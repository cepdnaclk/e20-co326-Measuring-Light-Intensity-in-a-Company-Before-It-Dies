/*
 * tinyml_light_monitor.ino
 * ========================
 * ESP32 Edge AI firmware for LED bulb health monitoring.
 *
 * Updated for EloquentTinyML v3.x API
 *
 * Libraries Required:
 *   1. tflm_esp32         - install via Library Manager (search "tflm_esp32")
 *   2. EloquentTinyML     - already installed (v3.0.1)
 *   3. PubSubClient       - already installed
 *   4. WiFi               - built-in ESP32
 *
 * Hardware:
 *   - ESP32 DevKit (30-pin)
 *   - LDR on GPIO 34 (ADC1_CH6) — voltage divider with 10kΩ to GND
 *   - LED/Relay on GPIO 26      — active LOW
 *
 * Partition Scheme: Huge APP (3MB No OTA)  <-- REQUIRED
 *
 * ML Model:
 *   - Architecture: Dense(16,ReLU) -> Dense(8,ReLU) -> Dense(3,Softmax)
 *   - Input  (6 floats): ldr_norm, avg_norm, rate_of_change, variance, min_norm, max_norm
 *   - Output (3 floats): P(HEALTHY), P(DEGRADING), P(FAILED)
 *
 * MQTT Topics:
 *   factory/light/ldr      - raw ADC integer (0-4095)
 *   factory/light/edge-ai  - JSON classification result
 */

// ── Step 1: include model BEFORE tflm headers ────────────────────────────────
#include "bulb_model.h"

// ── Step 2: include tflm runtime for ESP32 ───────────────────────────────────
#include <tflm_esp32.h>

// ── Step 3: include EloquentTinyML wrapper ────────────────────────────────────
#include <eloquent_tinyml.h>

// ── Step 4: other includes ────────────────────────────────────────────────────
#include <WiFi.h>
#include <PubSubClient.h>
#include "credentials.h"

// ─────────────────────────────────────────────────────────────────────────────
// Pin definitions
// ─────────────────────────────────────────────────────────────────────────────
const int LDR_PIN   = 34;   // LDR analog input
const int RELAY_PIN = 26;   // LED / relay output (active LOW)

// ─────────────────────────────────────────────────────────────────────────────
// ADC & window config
// ─────────────────────────────────────────────────────────────────────────────
#define ADC_MAX       4095.0f
#define WINDOW_SIZE   20
#define MIN_WINDOW_FILL 10

// ─────────────────────────────────────────────────────────────────────────────
// TinyML v3 config
//   TF_NUM_OPS is defined inside bulb_model.h (auto-generated).
//   If it is NOT defined there, set it manually: #define TF_NUM_OPS 5
//   Our model uses: FullyConnected + Softmax + Relu + Quantize + Dequantize
// ─────────────────────────────────────────────────────────────────────────────
#ifndef TF_NUM_OPS
  #define TF_NUM_OPS 5
#endif

#define ARENA_SIZE 8000    // bytes — increase if model load fails

Eloquent::TF::Sequential<TF_NUM_OPS, ARENA_SIZE> tf;

// ─────────────────────────────────────────────────────────────────────────────
// Anomaly detection
// ─────────────────────────────────────────────────────────────────────────────
#define Z_SCORE_THRESHOLD 3.0f

// ─────────────────────────────────────────────────────────────────────────────
// Class labels
// ─────────────────────────────────────────────────────────────────────────────
const char *CLASS_LABELS[] = {"HEALTHY", "DEGRADING", "FAILED"};

// ─────────────────────────────────────────────────────────────────────────────
// MQTT & WiFi
// ─────────────────────────────────────────────────────────────────────────────
WiFiClient   espClient;
PubSubClient mqttClient(espClient);

// ─────────────────────────────────────────────────────────────────────────────
// Sliding window
// ─────────────────────────────────────────────────────────────────────────────
int   readings[WINDOW_SIZE];
int   windowIndex = 0;
int   windowCount = 0;
long  windowSum   = 0;

// ─────────────────────────────────────────────────────────────────────────────
// State
// ─────────────────────────────────────────────────────────────────────────────
bool  suddenFailure     = false;
float currentConfidence = 0.0f;
int   predictedClass    = 0;


// =============================================================================
// WiFi
// =============================================================================
void setupWifi()
{
    WiFi.mode(WIFI_STA);
    WiFi.begin(ssid, password);
    Serial.print("Connecting to WiFi");
    while (WiFi.status() != WL_CONNECTED) {
        delay(500);
        Serial.print(".");
    }
    Serial.println();
    Serial.print("WiFi connected – IP: ");
    Serial.println(WiFi.localIP());
}

// =============================================================================
// MQTT reconnect
// =============================================================================
void reconnectMqtt()
{
    while (!mqttClient.connected()) {
        Serial.print("Connecting to MQTT ... ");
        if (mqttClient.connect("LightMonitorESP32")) {
            Serial.println("connected.");
        } else {
            Serial.print("failed (rc=");
            Serial.print(mqttClient.state());
            Serial.println("). Retrying in 2 s...");
            delay(2000);
        }
    }
}

// =============================================================================
// Feature extraction from sliding window
// =============================================================================
void extractFeatures(float features[6])
{
    int n = min(windowCount, WINDOW_SIZE);

    int currentIdx = (windowIndex - 1 + WINDOW_SIZE) % WINDOW_SIZE;
    int currentVal = readings[currentIdx];
    int oldestIdx  = windowIndex % WINDOW_SIZE;
    int oldestVal  = readings[oldestIdx];

    float mean   = (float)windowSum / n;
    int   minVal = readings[0];
    int   maxVal = readings[0];
    float varSum = 0.0f;

    for (int i = 0; i < n; i++) {
        if (readings[i] < minVal) minVal = readings[i];
        if (readings[i] > maxVal) maxVal = readings[i];
        float diff = readings[i] - mean;
        varSum += diff * diff;
    }

    features[0] = currentVal / ADC_MAX;                // ldr_norm
    features[1] = mean       / ADC_MAX;                // avg_norm
    features[2] = (currentVal - oldestVal) / ADC_MAX;  // rate_of_change
    features[3] = (varSum / n) / (ADC_MAX * ADC_MAX);  // variance (normalised)
    features[4] = minVal / ADC_MAX;                    // min_norm
    features[5] = maxVal / ADC_MAX;                    // max_norm
}

// =============================================================================
// Z-score sudden failure detection
// =============================================================================
bool detectSuddenFailure(int latestValue)
{
    int n = min(windowCount, WINDOW_SIZE);
    if (n < MIN_WINDOW_FILL) return false;

    float mean   = (float)windowSum / n;
    float varSum = 0.0f;
    for (int i = 0; i < n; i++) {
        float d = readings[i] - mean;
        varSum += d * d;
    }
    float stdDev = sqrt(varSum / n);
    if (stdDev < 1.0f) return false;

    float zScore = fabs(latestValue - mean) / stdDev;
    return (zScore > Z_SCORE_THRESHOLD);
}

// =============================================================================
// Publish edge-AI result as JSON
// =============================================================================
void publishEdgeAiResult(int ldrValue)
{
    char json[256];
    snprintf(json, sizeof(json),
             "{\"status\":\"%s\",\"confidence\":%.2f,"
             "\"scores\":[%.2f,%.2f,%.2f],"
             "\"sudden_failure\":%s,\"ldr\":%d}",
             CLASS_LABELS[predictedClass],
             currentConfidence,
             tf.output(0), tf.output(1), tf.output(2),
             suddenFailure ? "true" : "false",
             ldrValue);

    mqttClient.publish("factory/light/edge-ai", json);
}


// =============================================================================
// setup()
// =============================================================================
void setup()
{
    Serial.begin(115200);
    analogReadResolution(12);
    pinMode(RELAY_PIN, OUTPUT);
    digitalWrite(RELAY_PIN, HIGH);  // relay OFF by default

    // Zero out sliding window
    for (int i = 0; i < WINDOW_SIZE; i++) readings[i] = 0;

    // WiFi & MQTT
    setupWifi();
    mqttClient.setServer(mqtt_server, 1883);

    // ── TinyML v3 init ────────────────────────────────────────────────────────
    tf.setNumInputs(6);
    tf.setNumOutputs(3);

    // Register only the ops our model uses
    tf.resolver.AddFullyConnected();
    tf.resolver.AddSoftmax();
    tf.resolver.AddRelu();
    tf.resolver.AddQuantize();
    tf.resolver.AddDequantize();

    while (!tf.begin(bulb_model).isOk()) {
        Serial.print("Model load error: ");
        Serial.println(tf.exception.toString());
        delay(1000);
    }
    Serial.println("TinyML model loaded successfully.");
}


// =============================================================================
// loop()
// =============================================================================
void loop()
{
    // ── MQTT keep-alive ───────────────────────────────────────────────────────
    if (!mqttClient.connected()) reconnectMqtt();
    mqttClient.loop();

    // ── 1. Read LDR ───────────────────────────────────────────────────────────
    int ldrValue = analogRead(LDR_PIN);

    // ── 2. Update sliding window ──────────────────────────────────────────────
    windowSum -= readings[windowIndex];
    readings[windowIndex] = ldrValue;
    windowSum += ldrValue;
    windowIndex = (windowIndex + 1) % WINDOW_SIZE;
    if (windowCount < WINDOW_SIZE) windowCount++;

    // ── 3. Anomaly detection ──────────────────────────────────────────────────
    suddenFailure = detectSuddenFailure(ldrValue);

    // ── 4. TinyML inference ───────────────────────────────────────────────────
    predictedClass    = 0;
    currentConfidence = 1.0f;

    if (windowCount >= MIN_WINDOW_FILL) {
        float features[6];
        extractFeatures(features);

        if (tf.predict(features).isOk()) {
            predictedClass    = tf.classification;
            currentConfidence = tf.output(predictedClass);
        } else {
            Serial.print("Inference error: ");
            Serial.println(tf.exception.toString());
        }
    }

    // ── 5. LED / relay control ────────────────────────────────────────────────
    // HEALTHY → relay OFF (HIGH)  |  DEGRADING / FAILED → relay ON (LOW)
    digitalWrite(RELAY_PIN, (predictedClass == 0) ? HIGH : LOW);

    // ── 6. Serial debug ───────────────────────────────────────────────────────
    Serial.print("LDR: ");
    Serial.print(ldrValue);
    Serial.print(" | Status: ");
    Serial.print(CLASS_LABELS[predictedClass]);
    Serial.print(" (");
    Serial.print(currentConfidence, 2);
    Serial.print(") | Sudden: ");
    Serial.println(suddenFailure ? "YES" : "no");

    // ── 7. Publish to MQTT ────────────────────────────────────────────────────
    char ldrPayload[16];
    snprintf(ldrPayload, sizeof(ldrPayload), "%d", ldrValue);
    mqttClient.publish("factory/light/ldr", ldrPayload);

    publishEdgeAiResult(ldrValue);

    // ── 8. Wait ───────────────────────────────────────────────────────────────
    delay(1000);
}