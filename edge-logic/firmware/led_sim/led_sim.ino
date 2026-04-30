// LED simulator for Arduino Uno
// Gradually decreases LED intensity using PWM on a PWM-capable pin.

const int ledPin = 9;             // PWM pin (Uno: 3,5,6,9,10,11)
const int fadeStep = 5;           // decrement per step (0-255)
const long fadeDurationMs = 60000; // total fade duration in milliseconds (1 minute)
int stepDelay = 25;               // computed ms between PWM changes (set in setup)
const int holdDelay = 2500;        // hold time after fully dimmed

void setup() {
  pinMode(ledPin, OUTPUT);
  // start fully on
  analogWrite(ledPin, 255);

  // compute stepDelay so full fade takes ~fadeDurationMs
  int steps = 255 / fadeStep + 1;
  stepDelay = max(1L, fadeDurationMs / steps);
}

void loop() {
  // Gradually decrease brightness from full (255) to off (0)
  for (int b = 255; b >= 0; b -= fadeStep) {
    analogWrite(ledPin, b);
    delay(stepDelay);
  }

  // keep off briefly then restore to full and repeat
  analogWrite(ledPin, 0);
  delay(holdDelay);

  analogWrite(ledPin, 255);
  delay(holdDelay);
}
