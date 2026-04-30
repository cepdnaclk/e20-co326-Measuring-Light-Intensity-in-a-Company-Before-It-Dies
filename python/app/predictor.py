"""
predictor.py
============
XGBoost failure prediction module.

Loads the pre-trained failure predictor model and provides a function
to predict the probability of bulb failure within 3, 7, and 14 days.

The model expects features produced by feature_engine.extract_features().
Probability output is calibrated (via CalibratedClassifierCV during
training) so values can be interpreted as true probabilities.

Usage
-----
    from app.predictor import FailurePredictor

    predictor = FailurePredictor("models/failure_predictor.joblib")
    result = predictor.predict(readings)
    # result = {
    #     "probability_3_days":  0.08,
    #     "probability_7_days":  0.23,
    #     "probability_14_days": 0.67,
    #     "estimated_remaining_days": 18,
    #     "confidence": 0.82,
    # }
"""

import os
import logging
import numpy as np
import joblib
from app.feature_engine import extract_features

logger = logging.getLogger(__name__)


class FailurePredictor:
    """
    Wraps the three XGBoost failure prediction models (3d, 7d, 14d)
    loaded from a single joblib artifact.
    """

    def __init__(self, model_path: str):
        """
        Load the failure predictor artifact.

        Parameters
        ----------
        model_path : str
            Path to the joblib file produced by train_failure_predictor.py.
        """
        self.model_path = model_path
        self.models = {}
        self.feature_names = []
        self.loaded = False

        if os.path.exists(model_path):
            self._load()
        else:
            logger.warning(
                "Failure predictor model not found at %s. "
                "Predictions will return defaults.", model_path,
            )

    def _load(self):
        """Load the model artifact from disk."""
        artifact = joblib.load(self.model_path)
        self.models = artifact["models"]       # {"3d": ..., "7d": ..., "14d": ...}
        self.feature_names = artifact["feature_names"]
        self.loaded = True
        logger.info(
            "Loaded failure predictor: windows=%s, features=%d",
            list(self.models.keys()), len(self.feature_names),
        )

    def predict(self, readings: list[dict]) -> dict:
        """
        Predict failure probabilities for a bulb given its recent readings.

        Parameters
        ----------
        readings : list[dict]
            Chronologically-ordered hourly sensor readings (all fields required).

        Returns
        -------
        dict
            Failure prediction results including probabilities and estimated
            remaining days.
        """
        # Default response when model is not loaded
        default = {
            "probability_3_days": 0.0,
            "probability_7_days": 0.0,
            "probability_14_days": 0.0,
            "estimated_remaining_days": -1,
            "confidence": 0.0,
        }

        if not self.loaded or not readings:
            return default

        # Extract features
        features = extract_features(readings)
        X = features.reshape(1, -1)

        # Get probability from each window model
        probabilities = {}
        for window_name, info in self.models.items():
            model = info["model"]
            try:
                prob = model.predict_proba(X)[0][1]  # P(failure)
            except Exception as e:
                logger.error("Prediction error for %s: %s", window_name, e)
                prob = 0.0
            probabilities[window_name] = round(float(prob), 4)

        # Estimate remaining days from the 14-day probability
        # Simple heuristic: remaining_days ≈ 14 × (1 - P(14d))
        p14 = probabilities.get("14d", 0)
        estimated_days = max(0, round(14 * (1 - p14)))

        # Confidence is the maximum probability across windows
        # (higher confidence when predictions agree)
        confidence = max(probabilities.values()) if probabilities else 0.0

        return {
            "probability_3_days": probabilities.get("3d", 0.0),
            "probability_7_days": probabilities.get("7d", 0.0),
            "probability_14_days": probabilities.get("14d", 0.0),
            "estimated_remaining_days": estimated_days,
            "confidence": round(confidence, 4),
        }
