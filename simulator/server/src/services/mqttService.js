import mqtt from "mqtt";
import { MQTT_CLIENT_ID, MQTT_ENABLED, MQTT_URL } from "../config.js";

let mqttClient = null;
let mqttConnected = false;

export function initMqtt() {
  if (!MQTT_ENABLED) {
    console.log("MQTT publishing disabled (MQTT_ENABLED=false).");
    return;
  }

  mqttClient = mqtt.connect(MQTT_URL, {
    clientId: MQTT_CLIENT_ID,
    reconnectPeriod: 2000,
    connectTimeout: 5000,
  });

  mqttClient.on("connect", () => {
    mqttConnected = true;
    console.log(`Connected to MQTT broker: ${MQTT_URL}`);
  });

  mqttClient.on("reconnect", () => {
    mqttConnected = false;
  });

  mqttClient.on("close", () => {
    mqttConnected = false;
  });

  mqttClient.on("error", (err) => {
    mqttConnected = false;
    console.warn(`MQTT error: ${err.message}`);
  });
}

export function publishSensorSample(instance) {
  if (!mqttClient || !mqttConnected) return;

  const payload = {
    timestamp: new Date().toISOString(),
    lamp: {
      id: instance.id,
      location: instance.location,
      topicBase: instance.topicBase,
    },
    sim: {
      timeHours: Number(instance.timeHours.toFixed(2)),
      speed: instance.speed,
      playing: instance.playing,
    },
    environment: {
      ambientTemp: instance.ambientTemp,
      humidity: instance.humidity,
      driveCurrent: instance.driveCurrent,
    },
    sensors: {
      tcs34725: instance.sensors.rgb,
      ldrAdc: instance.sensors.ldr,
      ripplePercent: instance.sensors.ripplePercent,
    },
    derived: instance.derived,
    adc: instance.adc,
    anomalies: instance.anomalies,
  };

  mqttClient.publish(instance.mqttTopic, JSON.stringify(payload), { qos: 0, retain: false }, (err) => {
    if (err) {
      console.warn(`Failed to publish MQTT sample: ${err.message}`);
    }
  });
}
