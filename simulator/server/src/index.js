import express from "express";
import cors from "cors";
import { DEFAULT_INSTANCE_ID, MQTT_ENABLED, MQTT_TOPIC, PORT, TICK_SECONDS } from "./config.js";
import {
  initDefaultInstance,
  tickAllInstances,
} from "./services/instanceManager.js";
import { initMqtt, publishSensorSample } from "./services/mqttService.js";
import instancesRouter from "./routes/instances.js";
import defaultInstanceRouter from "./routes/defaultInstance.js";

const app = express();
app.use(cors());
app.use(express.json());

initDefaultInstance();
initMqtt();
setInterval(() => tickAllInstances(publishSensorSample), TICK_SECONDS * 1000);

app.use("/api/instances", instancesRouter);
app.use("/api", defaultInstanceRouter);

app.listen(PORT, () => {
  console.log(`Simulator API running on http://localhost:${PORT}`);
  if (MQTT_ENABLED) {
    console.log(`Publishing default sensor samples to MQTT topic: ${MQTT_TOPIC}`);
  }
  console.log(`Default instance id: ${DEFAULT_INSTANCE_ID}`);
});
