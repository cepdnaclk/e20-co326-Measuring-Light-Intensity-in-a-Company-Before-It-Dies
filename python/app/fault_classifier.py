"""
fault_classifier.py
====================
XGBoost fault type classification module.

Loads the pre-trained fault classifier (trained on the 34K-row street
light fault prediction dataset) and classifies the current fault type
of a bulb based on electrical and environmental features.

Fault types
-----------
    0  No Fault
    1  Electrical Fault
    2  Thermal Fault
    3  Environmental Fault
    4  Wear-out Fault

Usage
-----
    from app.fault_classifier import FaultClassifier

    classifier = FaultClassifier("models/fault_classifier.joblib")
    result = classifier.classify(reading)
    # result = {
    #     "predicted_fault_type": 0,
    #     "fault_label": "No Fault",
    #     "fault_probabilities": {"no_fault": 0.85, ...}
    # }
"""

import os
import logging
import numpy as np
import joblib

logger = logging.getLogger(__name__)

# Probability output labels (must match training order)
PROB_KEYS = [
    "no_fault",
    "electrical_fault",
    "thermal_fault",
    "environmental_fault",
    "wear_out",
]

# Environmental condition encoding — same one-hot scheme used in training
ENV_CONDITIONS = ["Clear", "Cloudy", "Rainy"]


class FaultClassifier:
    """
    Wraps the XGBoost multi-class fault classifier loaded from a
    joblib artifact.
    """

    def __init__(self, model_path: str):
        """
        Load the fault classifier artifact.

        Parameters
        ----------
        model_path : str
            Path to the joblib file produced by train_fault_classifier.py.
        """
        self.model_path = model_path
        self.model = None
        self.feature_names = []
        self.fault_labels = []
        self.loaded = False

        if os.path.exists(model_path):
            self._load()
        else:
            logger.warning(
                "Fault classifier model not found at %s. "
                "Classification will return defaults.", model_path,
            )

    def _load(self):
        """Load the model artifact from disk."""
        artifact = joblib.load(self.model_path)
        self.model = artifact["model"]
        self.feature_names = artifact["feature_names"]
        self.fault_labels = artifact["fault_labels"]
        self.loaded = True
        logger.info(
            "Loaded fault classifier: labels=%s, features=%d",
            self.fault_labels, len(self.feature_names),
        )

    def _build_features(self, reading: dict) -> np.ndarray:
        """
        Build a feature vector from a single sensor reading dict.

        The reading must contain all required fields (with dummy values
        if real sensors are not connected).

        The feature order must match the training data:
            power_consumption, voltage_levels, current_fluctuations,
            temperature, current_fluctuations_env,
            environmental_conditions_Clear,
            environmental_conditions_Cloudy,
            environmental_conditions_Rainy
        """
        # Map the reading keys to the dataset column names
        power = float(reading.get("power_consumption", 60.0))
        voltage = float(reading.get("voltage", 230.0))
        current_fluct = float(reading.get("current", 320.0))
        temperature = float(reading.get("temperature", 25.0))
        current_env = float(reading.get("current", 320.0)) * 0.01  # Approximation

        # One-hot encode environmental conditions (default: "Clear")
        env = reading.get("environmental_conditions", "Clear")
        env_clear = 1 if env == "Clear" else 0
        env_cloudy = 1 if env == "Cloudy" else 0
        env_rainy = 1 if env == "Rainy" else 0

        features = np.array([
            power,
            voltage,
            current_fluct,
            temperature,
            current_env,
            env_clear,
            env_cloudy,
            env_rainy,
        ], dtype=np.float32)

        return features.reshape(1, -1)

    def classify(self, reading: dict) -> dict:
        """
        Classify the fault type of a single sensor reading.

        Parameters
        ----------
        reading : dict
            A sensor reading with all fields required (use dummy values
            for sensors not yet connected).

        Returns
        -------
        dict
            Classification result with predicted type, label, and
            per-class probabilities.
        """
        default = {
            "predicted_fault_type": 0,
            "fault_label": "No Fault",
            "fault_probabilities": {k: 0.0 for k in PROB_KEYS},
        }

        if not self.loaded:
            return default

        try:
            X = self._build_features(reading)
            proba = self.model.predict_proba(X)[0]
            predicted = int(np.argmax(proba))

            return {
                "predicted_fault_type": predicted,
                "fault_label": self.fault_labels[predicted],
                "fault_probabilities": {
                    PROB_KEYS[i]: round(float(proba[i]), 4)
                    for i in range(len(PROB_KEYS))
                },
            }
        except Exception as e:
            logger.error("Fault classification error: %s", e)
            return default
