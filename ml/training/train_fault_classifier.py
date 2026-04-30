"""
train_fault_classifier.py
=========================
Trains an XGBoost multi-class classifier on the street-light fault
prediction dataset (34 310 rows, 5 fault types).

This model classifies the *current* fault type of a bulb based on
electrical and environmental features.  It runs server-side in the
Python Docker container (not on the ESP32).

Dataset columns
---------------
    bulb_number                     – bulb identifier
    timestamp                       – observation timestamp
    power_consumption (Watts)       – instantaneous power draw
    voltage_levels (Volts)          – supply voltage
    current_fluctuations (Amperes)  – current fluctuation amplitude
    temperature (Celsius)           – ambient temperature
    environmental_conditions        – categorical: Clear / Cloudy / Rainy
    current_fluctuations_env (A)    – environment-driven current noise
    fault_type                      – target label (0–4)

Fault type mapping
------------------
    0  No Fault
    1  Electrical Fault
    2  Thermal Fault
    3  Environmental Fault
    4  Wear-out Fault

Output
------
    python/models/fault_classifier.joblib

Usage
-----
    python train_fault_classifier.py
"""

import os
import joblib
import numpy as np
import pandas as pd
from sklearn.model_selection import train_test_split
from sklearn.metrics import classification_report, confusion_matrix
from sklearn.preprocessing import LabelEncoder
from xgboost import XGBClassifier

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
DATASET_PATH = os.path.normpath(os.path.join(
    SCRIPT_DIR, "..", "models",
    "Street Light Fault Prediction Dataset",
    "street_light_fault_prediction_dataset.csv",
))
OUTPUT_DIR = os.path.normpath(os.path.join(SCRIPT_DIR, "..", "..", "python", "models"))
MODEL_PATH = os.path.join(OUTPUT_DIR, "fault_classifier.joblib")

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------
FAULT_LABELS = [
    "No Fault",
    "Electrical Fault",
    "Thermal Fault",
    "Environmental Fault",
    "Wear-out Fault",
]

RANDOM_STATE = 42
TEST_SIZE = 0.2


def load_and_prepare_data():
    """
    Load the CSV and prepare features / labels.

    - One-hot encodes the 'environmental_conditions' column.
    - Drops non-feature columns (bulb_number, timestamp).
    - Returns X (features) and y (labels) as numpy arrays.
    """
    df = pd.read_csv(DATASET_PATH)
    print(f"Loaded {len(df)} rows from dataset.")
    print(f"Columns: {list(df.columns)}\n")

    # Drop identifier / time columns (not useful for classification)
    df = df.drop(columns=["bulb_number", "timestamp"])

    # One-hot encode the categorical column
    df = pd.get_dummies(df, columns=["environmental_conditions"], dtype=int)

    # Separate features and target
    y = df["fault_type"].values
    X = df.drop(columns=["fault_type"]).values
    feature_names = [c for c in df.columns if c != "fault_type"]

    # Print class distribution
    unique, counts = np.unique(y, return_counts=True)
    print("Class distribution:")
    for cls, cnt in zip(unique, counts):
        print(f"  {cls} ({FAULT_LABELS[cls]}): {cnt}")
    print()

    return X, y, feature_names


def train_model(X_train, y_train):
    """
    Train an XGBoost classifier with hyperparameters tuned for this
    imbalanced dataset (24 K healthy vs ~10 K faults total).

    Uses 'multi:softprob' objective for probability output so that
    downstream code can query per-class probabilities.
    """
    model = XGBClassifier(
        n_estimators=200,
        max_depth=6,
        learning_rate=0.1,
        subsample=0.8,
        colsample_bytree=0.8,
        objective="multi:softprob",
        num_class=len(FAULT_LABELS),
        eval_metric="mlogloss",
        random_state=RANDOM_STATE,
        n_jobs=-1,
        verbosity=1,
    )

    model.fit(X_train, y_train)
    return model


def evaluate_model(model, X_test, y_test, feature_names):
    """Print classification report, confusion matrix, and feature importance."""
    y_pred = model.predict(X_test)
    accuracy = np.mean(y_pred == y_test)

    print(f"Test Accuracy: {accuracy:.4f}\n")
    print("Classification Report:")
    print(classification_report(y_test, y_pred, target_names=FAULT_LABELS))
    print("Confusion Matrix:")
    print(confusion_matrix(y_test, y_pred))

    # Feature importance (top features)
    importances = model.feature_importances_
    sorted_idx = np.argsort(importances)[::-1]
    print("\nFeature Importance (top 10):")
    for i in range(min(10, len(feature_names))):
        idx = sorted_idx[i]
        print(f"  {feature_names[idx]:40s}  {importances[idx]:.4f}")

    return accuracy


def main():
    os.makedirs(OUTPUT_DIR, exist_ok=True)

    # -----------------------------------------------------------------------
    # 1. Load data
    # -----------------------------------------------------------------------
    X, y, feature_names = load_and_prepare_data()

    # -----------------------------------------------------------------------
    # 2. Split
    # -----------------------------------------------------------------------
    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=TEST_SIZE, random_state=RANDOM_STATE, stratify=y,
    )
    print(f"Train: {len(X_train)}  |  Test: {len(X_test)}\n")

    # -----------------------------------------------------------------------
    # 3. Train
    # -----------------------------------------------------------------------
    print("Training XGBoost fault classifier ...")
    model = train_model(X_train, y_train)

    # -----------------------------------------------------------------------
    # 4. Evaluate
    # -----------------------------------------------------------------------
    accuracy = evaluate_model(model, X_test, y_test, feature_names)

    # -----------------------------------------------------------------------
    # 5. Save model + metadata
    # -----------------------------------------------------------------------
    artifact = {
        "model": model,
        "feature_names": feature_names,
        "fault_labels": FAULT_LABELS,
    }
    joblib.dump(artifact, MODEL_PATH)
    print(f"\nModel saved -> {MODEL_PATH}")
    print(f"Accuracy: {accuracy:.4f}")
    print("Done.")


if __name__ == "__main__":
    main()
