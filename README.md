# Digital Twin LED Luminaire Monitor

This project uses Docker Compose to run the monitoring stack:

- InfluxDB (time-series database)
- Grafana (dashboard/visualization)
- Node-RED (flow-based processing)

## Prerequisites

- Docker Desktop installed and running
- Docker Compose plugin available (`docker compose`)
- On Linux, you may need either:
  - run Docker commands with `sudo`, or
  - add your user to the `docker` group so `docker compose` can access `/var/run/docker.sock`

## How to Run the Containers

### Production mode

1. Open a terminal in the project root.
2. Move to the `docker` folder:

   ```bash
   cd docker
   ```

3. Start all containers in detached mode:

   ```bash
   docker compose up -d --build
   ```

4. Verify running containers:

   ```bash
   docker compose ps
   ```

5. The production simulator UI is served on `http://localhost:5173`.

### Development mode

1. Open a terminal in the project root.
2. Move to the `docker` folder:

   ```bash
   cd docker
   ```

3. Start the stack with the development override:

   ```bash
   docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build
   ```

4. Verify running containers:

   ```bash
   docker compose -f docker-compose.yml -f docker-compose.dev.yml ps
   ```

5. The simulator UI dev server runs on `http://localhost:5174/`.

6. Edit simulator UI or server files in `simulator/client` or `simulator/server`; the dev services mount the source code and will reflect changes without rebuilding the container.

### Promote confirmed changes to production

After you verify your changes in development mode, rebuild and restart the production stack so the production containers use the updated source files:

```bash
cd docker
docker compose -f docker-compose.yml build simulator-client simulator-server
docker compose -f docker-compose.yml up -d
```

Or run the full production rebuild:

```bash
cd docker
docker compose up -d --build
```

The production UI will then serve the updated app from `http://localhost:5173`.

## Service URLs

- Grafana: http://localhost:3000
  - Username: `admin`
  - Password: `admin`
- Node-RED: http://localhost:1880
- InfluxDB: http://localhost:8086
  - Username: `root`
  - Password: `rootpassword`
  - Organization: `light_org`
  - Bucket: `light_data`
- Simulator server API: http://localhost:4000
- Simulator UI (production): http://localhost:5173
- Simulator UI (development): http://localhost:5174

## Useful Commands

- View logs:

  ```powershell
  docker compose logs -f
  ```

- Stop containers:

  ```powershell
  docker compose down
  ```

- Stop and remove volumes (this deletes InfluxDB data):

  ```powershell
  docker compose down -v
  ```

## Notes

- If a container does not start, check logs with `docker compose logs <service-name>`.
- If ports `3000`, `1880`, or `8086` are already in use, stop the conflicting process or change the port mappings in `docker/docker-compose.yml`.
- InfluxDB is configured as 2.x with initial setup enabled. Admin token is `root-token`.
