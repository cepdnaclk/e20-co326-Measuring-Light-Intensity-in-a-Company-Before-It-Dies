import { Router } from "express";
import { getInstance } from "../services/instanceManager.js";
import {
  bulkControlInstances,
  createInstances,
  deleteAllNonDefaultInstances,
  deleteInstanceById,
  getInstanceStateOr404,
  listInstancesSummary,
} from "../services/instanceOperations.js";
import {
  applyAnomaliesPayload,
  applyControlPayload,
  applyInitialValuesPayload,
  applyRulModelPayload,
} from "../services/stateMutations.js";

const router = Router();

router.get("/", (_req, res) => {
  res.json(listInstancesSummary());
});

router.post("/", (req, res) => {
  res.json(createInstances(req.body));
});

router.post("/bulk/control", (req, res) => {
  res.json(bulkControlInstances(req.body));
});

router.post("/delete-all", (_req, res) => {
  res.json(deleteAllNonDefaultInstances());
});

router.get("/:id/state", (req, res) => {
  const state = getInstanceStateOr404(req.params.id);
  if (!state) return res.status(404).json({ ok: false, error: "Instance not found" });
  return res.json(state);
});

router.post("/:id/control", (req, res) => {
  const state = getInstance(req.params.id);
  if (!state) return res.status(404).json({ ok: false, error: "Instance not found" });
  applyControlPayload(state, req.body);
  return res.json({ ok: true, state });
});

router.post("/:id/anomalies", (req, res) => {
  const state = getInstance(req.params.id);
  if (!state) return res.status(404).json({ ok: false, error: "Instance not found" });
  applyAnomaliesPayload(state, req.body);
  return res.json({ ok: true, anomalies: state.anomalies });
});

router.post("/:id/rul-model", (req, res) => {
  const state = getInstance(req.params.id);
  if (!state) return res.status(404).json({ ok: false, error: "Instance not found" });
  applyRulModelPayload(state, req.body);
  return res.json({ ok: true, rulModel: state.rulModel });
});

router.post("/:id/initial-values", (req, res) => {
  const state = getInstance(req.params.id);
  if (!state) return res.status(404).json({ ok: false, error: "Instance not found" });
  applyInitialValuesPayload(state, req.body);
  return res.json({ ok: true, initialValues: state.initialValues, state });
});

router.delete("/:id", (req, res) => {
  const result = deleteInstanceById(req.params.id);
  if (!result.ok) return res.status(result.status).json({ ok: false, error: result.error });
  return res.json(result);
});

export default router;
