"""
anomaly_detector.py
====================
Server-side anomaly detection using historical sensor readings.

Complements the ESP32 edge-side Z-score detection with deeper
analysis over longer time windows.  Detects two types of anomalies:

1. **Z-score anomaly**: Latest reading is more than Z_SCORE_THRESHOLD
   standard deviations away from the historical mean.

2. **Rapid brightness drop**: Brightness dropped by more than
   RAPID_DROP_PERCENT within the last 24 readings.

Usage
-----
    from app.anomaly_detector import AnomalyDetector

    detector = AnomalyDetector(z_threshold=3.0, drop_percent=30.0)
    result = detector.detect(readings)
    # result = {
    #     "detected": True,
    #     "drop_magnitude": 1200,
    #     "z_score": 3.5,
    #     "reason": "Z-score anomaly: latest reading is 3.5σ below mean"
    # }
"""

import logging
import numpy as np

logger = logging.getLogger(__name__)


class AnomalyDetector:
    """
    Detects sudden bulb failures from historical sensor readings
    using statistical methods.
    """

    def __init__(self, z_threshold: float = 3.0, drop_percent: float = 30.0):
        """
        Parameters
        ----------
        z_threshold : float
            Z-score threshold for flagging anomalies.
        drop_percent : float
            Maximum acceptable brightness drop (%) in 24 hours.
        """
        self.z_threshold = z_threshold
        self.drop_percent = drop_percent

    def detect(self, readings: list[dict]) -> dict:
        """
        Analyse the reading history for sudden failure indicators.

        Parameters
        ----------
        readings : list[dict]
            Chronologically-ordered sensor readings.  Each dict must
            contain an 'ldr' field (int).

        Returns
        -------
        dict
            Detection result with 'detected', 'drop_magnitude',
            'z_score', and 'reason' fields.
        """
        result = {
            "detected": False,
            "drop_magnitude": None,
            "z_score": None,
            "reason": None,
        }

        if len(readings) < 10:
            # Not enough data to detect anomalies reliably
            return result

        ldr_values = [r["ldr"] for r in readings]
        latest = ldr_values[-1]

        # ----- 1. Z-score check over the full history -----
        mean = np.mean(ldr_values)
        std = np.std(ldr_values)

        if std > 0:
            z_score = abs(latest - mean) / std
            result["z_score"] = round(float(z_score), 2)

            if z_score > self.z_threshold:
                result["detected"] = True
                result["reason"] = (
                    f"Z-score anomaly: latest reading is "
                    f"{z_score:.1f}σ from mean"
                )

        # ----- 2. Rapid drop check in last 24 readings -----
        recent = ldr_values[-24:]
        if len(recent) >= 2:
            max_recent = max(recent)
            if max_recent > 0:
                drop = max_recent - latest
                drop_pct = (drop / max_recent) * 100
                result["drop_magnitude"] = int(drop)

                if drop_pct > self.drop_percent:
                    result["detected"] = True
                    reason = (
                        f"Rapid drop: brightness fell {drop_pct:.1f}% "
                        f"(from {max_recent} to {latest}) in last 24 readings"
                    )
                    # Append to existing reason if Z-score also triggered
                    if result["reason"]:
                        result["reason"] += f"; {reason}"
                    else:
                        result["reason"] = reason

        return result
