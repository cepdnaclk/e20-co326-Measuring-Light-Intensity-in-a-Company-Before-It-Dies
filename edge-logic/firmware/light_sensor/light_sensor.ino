// use 34 as reading pin. 3.3v supply

const int ldrPin = 34;

void setup() {
  Serial.begin(115200);
}

void loop() {
    int ldrValue = analogRead(ldrPin);
    Serial.print("LDR Value: ");
    Serial.println(ldrValue);
    delay(500); // Delay for 0.5 second before the next reading
}