import { DEFAULT_INSTANCE_ID } from "../config.js";
import { clamp } from "../utils/math.js";
import { createLampState, getInstance, getInstancesMap, getPublicState } from "./instanceManager.js";
import { applyControlPayload } from "./stateMutations.js";

const normalizeInstanceId = (id) => String(id ?? "").trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "_");

export function listInstancesSummary() {
  const list = [...getInstancesMap().values()].map((instance) => ({
    id: instance.id,
    playing: instance.playing,
    speed: instance.speed,
    timeHours: Number(instance.timeHours.toFixed(2)),
    location: instance.location,
    mqttTopic: instance.mqttTopic,
    anomalyScore: instance.derived.anomalyScore,
    rulHours: instance.derived.rulHours,
  }));
  return { instances: list, count: list.length, defaultInstanceId: DEFAULT_INSTANCE_ID };
}

export function createInstances(payload = {}) {
  const { ids, count = 1, defaults = {}, replace = false } = payload;
  const created = [];
  const skipped = [];
  const targetIds =
    Array.isArray(ids) && ids.length
      ? ids.map((id) => normalizeInstanceId(id))
      : Array.from({ length: clamp(Number(count) || 1, 1, 1000) }, (_, idx) =>
          `lum_${String(getInstancesMap().size + idx + 1).padStart(4, "0")}`
        );

  for (const candidateId of targetIds) {
    if (!candidateId) continue;
    if (candidateId === DEFAULT_INSTANCE_ID && !replace) {
      skipped.push({ id: candidateId, reason: "default instance already exists" });
      continue;
    }
    if (getInstancesMap().has(candidateId) && !replace) {
      skipped.push({ id: candidateId, reason: "instance already exists" });
      continue;
    }

    const lamp = createLampState(candidateId, defaults);
    getInstancesMap().set(candidateId, lamp);
    created.push({ id: candidateId, mqttTopic: lamp.mqttTopic, location: lamp.location });
  }

  return { ok: true, created, skipped, total: getInstancesMap().size };
}

export function bulkControlInstances(payload = {}) {
  const { ids, control = {} } = payload;
  const targetIds = Array.isArray(ids) && ids.length ? ids : [...getInstancesMap().keys()];
  const updated = [];
  const missing = [];

  for (const id of targetIds) {
    const instance = getInstance(id);
    if (!instance) {
      missing.push(id);
      continue;
    }
    applyControlPayload(instance, control);
    updated.push(id);
  }

  return { ok: true, updated, missing };
}

export function deleteAllNonDefaultInstances() {
  const deleted = [];
  for (const id of getInstancesMap().keys()) {
    if (id === DEFAULT_INSTANCE_ID) continue;
    deleted.push(id);
    getInstancesMap().delete(id);
  }
  return { ok: true, deleted, total: getInstancesMap().size, keptDefault: DEFAULT_INSTANCE_ID };
}

export function getInstanceStateOr404(id) {
  const state = getInstance(id);
  if (!state) return null;
  return getPublicState(state);
}

export function deleteInstanceById(id) {
  if (id === DEFAULT_INSTANCE_ID) {
    return { ok: false, status: 400, error: "Default instance cannot be deleted" };
  }
  if (!getInstancesMap().has(id)) {
    return { ok: false, status: 404, error: "Instance not found" };
  }
  getInstancesMap().delete(id);
  return { ok: true, deleted: id, total: getInstancesMap().size };
}
