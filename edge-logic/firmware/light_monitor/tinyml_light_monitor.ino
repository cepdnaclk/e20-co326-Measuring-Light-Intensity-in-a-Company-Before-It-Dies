/*
 * tinyml_light_monitor.ino
 * ========================
 * ESP32 Edge AI firmware for LED bulb health monitoring.
 *
 * This firmware replaces the previous threshold-based classification
 * with a TensorFlow Lite Micro neural network that runs inference
 * directly on the ESP32 (Edge AI / TinyML).
 *
 * Hardware:
 *   - ESP32 DevKit
 *   - LDR (Light Dependent Resistor) on GPIO 34 (ADC1_CH6)
 *   - Relay module on GPIO 26 (for backup light switching)
 *
 * ML Model:
 *   - Architecture: Dense(16,ReLU) -> Dense(8,ReLU) -> Dense(3,Softmax)
 *   - Input (6 floats): ldr_norm, avg_norm, rate_of_change,
 *                        variance, min_norm, max_norm
 *   - Output (3 floats): P(HEALTHY), P(DEGRADING), P(FAILED)
 *   - Size: ~2 KB (int8 quantised TFLite)
 *
 * MQTT Topics Published:
 *   factory/light/ldr           - raw LDR ADC value (int)
 *   factory/light/edge-ai       - JSON: {status, confidence, scores,
 *                                        sudden_failure, ldr}
 *
 * Libraries Required (install via Arduino Library Manager):
 *   - EloquentTinyML  (TFLite Micro wrapper)
 *   - PubSubClient    (MQTT)
 *   - WiFi            (built-in ESP32)
 *
 * Author: LED Luminaire Monitor Team
 * Date:   April 2026
 */

#include <WiFi.h>
#include <PubSubClient.h>
#include <EloquentTinyML.h>
#include "credentials.h"
#include "bulb_model.h"    // Auto-generated TFLite model as C array

// -------------------------------------------------------------------------
// Pin definitions
// -------------------------------------------------------------------------
const int LDR_PIN = 34;         // LDR analog input (ADC1_CH6)
const int RELAY_PIN = 26;       // Relay output for backup light

// -------------------------------------------------------------------------
// ADC and window configuration
// -------------------------------------------------------------------------
#define ADC_MAX 4095.0f          // 12-bit ADC resolution
#define WINDOW_SIZE 20           // Sliding window size (matches training)

// -------------------------------------------------------------------------
// TinyML model configuration
// -------------------------------------------------------------------------
#define NUM_INPUTS 6             // Number of input features
#define NUM_OUTPUTS 3            // Number of output classes
#define TENSOR_ARENA_SIZE 4096   // Memory arena for TFLite (bytes)

// -------------------------------------------------------------------------
// Anomaly detection thresholds
// -------------------------------------------------------------------------
#define Z_SCORE_THRESHOLD 3.0f   // Z-score threshold for sudden failure
#define MIN_WINDOW_FILL 10       // Minimum readings before running ML

// -------------------------------------------------------------------------
// Class labels
// -------------------------------------------------------------------------
const char *CLASS_LABELS[] = {"HEALTHY", "DEGRADING", "FAILED"};

// -------------------------------------------------------------------------
// Global objects
// -------------------------------------------------------------------------
WiFiClient espClient;
PubSubClient mqttClient(espClient);

// EloquentTinyML model instance
Eloquent::TinyML::TfLite<NUM_INPUTS, NUM_OUTPUTS, TENSOR_ARENA_SIZE> ml;

// Sliding window for LDR readings
int readings[WINDOW_SIZE];
int windowIndex = 0;
int windowCount = 0;       // Tracks how many readings we have so far
long windowSum = 0;

// Current state
String currentState = "HEALTHY";
float currentConfidence = 0.0;
bool suddenFailure = false;


// =========================================================================
// WiFi setup
// =========================================================================
void setupWifi()
{
    WiFi.mode(WIFI_STA);
    WiFi.begin(ssid, password);

    Serial.print("Connecting to WiFi");
    while (WiFi.status() != WL_CONNECTED)
    {
        delay(500);
        Serial.print(".");
    }
    Serial.println();
    Serial.print("WiFi connected - IP: ");
    Serial.println(WiFi.localIP());
}

// =========================================================================
// MQTT reconnect
// =========================================================================
void reconnectMqtt()
{
    while (!mqttClient.connected())
    {
        Serial.print("Connecting to MQTT ... ");
        if (mqttClient.connect("LightMonitorESP32"))
        {
            Serial.println("connected.");
        }
        else
        {
            Serial.print("failed (rc=");
            Serial.print(mqttClient.state());
            Serial.println("). Retrying in 2s...");
            delay(2000);
        }
    }
}

// =========================================================================
// Feature extraction from the sliding window
// =========================================================================

/**
 * Compute the 6 normalised features that the TinyML model expects.
 *
 * Features:
 *   [0] ldr_norm        - current reading / ADC_MAX
 *   [1] avg_norm        - window mean / ADC_MAX
 *   [2] rate_of_change  - (newest - oldest) / ADC_MAX
 *   [3] variance        - normalised variance of the window
 *   [4] min_norm        - min(window) / ADC_MAX
 *   [5] max_norm        - max(window) / ADC_MAX
 */
void extractFeatures(float features[NUM_INPUTS])
{
    int n = min(windowCount, WINDOW_SIZE);

    // Current reading (the most recent one added)
    int currentIdx = (windowIndex - 1 + WINDOW_SIZE) % WINDOW_SIZE;
    int currentVal = readings[currentIdx];

    // Oldest reading in the circular buffer
    int oldestIdx = (windowIndex) % WINDOW_SIZE;
    int oldestVal = readings[oldestIdx];

    // Compute mean
    float mean = (float)windowSum / n;

    // Find min, max, and variance in one pass
    int minVal = readings[0];
    int maxVal = readings[0];
    float varSum = 0.0f;

    for (int i = 0; i < n; i++)
    {
        if (readings[i] < minVal) minVal = readings[i];
        if (readings[i] > maxVal) maxVal = readings[i];
        float diff = readings[i] - mean;
        varSum += diff * diff;
    }

    float variance = varSum / n;

    // Populate feature array (normalised)
    features[0] = currentVal / ADC_MAX;                // ldr_norm
    features[1] = mean / ADC_MAX;                      // avg_norm
    features[2] = (currentVal - oldestVal) / ADC_MAX;  // rate_of_change
    features[3] = variance / (ADC_MAX * ADC_MAX);      // variance (normalised)
    features[4] = minVal / ADC_MAX;                    // min_norm
    features[5] = maxVal / ADC_MAX;                    // max_norm
}

// =========================================================================
// Sudden failure detection (Z-score)
// =========================================================================

/**
 * Check if the latest LDR reading is an anomaly compared to the
 * sliding window.  Uses Z-score: if |value - mean| > 3 sigma the
 * reading is flagged as a sudden failure.
 *
 * Returns true if a sudden failure is detected.
 */
bool detectSuddenFailure(int latestValue)
{
    int n = min(windowCount, WINDOW_SIZE);
    if (n < MIN_WINDOW_FILL) return false;  // Not enough data yet

    float mean = (float)windowSum / n;

    // Compute standard deviation
    float varSum = 0.0f;
    for (int i = 0; i < n; i++)
    {
        float diff = readings[i] - mean;
        varSum += diff * diff;
    }
    float stdDev = sqrt(varSum / n);

    // Avoid division by zero
    if (stdDev < 1.0f) return false;

    float zScore = fabs(latestValue - mean) / stdDev;
    return (zScore > Z_SCORE_THRESHOLD);
}

// =========================================================================
// Publish edge AI results to MQTT
// =========================================================================

/**
 * Publish the TinyML classification result as a JSON payload.
 *
 * Topic: factory/light/edge-ai
 * Payload example:
 *   {"status":"DEGRADING","confidence":0.87,
 *    "scores":[0.08,0.87,0.05],"sudden_failure":false,"ldr":2450}
 */
void publishEdgeAiResult(int ldrValue, float output[NUM_OUTPUTS], int classIdx)
{
    char json[256];
    snprintf(json, sizeof(json),
             "{\"status\":\"%s\",\"confidence\":%.2f,"
             "\"scores\":[%.2f,%.2f,%.2f],"
             "\"sudden_failure\":%s,\"ldr\":%d}",
             CLASS_LABELS[classIdx],
             output[classIdx],
             output[0], output[1], output[2],
             suddenFailure ? "true" : "false",
             ldrValue);

    mqttClient.publish("factory/light/edge-ai", json);
}

// =========================================================================
// Arduino setup
// =========================================================================
void setup()
{
    Serial.begin(115200);
    analogReadResolution(12);          // 12-bit ADC (0..4095)
    pinMode(RELAY_PIN, OUTPUT);
    digitalWrite(RELAY_PIN, HIGH);     // Relay OFF by default

    // Initialise sliding window to zero
    for (int i = 0; i < WINDOW_SIZE; i++)
    {
        readings[i] = 0;
    }

    // Connect to WiFi and MQTT
    setupWifi();
    mqttClient.setServer(mqtt_server, 1883);

    // Initialise TinyML model
    if (!ml.begin(bulb_model))
    {
        Serial.println("ERROR: Failed to load TinyML model!");
        while (true) { delay(1000); }  // Halt on model load failure
    }
    Serial.println("TinyML model loaded successfully.");
}

// =========================================================================
// Arduino main loop
// =========================================================================
void loop()
{
    // Reconnect MQTT if needed
    if (!mqttClient.connected())
    {
        reconnectMqtt();
    }
    mqttClient.loop();

    // ---- 1. Read LDR sensor ----
    int ldrValue = analogRead(LDR_PIN);

    // ---- 2. Update sliding window ----
    windowSum -= readings[windowIndex];
    readings[windowIndex] = ldrValue;
    windowSum += ldrValue;
    windowIndex = (windowIndex + 1) % WINDOW_SIZE;
    if (windowCount < WINDOW_SIZE) windowCount++;

    // ---- 3. Check for sudden failure (Z-score anomaly) ----
    suddenFailure = detectSuddenFailure(ldrValue);

    // ---- 4. Run TinyML inference (once window is filled enough) ----
    int predictedClass = 0;
    float confidence = 0.0;
    float output[NUM_OUTPUTS] = {1.0, 0.0, 0.0};  // Default: HEALTHY

    if (windowCount >= MIN_WINDOW_FILL)
    {
        float features[NUM_INPUTS];
        extractFeatures(features);

        // Run inference - populates output[] with probabilities
        ml.predict(features, output);

        // Find class with highest probability
        predictedClass = 0;
        confidence = output[0];
        for (int i = 1; i < NUM_OUTPUTS; i++)
        {
            if (output[i] > confidence)
            {
                confidence = output[i];
                predictedClass = i;
            }
        }

        currentState = CLASS_LABELS[predictedClass];
        currentConfidence = confidence;
    }

    // ---- 5. Control relay based on ML classification ----
    // Turn ON backup light if bulb is DEGRADING or FAILED
    if (predictedClass == 0)
    {
        // HEALTHY - no backup needed
        digitalWrite(RELAY_PIN, HIGH);
    }
    else
    {
        // DEGRADING or FAILED - activate backup light
        digitalWrite(RELAY_PIN, LOW);
    }

    // ---- 6. Serial monitor output (for debugging) ----
    Serial.print("LDR: ");
    Serial.print(ldrValue);
    Serial.print(" | Status: ");
    Serial.print(currentState);
    Serial.print(" (");
    Serial.print(currentConfidence, 2);
    Serial.print(") | Sudden: ");
    Serial.println(suddenFailure ? "YES" : "no");

    // ---- 7. Publish to MQTT ----
    // Raw LDR value
    char ldrPayload[16];
    snprintf(ldrPayload, sizeof(ldrPayload), "%d", ldrValue);
    mqttClient.publish("factory/light/ldr", ldrPayload);

    // Edge AI classification result
    publishEdgeAiResult(ldrValue, output, predictedClass);

    // ---- 8. Wait before next reading ----
    delay(1000);
}