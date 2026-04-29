import { clamp } from "../utils/math.js";
import { applyInitialValues } from "./instanceManager.js";

export const applyControlPayload = (state, payload = {}) => {
  const { playing, speed, ambientTemp, humidity, driveCurrent, adcBits } = payload;
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
};

export const applyAnomaliesPayload = (state, payload = {}) => {
  const { rgb, ldr, ripple } = payload;
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
    if (typeof ripple.value === "number") state.anomalies.ripple.value = clamp(ripple.value, 0, 100);
  }
};

export const applyRulModelPayload = (state, payload = {}) => {
  const { baseLifeHours, hoursPenalty, ripplePenalty, tempPenalty, currentPenalty, anomalyPenalty, minRul } = payload;
  const model = state.rulModel;
  if (typeof baseLifeHours === "number") model.baseLifeHours = clamp(baseLifeHours, 100, 50000);
  if (typeof hoursPenalty === "number") model.hoursPenalty = clamp(hoursPenalty, 0, 10);
  if (typeof ripplePenalty === "number") model.ripplePenalty = clamp(ripplePenalty, 0, 1000);
  if (typeof tempPenalty === "number") model.tempPenalty = clamp(tempPenalty, 0, 200);
  if (typeof currentPenalty === "number") model.currentPenalty = clamp(currentPenalty, 0, 200);
  if (typeof anomalyPenalty === "number") model.anomalyPenalty = clamp(anomalyPenalty, 0, 20000);
  if (typeof minRul === "number") model.minRul = clamp(minRul, 0, 50000);
};

export const applyInitialValuesPayload = (state, payload = {}) => {
  const { ambientTemp, humidity, driveCurrent, speed, adcBits, applyNow } = payload;
  if (typeof ambientTemp === "number") state.initialValues.ambientTemp = clamp(ambientTemp, -10, 100);
  if (typeof humidity === "number") state.initialValues.humidity = clamp(humidity, 0, 100);
  if (typeof driveCurrent === "number") state.initialValues.driveCurrent = clamp(driveCurrent, 50, 700);
  if (typeof speed === "number") state.initialValues.speed = clamp(speed, 0.25, 8);
  if (typeof adcBits === "number") state.initialValues.adcBits = adcBits >= 12 ? 12 : 10;
  if (applyNow) applyInitialValues(state, true);
};
