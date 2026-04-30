"""
influxdb_client.py
==================
InfluxDB 2.x query service for retrieving historical sensor readings.

Connects to the InfluxDB instance in the Docker stack and queries
bulb sensor data over a specified time window.  Results are returned
as lists of reading dicts compatible with the feature_engine and
predictor modules.

Usage
-----
    from app.influxdb_client import InfluxDBService

    service = InfluxDBService(url, token, org, bucket)
    readings = service.get_readings("lum_0001", lookback_hours=336)
"""

import logging
from datetime import datetime, timezone

logger = logging.getLogger(__name__)

try:
    from influxdb_client import InfluxDBClient
    INFLUX_AVAILABLE = True
except ImportError:
    INFLUX_AVAILABLE = False
    logger.warning("influxdb-client not installed. InfluxDB queries disabled.")


class InfluxDBService:
    """
    Service for querying sensor readings from InfluxDB 2.x.
    """

    def __init__(self, url: str, token: str, org: str, bucket: str):
        """
        Initialise the InfluxDB connection.

        Parameters
        ----------
        url : str
            InfluxDB URL (e.g. "http://influxdb:8086").
        token : str
            Authentication token.
        org : str
            InfluxDB organisation name.
        bucket : str
            Bucket containing sensor data.
        """
        self.url = url
        self.token = token
        self.org = org
        self.bucket = bucket
        self.client = None
        self.connected = False

        if INFLUX_AVAILABLE:
            try:
                self.client = InfluxDBClient(
                    url=url, token=token, org=org,
                )
                # Test connection
                health = self.client.health()
                self.connected = health.status == "pass"
                logger.info(
                    "InfluxDB connection: %s (%s)",
                    "OK" if self.connected else "FAILED", url,
                )
            except Exception as e:
                logger.error("InfluxDB connection error: %s", e)

    def is_connected(self) -> bool:
        """Check if InfluxDB is reachable."""
        return self.connected

    def get_readings(
        self,
        bulb_id: str,
        lookback_hours: int = 336,
    ) -> list[dict]:
        """
        Query sensor readings for a specific bulb over a time window.

        Parameters
        ----------
        bulb_id : str
            The bulb/luminaire identifier (e.g. "lum_0001").
        lookback_hours : int
            Number of hours of history to retrieve (default: 336 = 14 days).

        Returns
        -------
        list[dict]
            Chronologically-ordered list of sensor reading dicts.
            Returns empty list if query fails or no data found.
        """
        if not self.connected or not self.client:
            logger.warning("InfluxDB not connected. Returning empty readings.")
            return []

        # Flux query to retrieve sensor data for the specified bulb
        # The measurement name and field names depend on how Node-RED
        # writes data to InfluxDB — adjust if your flow uses different names
        query = f'''
        from(bucket: "{self.bucket}")
            |> range(start: -{lookback_hours}h)
            |> filter(fn: (r) => r["_measurement"] == "sensor_data")
            |> filter(fn: (r) => r["bulb_id"] == "{bulb_id}")
            |> pivot(rowKey: ["_time"], columnKey: ["_field"], valueColumn: "_value")
            |> sort(columns: ["_time"])
        '''

        try:
            query_api = self.client.query_api()
            tables = query_api.query(query, org=self.org)

            readings = []
            for table in tables:
                for record in table.records:
                    reading = {
                        "timestamp": record.get_time().isoformat(),
                        "ldr": int(record.values.get("ldr", 0)),
                        "temperature": float(record.values.get("temperature", 25.0)),
                        "current": float(record.values.get("current", 320.0)),
                        "voltage": float(record.values.get("voltage", 230.0)),
                        "humidity": float(record.values.get("humidity", 45.0)),
                        "power_consumption": float(
                            record.values.get("power_consumption", 60.0)
                        ),
                        "ripple_percent": float(
                            record.values.get("ripple_percent", 1.6)
                        ),
                        "rgb": {
                            "r": int(record.values.get("rgb_r", 255)),
                            "g": int(record.values.get("rgb_g", 240)),
                            "b": int(record.values.get("rgb_b", 225)),
                        },
                    }
                    readings.append(reading)

            logger.info(
                "Retrieved %d readings for bulb %s (last %dh)",
                len(readings), bulb_id, lookback_hours,
            )
            return readings

        except Exception as e:
            logger.error(
                "InfluxDB query error for bulb %s: %s", bulb_id, e,
            )
            return []

    def close(self):
        """Close the InfluxDB client connection."""
        if self.client:
            self.client.close()
            logger.info("InfluxDB connection closed.")
