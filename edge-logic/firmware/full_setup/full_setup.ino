#include <WiFi.h>
#include <PubSubClient.h>
#include "credentials.h"

const int ldrPin = 34;
const int relayBackup = 26;

WiFiClient espClient;
PubSubClient client(espClient);

void setupWifi()
{
	WiFi.mode(WIFI_STA);
	WiFi.begin(ssid, password);

	while (WiFi.status() != WL_CONNECTED)
	{
		delay(500);
		Serial.print('.');
	}

	Serial.println();
	Serial.println("WiFi connected");
}

void reconnectMqtt()
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
	analogReadResolution(12);
	pinMode(relayBackup, OUTPUT);
	digitalWrite(relayBackup, HIGH);

	setupWifi();

	client.setServer(mqtt_server, 1883);
}

void loop()
{
	if (!client.connected())
	{
		reconnectMqtt();
	}

	client.loop();

	int ldrValue = analogRead(ldrPin);
	const char *status = "NORMAL";

	if (ldrValue >= 3000)
	{
		digitalWrite(relayBackup, HIGH);
		status = "NORMAL";
	}
	else if (ldrValue >= 1000)
	{
		digitalWrite(relayBackup, LOW);
		status = "DEGRADING";
	}
	else
	{
		digitalWrite(relayBackup, LOW);
		status = "FAILED / VERY LOW";
	}

	Serial.print("LDR Value: ");
	Serial.println(ldrValue);
	Serial.print("Status: ");
	Serial.println(status);

	char payload[16];
	snprintf(payload, sizeof(payload), "%d", ldrValue);
	client.publish("factory/light/ldr", payload);

	delay(1000);
}
