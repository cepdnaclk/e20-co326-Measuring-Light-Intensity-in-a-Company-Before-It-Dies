# ML Predictive Failure Service — Implementation Plan

Two-tier ML system: **TinyML on ESP32 (Edge AI)** + **XGBoost in Docker (Cloud AI)**.

## Current Codebase State

The project has been refactored since the original plan:
- **Simulator** is now multi-instance: `instanceManager.js`, `mqttService.js`, `stateMutations.js`, `instanceOperations.js`
- **MQTT topic format**: `factory/{site}/{floor}/{line}/{cell}/{luminaireId}/telemetry/raw`
- **Docker** has production (`docker-compose.yml`) and dev (`docker-compose.dev.yml`) configs
- **Containers**: mosquitto, influxdb, grafana, simulator-server, simulator-client, node-red
- **ESP32 firmware**: LDR sensor on pin 34 with 20-sample moving window (threshold-based — to be replaced with TinyML)
- **Sensor status**: Only LDR is physically connected. Temperature, current, RGB, humidity, ripple use dummy values now.

---

## Architecture

```
┌──────────────────────────────────────────────────────┐
│                 ESP32 (Edge Device)                   │
│                                                      │
│  LDR Sensor → [TinyML Model] → Classification        │
│                 (TFLite Micro)                        │
│                                                      │
│  Inputs: ldr_norm, moving_avg_norm, rate_of_change,  │
│          variance, min_reading, max_reading           │
│  Output: HEALTHY (0) / DEGRADING (1) / FAILED (2)   │
│          + confidence + sudden failure flag           │
│                                                      │
│  MQTT out:                                           │
│    factory/.../telemetry/raw     → raw sensor data   │
│    factory/.../telemetry/edge-ai → TinyML result     │
└──────────────────┬───────────────────────────────────┘
                   │ MQTT
                   ▼
┌──────────────────────────────────────────────────────┐
│            Docker Compose Stack                       │
│                                                      │
│  ┌────────────┐  ┌──────────────────────────────┐   │
│  │ Mosquitto  │  │  python-edge (port 5000)      │   │
│  │   (MQTT)   │←→│  • MQTT subscriber            │   │
│  └─────┬──────┘  │  • Feature engineering        │   │
│        │         │  • XGBoost 14-day prediction   │   │
│        │         │  • Alert engine                │   │
│        │         └──────────────┬────────────────┘   │
│        │                       │                     │
│  ┌─────▼──────┐  ┌─────────────▼────────────────┐   │
│  │  Node-RED  │  │     InfluxDB                  │   │
│  │ Dashboard  │  │  (time-series store)          │   │
│  └────────────┘  └──────────────────────────────┘   │
│  ┌────────────┐  ┌──────────────────────────────┐   │
│  │  Grafana   │  │  Simulator (server + client)  │   │
│  └────────────┘  └──────────────────────────────┘   │
└──────────────────────────────────────────────────────┘
```

---

## MQTT Topics

Aligned with the existing `factory/{site}/{floor}/{line}/{cell}/{luminaireId}` hierarchy:

| Topic | Publisher | Payload |
|-------|----------|---------|
| `factory/.../telemetry/raw` | ESP32 / Simulator | Full sensor reading (all fields required) |
| `factory/.../telemetry/edge-ai` | ESP32 | `{"status":"HEALTHY","confidence":0.92,"scores":[0.92,0.06,0.02],"sudden_failure":false}` |
| `factory/.../alerts/status` | Python service | `{"severity":"HIGH","probability_14d":0.73,"message":"..."}` |

---

## API Contract (Python Service — port 5000)

### `POST /api/predict`

**Request** — all fields required (use dummy values for sensors not yet connected):
```json
{
  "bulb_id": "lum_0001",
  "readings": [
    {
      "timestamp": "2026-04-15T12:00:00Z",
      "ldr": 3500,
      "temperature": 25.0,
      "current": 320.0,
      "voltage": 230.0,
      "humidity": 45.0,
      "rgb": { "r": 255, "g": 240, "b": 225 },
      "power_consumption": 60.0,
      "ripple_percent": 1.6
    }
  ]
}
```

**Response:**
```json
{
  "bulb_id": "lum_0001",
  "current_status": { "state": "DEGRADING", "health_score": 0.65 },
  "failure_prediction": {
    "probability_14_days": 0.67,
    "probability_7_days": 0.23,
    "probability_3_days": 0.08,
    "estimated_remaining_days": 18,
    "confidence": 0.82
  },
  "fault_classification": {
    "predicted_fault_type": 0,
    "fault_label": "No Fault",
    "fault_probabilities": {
      "no_fault": 0.45, "electrical_fault": 0.30,
      "thermal_fault": 0.15, "environmental_fault": 0.05, "wear_out": 0.05
    }
  },
  "alerts": [
    { "type": "PREDICTIVE_WARNING", "severity": "MEDIUM",
      "message": "67% probability of failure within 14 days" }
  ],
  "sudden_failure": { "detected": false }
}
```

### `POST /api/predict/batch` — queries InfluxDB for multiple bulbs
### `GET /api/health` — health check

---

## Proposed Changes

### Part A — TinyML Training Pipeline

#### [NEW] `ml/training/generate_tinyml_training_data.py`

Generates labeled samples by simulating bulb lifecycles using the same degradation formula from [instanceManager.js](file:///d:/01_OneDrive/OneDrive%20-%20University%20of%20Peradeniya/02.%20Others/02.%20Documents/11.%20GitHub/19.%20LED%20Luminaire%20Monitor%20-%20CO326/e20-co326-Digital-Twin-LED-Luminaire-Monitor/simulator/server/src/services/instanceManager.js#L108-L178):
- `intensity = exp(-0.00006 * hours) * temp_factor * humidity_factor * current_factor`
- For each point, compute 6 features from a sliding window of LDR readings
- Labels: `HEALTHY` (intensity > 0.7), `DEGRADING` (0.3–0.7), `FAILED` (< 0.3)
- Varies conditions: temp 15–45°C, current 200–500mA, humidity 20–80%
- Outputs ~10,000 labeled samples as CSV

#### [NEW] `ml/training/train_tinyml_classifier.py`

Trains a small Keras neural network:
- **Input (6 features):** `ldr_normalized`, `moving_avg_normalized`, `rate_of_change`, `variance`, `min_in_window`, `max_in_window`
- **Architecture:** Dense(16, ReLU) → Dense(8, ReLU) → Dense(3, Softmax)
- **Target size:** ~2KB after int8 quantization
- Converts to TFLite → exports as `bulb_model.h` C header

#### [NEW] `ml/training/export_model.py`

Keras → TFLite (int8 quantized) → C header file for Arduino inclusion.

---

### Part B — ESP32 Edge AI Firmware

#### [MODIFY] `edge-logic/firmware/light_monitor/tinyml_light_monitor.ino`

Replace threshold-based classification with TinyML inference:

**What changes:**
- Add `#include <EloquentTinyML.h>` and `#include "bulb_model.h"`
- Keep existing 20-sample sliding window
- Compute 6 normalized features from window each loop
- Run `tf.predictClass(features)` for classification
- Compute Z-score: if `|current - moving_avg| > 3 * std_dev` → sudden failure flag
- Publish raw data to `factory/.../telemetry/raw` (all fields: LDR real, rest dummy)
- Publish edge AI result to `factory/.../telemetry/edge-ai`
- Relay control driven by TinyML output instead of hardcoded thresholds

**What stays the same:**
- WiFi/MQTT connection logic
- LDR pin 34, relay pin 26
- 20-sample window size
- 1-second loop delay

---

### Part C — Python Cloud AI Service

#### [NEW] `python/` directory

```
python/
├── Dockerfile
├── requirements.txt
├── edge_ai.py                # Main: MQTT subscriber + FastAPI + scheduler
├── mqtt_publisher.py          # Standalone test publisher
├── app/
│   ├── __init__.py
│   ├── config.py              # Env config (InfluxDB, MQTT, thresholds)
│   ├── feature_engine.py      # Feature engineering from historical data
│   ├── predictor.py           # XGBoost 14-day failure predictor
│   ├── fault_classifier.py    # XGBoost fault type classifier
│   ├── anomaly_detector.py    # Z-score anomaly detection (historical)
│   ├── alert_engine.py        # Alert generation + MQTT publish
│   └── influxdb_client.py     # InfluxDB query service
└── models/
    ├── fault_classifier.joblib
    └── failure_predictor.joblib
```

Key design: **all sensor fields are required in API calls**. For now, callers send real LDR data + dummy values for temperature, current, voltage, humidity, RGB, power, ripple. When real sensors are connected in the future, callers simply send actual values — no internal code changes needed.

#### [NEW] `python/Dockerfile`

```dockerfile
FROM python:3.11-slim
WORKDIR /app
COPY . /app
RUN pip install --no-cache-dir \
    paho-mqtt numpy pandas scikit-learn xgboost \
    fastapi uvicorn influxdb-client joblib scipy apscheduler
CMD ["python", "edge_ai.py"]
```

#### [NEW] `python/edge_ai.py` — main entry point

Combines MQTT subscriber + FastAPI + scheduled predictions:
- Subscribes to `factory/+/+/+/+/+/telemetry/raw` and `factory/+/+/+/+/+/telemetry/edge-ai`
- Buffers readings per bulb in memory
- Runs XGBoost prediction pipeline every hour via APScheduler
- Publishes alerts to `factory/.../alerts/status`
- Exposes FastAPI on port 5000 for on-demand `/api/predict` calls

#### [NEW] `python/app/feature_engine.py`

Transforms raw readings into ML features:
- `mean_ldr_24h/7d/14d`, `slope_ldr_7d/14d`, `std_ldr_24h`
- `max_drop_24h`, `ldr_ratio_7d_14d`, `cumulative_hours`
- `mean_temperature/current/humidity/voltage/power/ripple`

#### [NEW] `python/app/predictor.py` — XGBoost failure predictor
#### [NEW] `python/app/fault_classifier.py` — XGBoost fault classifier (trained on 34K-row dataset)
#### [NEW] `python/app/anomaly_detector.py` — historical Z-score analysis
#### [NEW] `python/app/alert_engine.py` — severity-based alerts

Alert severity:

| Severity | Condition |
|----------|-----------|
| `INFO` | P(14d) 30–50% |
| `MEDIUM` | P(14d) 50–70% |
| `HIGH` | P(14d) > 70% or P(7d) > 50% |
| `CRITICAL` | Sudden failure or P(3d) > 70% |

---

### Part D — Cloud Training Pipeline

#### [NEW] `ml/training/train_fault_classifier.py`

Trains XGBoost on `street_light_fault_prediction_dataset.csv` (34,310 rows):
- Features: power_consumption, voltage, current_fluctuations, temperature, environmental_conditions (one-hot), current_fluctuations_env
- Target: fault_type (0–4)
- Handles class imbalance (24K healthy vs ~10K faults)
- Saves to `python/models/fault_classifier.joblib`

#### [NEW] `ml/training/generate_synthetic_data.py`

Generates synthetic degradation data for 14-day predictor:
- Ports simulator's decay formula to Python
- ~5000 bulb lifecycles with varied conditions
- Labels: "will fail within 3/7/14 days?"

#### [NEW] `ml/training/train_failure_predictor.py`

Trains XGBoost with calibrated probability output. Saves to `python/models/failure_predictor.joblib`.

---

### Part E — Docker Integration

#### [MODIFY] [docker-compose.yml](file:///d:/01_OneDrive/OneDrive%20-%20University%20of%20Peradeniya/02.%20Others/02.%20Documents/11.%20GitHub/19.%20LED%20Luminaire%20Monitor%20-%20CO326/e20-co326-Digital-Twin-LED-Luminaire-Monitor/docker/docker-compose.yml)

Add `python-edge` service after the existing `node-red` service:

```yaml
  python-edge:
    build:
      context: ../python
      dockerfile: Dockerfile
    container_name: python-edge
    environment:
      - INFLUXDB_URL=http://influxdb:8086
      - INFLUXDB_TOKEN=root-token
      - INFLUXDB_ORG=light_org
      - INFLUXDB_BUCKET=light_data
      - MQTT_URL=mqtt://mosquitto:1883
      - MQTT_TOPIC_ALERTS=factory/sitea/floor1/line1/cell1/lum_0001/alerts/status
      - MQTT_TOPIC_DATA=factory/+/+/+/+/+/telemetry/raw
      - MQTT_TOPIC_EDGE=factory/+/+/+/+/+/telemetry/edge-ai
    ports:
      - "5000:5000"
    depends_on:
      - influxdb
      - mosquitto
    networks:
      - iot_network
```

---

## Implementation Order

| Phase | What | Key Files |
|-------|------|-----------|
| **1** | Generate TinyML training data | `ml/training/generate_tinyml_training_data.py` |
| **2** | Train & export TinyML model to C header | `ml/training/train_tinyml_classifier.py`, `export_model.py` |
| **3** | Update ESP32 firmware with TinyML | `edge-logic/firmware/light_monitor/` |
| **4** | Train fault classifier (street light dataset) | `ml/training/train_fault_classifier.py` |
| **5** | Generate synthetic degradation data + train failure predictor | `ml/training/generate_synthetic_data.py`, `train_failure_predictor.py` |
| **6** | Build Python service (all app/ modules) | `python/` directory |
| **7** | Dockerfile + Docker Compose update | `python/Dockerfile`, `docker/docker-compose.yml` |
| **8** | Integration testing | End-to-end MQTT flow |

---

## Verification Plan

### Automated
1. TinyML model: accuracy > 85% on test set, model size < 5KB
2. Fault classifier: accuracy > 80% on street light dataset
3. Failure predictor: AUC-ROC > 0.75
4. `docker compose up --build` starts all containers including python-edge
5. `curl POST localhost:5000/api/predict` returns valid prediction
6. MQTT flow: ESP32 → mosquitto → python-edge → alerts topic → Node-RED

### Manual
1. Flash ESP32, verify TinyML output on Serial Monitor (class + confidence)
2. Inject anomalies via simulator → verify sudden failure alert
3. Verify Grafana dashboard shows predictions and alerts
