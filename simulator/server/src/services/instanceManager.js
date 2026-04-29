import { DEFAULT_INSTANCE_ID, HEALTHY_DEFAULTS, MAX_HISTORY, MQTT_TOPIC, TICK_SECONDS } from "../config.js";
import { clamp, noise } from "../utils/math.js";
import { sanitizePathSegment } from "../utils/path.js";

const instances = new Map();

const buildTopicBase = (location, luminaireId) =>
  `factory/${location.site}/${location.floor}/${location.line}/${location.cell}/${luminaireId}`;

export function createLampState(instanceId, overrides = {}, options = {}) {
  const location = {
    site: sanitizePathSegment(overrides?.location?.site, "sitea"),
    floor: sanitizePathSegment(overrides?.location?.floor, "floor1"),
    line: sanitizePathSegment(overrides?.location?.line, "line1"),
    cell: sanitizePathSegment(overrides?.location?.cell, "cell1"),
  };
  const topicBase = overrides.topicBase || buildTopicBase(location, instanceId);
  const defaultTopic = `${topicBase}/telemetry/raw`;

  const initialSpeed = typeof overrides.speed === "number" ? overrides.speed : HEALTHY_DEFAULTS.speed;
  const initialAmbientTemp =
    typeof overrides.ambientTemp === "number" ? overrides.ambientTemp : HEALTHY_DEFAULTS.ambientTemp;
  const initialHumidity =
    typeof overrides.humidity === "number" ? overrides.humidity : HEALTHY_DEFAULTS.humidity;
  const initialDriveCurrent =
    typeof overrides.driveCurrent === "number" ? overrides.driveCurrent : HEALTHY_DEFAULTS.driveCurrent;
  const initialAdcBits =
    typeof overrides.adcBits === "number" ? (overrides.adcBits >= 12 ? 12 : 10) : HEALTHY_DEFAULTS.adcBits;

  return {
    id: instanceId,
    playing: !!overrides.playing,
    speed: clamp(initialSpeed, 0.25, 8),
    timeHours: typeof overrides.timeHours === "number" ? Math.max(0, overrides.timeHours) : 0,
    ambientTemp: clamp(initialAmbientTemp, -10, 100),
    humidity: clamp(initialHumidity, 0, 100),
    driveCurrent: clamp(initialDriveCurrent, 50, 700),
    location,
    topicBase,
    mqttTopic: options.isDefault ? MQTT_TOPIC : defaultTopic,
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
      bits: initialAdcBits,
      max: initialAdcBits === 12 ? 4095 : 1023,
    },
    initialValues: {
      ambientTemp: clamp(initialAmbientTemp, -10, 100),
      humidity: clamp(initialHumidity, 0, 100),
      driveCurrent: clamp(initialDriveCurrent, 50, 700),
      speed: clamp(initialSpeed, 0.25, 8),
      adcBits: initialAdcBits,
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
    history: [],
  };
}

export function initDefaultInstance() {
  instances.set(DEFAULT_INSTANCE_ID, createLampState(DEFAULT_INSTANCE_ID, {}, { isDefault: true }));
}

export const getInstancesMap = () => instances;
export const getInstance = (id) => instances.get(id) || null;
export const getDefaultInstance = () => getInstance(DEFAULT_INSTANCE_ID);

export const getPublicState = (instance) => ({
  ...instance,
  history: [...instance.history],
});

export function applyInitialValues(instance, resetTime = true) {
  instance.ambientTemp = instance.initialValues.ambientTemp;
  instance.humidity = instance.initialValues.humidity;
  instance.driveCurrent = instance.initialValues.driveCurrent;
  instance.speed = instance.initialValues.speed;
  instance.adc.bits = instance.initialValues.adcBits >= 12 ? 12 : 10;
  instance.adc.max = instance.adc.bits === 12 ? 4095 : 1023;
  if (resetTime) {
    instance.timeHours = 0;
    instance.history.length = 0;
  }
  instance.anomalies.rgb.enabled = false;
  instance.anomalies.ldr.enabled = false;
  instance.anomalies.ripple.enabled = false;
}

export function simulateInstance(instance, publishFn) {
  if (!instance.playing) return;

  instance.timeHours += TICK_SECONDS * instance.speed * 30;

  const intensity =
    Math.exp(-0.00006 * instance.timeHours) *
    (1 - Math.max(0, instance.ambientTemp - 25) * 0.0025) *
    (1 - Math.max(0, instance.humidity - 50) * 0.001) *
    (1 + (instance.driveCurrent - 350) * 0.0004);

  const safeIntensity = clamp(intensity, 0.05, 1.1);
  const adcMax = instance.adc.max;
  const baseR = clamp(noise(255 * safeIntensity * 1.0), 0, 1023);
  const baseG = clamp(noise(240 * safeIntensity * 0.95), 0, 1023);
  const baseB = clamp(noise(225 * safeIntensity * 0.9), 0, 1023);
  const baseLdr = clamp(
    noise((adcMax * Math.log10(1 + safeIntensity * 9)) / Math.log10(10), 0.02),
    0,
    adcMax
  );
  const baseRipple = clamp(
    noise((1 + instance.timeHours * 0.0001 + (instance.driveCurrent - 350) * 0.0005) * 1.6, 0.1),
    0.2,
    45
  );

  const finalR = instance.anomalies.rgb.enabled ? instance.anomalies.rgb.r : baseR;
  const finalG = instance.anomalies.rgb.enabled ? instance.anomalies.rgb.g : baseG;
  const finalB = instance.anomalies.rgb.enabled ? instance.anomalies.rgb.b : baseB;
  const finalLdr = instance.anomalies.ldr.enabled ? instance.anomalies.ldr.value : baseLdr;
  const finalRipple = instance.anomalies.ripple.enabled ? instance.anomalies.ripple.value : baseRipple;

  instance.sensors.rgb = {
    R: Math.round(finalR),
    G: Math.round(finalG),
    B: Math.round(finalB),
    C: Math.round(finalR + finalG + finalB),
  };
  instance.sensors.ldr = Math.round(finalLdr);
  instance.sensors.ripplePercent = Number(finalRipple.toFixed(2));

  const anomalyScore =
    0.35 * Number(instance.anomalies.rgb.enabled) +
    0.3 * Number(instance.anomalies.ldr.enabled) +
    0.35 * Number(instance.anomalies.ripple.enabled);

  const rippleRatio = instance.sensors.ripplePercent / 100;
  const tempRise = Math.max(0, instance.ambientTemp - 25);
  const currentRiseRatio = Math.max(0, (instance.driveCurrent - 350) / 350);
  const model = instance.rulModel;
  const rul =
    model.baseLifeHours -
    instance.timeHours * model.hoursPenalty -
    rippleRatio * model.ripplePenalty * 100 -
    tempRise * model.tempPenalty -
    currentRiseRatio * model.currentPenalty * 100 -
    anomalyScore * model.anomalyPenalty;

  instance.derived.anomalyScore = Number(anomalyScore.toFixed(2));
  instance.derived.rulHours = Math.max(model.minRul, Math.round(rul));

  instance.history.push({
    t: Math.round(instance.timeHours),
    rgb: { ...instance.sensors.rgb },
    ldr: instance.sensors.ldr,
    ripplePercent: instance.sensors.ripplePercent,
  });
  if (instance.history.length > MAX_HISTORY) instance.history.shift();

  publishFn(instance);
}

export function tickAllInstances(publishFn) {
  for (const instance of instances.values()) {
    simulateInstance(instance, publishFn);
  }
}
