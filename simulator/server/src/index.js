import express from "express";
import cors from "cors";
import mqtt from "mqtt";

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 4000;
const TICK_SECONDS = 0.5;
const MQTT_URL = process.env.MQTT_URL || "mqtt://localhost:1883";
const MQTT_TOPIC = process.env.MQTT_TOPIC || "led/simulator/sensors";
const MQTT_CLIENT_ID =
  process.env.MQTT_CLIENT_ID || `led-simulator-${Math.random().toString(16).slice(2, 10)}`;
const MQTT_ENABLED = (process.env.MQTT_ENABLED || "true").toLowerCase() !== "false";
const HEALTHY_DEFAULTS = {
  ambientTemp: 25,
  humidity: 45,
  driveCurrent: 320,
  speed: 1,
  adcBits: 12,
};

const state = {
  playing: false,
  speed: HEALTHY_DEFAULTS.speed,
  timeHours: 0,
  ambientTemp: HEALTHY_DEFAULTS.ambientTemp,
  humidity: HEALTHY_DEFAULTS.humidity,
  driveCurrent: HEALTHY_DEFAULTS.driveCurrent,
  anomalies: {
    rgb: { enabled: false, r: 0, g: 0, b: 0 },
    ldr: { enabled: false, value: 0 },
    ripple: { enabled: false, value: 0 },
  },
  sensors: {
    rgb: { R: 0, G: 0, B: 0, C: 0 },
    ldr: 0,
    ripplePercent: 0,
  },
  adc: {
    bits: HEALTHY_DEFAULTS.adcBits,
    max: HEALTHY_DEFAULTS.adcBits === 12 ? 4095 : 1023,
  },
  initialValues: {
    ambientTemp: HEALTHY_DEFAULTS.ambientTemp,
    humidity: HEALTHY_DEFAULTS.humidity,
    driveCurrent: HEALTHY_DEFAULTS.driveCurrent,
    speed: HEALTHY_DEFAULTS.speed,
    adcBits: HEALTHY_DEFAULTS.adcBits,
  },
  rulModel: {
    baseLifeHours: 12000,
    hoursPenalty: 0.55,
    ripplePenalty: 85,
    tempPenalty: 22,
    currentPenalty: 12,
    anomalyPenalty: 2200,
    minRul: 0,
  },
  derived: {
    anomalyScore: 0,
    rulHours: 12000,
  },
};

const history = [];
let mqttClient = null;
let mqttConnected = false;

const clamp = (v, min, max) => Math.min(max, Math.max(min, v));
const noise = (v, ratio = 0.03) => v + (Math.random() - 0.5) * 2 * v * ratio;

function initMqtt() {
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

function publishSensorSample() {
  if (!mqttClient || !mqttConnected) return;

  const payload = {
    timestamp: new Date().toISOString(),
    sim: {
      timeHours: Number(state.timeHours.toFixed(2)),
      speed: state.speed,
      playing: state.playing,
    },
    environment: {
      ambientTemp: state.ambientTemp,
      humidity: state.humidity,
      driveCurrent: state.driveCurrent,
    },
    sensors: {
      tcs34725: state.sensors.rgb,
      ldrAdc: state.sensors.ldr,
      ripplePercent: state.sensors.ripplePercent,
    },
    derived: state.derived,
    adc: state.adc,
    anomalies: state.anomalies,
  };

  mqttClient.publish(MQTT_TOPIC, JSON.stringify(payload), { qos: 0, retain: false }, (err) => {
    if (err) {
      console.warn(`Failed to publish MQTT sample: ${err.message}`);
    }
  });
}

function applyInitialValues(resetTime = true) {
  state.ambientTemp = state.initialValues.ambientTemp;
  state.humidity = state.initialValues.humidity;
  state.driveCurrent = state.initialValues.driveCurrent;
  state.speed = state.initialValues.speed;
  state.adc.bits = state.initialValues.adcBits >= 12 ? 12 : 10;
  state.adc.max = state.adc.bits === 12 ? 4095 : 1023;
  if (resetTime) {
    state.timeHours = 0;
    history.length = 0;
  }
  state.anomalies.rgb.enabled = false;
  state.anomalies.ldr.enabled = false;
  state.anomalies.ripple.enabled = false;
}

function simulate() {
  if (!state.playing) return;

  state.timeHours += TICK_SECONDS * state.speed * 30;

  const intensity =
    Math.exp(-0.00006 * state.timeHours) *
    (1 - Math.max(0, state.ambientTemp - 25) * 0.0025) *
    (1 - Math.max(0, state.humidity - 50) * 0.001) *
    (1 + (state.driveCurrent - 350) * 0.0004);

  const safeIntensity = clamp(intensity, 0.05, 1.1);
  const adcMax = state.adc.max;
  const baseR = clamp(noise(255 * safeIntensity * 1.0), 0, 1023);
  const baseG = clamp(noise(240 * safeIntensity * 0.95), 0, 1023);
  const baseB = clamp(noise(225 * safeIntensity * 0.9), 0, 1023);
  const baseLdr = clamp(
    noise((adcMax * Math.log10(1 + safeIntensity * 9)) / Math.log10(10), 0.02),
    0,
    adcMax
  );
  const baseRipple = clamp(
    noise((1 + state.timeHours * 0.0001 + (state.driveCurrent - 350) * 0.0005) * 1.6, 0.1),
    0.2,
    45
  );

  const finalR = state.anomalies.rgb.enabled ? state.anomalies.rgb.r : baseR;
  const finalG = state.anomalies.rgb.enabled ? state.anomalies.rgb.g : baseG;
  const finalB = state.anomalies.rgb.enabled ? state.anomalies.rgb.b : baseB;
  const finalLdr = state.anomalies.ldr.enabled ? state.anomalies.ldr.value : baseLdr;
  const finalRipple = state.anomalies.ripple.enabled
    ? state.anomalies.ripple.value
    : baseRipple;

  state.sensors.rgb = {
    R: Math.round(finalR),
    G: Math.round(finalG),
    B: Math.round(finalB),
    C: Math.round(finalR + finalG + finalB),
  };
  state.sensors.ldr = Math.round(finalLdr);
  state.sensors.ripplePercent = Number(finalRipple.toFixed(2));

  const anomalyScore =
    0.35 * Number(state.anomalies.rgb.enabled) +
    0.3 * Number(state.anomalies.ldr.enabled) +
    0.35 * Number(state.anomalies.ripple.enabled);

  const rippleRatio = state.sensors.ripplePercent / 100;
  const tempRise = Math.max(0, state.ambientTemp - 25);
  const currentRiseRatio = Math.max(0, (state.driveCurrent - 350) / 350);
  const model = state.rulModel;
  const rul =
    model.baseLifeHours -
    state.timeHours * model.hoursPenalty -
    rippleRatio * model.ripplePenalty * 100 -
    tempRise * model.tempPenalty -
    currentRiseRatio * model.currentPenalty * 100 -
    anomalyScore * model.anomalyPenalty;

  state.derived.anomalyScore = Number(anomalyScore.toFixed(2));
  state.derived.rulHours = Math.max(model.minRul, Math.round(rul));

  history.push({
    t: Math.round(state.timeHours),
    rgb: { ...state.sensors.rgb },
    ldr: state.sensors.ldr,
    ripplePercent: state.sensors.ripplePercent,
  });
  if (history.length > 120) history.shift();

  publishSensorSample();
}

setInterval(simulate, TICK_SECONDS * 1000);
initMqtt();

app.get("/api/state", (_req, res) => {
  res.json({ ...state, history });
});

app.post("/api/control", (req, res) => {
  const { playing, speed, ambientTemp, humidity, driveCurrent, adcBits } = req.body;

  if (typeof playing === "boolean") state.playing = playing;
  if (typeof speed === "number") state.speed = clamp(speed, 0.25, 8);
  if (typeof ambientTemp === "number") state.ambientTemp = clamp(ambientTemp, -10, 100);
  if (typeof humidity === "number") state.humidity = clamp(humidity, 0, 100);
  if (typeof driveCurrent === "number") state.driveCurrent = clamp(driveCurrent, 50, 700);
  if (typeof adcBits === "number") {
    const bits = adcBits >= 12 ? 12 : 10;
    state.adc.bits = bits;
    state.adc.max = bits === 12 ? 4095 : 1023;
    state.anomalies.ldr.value = clamp(state.anomalies.ldr.value, 0, state.adc.max);
  }

  res.json({ ok: true, state });
});

app.post("/api/anomalies", (req, res) => {
  const { rgb, ldr, ripple } = req.body;

  if (rgb) {
    state.anomalies.rgb.enabled = !!rgb.enabled;
    if (typeof rgb.r === "number") state.anomalies.rgb.r = clamp(rgb.r, 0, 1023);
    if (typeof rgb.g === "number") state.anomalies.rgb.g = clamp(rgb.g, 0, 1023);
    if (typeof rgb.b === "number") state.anomalies.rgb.b = clamp(rgb.b, 0, 1023);
  }
  if (ldr) {
    state.anomalies.ldr.enabled = !!ldr.enabled;
    if (typeof ldr.value === "number") state.anomalies.ldr.value = clamp(ldr.value, 0, state.adc.max);
  }
  if (ripple) {
    state.anomalies.ripple.enabled = !!ripple.enabled;
    if (typeof ripple.value === "number") {
      state.anomalies.ripple.value = clamp(ripple.value, 0, 100);
    }
  }

  res.json({ ok: true, anomalies: state.anomalies });
});

app.post("/api/rul-model", (req, res) => {
  const {
    baseLifeHours,
    hoursPenalty,
    ripplePenalty,
    tempPenalty,
    currentPenalty,
    anomalyPenalty,
    minRul,
  } = req.body;

  const model = state.rulModel;
  if (typeof baseLifeHours === "number") model.baseLifeHours = clamp(baseLifeHours, 100, 50000);
  if (typeof hoursPenalty === "number") model.hoursPenalty = clamp(hoursPenalty, 0, 10);
  if (typeof ripplePenalty === "number") model.ripplePenalty = clamp(ripplePenalty, 0, 1000);
  if (typeof tempPenalty === "number") model.tempPenalty = clamp(tempPenalty, 0, 200);
  if (typeof currentPenalty === "number") model.currentPenalty = clamp(currentPenalty, 0, 200);
  if (typeof anomalyPenalty === "number") model.anomalyPenalty = clamp(anomalyPenalty, 0, 20000);
  if (typeof minRul === "number") model.minRul = clamp(minRul, 0, 50000);

  res.json({ ok: true, rulModel: model });
});

app.post("/api/initial-values", (req, res) => {
  const { ambientTemp, humidity, driveCurrent, speed, adcBits, applyNow } = req.body;

  if (typeof ambientTemp === "number") state.initialValues.ambientTemp = clamp(ambientTemp, -10, 100);
  if (typeof humidity === "number") state.initialValues.humidity = clamp(humidity, 0, 100);
  if (typeof driveCurrent === "number") state.initialValues.driveCurrent = clamp(driveCurrent, 50, 700);
  if (typeof speed === "number") state.initialValues.speed = clamp(speed, 0.25, 8);
  if (typeof adcBits === "number") state.initialValues.adcBits = adcBits >= 12 ? 12 : 10;

  if (applyNow) {
    applyInitialValues(true);
  }

  res.json({ ok: true, initialValues: state.initialValues, state });
});

app.listen(PORT, () => {
  console.log(`Simulator API running on http://localhost:${PORT}`);
  if (MQTT_ENABLED) {
    console.log(`Publishing sensor samples to MQTT topic: ${MQTT_TOPIC}`);
  }
});
