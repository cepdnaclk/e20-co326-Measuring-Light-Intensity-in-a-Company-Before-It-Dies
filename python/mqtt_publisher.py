"""
mqtt_publisher.py
=================
Standalone MQTT publisher for testing the Edge AI service.

Simulates an ESP32 sending sensor readings to the MQTT broker.
Useful for verifying the pipeline without physical hardware.

The publisher sends readings with all required fields (LDR is
simulated with degradation; other sensors use dummy values).

MQTT Topic:
    factory/sitea/floor1/line1/cell1/lum_0001/telemetry/raw

Usage
-----
    python mqtt_publisher.py
"""

import os
import json
import math
import time
import random
import logging

import paho.mqtt.client as mqtt

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s")
logger = logging.getLogger("mqtt_publisher")

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
MQTT_BROKER = os.getenv("MQTT_BROKER", "localhost")
MQTT_PORT = int(os.getenv("MQTT_PORT", "1883"))
MQTT_TOPIC = os.getenv(
    "MQTT_TOPIC",
    "factory/sitea/floor1/line1/cell1/lum_0001/telemetry/raw",
)
PUBLISH_INTERVAL = int(os.getenv("PUBLISH_INTERVAL", "2"))  # seconds

# Simulation parameters
BULB_ID = "lum_0001"
AMBIENT_TEMP = 25.0
HUMIDITY = 45.0
DRIVE_CURRENT = 320.0


def simulate_intensity(hours: float) -> float:
    """Exponential decay model matching the simulator."""
    return math.exp(-0.00006 * hours)


def noise(value: float, ratio: float = 0.02) -> float:
    """Add random sensor noise."""
    return value + (random.random() - 0.5) * 2 * value * ratio


def create_payload(hours: float) -> dict:
    """
    Create a sensor data payload matching the simulator format.

    All fields are populated — LDR simulates degradation while
    other sensors use dummy values.
    """
    intensity = simulate_intensity(hours)
    safe_intensity = max(0.05, min(1.1, intensity))
    adc_max = 4095

    # LDR reading (with noise)
    ldr_raw = noise(
        (adc_max * math.log10(1 + safe_intensity * 9)) / math.log10(10),
        0.02,
    )
    ldr = int(max(0, min(adc_max, ldr_raw)))

    # RGB readings (dummy but realistic)
    r = int(max(0, min(1023, noise(255 * safe_intensity))))
    g = int(max(0, min(1023, noise(240 * safe_intensity * 0.95))))
    b = int(max(0, min(1023, noise(225 * safe_intensity * 0.9))))

    # Ripple (increases with age)
    ripple = round(max(0.2, min(45, noise(
        (1 + hours * 0.0001) * 1.6, 0.1,
    ))), 2)

    return {
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "lamp": {
            "id": BULB_ID,
            "location": {
                "site": "sitea",
                "floor": "floor1",
                "line": "line1",
                "cell": "cell1",
            },
        },
        "sim": {
            "timeHours": round(hours, 2),
            "speed": 1,
            "playing": True,
        },
        "environment": {
            "ambientTemp": AMBIENT_TEMP,
            "humidity": HUMIDITY,
            "driveCurrent": DRIVE_CURRENT,
        },
        "sensors": {
            "tcs34725": {"R": r, "G": g, "B": b, "C": r + g + b},
            "ldrAdc": ldr,
            "ripplePercent": ripple,
        },
        "adc": {"bits": 12, "max": 4095},
    }


def main():
    """Connect to MQTT and publish simulated sensor readings."""
    client = mqtt.Client(
        client_id="test-publisher",
        callback_api_version=mqtt.CallbackAPIVersion.VERSION2,
    )

    logger.info("Connecting to MQTT broker at %s:%d …", MQTT_BROKER, MQTT_PORT)
    client.connect(MQTT_BROKER, MQTT_PORT, keepalive=60)
    client.loop_start()
    logger.info("Connected. Publishing to topic: %s", MQTT_TOPIC)

    hours = 0.0
    hour_step = 100  # Simulate 100 hours per message (accelerated)

    try:
        while True:
            payload = create_payload(hours)
            message = json.dumps(payload)
            client.publish(MQTT_TOPIC, message, qos=0)

            intensity = simulate_intensity(hours)
            logger.info(
                "Published: hours=%.0f  ldr=%d  intensity=%.3f",
                hours, payload["sensors"]["ldrAdc"], intensity,
            )

            hours += hour_step
            time.sleep(PUBLISH_INTERVAL)

    except KeyboardInterrupt:
        logger.info("Stopped by user.")
    finally:
        client.loop_stop()
        client.disconnect()


if __name__ == "__main__":
    main()
