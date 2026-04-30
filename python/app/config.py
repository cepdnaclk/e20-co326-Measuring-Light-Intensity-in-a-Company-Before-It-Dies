"""
config.py
=========
Centralised configuration for the Edge AI Python service.

All settings are loaded from environment variables with sensible
defaults so the service works out-of-the-box in Docker Compose
and can be overridden per deployment.
"""

import os

# ---------------------------------------------------------------------------
# InfluxDB connection
# ---------------------------------------------------------------------------
INFLUXDB_URL = os.getenv("INFLUXDB_URL", "http://influxdb:8086")
INFLUXDB_TOKEN = os.getenv("INFLUXDB_TOKEN", "root-token")
INFLUXDB_ORG = os.getenv("INFLUXDB_ORG", "light_org")
INFLUXDB_BUCKET = os.getenv("INFLUXDB_BUCKET", "light_data")

# ---------------------------------------------------------------------------
# MQTT connection
# ---------------------------------------------------------------------------
MQTT_URL = os.getenv("MQTT_URL", "mqtt://mosquitto:1883")
MQTT_CLIENT_ID = os.getenv("MQTT_CLIENT_ID", "python-edge-ai")

# MQTT topics — uses wildcards to subscribe to all luminaires
MQTT_TOPIC_DATA = os.getenv(
    "MQTT_TOPIC_DATA",
    "factory/+/+/+/+/+/telemetry/raw",
)
MQTT_TOPIC_EDGE = os.getenv(
    "MQTT_TOPIC_EDGE",
    "factory/+/+/+/+/+/telemetry/edge-ai",
)
MQTT_TOPIC_ALERTS = os.getenv(
    "MQTT_TOPIC_ALERTS",
    "factory/sitea/floor1/line1/cell1/lum_0001/alerts/status",
)
MQTT_TOPIC_PREDICTIONS = os.getenv(
    "MQTT_TOPIC_PREDICTIONS",
    "factory/{site}/{floor}/{line}/{cell}/{bulb_id}/telemetry/predictions",
)

# ---------------------------------------------------------------------------
# FastAPI server
# ---------------------------------------------------------------------------
API_HOST = os.getenv("API_HOST", "0.0.0.0")
API_PORT = int(os.getenv("API_PORT", "5000"))

# ---------------------------------------------------------------------------
# Model paths (relative to the app's working directory)
# ---------------------------------------------------------------------------
MODEL_DIR = os.getenv("MODEL_DIR", "/app/models")
FAULT_CLASSIFIER_PATH = os.path.join(MODEL_DIR, "fault_classifier.joblib")
FAILURE_PREDICTOR_PATH = os.path.join(MODEL_DIR, "failure_predictor.joblib")

# ---------------------------------------------------------------------------
# Prediction scheduler
# ---------------------------------------------------------------------------
# TESTING: Change PREDICTION_INTERVAL_SECONDS to test different cadences.
# Set to 30 for rapid testing, 3600 (1 hour) for production.
PREDICTION_INTERVAL_SECONDS = int(
    os.getenv("PREDICTION_INTERVAL_SECONDS", "10")  # 30 seconds for testing
)

# ---------------------------------------------------------------------------
# Alert severity thresholds (probability-based)
# ---------------------------------------------------------------------------
ALERT_THRESHOLDS = {
    "INFO": {"14d": 0.30},            # P(14d) >= 30%
    "MEDIUM": {"14d": 0.50},          # P(14d) >= 50%
    "HIGH": {"14d": 0.70, "7d": 0.50},  # P(14d) >= 70% OR P(7d) >= 50%
    "CRITICAL": {"3d": 0.70},         # P(3d) >= 70% or sudden failure
}

# ---------------------------------------------------------------------------
# Anomaly detection
# ---------------------------------------------------------------------------
Z_SCORE_THRESHOLD = float(os.getenv("Z_SCORE_THRESHOLD", "3.0"))
RAPID_DROP_PERCENT = float(os.getenv("RAPID_DROP_PERCENT", "30.0"))

# ---------------------------------------------------------------------------
# Dummy sensor defaults (used when real sensors are not connected)
# ---------------------------------------------------------------------------
DUMMY_DEFAULTS = {
    "temperature": 25.0,
    "current": 320.0,
    "voltage": 230.0,
    "humidity": 45.0,
    "rgb": {"r": 255, "g": 240, "b": 225},
    "power_consumption": 60.0,
    "ripple_percent": 1.6,
}
