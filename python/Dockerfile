# Dockerfile
# ==========
# Docker image for the Edge AI Python service.
#
# This container runs the XGBoost-based failure predictor, fault
# classifier, anomaly detector, and alert engine.  It connects to
# the Mosquitto MQTT broker and InfluxDB in the Docker network.
#
# Build context: python/ directory
# Exposes: port 5000 (FastAPI)
#
# Usage:
#   Built automatically by docker-compose.yml
#   Or manually: docker build -t python-edge .

FROM python:3.11-slim

# Set working directory
WORKDIR /app

# Install dependencies first (cached layer)
COPY requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code and pre-trained models
COPY . /app

# Expose FastAPI port
EXPOSE 5000

# Health check — verify the API is responding
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:5000/api/health')" || exit 1

# Start the Edge AI service
CMD ["python", "edge_ai.py"]
