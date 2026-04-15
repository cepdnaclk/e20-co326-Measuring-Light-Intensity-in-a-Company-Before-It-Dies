# Sensor Simulator

React + Node.js simulator for luminaire sensor streams:

- RGB sensor (TCS34725 style RGBC output)
- LDR ADC output
- Ripple monitor output (ESP32 analog input style percent)

This implementation intentionally removes all ML inference features and focuses on sensor simulation and anomaly injection.

## Run

```bash
cd simulator
npm install
npm run install:all
npm run dev
```

- API server: `http://localhost:4000`
- React app: `http://localhost:5173`

## Anomaly Injection

Use the dashboard controls to inject custom values for:

- RGB channels (`R`, `G`, `B`)
- LDR ADC
- Ripple percentage

Each sensor channel can be toggled independently.

## MQTT Publishing (Mosquitto / Node-RED)

The server now publishes each simulated sample to MQTT so Node-RED can consume it.

- Default broker: `mqtt://localhost:1883`
- Default topic: `led/simulator/sensors`

Configure with environment variables before starting server:

- `MQTT_ENABLED=true|false` (default: `true`)
- `MQTT_URL` (default: `mqtt://localhost:1883`)
- `MQTT_TOPIC` (default: `led/simulator/sensors`)
- `MQTT_CLIENT_ID` (optional custom client id)

Example:

```bash
MQTT_URL=mqtt://localhost:1883 MQTT_TOPIC=led/simulator/sensors npm run dev --prefix server
```
