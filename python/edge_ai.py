"""
edge_ai.py
==========
Main entry point for the Edge AI Python service.

Combines three responsibilities in a single process:

1. **MQTT Subscriber** — Listens to sensor data and edge-AI results
   from ESP32 devices.  Buffers readings per bulb in memory.

2. **FastAPI Server** — Exposes REST endpoints for on-demand
   prediction (POST /api/predict, POST /api/predict/batch, GET /api/health).

3. **Scheduled Predictions** — Runs the XGBoost prediction pipeline
   every hour (configurable) using APScheduler, querying InfluxDB
   for historical data.

Architecture
------------
    ESP32 → MQTT → [this service] → MQTT alerts
                                   → FastAPI responses

Docker
------
    This script is the CMD entry point in the Dockerfile.
    It starts the FastAPI server with uvicorn and the MQTT/scheduler
    loops in background threads.

Usage
-----
    python edge_ai.py
"""

import os
import sys
import json
import time
import logging
import threading
from datetime import datetime, timezone
from collections import defaultdict
from contextlib import asynccontextmanager

import uvicorn
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field
import paho.mqtt.client as paho_mqtt

from app.config import (
    INFLUXDB_URL, INFLUXDB_TOKEN, INFLUXDB_ORG, INFLUXDB_BUCKET,
    MQTT_URL, MQTT_CLIENT_ID,
    MQTT_TOPIC_DATA, MQTT_TOPIC_EDGE, MQTT_TOPIC_ALERTS, MQTT_TOPIC_PREDICTIONS,
    API_HOST, API_PORT,
    FAULT_CLASSIFIER_PATH, FAILURE_PREDICTOR_PATH,
    PREDICTION_INTERVAL_SECONDS,
    Z_SCORE_THRESHOLD, RAPID_DROP_PERCENT,
)
from app.predictor import FailurePredictor
from app.fault_classifier import FaultClassifier
from app.anomaly_detector import AnomalyDetector
from app.alert_engine import AlertEngine
from app.influxdb_client import InfluxDBService

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("edge_ai")

# ---------------------------------------------------------------------------
# Global state
# ---------------------------------------------------------------------------
# In-memory buffer of readings per bulb (most recent 336 = 14 days @ 1/hour)
readings_buffer: dict[str, list[dict]] = defaultdict(list)
MAX_BUFFER_SIZE = 336

# Latest metadata per bulb (location info from topic/payload)
bulb_metadata: dict[str, dict] = {}

# ML model instances (loaded on startup)
failure_predictor: FailurePredictor | None = None
fault_classifier: FaultClassifier | None = None
anomaly_detector: AnomalyDetector | None = None
alert_engine: AlertEngine | None = None
influxdb_service: InfluxDBService | None = None

# MQTT client
mqtt_client: paho_mqtt.Client | None = None
mqtt_connected = False

# Timestamp of last prediction run
last_prediction_at: str | None = None


# ===========================================================================
# Pydantic schemas
# ===========================================================================

class RGBReading(BaseModel):
    """RGB sensor values (required — use dummy values if not connected)."""
    r: int = Field(..., description="Red channel value (0-1023)")
    g: int = Field(..., description="Green channel value (0-1023)")
    b: int = Field(..., description="Blue channel value (0-1023)")


class SensorReading(BaseModel):
    """
    A single sensor reading — all fields are required.

    For sensors not yet physically connected, send dummy values.
    When real sensors are added later, simply send actual values;
    no internal code changes are needed.
    """
    timestamp: str = Field(..., description="ISO 8601 timestamp")
    ldr: int = Field(..., description="LDR ADC value (0-4095)")
    temperature: float = Field(..., description="Ambient temperature °C")
    current: float = Field(..., description="Drive current mA")
    voltage: float = Field(..., description="Supply voltage V")
    humidity: float = Field(..., description="Relative humidity %")
    rgb: RGBReading = Field(..., description="RGB sensor reading")
    power_consumption: float = Field(..., description="Power consumption W")
    ripple_percent: float = Field(..., description="Current ripple %")


class PredictRequest(BaseModel):
    """Request body for single bulb prediction."""
    bulb_id: str = Field(..., description="Bulb / luminaire identifier")
    readings: list[SensorReading] = Field(
        ..., description="Chronological list of sensor readings",
    )


class BatchPredictRequest(BaseModel):
    """Request body for batch prediction (queries InfluxDB)."""
    bulb_ids: list[str] = Field(..., description="List of bulb identifiers")
    lookback_hours: int = Field(
        336, description="Hours of history to query (default 336 = 14 days)",
    )


class HealthResponse(BaseModel):
    """Health check response."""
    status: str
    model_version: str = "1.0.0"
    failure_predictor_loaded: bool
    fault_classifier_loaded: bool
    influxdb_connected: bool
    mqtt_connected: bool
    last_prediction_at: str | None


# ===========================================================================
# MQTT setup
# ===========================================================================

def _parse_mqtt_url(url: str) -> tuple[str, int]:
    """Extract host and port from an MQTT URL like 'mqtt://host:port'."""
    url = url.replace("mqtt://", "").replace("mqtts://", "")
    parts = url.split(":")
    host = parts[0]
    port = int(parts[1]) if len(parts) > 1 else 1883
    return host, port


def _on_mqtt_connect(client, userdata, flags, rc, properties=None):
    """Callback when MQTT connection is established."""
    global mqtt_connected
    if rc == 0:
        mqtt_connected = True
        logger.info("Connected to MQTT broker.")
        # Subscribe to sensor data and edge-AI topics
        client.subscribe(MQTT_TOPIC_DATA)
        client.subscribe(MQTT_TOPIC_EDGE)
        logger.info("Subscribed to: %s", MQTT_TOPIC_DATA)
        logger.info("Subscribed to: %s", MQTT_TOPIC_EDGE)
    else:
        mqtt_connected = False
        logger.error("MQTT connection failed with rc=%d", rc)


def _on_mqtt_message(client, userdata, msg):
    """
    Callback for incoming MQTT messages.

    Parses sensor data from ESP32/simulator and buffers it per bulb.
    """
    try:
        payload = json.loads(msg.payload.decode())
        topic = msg.topic

        # Determine bulb ID from the topic or payload
        # Topic format: factory/{site}/{floor}/{line}/{cell}/{luminaire_id}/...
        parts = topic.split("/")
        if len(parts) >= 6:
            bulb_id = parts[5]  # The luminaire ID segment
        else:
            bulb_id = payload.get("lamp", {}).get("id", "unknown")

        # Buffer the reading
        if "telemetry/raw" in topic:
            # Raw sensor data from simulator or ESP32
            reading = _extract_reading_from_payload(payload)
            if reading:
                bulb_metadata[bulb_id] = _extract_bulb_metadata(topic, payload)
                readings_buffer[bulb_id].append(reading)
                # Trim buffer to MAX_BUFFER_SIZE
                if len(readings_buffer[bulb_id]) > MAX_BUFFER_SIZE:
                    readings_buffer[bulb_id] = readings_buffer[bulb_id][-MAX_BUFFER_SIZE:]

        elif "telemetry/edge-ai" in topic:
            # Edge AI classification from ESP32 (logged but not buffered)
            logger.debug(
                "Edge AI from %s: status=%s confidence=%.2f",
                bulb_id,
                payload.get("status", "?"),
                payload.get("confidence", 0),
            )

    except Exception as e:
        logger.error("Error processing MQTT message: %s", e)


def _extract_reading_from_payload(payload: dict) -> dict | None:
    """
    Extract a standardised sensor reading dict from an MQTT payload.

    Handles both the simulator format (nested sensors/environment)
    and the direct ESP32 format.
    """
    try:
        sensors = payload.get("sensors", {})
        env = payload.get("environment", {})

        reading = {
            "timestamp": payload.get("timestamp", datetime.now(timezone.utc).isoformat()),
            "ldr": int(sensors.get("ldrAdc", 0)),
            "temperature": float(env.get("ambientTemp", 25.0)),
            "current": float(env.get("driveCurrent", 320.0)),
            "voltage": 230.0,  # Dummy — not in simulator payload
            "humidity": float(env.get("humidity", 45.0)),
            "power_consumption": 60.0,  # Dummy — not in simulator payload
            "ripple_percent": float(sensors.get("ripplePercent", 1.6)),
            "rgb": {
                "r": int(sensors.get("tcs34725", {}).get("R", 255)),
                "g": int(sensors.get("tcs34725", {}).get("G", 240)),
                "b": int(sensors.get("tcs34725", {}).get("B", 225)),
            },
        }
        return reading
    except Exception as e:
        logger.error("Failed to extract reading from payload: %s", e)
        return None


def _extract_bulb_metadata(topic: str, payload: dict) -> dict:
    """
    Extract bulb metadata (location + ID) from topic or payload.
    """
    parts = topic.split("/") if isinstance(topic, str) else []
    topic_site = parts[1] if len(parts) > 1 else "sitea"
    topic_floor = parts[2] if len(parts) > 2 else "floor1"
    topic_line = parts[3] if len(parts) > 3 else "line1"
    topic_cell = parts[4] if len(parts) > 4 else "cell1"
    topic_lamp_id = parts[5] if len(parts) > 5 else "unknown_lamp"

    lamp = payload.get("lamp", {}) if isinstance(payload, dict) else {}
    location = lamp.get("location", {}) if isinstance(lamp, dict) else {}

    return {
        "site": str(location.get("site", topic_site)),
        "floor": str(location.get("floor", topic_floor)),
        "line": str(location.get("line", topic_line)),
        "cell": str(location.get("cell", topic_cell)),
        "luminaireId": str(lamp.get("id", topic_lamp_id)),
    }


def _mqtt_publish(topic: str, payload: str):
    """Publish a message to MQTT."""
    if mqtt_client and mqtt_connected:
        mqtt_client.publish(topic, payload, qos=0, retain=False)


def _format_prediction_topic(bulb_id: str, meta: dict) -> str:
    """Build prediction topic from a template and metadata."""
    values = {
        "site": meta.get("site", "sitea"),
        "floor": meta.get("floor", "floor1"),
        "line": meta.get("line", "line1"),
        "cell": meta.get("cell", "cell1"),
        "bulb_id": bulb_id,
    }
    try:
        return MQTT_TOPIC_PREDICTIONS.format(**values)
    except Exception:
        return (
            f"factory/{values['site']}/{values['floor']}/"
            f"{values['line']}/{values['cell']}/{bulb_id}/telemetry/predictions"
        )


def _summarize_alerts(alerts: list[dict]) -> dict:
    """Return the highest-severity alert summary for a prediction."""
    if not alerts:
        return {
            "severity": "NONE",
            "alert_type": "NONE",
            "message": "No alerts",
        }

    severity_rank = {
        "CRITICAL": 4,
        "HIGH": 3,
        "MEDIUM": 2,
        "INFO": 1,
    }
    top = max(alerts, key=lambda a: severity_rank.get(a.get("severity", ""), 0))
    return {
        "severity": str(top.get("severity", "UNKNOWN")),
        "alert_type": str(top.get("alert_type", "UNKNOWN")),
        "message": str(top.get("message", "")),
    }


def _publish_prediction(bulb_id: str, result: dict):
    """Publish a summarized prediction payload for Grafana/InfluxDB."""
    meta = {
        "site": "sitea",
        "floor": "floor1",
        "line": "line1",
        "cell": "cell1",
        "luminaireId": bulb_id,
    }
    meta.update(bulb_metadata.get(bulb_id, {}))

    payload = {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "bulb_id": bulb_id,
        "meta": meta,
        "current_status": result.get("current_status", {}),
        "failure_prediction": result.get("failure_prediction", {}),
        "fault_classification": result.get("fault_classification", {}),
        "alert": _summarize_alerts(result.get("alerts", [])),
    }
    topic = _format_prediction_topic(bulb_id, meta)
    _mqtt_publish(topic, json.dumps(payload))


def start_mqtt():
    """Initialise and start the MQTT client in a background thread."""
    global mqtt_client
    host, port = _parse_mqtt_url(MQTT_URL)

    mqtt_client = paho_mqtt.Client(
        client_id=MQTT_CLIENT_ID,
        callback_api_version=paho_mqtt.CallbackAPIVersion.VERSION2,
    )
    mqtt_client.on_connect = _on_mqtt_connect
    mqtt_client.on_message = _on_mqtt_message

    def _loop():
        while True:
            try:
                mqtt_client.connect(host, port, keepalive=60)
                mqtt_client.loop_forever()
            except Exception as e:
                logger.error("MQTT error: %s. Reconnecting in 5s …", e)
                time.sleep(5)

    thread = threading.Thread(target=_loop, daemon=True)
    thread.start()
    logger.info("MQTT client started (connecting to %s:%d)", host, port)


# ===========================================================================
# Prediction pipeline
# ===========================================================================

def run_prediction(bulb_id: str, readings: list[dict]) -> dict:
    """
    Run the full prediction pipeline for a single bulb.

    Parameters
    ----------
    bulb_id : str
        Bulb identifier.
    readings : list[dict]
        Chronological sensor readings (all fields required).

    Returns
    -------
    dict
        Full prediction result including status, failure prediction,
        fault classification, alerts, and anomaly detection.
    """
    # 1. Failure prediction (XGBoost)
    prediction = failure_predictor.predict(readings) if failure_predictor else {
        "probability_3_days": 0, "probability_7_days": 0,
        "probability_14_days": 0, "estimated_remaining_days": -1,
        "confidence": 0,
    }

    # 2. Fault classification (XGBoost)
    latest_reading = readings[-1] if readings else {}
    fault = fault_classifier.classify(latest_reading) if fault_classifier else {
        "predicted_fault_type": 0, "fault_label": "No Fault",
        "fault_probabilities": {},
    }

    # 3. Anomaly detection
    anomaly = anomaly_detector.detect(readings) if anomaly_detector else {
        "detected": False, "drop_magnitude": None, "z_score": None,
    }

    # 4. Determine current status from prediction + latest LDR
    ldr = readings[-1].get("ldr", 0) if readings else 0
    health_score = 1.0 - prediction.get("probability_14_days", 0)
    if ldr > 3000:
        state = "HEALTHY"
    elif ldr > 1000:
        state = "DEGRADING"
    else:
        state = "FAILED"

    # 5. Generate alerts
    alerts = []
    if alert_engine:
        alerts = alert_engine.evaluate(bulb_id, prediction, anomaly)

    return {
        "bulb_id": bulb_id,
        "current_status": {
            "state": state,
            "health_score": round(health_score, 2),
        },
        "failure_prediction": prediction,
        "fault_classification": fault,
        "alerts": alerts,
        "sudden_failure": anomaly,
    }


def run_scheduled_predictions():
    """
    Scheduled task that runs predictions for all buffered bulbs.
    Called by APScheduler every PREDICTION_INTERVAL_SECONDS.
    """
    global last_prediction_at
    logger.info("Running scheduled predictions for %d bulbs …", len(readings_buffer))

    for bulb_id, readings in readings_buffer.items():
        if len(readings) >= 10:  # Need at least 10 readings
            try:
                result = run_prediction(bulb_id, readings)
                alerts = result.get("alerts", [])
                _publish_prediction(bulb_id, result)
                if alerts:
                    logger.info(
                        "Bulb %s: %d alert(s) generated", bulb_id, len(alerts),
                    )
            except Exception as e:
                logger.error("Prediction error for %s: %s", bulb_id, e)

    last_prediction_at = datetime.now(timezone.utc).isoformat()
    logger.info("Scheduled predictions complete.")


# ===========================================================================
# FastAPI application
# ===========================================================================

@asynccontextmanager
async def lifespan(app: FastAPI):
    """FastAPI lifespan handler — initialises ML models and services."""
    global failure_predictor, fault_classifier, anomaly_detector
    global alert_engine, influxdb_service

    logger.info("Initialising Edge AI service …")

    # Load ML models
    failure_predictor = FailurePredictor(FAILURE_PREDICTOR_PATH)
    fault_classifier = FaultClassifier(FAULT_CLASSIFIER_PATH)
    anomaly_detector = AnomalyDetector(
        z_threshold=Z_SCORE_THRESHOLD,
        drop_percent=RAPID_DROP_PERCENT,
    )

    # Initialise alert engine with MQTT publishing
    alert_engine = AlertEngine(
        mqtt_publish_fn=_mqtt_publish,
        alert_topic=MQTT_TOPIC_ALERTS,
    )

    # Connect to InfluxDB
    influxdb_service = InfluxDBService(
        INFLUXDB_URL, INFLUXDB_TOKEN, INFLUXDB_ORG, INFLUXDB_BUCKET,
    )

    # Start MQTT client
    start_mqtt()

    # Start scheduled prediction loop in a background thread
    def _scheduler_loop():
        while True:
            time.sleep(PREDICTION_INTERVAL_SECONDS)
            try:
                run_scheduled_predictions()
            except Exception as e:
                logger.error("Scheduler error: %s", e)

    threading.Thread(target=_scheduler_loop, daemon=True).start()
    logger.info(
        "Prediction scheduler started (interval: %ds)",
        PREDICTION_INTERVAL_SECONDS,
    )

    logger.info("Edge AI service ready.")
    yield

    # Shutdown
    if influxdb_service:
        influxdb_service.close()
    logger.info("Edge AI service stopped.")


app = FastAPI(
    title="LED Bulb Edge AI Service",
    description=(
        "Predictive failure analysis for LED luminaires. "
        "Combines XGBoost failure prediction, fault classification, "
        "and anomaly detection."
    ),
    version="1.0.0",
    lifespan=lifespan,
)


@app.get("/api/health", response_model=HealthResponse)
async def health_check():
    """Health check endpoint — verifies all components are operational."""
    return HealthResponse(
        status="healthy",
        failure_predictor_loaded=failure_predictor.loaded if failure_predictor else False,
        fault_classifier_loaded=fault_classifier.loaded if fault_classifier else False,
        influxdb_connected=influxdb_service.is_connected() if influxdb_service else False,
        mqtt_connected=mqtt_connected,
        last_prediction_at=last_prediction_at,
    )


@app.post("/api/predict")
async def predict(request: PredictRequest):
    """
    On-demand prediction for a single bulb.

    All sensor fields in each reading are required.  Use dummy values
    for sensors that are not physically connected yet.
    """
    # Convert Pydantic models to dicts
    readings = [r.model_dump() for r in request.readings]
    if not readings:
        raise HTTPException(status_code=400, detail="No readings provided")

    result = run_prediction(request.bulb_id, readings)
    return result


@app.post("/api/predict/batch")
async def predict_batch(request: BatchPredictRequest):
    """
    Batch prediction for multiple bulbs.

    Queries InfluxDB for historical readings over the lookback window,
    then runs predictions for each bulb.
    """
    if not influxdb_service or not influxdb_service.is_connected():
        raise HTTPException(status_code=503, detail="InfluxDB not connected")

    predictions = []
    summary = {"total_bulbs": len(request.bulb_ids), "healthy": 0,
               "degrading": 0, "failed": 0, "alerts_generated": 0}

    for bulb_id in request.bulb_ids:
        readings = influxdb_service.get_readings(
            bulb_id, lookback_hours=request.lookback_hours,
        )
        if readings:
            result = run_prediction(bulb_id, readings)
            predictions.append(result)

            # Update summary
            state = result["current_status"]["state"]
            if state == "HEALTHY":
                summary["healthy"] += 1
            elif state == "DEGRADING":
                summary["degrading"] += 1
            else:
                summary["failed"] += 1
            summary["alerts_generated"] += len(result.get("alerts", []))

    return {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "predictions": predictions,
        "summary": summary,
    }


# ===========================================================================
# Entry point
# ===========================================================================

if __name__ == "__main__":
    uvicorn.run(
        "edge_ai:app",
        host=API_HOST,
        port=API_PORT,
        log_level="info",
    )
