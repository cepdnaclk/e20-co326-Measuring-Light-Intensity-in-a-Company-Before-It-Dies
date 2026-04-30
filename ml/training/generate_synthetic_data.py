"""
generate_synthetic_data.py
==========================
Generates synthetic bulb degradation data for training the XGBoost
14-day failure predictor that runs in the Python Docker container.

Unlike the TinyML training data (which uses single-window snapshots),
this script generates *time-series* data for each bulb — hourly
readings over the bulb's entire lifetime — and labels each hourly
observation with whether the bulb will fail within 3, 7, or 14 days.

The failure threshold is defined as normalised intensity < 0.3 (same
as the TinyML FAILED class).

The feature engineering step (computing rolling means, slopes, etc.)
is performed by the Python service's feature_engine.py at runtime.
This script outputs raw hourly readings so that feature_engine can
be applied identically during both training and inference.

Output
------
    ml/training/data/synthetic_degradation_data.csv

Usage
-----
    python generate_synthetic_data.py
"""

import os
import csv
import math
import random

# ---------------------------------------------------------------------------
# Constants — same degradation model as the simulator
# ---------------------------------------------------------------------------
ADC_MAX = 4095
NOISE_RATIO = 0.02
FAILURE_INTENSITY = 0.3  # Intensity below this = FAILED

# Simulation parameters
NUM_BULBS = 2000
HOURS_PER_READING = 1     # One reading per hour
PREDICTION_WINDOWS = [3 * 24, 7 * 24, 14 * 24]  # In hours: 3d, 7d, 14d

# ---------------------------------------------------------------------------
# Output path
# ---------------------------------------------------------------------------
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(SCRIPT_DIR, "data")
OUTPUT_CSV = os.path.join(DATA_DIR, "synthetic_degradation_data.csv")


def noise(value, ratio=NOISE_RATIO):
    """Add uniform sensor noise."""
    return value + (random.random() - 0.5) * 2 * value * ratio


def clamp(value, lo, hi):
    """Clamp value between lo and hi."""
    return max(lo, min(hi, value))


def compute_intensity(hours, temp, humidity, current):
    """
    Compute normalised intensity using the simulator's decay model.
    Ported from instanceManager.js lines 113-117.
    """
    return (
        math.exp(-0.00006 * hours)
        * (1 - max(0, temp - 25) * 0.0025)
        * (1 - max(0, humidity - 50) * 0.001)
        * (1 + (current - 350) * 0.0004)
    )


def compute_ldr(intensity):
    """Convert normalised intensity to LDR ADC value."""
    safe = clamp(intensity, 0.05, 1.1)
    raw = noise(
        (ADC_MAX * math.log10(1 + safe * 9)) / math.log10(10),
        NOISE_RATIO,
    )
    return int(clamp(raw, 0, ADC_MAX))


def compute_rgb(intensity):
    """
    Compute RGB sensor values.
    Ported from instanceManager.js lines 121-123.
    """
    safe = clamp(intensity, 0.05, 1.1)
    r = int(clamp(noise(255 * safe * 1.0), 0, 1023))
    g = int(clamp(noise(240 * safe * 0.95), 0, 1023))
    b = int(clamp(noise(225 * safe * 0.9), 0, 1023))
    return r, g, b


def compute_ripple(hours, current):
    """
    Compute ripple percentage.
    Ported from instanceManager.js lines 129-133.
    """
    raw = noise(
        (1 + hours * 0.0001 + (current - 350) * 0.0005) * 1.6,
        0.1,
    )
    return round(clamp(raw, 0.2, 45), 2)


def find_failure_hour(temp, humidity, current, max_hours=30000):
    """
    Binary-search for the hour at which intensity drops below
    FAILURE_INTENSITY for the given environmental conditions.
    Returns None if the bulb survives past max_hours.
    """
    lo, hi = 0, max_hours
    if compute_intensity(0, temp, humidity, current) < FAILURE_INTENSITY:
        return 0
    if compute_intensity(max_hours, temp, humidity, current) >= FAILURE_INTENSITY:
        return None

    for _ in range(50):  # 50 iterations of bisection
        mid = (lo + hi) / 2
        if compute_intensity(mid, temp, humidity, current) < FAILURE_INTENSITY:
            hi = mid
        else:
            lo = mid
    return int(hi)


def simulate_bulb(bulb_id):
    """
    Simulate one bulb lifecycle and return hourly observation rows.

    Each row contains raw sensor values + labels for whether the bulb
    will fail within 3, 7, or 14 days from that observation.
    """
    # Randomise operating conditions
    temp = round(random.uniform(15, 45), 1)
    humidity = round(random.uniform(20, 80), 1)
    current = round(random.uniform(200, 500), 1)
    voltage = round(random.uniform(210, 245), 1)
    power = round(random.uniform(40, 200), 1)

    # Find when this bulb fails
    failure_hour = find_failure_hour(temp, humidity, current)
    if failure_hour is None:
        failure_hour = 30000  # Will never reach failure in our range

    # Simulate up to failure_hour + some margin (or cap at 25000 hours)
    total_hours = min(failure_hour + 500, 25000)

    # Sample every HOURS_PER_READING hours
    # To keep dataset manageable, sub-sample: take every Nth reading
    step = max(1, total_hours // 500)  # ~500 readings per bulb

    rows = []
    for hour in range(0, total_hours, step):
        intensity = compute_intensity(hour, temp, humidity, current)
        ldr = compute_ldr(intensity)
        r, g, b = compute_rgb(intensity)
        ripple = compute_ripple(hour, current)

        # Label: will the bulb fail within X hours from now?
        hours_to_failure = max(0, failure_hour - hour)
        will_fail_3d = 1 if hours_to_failure <= PREDICTION_WINDOWS[0] else 0
        will_fail_7d = 1 if hours_to_failure <= PREDICTION_WINDOWS[1] else 0
        will_fail_14d = 1 if hours_to_failure <= PREDICTION_WINDOWS[2] else 0

        rows.append([
            bulb_id,
            hour,
            ldr,
            temp,
            humidity,
            current,
            voltage,
            power,
            r, g, b,
            ripple,
            round(intensity, 4),
            hours_to_failure,
            will_fail_3d,
            will_fail_7d,
            will_fail_14d,
        ])

    return rows


def main():
    """Generate synthetic degradation data for all simulated bulbs."""
    os.makedirs(DATA_DIR, exist_ok=True)

    header = [
        "bulb_id",
        "operating_hours",
        "ldr",
        "temperature",
        "humidity",
        "current",
        "voltage",
        "power_consumption",
        "rgb_r", "rgb_g", "rgb_b",
        "ripple_percent",
        "intensity",
        "hours_to_failure",
        "will_fail_3d",
        "will_fail_7d",
        "will_fail_14d",
    ]

    all_rows = []
    for i in range(NUM_BULBS):
        bulb_rows = simulate_bulb(f"bulb_{i:04d}")
        all_rows.extend(bulb_rows)
        if (i + 1) % 200 == 0:
            print(f"  Simulated {i + 1}/{NUM_BULBS} bulbs ...")

    # Shuffle rows
    random.shuffle(all_rows)

    with open(OUTPUT_CSV, "w", newline="") as f:
        writer = csv.writer(f)
        writer.writerow(header)
        writer.writerows(all_rows)

    # Print summary
    total = len(all_rows)
    fail_14d = sum(1 for r in all_rows if r[-1] == 1)
    fail_7d = sum(1 for r in all_rows if r[-2] == 1)
    fail_3d = sum(1 for r in all_rows if r[-3] == 1)
    print(f"\nGenerated {total} samples -> {OUTPUT_CSV}")
    print(f"  Will fail in 14d: {fail_14d} ({100*fail_14d/total:.1f}%)")
    print(f"  Will fail in 7d:  {fail_7d} ({100*fail_7d/total:.1f}%)")
    print(f"  Will fail in 3d:  {fail_3d} ({100*fail_3d/total:.1f}%)")


if __name__ == "__main__":
    main()
