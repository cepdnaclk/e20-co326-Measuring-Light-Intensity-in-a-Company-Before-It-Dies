import { Router } from "express";
import { getDefaultInstance, getPublicState } from "../services/instanceManager.js";
import {
  applyAnomaliesPayload,
  applyControlPayload,
  applyInitialValuesPayload,
  applyRulModelPayload,
} from "../services/stateMutations.js";

const router = Router();

router.get("/state", (_req, res) => {
  const state = getDefaultInstance();
  res.json(getPublicState(state));
});

router.post("/control", (req, res) => {
  const state = getDefaultInstance();
  applyControlPayload(state, req.body);
  res.json({ ok: true, state });
});

router.post("/anomalies", (req, res) => {
  const state = getDefaultInstance();
  applyAnomaliesPayload(state, req.body);
  res.json({ ok: true, anomalies: state.anomalies });
});

router.post("/rul-model", (req, res) => {
  const state = getDefaultInstance();
  applyRulModelPayload(state, req.body);
  res.json({ ok: true, rulModel: state.rulModel });
});

router.post("/initial-values", (req, res) => {
  const state = getDefaultInstance();
  applyInitialValuesPayload(state, req.body);
  res.json({ ok: true, initialValues: state.initialValues, state });
});

export default router;
