"""
feature_engine.py
=================
Feature engineering module for the XGBoost failure predictor.

Transforms raw hourly sensor readings into the ML features expected
by the failure predictor model.  This module is used both during
training (by train_failure_predictor.py) and at inference time (by
predictor.py).

All features are computed from a list of chronologically-ordered
sensor reading dictionaries.

Features produced
-----------------
    ldr              – latest LDR value
    mean_ldr_24      – 24-hour rolling mean of LDR
    mean_ldr_168     – 7-day (168-hour) rolling mean of LDR
    std_ldr_24       – 24-hour rolling standard deviation of LDR
    slope_ldr_168    – degradation slope over 7 days
    max_drop_24      – maximum single-period brightness drop in 24h
    ldr_ratio        – recent/historical brightness ratio
    operating_hours  – cumulative operating hours
    temperature      – mean temperature over window
    humidity         – mean humidity over window
    current          – mean drive current over window
    voltage          – mean voltage over window
    power_consumption – mean power consumption over window
    ripple_percent   – mean ripple percentage over window
    rgb_r            – latest red channel value
    rgb_g            – latest green channel value
    rgb_b            – latest blue channel value
"""

import numpy as np
from typing import Any


# The feature names in the exact order expected by the model
FEATURE_NAMES = [
    "ldr",
    "mean_ldr_24",
    "mean_ldr_168",
    "std_ldr_24",
    "slope_ldr_168",
    "max_drop_24",
    "ldr_ratio",
    "operating_hours",
    "temperature",
    "humidity",
    "current",
    "voltage",
    "power_consumption",
    "ripple_percent",
    "rgb_r",
    "rgb_g",
    "rgb_b",
]


def _safe_mean(values: list[float]) -> float:
    """Compute mean, returning 0 if the list is empty."""
    return float(np.mean(values)) if values else 0.0


def _safe_std(values: list[float]) -> float:
    """Compute standard deviation, returning 0 if the list is empty."""
    return float(np.std(values)) if len(values) > 1 else 0.0


def _compute_slope(values: list[float]) -> float:
    """
    Compute the linear regression slope of a series.
    Returns (last - first) / length as a simple approximation.
    """
    if len(values) < 2:
        return 0.0
    return (values[-1] - values[0]) / len(values)


def _compute_max_drop(values: list[float]) -> float:
    """
    Compute the maximum single-step brightness drop in the series.
    A "drop" is when a later reading is lower than the window maximum.
    """
    if not values:
        return 0.0
    return max(0, max(values) - values[-1])


def extract_features(readings: list[dict[str, Any]]) -> np.ndarray:
    """
    Extract a feature vector from a list of hourly sensor readings.

    Parameters
    ----------
    readings : list[dict]
        Chronologically-ordered sensor readings.  Each dict must contain:
            ldr (int), temperature (float), current (float),
            voltage (float), humidity (float), power_consumption (float),
            ripple_percent (float), rgb (dict with r, g, b keys)

    Returns
    -------
    np.ndarray
        Feature vector of shape (17,) matching FEATURE_NAMES.
    """
    if not readings:
        return np.zeros(len(FEATURE_NAMES), dtype=np.float32)

    # Extract LDR series
    ldr_values = [r["ldr"] for r in readings]
    latest = readings[-1]

    # Rolling windows (use available data, capped at window size)
    ldr_24 = ldr_values[-24:]       # Last 24 readings
    ldr_168 = ldr_values[-168:]     # Last 168 readings (7 days)

    # Core LDR features
    ldr = float(latest["ldr"])
    mean_ldr_24 = _safe_mean(ldr_24)
    mean_ldr_168 = _safe_mean(ldr_168)
    std_ldr_24 = _safe_std(ldr_24)
    slope_ldr_168 = _compute_slope(ldr_168)
    max_drop_24 = _compute_max_drop(ldr_24)

    # Ratio of recent to historical brightness (degradation indicator)
    ldr_ratio = mean_ldr_24 / mean_ldr_168 if mean_ldr_168 > 0 else 1.0

    # Operating hours (from the latest reading if available, else estimate)
    operating_hours = float(latest.get("operating_hours", len(readings)))

    # Environmental features (mean over available readings)
    temperature = _safe_mean([r["temperature"] for r in readings[-24:]])
    humidity = _safe_mean([r["humidity"] for r in readings[-24:]])
    current = _safe_mean([r["current"] for r in readings[-24:]])
    voltage = _safe_mean([r["voltage"] for r in readings[-24:]])
    power = _safe_mean([r["power_consumption"] for r in readings[-24:]])
    ripple = _safe_mean([r["ripple_percent"] for r in readings[-24:]])

    # RGB (latest reading)
    rgb = latest.get("rgb", {"r": 0, "g": 0, "b": 0})
    rgb_r = float(rgb["r"])
    rgb_g = float(rgb["g"])
    rgb_b = float(rgb["b"])

    # Assemble feature vector in the expected order
    feature_vector = np.array([
        ldr,
        mean_ldr_24,
        mean_ldr_168,
        std_ldr_24,
        slope_ldr_168,
        max_drop_24,
        ldr_ratio,
        operating_hours,
        temperature,
        humidity,
        current,
        voltage,
        power,
        ripple,
        rgb_r,
        rgb_g,
        rgb_b,
    ], dtype=np.float32)

    return feature_vector
