export const PORT = process.env.PORT || 4000;
export const TICK_SECONDS = 0.5;
export const MQTT_URL = process.env.MQTT_URL || "mqtt://localhost:1883";
export const MQTT_TOPIC =
  process.env.MQTT_TOPIC || "factory/sitea/floor1/line1/cell1/lum_0001/telemetry/raw";
export const MQTT_CLIENT_ID =
  process.env.MQTT_CLIENT_ID || `led-simulator-${Math.random().toString(16).slice(2, 10)}`;
export const MQTT_ENABLED = (process.env.MQTT_ENABLED || "true").toLowerCase() !== "false";
export const DEFAULT_INSTANCE_ID = process.env.DEFAULT_INSTANCE_ID || "lum_0001";
export const MAX_HISTORY = 120;

export const HEALTHY_DEFAULTS = {
  ambientTemp: 25,
  humidity: 45,
  driveCurrent: 320,
  speed: 1,
  adcBits: 12,
};
