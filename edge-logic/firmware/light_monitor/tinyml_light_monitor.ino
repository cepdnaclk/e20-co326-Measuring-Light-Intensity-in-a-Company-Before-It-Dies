#include <WiFi.h>
#include <PubSubClient.h>
#include "credentials.h"

const int ldrPin = 34;

WiFiClient espClient;
PubSubClient client(espClient);

#define WINDOW_SIZE 20

int readings[WINDOW_SIZE];
int indexPointer = 0;

long sum = 0;

String state = "NORMAL";

void setup_wifi()
{
  WiFi.begin(ssid, password);

  while (WiFi.status() != WL_CONNECTED)
  {
    delay(500);
    Serial.print(".");
  }

  Serial.println("WiFi connected");
}

void reconnect()
{
  while (!client.connected())
  {
    if (client.connect("LightMonitorESP32"))
    {
      Serial.println("MQTT connected");
    }
    else
    {
      delay(2000);
    }
  }
}

void setup()
{
  Serial.begin(115200);

  setup_wifi();
  client.setServer(mqtt_server, 1883);

  for(int i=0;i<WINDOW_SIZE;i++)
  {
    readings[i]=0;
  }
}

void loop()
{
  if (!client.connected())
  {
    reconnect();
  }

  client.loop();

  int value = analogRead(ldrPin);

  sum -= readings[indexPointer];
  readings[indexPointer] = value;
  sum += value;

  indexPointer++;
  indexPointer %= WINDOW_SIZE;

  int baseline = sum / WINDOW_SIZE;

  int deviation = baseline - value;

  if (deviation < 200)
      state = "NORMAL";
  else if (deviation < 1500)
      state = "DEGRADING";
  else
      state = "FAILURE";

  Serial.print("LDR: ");
  Serial.print(value);
  Serial.print(" Baseline: ");
  Serial.print(baseline);
  Serial.print(" State: ");
  Serial.println(state);

  char payload[50];
  sprintf(payload,"%d",value);

  client.publish("factory/light/ldr", payload);
  client.publish("factory/light/state", state.c_str());

  delay(1000);
}