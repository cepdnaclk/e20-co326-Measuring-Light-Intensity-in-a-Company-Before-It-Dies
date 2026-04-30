"""
alert_engine.py
===============
Alert generation and publishing module.

Combines outputs from the failure predictor and anomaly detector to
produce severity-classified alerts.  Alerts are published to MQTT
and can also be sent via Grafana (now), email, or push notifications
(future).

Severity levels
---------------
    INFO     – P(14d) 30–50%            → Log only
    MEDIUM   – P(14d) 50–70%            → Grafana warning panel
    HIGH     – P(14d) > 70% or P(7d) > 50%  → Grafana alert
    CRITICAL – Sudden failure or P(3d) > 70%  → Immediate alert

Usage
-----
    from app.alert_engine import AlertEngine

    engine = AlertEngine(mqtt_client, config.ALERT_THRESHOLDS)
    alerts = engine.evaluate(bulb_id, prediction, anomaly_result)
"""

import json
import logging
from datetime import datetime, timezone

logger = logging.getLogger(__name__)


class AlertEngine:
    """
    Evaluates prediction and anomaly detection results to generate
    severity-classified alerts.
    """

    def __init__(self, mqtt_publish_fn=None, alert_topic: str = ""):
        """
        Parameters
        ----------
        mqtt_publish_fn : callable, optional
            Function to publish MQTT messages: fn(topic, payload_str).
            If None, alerts are only returned (not published).
        alert_topic : str
            MQTT topic to publish alerts to.
        """
        self.mqtt_publish = mqtt_publish_fn
        self.alert_topic = alert_topic

    def evaluate(
        self,
        bulb_id: str,
        prediction: dict,
        anomaly: dict,
    ) -> list[dict]:
        """
        Evaluate predictions and generate alerts.

        Parameters
        ----------
        bulb_id : str
            Identifier of the bulb being evaluated.
        prediction : dict
            Output from FailurePredictor.predict() containing
            probability_3_days, probability_7_days, probability_14_days.
        anomaly : dict
            Output from AnomalyDetector.detect() containing
            'detected' flag.

        Returns
        -------
        list[dict]
            List of alert dicts (may be empty if no alert conditions met).
        """
        alerts = []
        now = datetime.now(timezone.utc).isoformat()

        p3 = prediction.get("probability_3_days", 0)
        p7 = prediction.get("probability_7_days", 0)
        p14 = prediction.get("probability_14_days", 0)
        sudden = anomaly.get("detected", False)

        # ----- CRITICAL: Sudden failure or P(3d) > 70% -----
        if sudden:
            alerts.append(self._make_alert(
                bulb_id, "SUDDEN_FAILURE", "CRITICAL",
                f"Sudden failure detected! {anomaly.get('reason', '')}",
                prediction, now,
            ))
        elif p3 >= 0.70:
            alerts.append(self._make_alert(
                bulb_id, "IMMINENT_FAILURE", "CRITICAL",
                f"{p3*100:.0f}% probability of failure within 3 days. "
                f"Replace bulb immediately.",
                prediction, now,
            ))

        # ----- HIGH: P(14d) > 70% or P(7d) > 50% -----
        elif p14 >= 0.70 or p7 >= 0.50:
            msg = f"{p14*100:.0f}% probability of failure within 14 days"
            if p7 >= 0.50:
                msg = f"{p7*100:.0f}% probability of failure within 7 days"
            alerts.append(self._make_alert(
                bulb_id, "PREDICTIVE_WARNING", "HIGH",
                f"{msg}. Schedule replacement soon.",
                prediction, now,
            ))

        # ----- MEDIUM: P(14d) 50–70% -----
        elif p14 >= 0.50:
            alerts.append(self._make_alert(
                bulb_id, "DEGRADATION_NOTICE", "MEDIUM",
                f"{p14*100:.0f}% probability of failure within 14 days. "
                f"Consider scheduling replacement.",
                prediction, now,
            ))

        # ----- INFO: P(14d) 30–50% -----
        elif p14 >= 0.30:
            alerts.append(self._make_alert(
                bulb_id, "EARLY_WARNING", "INFO",
                f"{p14*100:.0f}% probability of failure within 14 days. "
                f"Monitor closely.",
                prediction, now,
            ))

        # Publish alerts to MQTT
        for alert in alerts:
            self._publish(alert)

        return alerts

    def _make_alert(
        self,
        bulb_id: str,
        alert_type: str,
        severity: str,
        message: str,
        prediction: dict,
        timestamp: str,
    ) -> dict:
        """Create a standardised alert payload."""
        return {
            "bulb_id": bulb_id,
            "alert_type": alert_type,
            "severity": severity,
            "message": message,
            "probability_3d": prediction.get("probability_3_days", 0),
            "probability_7d": prediction.get("probability_7_days", 0),
            "probability_14d": prediction.get("probability_14_days", 0),
            "estimated_remaining_days": prediction.get(
                "estimated_remaining_days", -1
            ),
            "recommended_action": self._get_action(severity),
            "timestamp": timestamp,
        }

    @staticmethod
    def _get_action(severity: str) -> str:
        """Return a recommended action string based on severity."""
        actions = {
            "CRITICAL": "Replace bulb immediately",
            "HIGH": "Schedule replacement within 5 days",
            "MEDIUM": "Schedule replacement within 14 days",
            "INFO": "Continue monitoring, no immediate action",
        }
        return actions.get(severity, "No action required")

    def _publish(self, alert: dict):
        """Publish alert to MQTT if a publish function is configured."""
        if self.mqtt_publish and self.alert_topic:
            try:
                payload = json.dumps(alert)
                self.mqtt_publish(self.alert_topic, payload)
                logger.info(
                    "Alert published [%s]: %s — %s",
                    alert["severity"], alert["bulb_id"], alert["message"],
                )
            except Exception as e:
                logger.error("Failed to publish alert: %s", e)
        else:
            logger.info(
                "Alert (not published) [%s]: %s — %s",
                alert["severity"], alert["bulb_id"], alert["message"],
            )

    # --- Future: email and push notification stubs ---

    def send_email(self, alert: dict, recipient: str):
        """
        Send alert via email (future implementation).

        TODO: Integrate with SMTP or email service API.
        """
        logger.info("Email alert stub: would send to %s", recipient)

    def send_push(self, alert: dict, device_token: str):
        """
        Send push notification (future implementation).

        TODO: Integrate with Firebase Cloud Messaging or similar.
        """
        logger.info("Push alert stub: would send to device %s", device_token)
