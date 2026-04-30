"""
train_failure_predictor.py
==========================
Trains XGBoost classifiers that predict whether a bulb will fail
within 3, 7, or 14 days, using engineered features from historical
hourly sensor readings.

This model runs server-side in the Python Docker container.  It
produces calibrated probability outputs so the alert engine can
report "X% chance of failure within 14 days".

Pipeline
--------
    1. Load synthetic degradation data.
    2. Engineer features (rolling means, slopes, etc.) — same logic
       as python/app/feature_engine.py.
    3. Train three XGBoost binary classifiers (3d, 7d, 14d).
    4. Calibrate probabilities using CalibratedClassifierCV.
    5. Save all three models in a single joblib artifact.

Output
------
    python/models/failure_predictor.joblib

Usage
-----
    python train_failure_predictor.py
"""

import os
import joblib
import numpy as np
import pandas as pd
from sklearn.model_selection import train_test_split
from sklearn.calibration import CalibratedClassifierCV
from sklearn.metrics import (
    classification_report,
    roc_auc_score,
    confusion_matrix,
)
from xgboost import XGBClassifier

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_CSV = os.path.join(SCRIPT_DIR, "data", "synthetic_degradation_data.csv")
OUTPUT_DIR = os.path.normpath(os.path.join(SCRIPT_DIR, "..", "..", "python", "models"))
MODEL_PATH = os.path.join(OUTPUT_DIR, "failure_predictor.joblib")

RANDOM_STATE = 42
TEST_SIZE = 0.2

# The three prediction windows we train for
WINDOWS = {
    "3d": "will_fail_3d",
    "7d": "will_fail_7d",
    "14d": "will_fail_14d",
}


def engineer_features(df: pd.DataFrame) -> pd.DataFrame:
    """
    Engineer features from raw hourly readings.

    This mirrors the logic in python/app/feature_engine.py so that
    training and inference use identical features.

    Features are computed per-bulb, sorted by operating_hours.
    """
    # Sort by bulb and time
    df = df.sort_values(["bulb_id", "operating_hours"]).reset_index(drop=True)

    features = []
    for bulb_id, group in df.groupby("bulb_id"):
        g = group.copy()

        # Rolling statistics on LDR
        g["mean_ldr_24"] = g["ldr"].rolling(24, min_periods=1).mean()
        g["mean_ldr_168"] = g["ldr"].rolling(168, min_periods=1).mean()
        g["std_ldr_24"] = g["ldr"].rolling(24, min_periods=1).std().fillna(0)

        # Slope: linear regression coefficient over last 168 readings
        # Simplified as (last - first) / window_size for efficiency
        g["slope_ldr_168"] = (
            g["ldr"].rolling(168, min_periods=2).apply(
                lambda x: (x.iloc[-1] - x.iloc[0]) / len(x) if len(x) > 1 else 0,
                raw=False,
            )
        ).fillna(0)

        # Max drop in 24 hours
        g["max_drop_24"] = (
            g["ldr"].rolling(24, min_periods=2).apply(
                lambda x: max(0, x.max() - x.iloc[-1]),
                raw=False,
            )
        ).fillna(0)

        # LDR ratio: recent 24h mean vs 168h mean (degradation indicator)
        g["ldr_ratio"] = (
            g["mean_ldr_24"] / g["mean_ldr_168"].replace(0, 1)
        )

        features.append(g)

    return pd.concat(features, ignore_index=True)


def prepare_feature_matrix(df: pd.DataFrame):
    """
    Select the feature columns used for training.

    Returns X (numpy array), feature_names (list), and df with labels.
    """
    feature_cols = [
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

    X = df[feature_cols].values.astype(np.float32)
    return X, feature_cols


def train_and_calibrate(X_train, y_train, X_test, y_test, window_name):
    """
    Train an XGBoost classifier for a single prediction window
    and calibrate its probability output.

    Returns the calibrated model.
    """
    print(f"\n--- Training {window_name} failure predictor ---")

    # Handle class imbalance with scale_pos_weight
    pos = np.sum(y_train == 1)
    neg = np.sum(y_train == 0)
    scale = neg / max(pos, 1)

    base_model = XGBClassifier(
        n_estimators=150,
        max_depth=5,
        learning_rate=0.1,
        subsample=0.8,
        colsample_bytree=0.8,
        scale_pos_weight=scale,
        objective="binary:logistic",
        eval_metric="logloss",
        random_state=RANDOM_STATE,
        n_jobs=-1,
        verbosity=0,
    )

    # Calibrate probabilities using isotonic regression
    calibrated = CalibratedClassifierCV(
        base_model, cv=3, method="isotonic",
    )
    calibrated.fit(X_train, y_train)

    # Evaluate
    y_pred = calibrated.predict(X_test)
    y_prob = calibrated.predict_proba(X_test)[:, 1]

    accuracy = np.mean(y_pred == y_test)
    try:
        auc = roc_auc_score(y_test, y_prob)
    except ValueError:
        auc = 0.0  # Edge case: only one class in test set

    print(f"  Accuracy: {accuracy:.4f}  |  AUC-ROC: {auc:.4f}")
    print(f"  Positive: {pos} ({100*pos/(pos+neg):.1f}%)  "
          f"Negative: {neg} ({100*neg/(pos+neg):.1f}%)")
    print(classification_report(y_test, y_pred,
                                target_names=["Survive", "Fail"]))

    return calibrated, auc


def main():
    os.makedirs(OUTPUT_DIR, exist_ok=True)

    # -----------------------------------------------------------------------
    # 1. Load data
    # -----------------------------------------------------------------------
    print("Loading synthetic degradation data ...")
    df = pd.read_csv(DATA_CSV)
    print(f"  {len(df)} rows loaded.")

    # -----------------------------------------------------------------------
    # 2. Feature engineering
    # -----------------------------------------------------------------------
    print("Engineering features ...")
    df = engineer_features(df)

    # -----------------------------------------------------------------------
    # 3. Prepare feature matrix
    # -----------------------------------------------------------------------
    X, feature_names = prepare_feature_matrix(df)
    print(f"  Feature matrix: {X.shape}")

    # -----------------------------------------------------------------------
    # 4. Train models for each prediction window
    # -----------------------------------------------------------------------
    models = {}
    for window_name, label_col in WINDOWS.items():
        y = df[label_col].values

        X_train, X_test, y_train, y_test = train_test_split(
            X, y, test_size=TEST_SIZE,
            random_state=RANDOM_STATE, stratify=y,
        )

        model, auc = train_and_calibrate(
            X_train, y_train, X_test, y_test, window_name,
        )
        models[window_name] = {"model": model, "auc": auc}

    # -----------------------------------------------------------------------
    # 5. Save all models
    # -----------------------------------------------------------------------
    artifact = {
        "models": models,
        "feature_names": feature_names,
        "windows": list(WINDOWS.keys()),
    }
    joblib.dump(artifact, MODEL_PATH)
    print(f"\nAll models saved -> {MODEL_PATH}")
    for name, info in models.items():
        print(f"  {name}: AUC-ROC = {info['auc']:.4f}")
    print("Done.")


if __name__ == "__main__":
    main()
