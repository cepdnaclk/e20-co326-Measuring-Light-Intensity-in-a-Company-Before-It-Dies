const int ldrPin = 34;
const int relayBackup = 26;   // Relay 1
const int relayWarning = 27;  // Relay 2

int ldrValue = 0;

void setup() {
  Serial.begin(115200);

  pinMode(relayBackup, OUTPUT);
  pinMode(relayWarning, OUTPUT);

  // Assuming active LOW relays
  digitalWrite(relayBackup, HIGH);   // OFF
  digitalWrite(relayWarning, HIGH);  // OFF
}

void loop() {
  ldrValue = analogRead(ldrPin);

  Serial.print("LDR Value: ");
  Serial.println(ldrValue);

  // State A: Normal
  if (ldrValue >= 3600) {
    digitalWrite(relayBackup, HIGH);   // OFF
    digitalWrite(relayWarning, HIGH);  // OFF
    Serial.println("Status: NORMAL");
  }
  // State B: Degrading
  else if (ldrValue >= 1000 && ldrValue < 3600) {
    digitalWrite(relayBackup, HIGH);   // OFF
    digitalWrite(relayWarning, LOW);   // ON
    Serial.println("Status: DEGRADING");
  }
  // State C: Failed / Very Low
  else {
    digitalWrite(relayBackup, LOW);    // ON
    digitalWrite(relayWarning, LOW);   // ON
    Serial.println("Status: FAILED / VERY LOW");
  }

  delay(500);
}