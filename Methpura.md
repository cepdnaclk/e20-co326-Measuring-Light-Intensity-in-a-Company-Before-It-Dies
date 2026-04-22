# Fresh Start Run Guide (Windows)

This is a full runbook for starting the LED simulator + MQTT + Node-RED stack from a clean restart.

Use this guide when:
- you restart your laptop
- Docker was stopped
- simulator is not sending data to Node-RED

## 1. Open project folder

In PowerShell:

	cd D:\Semester7\CO326 - Industrial Networks\miniProject\e20-co326-Measuring-Light-Intensity-in-a-Company-Before-It-Dies

## 2. Start Docker services

Start infrastructure first (mosquitto, node-red, influxdb, grafana):

	cd docker
	docker compose up -d
	docker compose ps

You should see these running:
- mosquitto
- node-red
- influxdb
- grafana

Node-RED URL: http://localhost:1880

## 3. Install simulator dependencies (first time or after clean clone)

In a new PowerShell terminal:

	cd D:\Semester7\CO326 - Industrial Networks\miniProject\e20-co326-Measuring-Light-Intensity-in-a-Company-Before-It-Dies\simulator
	npm run install:all

## 4. Start simulator backend (IMPORTANT MQTT settings)

Because Windows may also run a local Mosquitto service, do not use localhost blindly.

Use host LAN IP so backend publishes to the Docker broker path used by Node-RED.

In PowerShell:

	cd D:\Semester7\CO326 - Industrial Networks\miniProject\e20-co326-Measuring-Light-Intensity-in-a-Company-Before-It-Dies\simulator
	$env:MQTT_ENABLED="true"
	$env:MQTT_URL="mqtt://192.168.1.2:1883"
	$env:MQTT_TOPIC="led/simulator/sensors"
	$env:MQTT_CLIENT_ID="led-sim-debug"
	npm run dev --prefix server

Expected backend logs:
- Simulator API running on http://localhost:4000
- Publishing sensor samples to MQTT topic: led/simulator/sensors
- Connected to MQTT broker: mqtt://192.168.1.2:1883

Keep this terminal open.

## 5. Start simulator frontend

In another terminal:

	cd D:\Semester7\CO326 - Industrial Networks\miniProject\e20-co326-Measuring-Light-Intensity-in-a-Company-Before-It-Dies\simulator
	npm run dev --prefix client

Open:
- http://localhost:5173

Then click Run in the UI so simulation starts emitting samples.

## 6. Verify packets at MQTT broker (without installing mosquitto_sub on host)

Use mosquitto_sub from inside the Docker mosquitto container:

	cd D:\Semester7\CO326 - Industrial Networks\miniProject\e20-co326-Measuring-Light-Intensity-in-a-Company-Before-It-Dies\docker
	docker compose exec mosquitto mosquitto_sub -h localhost -p 1883 -t led/simulator/sensors -v

If you only want 3 packets and auto-exit:

	docker compose exec mosquitto mosquitto_sub -h localhost -p 1883 -t led/simulator/sensors -C 3 -v

You should see JSON payloads on topic led/simulator/sensors.

## 7. Verify Node-RED flow

Open Node-RED (http://localhost:1880):
1. Open node named Simulator In
2. Confirm topic is led/simulator/sensors
3. Confirm broker host is mosquitto, port 1883
4. Confirm debug node simulated debug is enabled
5. Click Deploy
6. Check Debug sidebar for incoming payloads

## 8. Quick health checks

Check simulator state:

	Invoke-RestMethod -Uri "http://localhost:4000/api/state" -Method Get | ConvertTo-Json -Depth 5

Set simulation running from terminal:

	Invoke-RestMethod -Uri "http://localhost:4000/api/control" -Method Post -ContentType "application/json" -Body '{"playing":true}'

Check Docker service logs:

	cd D:\Semester7\CO326 - Industrial Networks\miniProject\e20-co326-Measuring-Light-Intensity-in-a-Company-Before-It-Dies\docker
	docker compose logs -f mosquitto
	docker compose logs -f node-red

## 9. Common failure and fix

Symptom:
- backend says connected
- Node-RED receives nothing
- packet subscriber from Docker shows nothing

Most likely cause:
- backend connected to a different broker (Windows Mosquitto service), not Docker mosquitto

Check listeners on 1883:

	Get-NetTCPConnection -LocalPort 1883 -State Listen | Select-Object LocalAddress,LocalPort,OwningProcess
	Get-Process -Id (Get-NetTCPConnection -LocalPort 1883 -State Listen).OwningProcess | Select-Object Id,ProcessName

If Windows mosquitto service is running and causing confusion, either:
- keep using MQTT_URL with host IP (recommended in this guide), or
- stop local service:

	Stop-Service mosquitto
	Set-Service mosquitto -StartupType Manual

After this, localhost:1883 usually maps only to Docker broker.

## 10. Shutdown

Stop simulator terminals with Ctrl+C.

Stop Docker stack:

	cd D:\Semester7\CO326 - Industrial Networks\miniProject\e20-co326-Measuring-Light-Intensity-in-a-Company-Before-It-Dies\docker
	docker compose down

If you want to wipe InfluxDB data too:

	docker compose down -v

---

## One-screen quick start

Terminal 1:

	cd D:\Semester7\CO326 - Industrial Networks\miniProject\e20-co326-Measuring-Light-Intensity-in-a-Company-Before-It-Dies\docker
	docker compose up -d

Terminal 2:

	cd D:\Semester7\CO326 - Industrial Networks\miniProject\e20-co326-Measuring-Light-Intensity-in-a-Company-Before-It-Dies\simulator
	$env:MQTT_ENABLED="true"
	$env:MQTT_URL="mqtt://192.168.1.2:1883"
	$env:MQTT_TOPIC="led/simulator/sensors"
	npm run dev --prefix server

Terminal 3:

	cd D:\Semester7\CO326 - Industrial Networks\miniProject\e20-co326-Measuring-Light-Intensity-in-a-Company-Before-It-Dies\simulator
	npm run dev --prefix client

Terminal 4 (optional packet trace):

	cd D:\Semester7\CO326 - Industrial Networks\miniProject\e20-co326-Measuring-Light-Intensity-in-a-Company-Before-It-Dies\docker
	docker compose exec mosquitto mosquitto_sub -h localhost -p 1883 -t led/simulator/sensors -v
