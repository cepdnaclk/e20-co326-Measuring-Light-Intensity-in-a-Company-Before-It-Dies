/*
 * led_sim.ino — LED Bulb Lifecycle Simulator
 * ============================================
 * Simulates a complete HEALTHY → DEGRADING → FAILED bulb lifecycle
 * within a configurable 1–30 second window on an Arduino Uno.
 *
 * The simulation compresses the full exponential-decay model into
 * the chosen period so you can watch all three TinyML states trigger.
 *
 * Hardware:
 *   - Arduino Uno (or any AVR with PWM)
 *   - LED + 10kΩ resistor on pin 9  (current limiting)
 *
 * Phases (mapped to TinyML model thresholds):
 *   HEALTHY   : brightness > 70%  → PWM 180–255  (smooth hold)
 *   DEGRADING : 30–70%            → PWM 76–179   (slow flicker)
 *   FAILED    : < 30%             → PWM 0–75     (rapid strobe)
 *
 * Cycle time: fixed via FIXED_CYCLE_MS below.
 *             Change it to any value between 1000 (1s) and 30000 (30s).
 */

// ─── Pin config ──────────────────────────────────────────────────────────────
const int LED_PIN  = 9;     // PWM output → LED → 10kΩ → GND
const bool USE_POT = false; // no pot — using fixed cycle time

// ─── Timing ──────────────────────────────────────────────────────────────────
// ↓ Change this to set how long one full HEALTHY→DEGRADING→FAILED cycle takes
const long FIXED_CYCLE_MS = 15000; // 15 s  (valid range: 1000–30000)

// ─── Phase proportions (must sum to 1.0) ─────────────────────────────────────
const float HEALTHY_FRAC   = 0.40f; // 40% of cycle in HEALTHY
const float DEGRADING_FRAC = 0.40f; // 40% in DEGRADING
const float FAILED_FRAC    = 0.15f; // 15% in FAILED
const float RESET_FRAC     = 0.05f; // 5%  quick recovery flash

// ─── Brightness bands (0–255 PWM, matches TinyML thresholds) ─────────────────
// HEALTHY   = intensity > 0.70  → PWM ~178–255
// DEGRADING = intensity 0.30–0.70 → PWM ~76–178
// FAILED    = intensity < 0.30  → PWM 0–76
const int HEALTHY_MAX   = 255;
const int HEALTHY_MIN   = 178;
const int DEGRADING_MAX = 177;
const int DEGRADING_MIN = 76;
const int FAILED_MAX    = 75;
const int FAILED_MIN    = 0;

// ─── Globals ──────────────────────────────────────────────────────────────────
long cycleDurationMs = FIXED_CYCLE_MS;

// ─── Helper: returns fixed cycle time ────────────────────────────────────────
long readCycleMs() {
  return FIXED_CYCLE_MS;
}

// ─── Helper: smooth fade between two PWM values over a duration ───────────────
void fadeTo(int fromPWM, int toPWM, long durationMs) {
  int steps = abs(toPWM - fromPWM);
  if (steps == 0) { delay(durationMs); return; }
  long stepDelay = max(1L, durationMs / steps);
  int dir = (toPWM > fromPWM) ? 1 : -1;
  int current = fromPWM;
  for (int i = 0; i < steps; i++) {
    current += dir;
    analogWrite(LED_PIN, current);
    delay(stepDelay);
  }
}

// ─── Helper: slow flicker in a brightness band ───────────────────────────────
void flickerInBand(int lo, int hi, long durationMs, int flickerHz) {
  long periodMs   = 1000L / max(1, flickerHz);
  long iterations = durationMs / (periodMs * 2);
  for (long i = 0; i < iterations; i++) {
    int bright = random(lo, hi + 1);
    analogWrite(LED_PIN, bright);
    delay(periodMs);
    analogWrite(LED_PIN, max(0, bright - random(10, 40)));
    delay(periodMs);
  }
}

// ─── Helper: rapid strobe for FAILED state ────────────────────────────────────
void strobe(int maxPWM, long durationMs, int rateHz) {
  long onOff     = 1000L / max(1, rateHz);
  long iterations = durationMs / (onOff * 2);
  for (long i = 0; i < iterations; i++) {
    analogWrite(LED_PIN, random(0, max(1, maxPWM)));
    delay(onOff);
    analogWrite(LED_PIN, 0);
    delay(onOff);
  }
}

void setup() {
  Serial.begin(115200);
  pinMode(LED_PIN, OUTPUT);
  analogWrite(LED_PIN, 0);
  randomSeed(analogRead(A1));  // seed RNG from floating pin
  Serial.println("LED Bulb Lifecycle Simulator started.");
}

void loop() {
  // Read cycle time (live from pot or fixed)
  cycleDurationMs = readCycleMs();

  long tHealthy   = (long)(cycleDurationMs * HEALTHY_FRAC);
  long tDegrading = (long)(cycleDurationMs * DEGRADING_FRAC);
  long tFailed    = (long)(cycleDurationMs * FAILED_FRAC);
  long tReset     = (long)(cycleDurationMs * RESET_FRAC);

  Serial.print("Cycle: "); Serial.print(cycleDurationMs / 1000.0f, 1);
  Serial.print("s  [H:"); Serial.print(tHealthy);
  Serial.print(" D:"); Serial.print(tDegrading);
  Serial.print(" F:"); Serial.print(tFailed);
  Serial.println("]");

  // ── Phase 1: HEALTHY ────────────────────────────────────────────────────────
  // Ramp up to full brightness and hold with tiny shimmer
  Serial.println("→ HEALTHY");
  fadeTo(0, HEALTHY_MAX, 200);
  long healthyEnd = millis() + tHealthy;
  while (millis() < healthyEnd) {
    // very slight shimmer to keep LDR from being perfectly flat
    int shimmer = HEALTHY_MAX - random(0, 8);
    analogWrite(LED_PIN, shimmer);
    delay(80);
  }

  // ── Phase 2: DEGRADING ──────────────────────────────────────────────────────
  // Slowly fade from healthy zone down through degrading zone with flicker
  Serial.println("→ DEGRADING");
  // First, fade from HEALTHY_MAX down to DEGRADING_MIN over the degrading period
  fadeTo(HEALTHY_MAX, DEGRADING_MAX, tDegrading / 4);
  flickerInBand(DEGRADING_MIN, DEGRADING_MAX, tDegrading / 2, 3);
  fadeTo(DEGRADING_MAX, DEGRADING_MIN, tDegrading / 4);

  // ── Phase 3: FAILED ─────────────────────────────────────────────────────────
  // Rapid strobe in low brightness range
  Serial.println("→ FAILED");
  fadeTo(DEGRADING_MIN, FAILED_MAX, 100);
  strobe(FAILED_MAX, tFailed, 8);   // 8 Hz strobe
  analogWrite(LED_PIN, 0);           // fully off
  delay(100);

  // ── Phase 4: RESET / Recovery flash ─────────────────────────────────────────
  Serial.println("→ RESET");
  // Brief bright flash (simulates replacement / restart)
  fadeTo(0, HEALTHY_MAX, tReset / 3);
  delay(tReset / 3);
  fadeTo(HEALTHY_MAX, 0, tReset / 3);
  delay(100);
}
