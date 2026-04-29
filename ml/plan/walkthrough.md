# ML Predictive Failure Service — Walkthrough

## Summary

Implemented a **two-tier ML system** for LED bulb predictive failure monitoring:

1. **ESP32 Edge AI (TinyML)** — Real-time 3-class classification on the device
2. **Python Cloud AI (XGBoost)** — 14-day failure prediction with calibrated probabilities

Created **18 new files** and modified **2 existing files** across 4 components.

---

## Files Created

### Training Pipeline (`ml/training/` — 5 files)

| File | Purpose |
|------|---------|
| [generate_tinyml_training_data.py](file:///d:/01_OneDrive/OneDrive%20-%20University%20of%20Peradeniya/02.%20Others/02.%20Documents/11.%20GitHub/19.%20LED%20Luminaire%20Monitor%20-%20CO326/e20-co326-Digital-Twin-LED-Luminaire-Monitor/ml/training/generate_tinyml_training_data.py) | Generates 100K labelled samples from simulated bulb lifecycles for TinyML |
| [train_tinyml_classifier.py](file:///d:/01_OneDrive/OneDrive%20-%20University%20of%20Peradeniya/02.%20Others/02.%20Documents/11.%20GitHub/19.%20LED%20Luminaire%20Monitor%20-%20CO326/e20-co326-Digital-Twin-LED-Luminaire-Monitor/ml/training/train_tinyml_classifier.py) | Trains Keras model → TFLite int8 → C header for ESP32 |
| [train_fault_classifier.py](file:///d:/01_OneDrive/OneDrive%20-%20University%20of%20Peradeniya/02.%20Others/02.%20Documents/11.%20GitHub/19.%20LED%20Luminaire%20Monitor%20-%20CO326/e20-co326-Digital-Twin-LED-Luminaire-Monitor/ml/training/train_fault_classifier.py) | Trains XGBoost on 34K-row street light dataset (5 fault types) |
| [generate_synthetic_data.py](file:///d:/01_OneDrive/OneDrive%20-%20University%20of%20Peradeniya/02.%20Others/02.%20Documents/11.%20GitHub/19.%20LED%20Luminaire%20Monitor%20-%20CO326/e20-co326-Digital-Twin-LED-Luminaire-Monitor/ml/training/generate_synthetic_data.py) | Generates time-series degradation data for 14-day predictor |
| [train_failure_predictor.py](file:///d:/01_OneDrive/OneDrive%20-%20University%20of%20Peradeniya/02.%20Others/02.%20Documents/11.%20GitHub/19.%20LED%20Luminaire%20Monitor%20-%20CO326/e20-co326-Digital-Twin-LED-Luminaire-Monitor/ml/training/train_failure_predictor.py) | Trains calibrated XGBoost for 3/7/14-day failure prediction |

### ESP32 Firmware (`edge-logic/firmware/light_monitor/` — 1 file modified)

| File | Purpose |
|------|---------|
| [tinyml_light_monitor.ino](file:///d:/01_OneDrive/OneDrive%20-%20University%20of%20Peradeniya/02.%20Others/02.%20Documents/11.%20GitHub/19.%20LED%20Luminaire%20Monitor%20-%20CO326/e20-co326-Digital-Twin-LED-Luminaire-Monitor/edge-logic/firmware/light_monitor/tinyml_light_monitor.ino) | Replaced thresholds with TinyML inference + Z-score anomaly detection |

### Python Service (`python/` — 11 files)

| File | Purpose |
|------|---------|
| [edge_ai.py](file:///d:/01_OneDrive/OneDrive%20-%20University%20of%20Peradeniya/02.%20Others/02.%20Documents/11.%20GitHub/19.%20LED%20Luminaire%20Monitor%20-%20CO326/e20-co326-Digital-Twin-LED-Luminaire-Monitor/python/edge_ai.py) | Main entry: MQTT subscriber + FastAPI + scheduler |
| [mqtt_publisher.py](file:///d:/01_OneDrive/OneDrive%20-%20University%20of%20Peradeniya/02.%20Others/02.%20Documents/11.%20GitHub/19.%20LED%20Luminaire%20Monitor%20-%20CO326/e20-co326-Digital-Twin-LED-Luminaire-Monitor/python/mqtt_publisher.py) | Standalone test publisher (simulates ESP32) |
| [app/config.py](file:///d:/01_OneDrive/OneDrive%20-%20University%20of%20Peradeniya/02.%20Others/02.%20Documents/11.%20GitHub/19.%20LED%20Luminaire%20Monitor%20-%20CO326/e20-co326-Digital-Twin-LED-Luminaire-Monitor/python/app/config.py) | Centralised env-based configuration |
| [app/feature_engine.py](file:///d:/01_OneDrive/OneDrive%20-%20University%20of%20Peradeniya/02.%20Others/02.%20Documents/11.%20GitHub/19.%20LED%20Luminaire%20Monitor%20-%20CO326/e20-co326-Digital-Twin-LED-Luminaire-Monitor/python/app/feature_engine.py) | Feature engineering (rolling stats, slopes, etc.) |
| [app/predictor.py](file:///d:/01_OneDrive/OneDrive%20-%20University%20of%20Peradeniya/02.%20Others/02.%20Documents/11.%20GitHub/19.%20LED%20Luminaire%20Monitor%20-%20CO326/e20-co326-Digital-Twin-LED-Luminaire-Monitor/python/app/predictor.py) | XGBoost failure predictor wrapper |
| [app/fault_classifier.py](file:///d:/01_OneDrive/OneDrive%20-%20University%20of%20Peradeniya/02.%20Others/02.%20Documents/11.%20GitHub/19.%20LED%20Luminaire%20Monitor%20-%20CO326/e20-co326-Digital-Twin-LED-Luminaire-Monitor/python/app/fault_classifier.py) | XGBoost fault type classifier |
| [app/anomaly_detector.py](file:///d:/01_OneDrive/OneDrive%20-%20University%20of%20Peradeniya/02.%20Others/02.%20Documents/11.%20GitHub/19.%20LED%20Luminaire%20Monitor%20-%20CO326/e20-co326-Digital-Twin-LED-Luminaire-Monitor/python/app/anomaly_detector.py) | Z-score + rapid-drop anomaly detection |
| [app/alert_engine.py](file:///d:/01_OneDrive/OneDrive%20-%20University%20of%20Peradeniya/02.%20Others/02.%20Documents/11.%20GitHub/19.%20LED%20Luminaire%20Monitor%20-%20CO326/e20-co326-Digital-Twin-LED-Luminaire-Monitor/python/app/alert_engine.py) | Severity-based alert generation + MQTT publishing |
| [app/influxdb_client.py](file:///d:/01_OneDrive/OneDrive%20-%20University%20of%20Peradeniya/02.%20Others/02.%20Documents/11.%20GitHub/19.%20LED%20Luminaire%20Monitor%20-%20CO326/e20-co326-Digital-Twin-LED-Luminaire-Monitor/python/app/influxdb_client.py) | InfluxDB query service |
| [Dockerfile](file:///d:/01_OneDrive/OneDrive%20-%20University%20of%20Peradeniya/02.%20Others/02.%20Documents/11.%20GitHub/19.%20LED%20Luminaire%20Monitor%20-%20CO326/e20-co326-Digital-Twin-LED-Luminaire-Monitor/python/Dockerfile) | Docker image definition |
| [requirements.txt](file:///d:/01_OneDrive/OneDrive%20-%20University%20of%20Peradeniya/02.%20Others/02.%20Documents/11.%20GitHub/19.%20LED%20Luminaire%20Monitor%20-%20CO326/e20-co326-Digital-Twin-LED-Luminaire-Monitor/python/requirements.txt) | Pinned Python dependencies |

### Docker Integration (1 file modified)

| File | Change |
|------|--------|
| [docker-compose.yml](file:///d:/01_OneDrive/OneDrive%20-%20University%20of%20Peradeniya/02.%20Others/02.%20Documents/11.%20GitHub/19.%20LED%20Luminaire%20Monitor%20-%20CO326/e20-co326-Digital-Twin-LED-Luminaire-Monitor/docker/docker-compose.yml) | Added `python-edge` service (port 5000) |

---

## How to Run

### Step 1: Install training dependencies

```bash
pip install tensorflow numpy pandas scikit-learn xgboost joblib scipy
```

### Step 2: Run the training pipeline (in order)

```bash
cd ml/training

# 1. Generate TinyML training data
python generate_tinyml_training_data.py

# 2. Train TinyML model and export C header
python train_tinyml_classifier.py

# 3. Generate synthetic degradation data
python generate_synthetic_data.py

# 4. Train fault classifier
python train_fault_classifier.py

# 5. Train failure predictor
python train_failure_predictor.py
```

### Step 3: Flash ESP32

1. Open `edge-logic/firmware/light_monitor/tinyml_light_monitor.ino` in Arduino IDE
2. Install libraries: `EloquentTinyML`, `PubSubClient`
3. Verify `bulb_model.h` exists in the same directory
4. Upload to ESP32

### Step 4: Start Docker stack

```bash
cd docker
docker compose up -d --build
```

### Step 5: Verify

```bash
# Check python-edge health
curl http://localhost:5000/api/health

# Test prediction
curl -X POST http://localhost:5000/api/predict \
  -H "Content-Type: application/json" \
  -d '{"bulb_id":"lum_0001","readings":[{"timestamp":"2026-04-29T12:00:00Z","ldr":3500,"temperature":25.0,"current":320.0,"voltage":230.0,"humidity":45.0,"rgb":{"r":255,"g":240,"b":225},"power_consumption":60.0,"ripple_percent":1.6}]}'
```
