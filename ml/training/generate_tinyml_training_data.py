"""
generate_tinyml_training_data.py
================================
Generates labelled training data for the TinyML bulb-status classifier
that will run on the ESP32.

The script replicates the same exponential-decay degradation model used
by the Node.js simulator (see simulator/server/src/services/instanceManager.js,
lines 108-178) so the TinyML model learns the same physics.

Each simulated bulb lifecycle is sampled at 1-second intervals through a
20-sample sliding window (matching the ESP32 firmware WINDOW_SIZE).  Six
features are extracted from each window and the sample is labelled:
    0 = HEALTHY    (intensity > 0.7)
    1 = DEGRADING  (0.3 <= intensity <= 0.7)
    2 = FAILED     (intensity < 0.3)

Output
------
    ml/training/data/tinyml_training_data.csv
    Columns: ldr_norm, avg_norm, rate_of_change, variance, min_norm, max_norm, label

Usage
-----
    python generate_tinyml_training_data.py
"""

import os
import csv
import math
import random
from collections import deque

# ---------------------------------------------------------------------------
# Constants – mirror the Node.js simulator
# ---------------------------------------------------------------------------
ADC_MAX = 4095                # 12-bit ADC on ESP32
WINDOW_SIZE = 20              # matches ESP32 firmware
NOISE_RATIO = 0.02            # sensor noise amplitude (2 %)

# Label thresholds (based on normalised intensity 0..1)
HEALTHY_THRESH = 0.7
DEGRADING_THRESH = 0.3

# Simulation parameters
NUM_LIFECYCLES = 500          # number of bulb lifecycles to simulate
SAMPLES_PER_LIFECYCLE = 200   # number of window snapshots per lifecycle

# ---------------------------------------------------------------------------
# Output paths
# ---------------------------------------------------------------------------
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(SCRIPT_DIR, "data")
OUTPUT_CSV = os.path.join(DATA_DIR, "tinyml_training_data.csv")


def noise(value: float, ratio: float = NOISE_RATIO) -> float:
    """Add uniform sensor noise identical to the Node.js `noise()` helper."""
    return value + (random.random() - 0.5) * 2 * value * ratio


def clamp(value: float, lo: float, hi: float) -> float:
    """Clamp *value* between *lo* and *hi*."""
    return max(lo, min(hi, value))


def compute_ldr(intensity: float) -> int:
    """
    Convert normalised intensity (0..1) to a 12-bit LDR ADC value.
    Formula matches instanceManager.js line 124-128.
    """
    safe = clamp(intensity, 0.05, 1.1)
    raw = noise(
        (ADC_MAX * math.log10(1 + safe * 9)) / math.log10(10),
        NOISE_RATIO,
    )
    return int(clamp(raw, 0, ADC_MAX))


def compute_intensity(hours: float, temp: float, humidity: float,
                      current: float) -> float:
    """
    Exponential-decay degradation model.
    Ported directly from instanceManager.js lines 113-117.
    """
    return (
        math.exp(-0.00006 * hours)
        * (1 - max(0, temp - 25) * 0.0025)
        * (1 - max(0, humidity - 50) * 0.001)
        * (1 + (current - 350) * 0.0004)
    )


def label_from_intensity(intensity: float) -> int:
    """Map normalised intensity to a class label."""
    if intensity > HEALTHY_THRESH:
        return 0  # HEALTHY
    elif intensity >= DEGRADING_THRESH:
        return 1  # DEGRADING
    else:
        return 2  # FAILED


def extract_features(window: list[int]) -> list[float]:
    """
    Compute the 6 features that the TinyML model expects.

    Parameters
    ----------
    window : list[int]
        The last WINDOW_SIZE LDR readings (raw ADC values 0..4095).

    Returns
    -------
    list[float]
        [ldr_norm, avg_norm, rate_of_change, variance, min_norm, max_norm]
    """
    current = window[-1] / ADC_MAX              # normalise to 0..1
    avg = sum(window) / len(window) / ADC_MAX
    min_val = min(window) / ADC_MAX
    max_val = max(window) / ADC_MAX

    # Rate of change: difference between newest and oldest normalised readings
    rate = (window[-1] - window[0]) / ADC_MAX

    # Variance of normalised readings
    mean_raw = sum(window) / len(window)
    var = sum((r - mean_raw) ** 2 for r in window) / len(window)
    var_norm = var / (ADC_MAX ** 2)             # normalise variance

    return [
        round(current, 6),
        round(avg, 6),
        round(rate, 6),
        round(var_norm, 6),
        round(min_val, 6),
        round(max_val, 6),
    ]


def simulate_lifecycle() -> list[list]:
    """
    Simulate one bulb lifecycle with randomised environmental conditions
    and return a list of [feature_vector..., label] rows.
    """
    # Randomise operating conditions
    temp = random.uniform(15, 45)        # °C
    humidity = random.uniform(20, 80)    # %
    current = random.uniform(200, 500)   # mA

    # Total simulated life in hours (enough to traverse HEALTHY → FAILED)
    total_hours = random.uniform(8_000, 25_000)
    step_hours = total_hours / (SAMPLES_PER_LIFECYCLE * WINDOW_SIZE)

    # Initialise sliding window with healthy readings
    initial_intensity = compute_intensity(0, temp, humidity, current)
    initial_ldr = compute_ldr(initial_intensity)
    window = deque([initial_ldr] * WINDOW_SIZE, maxlen=WINDOW_SIZE)

    rows = []
    hours = 0.0

    for _ in range(SAMPLES_PER_LIFECYCLE):
        # Fill the window with WINDOW_SIZE new readings
        for _ in range(WINDOW_SIZE):
            hours += step_hours
            intensity = compute_intensity(hours, temp, humidity, current)
            ldr = compute_ldr(intensity)
            window.append(ldr)

        # Extract features and label
        features = extract_features(list(window))
        label = label_from_intensity(
            compute_intensity(hours, temp, humidity, current)
        )
        rows.append(features + [label])

    return rows


def main():
    """Generate the full training dataset and write to CSV."""
    os.makedirs(DATA_DIR, exist_ok=True)

    header = [
        "ldr_norm",
        "avg_norm",
        "rate_of_change",
        "variance",
        "min_norm",
        "max_norm",
        "label",
    ]

    all_rows = []
    for i in range(NUM_LIFECYCLES):
        all_rows.extend(simulate_lifecycle())
        if (i + 1) % 100 == 0:
            print(f"  Simulated {i + 1}/{NUM_LIFECYCLES} lifecycles ...")

    # Shuffle so labels are not grouped by lifecycle
    random.shuffle(all_rows)

    with open(OUTPUT_CSV, "w", newline="") as f:
        writer = csv.writer(f)
        writer.writerow(header)
        writer.writerows(all_rows)

    # Print class distribution
    counts = {0: 0, 1: 0, 2: 0}
    for row in all_rows:
        counts[row[-1]] += 1

    print(f"\nGenerated {len(all_rows)} samples -> {OUTPUT_CSV}")
    print(f"  HEALTHY   (0): {counts[0]}")
    print(f"  DEGRADING (1): {counts[1]}")
    print(f"  FAILED    (2): {counts[2]}")


if __name__ == "__main__":
    main()
