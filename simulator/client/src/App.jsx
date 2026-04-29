import { useEffect, useRef, useState } from "react";
import LineChart from "./components/charts/LineChart";
import BarChart from "./components/charts/BarChart";
import DialGauge from "./components/widgets/DialGauge";
import LedBulb from "./components/widgets/LedBulb";
import { buildSiteMaps } from "./utils/instanceMap";

const API_URL = "http://localhost:4000";

const postJson = async (path, payload) => {
  const res = await fetch(`${API_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return res.json();
};

const normalizePathInput = (value) =>
  String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");

export default function App() {
  const [sim, setSim] = useState(null);
  const [instances, setInstances] = useState([]);
  const [selectedInstanceId, setSelectedInstanceId] = useState("lum_0001");
  const [defaultInstanceId, setDefaultInstanceId] = useState("lum_0001");
  const [fleetForm, setFleetForm] = useState({
    count: 3,
    site: "siteA",
    floor: "floor1",
    line: "line1",
    cell: "cell1",
  });
  const [now, setNow] = useState(new Date());
  const [theme, setTheme] = useState(() => localStorage.getItem("sim-theme") || "dark");
  const [control, setControl] = useState({
    speed: 1,
    ambientTemp: 25,
    humidity: 50,
    driveCurrent: 350,
    adcBits: 10,
  });
  const [rulModel, setRulModel] = useState({
    baseLifeHours: 12000,
    hoursPenalty: 0.55,
    ripplePenalty: 85,
    tempPenalty: 22,
    currentPenalty: 12,
    anomalyPenalty: 2200,
    minRul: 0,
  });
  const [initialValues, setInitialValues] = useState({
    ambientTemp: 25,
    humidity: 45,
    driveCurrent: 320,
    speed: 1,
    adcBits: 12,
  });
  const [inject, setInject] = useState({
    rgbEnabled: false,
    r: 600,
    g: 400,
    b: 250,
    ldrEnabled: false,
    ldr: 1000,
    rippleEnabled: false,
    ripple: 25,
  });
  const [sidebarWidth, setSidebarWidth] = useState(() => Number(localStorage.getItem("sim-sidebar-width")) || 320);
  const [isResizingSidebar, setIsResizingSidebar] = useState(false);
  const resizeStartX = useRef(0);
  const resizeStartWidth = useRef(sidebarWidth);

  const endpointFor = (suffix) => `/api/instances/${selectedInstanceId}${suffix}`;

  const refreshInstances = async () => {
    const res = await fetch(`${API_URL}/api/instances`, { cache: "no-store" });
    const data = await res.json();
    const list = data.instances ?? [];
    setInstances(list);
    setDefaultInstanceId(data.defaultInstanceId || "lum_0001");
    if (!list.find((item) => item.id === selectedInstanceId) && list.length) {
      setSelectedInstanceId(list[0].id);
    }
    return list;
  };

  const refreshState = async (instanceId = selectedInstanceId) => {
    const res = await fetch(`${API_URL}/api/instances/${instanceId}/state`, { cache: "no-store" });
    if (!res.ok) return;
    const data = await res.json();
    setSim(data);
    setControl({
      speed: data.speed,
      ambientTemp: data.ambientTemp,
      humidity: data.humidity,
      driveCurrent: data.driveCurrent,
      adcBits: data.adc?.bits ?? 10,
    });
    setRulModel(data.rulModel ?? rulModel);
    setInitialValues(data.initialValues ?? initialValues);
  };

  useEffect(() => {
    const tick = async () => {
      await refreshInstances();
      await refreshState(selectedInstanceId);
    };
    tick();
    const id = setInterval(tick, 500);
    const clockId = setInterval(() => setNow(new Date()), 1000);
    return () => {
      clearInterval(id);
      clearInterval(clockId);
    };
  }, [selectedInstanceId]);

  useEffect(() => {
    const root = document.documentElement;
    if (theme === "light") {
      root.classList.add("theme-light");
    } else {
      root.classList.remove("theme-light");
    }
    localStorage.setItem("sim-theme", theme);
  }, [theme]);

  useEffect(() => {
    localStorage.setItem("sim-sidebar-width", String(sidebarWidth));
  }, [sidebarWidth]);

  useEffect(() => {
    if (!isResizingSidebar) return undefined;
    const onMove = (event) => {
      const delta = event.clientX - resizeStartX.current;
      const maxWidth = Math.min(window.innerWidth * 0.55, 560);
      setSidebarWidth(Math.min(maxWidth, Math.max(260, resizeStartWidth.current + delta)));
    };
    const onUp = () => setIsResizingSidebar(false);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [isResizingSidebar]);

  if (!sim) return <div className="loading">Loading simulator...</div>;

  const applyControl = (next) => {
    setControl(next);
    postJson(endpointFor("/control"), next).then(() => refreshState(selectedInstanceId));
  };

  const applyAnomalies = (next) => {
    setInject(next);
    postJson(endpointFor("/anomalies"), {
      rgb: { enabled: next.rgbEnabled, r: Number(next.r), g: Number(next.g), b: Number(next.b) },
      ldr: { enabled: next.ldrEnabled, value: Number(next.ldr) },
      ripple: { enabled: next.rippleEnabled, value: Number(next.ripple) },
    }).then(() => refreshState(selectedInstanceId));
  };

  const cTrace = sim.history.map((h) => h.rgb.C);
  const rippleTrace = sim.history.map((h) => h.ripplePercent);
  const ldrTrace = sim.history.map((h) => h.ldr);
  const anomalyVal = Number(
    (Number(inject.rgbEnabled) * 0.35 + Number(inject.ldrEnabled) * 0.3 + Number(inject.rippleEnabled) * 0.35).toFixed(2)
  );
  const ldrMax = sim.adc?.max ?? 1023;
  const junctionTemp = sim.ambientTemp + (sim.driveCurrent / 1000) * 3 * 15;
  const displayR = Math.min(255, Math.round((sim.sensors.rgb.R / 1023) * 255));
  const displayG = Math.min(255, Math.round((sim.sensors.rgb.G / 1023) * 255));
  const displayB = Math.min(255, Math.round((sim.sensors.rgb.B / 1023) * 255));
  const rgbIntensity = Math.min(
    1,
    Math.max(0.1, (sim.sensors.rgb.R + sim.sensors.rgb.G + sim.sensors.rgb.B) / (1023 * 3))
  );
  const siteMaps = buildSiteMaps(instances);

  const saveRulModel = async () => {
    await postJson(endpointFor("/rul-model"), {
      baseLifeHours: Number(rulModel.baseLifeHours),
      hoursPenalty: Number(rulModel.hoursPenalty),
      ripplePenalty: Number(rulModel.ripplePenalty),
      tempPenalty: Number(rulModel.tempPenalty),
      currentPenalty: Number(rulModel.currentPenalty),
      anomalyPenalty: Number(rulModel.anomalyPenalty),
      minRul: Number(rulModel.minRul),
    });
    await refreshState(selectedInstanceId);
  };

  const applyInitialProfile = async () => {
    await postJson(endpointFor("/initial-values"), {
      ambientTemp: Number(initialValues.ambientTemp),
      humidity: Number(initialValues.humidity),
      driveCurrent: Number(initialValues.driveCurrent),
      speed: Number(initialValues.speed),
      adcBits: Number(initialValues.adcBits),
      applyNow: true,
    });
    await refreshState(selectedInstanceId);
  };

  const togglePlay = async () => {
    await postJson(endpointFor("/control"), { playing: !sim.playing });
    await refreshState(selectedInstanceId);
  };

  const createFleet = async () => {
    const safeCount = Math.min(100, Math.max(1, Number(fleetForm.count) || 1));
    const safeSite = normalizePathInput(fleetForm.site) || "sitea";
    const safeFloor = normalizePathInput(fleetForm.floor) || "floor1";
    const safeLine = normalizePathInput(fleetForm.line) || "line1";
    const safeCell = normalizePathInput(fleetForm.cell) || "cell1";
    setFleetForm((prev) => ({
      ...prev,
      count: safeCount,
      site: safeSite,
      floor: safeFloor,
      line: safeLine,
      cell: safeCell,
    }));
    await postJson("/api/instances", {
      count: safeCount,
      defaults: {
        location: {
          site: safeSite,
          floor: safeFloor,
          line: safeLine,
          cell: safeCell,
        },
      },
    });
    const list = await refreshInstances();
    if (list.length) {
      const latestId = list[list.length - 1].id;
      setSelectedInstanceId(latestId);
      await refreshState(latestId);
    }
  };

  const runAll = async (playing) => {
    await postJson("/api/instances/bulk/control", { control: { playing } });
    await refreshInstances();
    await refreshState(selectedInstanceId);
  };

  const deleteInstance = async (id) => {
    await fetch(`${API_URL}/api/instances/${id}`, { method: "DELETE" });
    const list = await refreshInstances();
    const fallbackId = list.find((item) => item.id === selectedInstanceId)?.id || list[0]?.id;
    if (fallbackId) {
      setSelectedInstanceId(fallbackId);
      await refreshState(fallbackId);
    }
  };

  const deleteAllInstances = async () => {
    await postJson("/api/instances/delete-all", {});
    const list = await refreshInstances();
    const fallbackId = list[0]?.id;
    if (fallbackId) {
      setSelectedInstanceId(fallbackId);
      await refreshState(fallbackId);
    }
  };

  const toggleInstancePlay = async (instance) => {
    await postJson(`/api/instances/${instance.id}/control`, { playing: !instance.playing });
    await refreshInstances();
    if (instance.id === selectedInstanceId) {
      await refreshState(selectedInstanceId);
    }
  };

  const applyScenario = (name) => {
    const map = {
      normal: { ambientTemp: 25, humidity: 50, driveCurrent: 350 },
      capfail: { ambientTemp: 40, humidity: 65, driveCurrent: 360, rippleEnabled: true, ripple: 15 },
      phosphor: { ambientTemp: 55, humidity: 40, driveCurrent: 400, rgbEnabled: true, r: 900, g: 700, b: 500 },
      catastrophic: { ambientTemp: 75, humidity: 80, driveCurrent: 650, rippleEnabled: true, rgbEnabled: true, ldrEnabled: true },
      stress: { ambientTemp: 90, humidity: 90, driveCurrent: 680, rippleEnabled: true, ripple: 30 },
    };
    const selected = map[name];
    if (!selected) return;
    const nextControl = {
      speed: control.speed,
      ambientTemp: selected.ambientTemp,
      humidity: selected.humidity,
      driveCurrent: selected.driveCurrent,
    };
    applyControl(nextControl);
    const nextInject = {
      ...inject,
      rgbEnabled: !!selected.rgbEnabled,
      ldrEnabled: !!selected.ldrEnabled,
      rippleEnabled: !!selected.rippleEnabled,
      r: selected.r ?? inject.r,
      g: selected.g ?? inject.g,
      b: selected.b ?? inject.b,
      ldr: selected.ldr ?? inject.ldr,
      ripple: selected.ripple ?? inject.ripple,
    };
    applyAnomalies(nextInject);
  };

  return (
    <div className="page bg-bg text-gray">
      <header className="topbar card-header topbar-modern">
        <div className="brand brand-rich brand-logo-wrap">
          <div className="brand-wordmark">
            <div className="wordmark-title">
              <span className="lum">Lum</span>
              <span className="edge">Edge</span>
            </div>
            <div className="wordmark-sub">Predictive Maintenance for LED Systems</div>
          </div>
        </div>
        <div className="top-actions">
          <div className="status-cluster">
            <span className="status-pill neutral">{instances.length} instances</span>
            <span className="status-pill neutral">{selectedInstanceId}</span>
            <span className={`status-pill ${sim.playing ? "ok" : "warn"}`}>
              {sim.playing ? "RUNNING" : "PAUSED"}
            </span>
            <span className="status-pill neutral">{Math.round(sim.timeHours)} h</span>
            <span className="status-pill neutral">{now.toLocaleTimeString()}</span>
          </div>
          <div className="top-control-group">
          <button className="run-btn" onClick={togglePlay}>
            {sim.playing ? "Pause" : "Run"}
          </button>
          <select
            className="speed-select"
            value={control.speed}
            onChange={(e) => applyControl({ ...control, speed: Number(e.target.value) })}
          >
            <option value={0.5}>0.5x</option>
            <option value={1}>1x</option>
            <option value={3}>3x</option>
            <option value={6}>6x</option>
          </select>
          <select
            className="speed-select"
            value={selectedInstanceId}
            onChange={(e) => setSelectedInstanceId(e.target.value)}
          >
            {instances.map((item) => (
              <option key={item.id} value={item.id}>
                {item.id}
              </option>
            ))}
          </select>
          </div>
        </div>
        <button
          type="button"
          className="theme-toggle theme-corner"
          onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
          title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
          aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
        >
          <span className="theme-icon" aria-hidden="true">{theme === "dark" ? "☀" : "🌙"}</span>
        </button>
      </header>

      <div className="workspace" style={{ gridTemplateColumns: `${sidebarWidth}px 8px 1fr` }}>
        <aside className="sidebar">
          <section className="side-section">
            <h3>Parameters</h3>
            <div className="formula-note">Starts in healthy mode by default. Use Initial Setup to customize startup values.</div>
            <label>
              Operating Hours
              <div className="inline-value">{Math.round(sim.timeHours)}</div>
              <input type="range" className="slider-track" min="0" max="50000" value={Math.round(sim.timeHours)} readOnly />
            </label>
            <label>
              Drive Current ({control.driveCurrent} mA)
              <input
                className="slider-track"
                type="range"
                min="50"
                max="700"
                step="10"
                value={control.driveCurrent}
                onChange={(e) => applyControl({ ...control, driveCurrent: Number(e.target.value) })}
              />
            </label>
            <label>
              Ambient Temp ({control.ambientTemp} C)
              <input
                className="slider-track"
                type="range"
                min="-10"
                max="100"
                value={control.ambientTemp}
                onChange={(e) => applyControl({ ...control, ambientTemp: Number(e.target.value) })}
              />
            </label>
            <label>
              Humidity ({control.humidity}%)
              <input
                className="slider-track"
                type="range"
                min="0"
                max="100"
                value={control.humidity}
                onChange={(e) => applyControl({ ...control, humidity: Number(e.target.value) })}
              />
            </label>
            <label>
              ADC Resolution ({control.adcBits}-bit)
              <select
                className="speed-select full-width"
                value={control.adcBits}
                onChange={(e) => applyControl({ ...control, adcBits: Number(e.target.value) })}
              >
                <option value={10}>10-bit (0-1023)</option>
                <option value={12}>12-bit (0-4095)</option>
              </select>
            </label>
          </section>

          <section className="side-section">
            <h3>Fleet Manager</h3>
            <div className="formula-note">Create lamps with location path. Same floor value groups lamps into one floor box.</div>
            <div className="formula-grid">
              <div>
                <div className="input-label">Count</div>
                <input
                  type="number"
                  min="1"
                  max="100"
                  value={fleetForm.count}
                  onChange={(e) => {
                    const value = Number(e.target.value);
                    setFleetForm({ ...fleetForm, count: Number.isNaN(value) ? 1 : Math.min(100, Math.max(1, value)) });
                  }}
                />
              </div>
              <div>
                <div className="input-label">Site</div>
                <input
                  type="text"
                  pattern="[a-z0-9_-]+"
                  value={fleetForm.site}
                  onChange={(e) => setFleetForm({ ...fleetForm, site: normalizePathInput(e.target.value) })}
                />
              </div>
              <div>
                <div className="input-label">Floor</div>
                <input
                  type="text"
                  pattern="[a-z0-9_-]+"
                  value={fleetForm.floor}
                  onChange={(e) => setFleetForm({ ...fleetForm, floor: normalizePathInput(e.target.value) })}
                />
              </div>
              <div>
                <div className="input-label">Line</div>
                <input
                  type="text"
                  pattern="[a-z0-9_-]+"
                  value={fleetForm.line}
                  onChange={(e) => setFleetForm({ ...fleetForm, line: normalizePathInput(e.target.value) })}
                />
              </div>
              <div>
                <div className="input-label">Cell</div>
                <input
                  type="text"
                  pattern="[a-z0-9_-]+"
                  value={fleetForm.cell}
                  onChange={(e) => setFleetForm({ ...fleetForm, cell: normalizePathInput(e.target.value) })}
                />
              </div>
            </div>
            <div className="formula-note">Allowed text: lowercase letters, numbers, `_` and `-`.</div>
            <div className="scenario-grid">
              <button type="button" className="scenario-btn" onClick={createFleet}>Create Lamps</button>
              <button type="button" className="scenario-btn" onClick={() => runAll(true)}>Run All</button>
              <button type="button" className="scenario-btn" onClick={() => runAll(false)}>Pause All</button>
              <button type="button" className="scenario-btn danger wide" onClick={deleteAllInstances}>Delete All (Except Default)</button>
            </div>
          </section>

          <section className="side-section">
            <h3>Initial Setup</h3>
            <div className="formula-grid">
              <div>
                <div className="input-label">Ambient Temp (°C)</div>
                <input type="number" value={initialValues.ambientTemp} onChange={(e) => setInitialValues({ ...initialValues, ambientTemp: Number(e.target.value) })} />
              </div>
              <div>
                <div className="input-label">Humidity (%)</div>
                <input type="number" value={initialValues.humidity} onChange={(e) => setInitialValues({ ...initialValues, humidity: Number(e.target.value) })} />
              </div>
              <div>
                <div className="input-label">Drive Current (mA)</div>
                <input type="number" value={initialValues.driveCurrent} onChange={(e) => setInitialValues({ ...initialValues, driveCurrent: Number(e.target.value) })} />
              </div>
              <div>
                <div className="input-label">Startup Speed (x)</div>
                <input type="number" step="0.25" value={initialValues.speed} onChange={(e) => setInitialValues({ ...initialValues, speed: Number(e.target.value) })} />
              </div>
            </div>
            <div className="input-label">Startup ADC Mode</div>
            <select
              className="speed-select full-width"
              value={initialValues.adcBits}
              onChange={(e) => setInitialValues({ ...initialValues, adcBits: Number(e.target.value) })}
            >
              <option value={10}>10-bit (0-1023)</option>
              <option value={12}>12-bit (0-4095)</option>
            </select>
            <button type="button" className="scenario-btn full-width" onClick={applyInitialProfile}>
              Apply As Initial + Reset
            </button>
          </section>

          <section className="side-section">
            <h3>Fault Injection</h3>
            <div className="toggle-row">
              <span>
                Ripple Increase
                <small>Capacitor ESR degradation</small>
              </span>
              <label className="toggle-box">
                <input
                  type="checkbox"
                  checked={inject.rippleEnabled}
                  onChange={(e) => applyAnomalies({ ...inject, rippleEnabled: e.target.checked })}
                />
                <span className="toggle-track"></span>
                <span className="toggle-knob"></span>
              </label>
            </div>
            <div className="toggle-row">
              <span>
                Color Shift
                <small>Phosphor degradation</small>
              </span>
              <label className="toggle-box">
                <input
                  type="checkbox"
                  checked={inject.rgbEnabled}
                  onChange={(e) => applyAnomalies({ ...inject, rgbEnabled: e.target.checked })}
                />
                <span className="toggle-track"></span>
                <span className="toggle-knob"></span>
              </label>
            </div>
            <div className="toggle-row">
              <span>
                Sudden Failure
                <small>Bond wire / die attach</small>
              </span>
              <label className="toggle-box">
                <input
                  type="checkbox"
                  checked={inject.ldrEnabled}
                  onChange={(e) => applyAnomalies({ ...inject, ldrEnabled: e.target.checked })}
                />
                <span className="toggle-track"></span>
                <span className="toggle-knob"></span>
              </label>
            </div>
            <div className="inject-custom">
              <div className="mini-label">Custom Inject Values</div>
              <div className="triple-input">
                <div>
                  <div className="input-label">R</div>
                  <input type="number" value={inject.r} min="0" max="1023" onChange={(e) => applyAnomalies({ ...inject, r: e.target.value })} />
                </div>
                <div>
                  <div className="input-label">G</div>
                  <input type="number" value={inject.g} min="0" max="1023" onChange={(e) => applyAnomalies({ ...inject, g: e.target.value })} />
                </div>
                <div>
                  <div className="input-label">B</div>
                  <input type="number" value={inject.b} min="0" max="1023" onChange={(e) => applyAnomalies({ ...inject, b: e.target.value })} />
                </div>
              </div>
              <div className="input-label">LDR ADC ({ldrMax === 1023 ? "10-bit" : "12-bit"})</div>
              <input type="number" value={inject.ldr} min="0" max={ldrMax} onChange={(e) => applyAnomalies({ ...inject, ldr: e.target.value })} />
              <div className="input-label">Ripple (%)</div>
              <input type="number" value={inject.ripple} min="0" max="100" onChange={(e) => applyAnomalies({ ...inject, ripple: e.target.value })} />
            </div>
          </section>

          <section className="side-section">
            <h3>RUL Formula Editor</h3>
            <div className="formula-note">
              RUL = base - (hours*hoursPenalty) - ripple - thermal - current - anomaly
            </div>
            <div className="formula-grid">
              <div>
                <div className="input-label">Base Life (h)</div>
                <input type="number" value={rulModel.baseLifeHours} onChange={(e) => setRulModel({ ...rulModel, baseLifeHours: Number(e.target.value) })} />
              </div>
              <div>
                <div className="input-label">Hours Penalty</div>
                <input type="number" step="0.01" value={rulModel.hoursPenalty} onChange={(e) => setRulModel({ ...rulModel, hoursPenalty: Number(e.target.value) })} />
              </div>
              <div>
                <div className="input-label">Ripple Penalty</div>
                <input type="number" value={rulModel.ripplePenalty} onChange={(e) => setRulModel({ ...rulModel, ripplePenalty: Number(e.target.value) })} />
              </div>
              <div>
                <div className="input-label">Temp Penalty</div>
                <input type="number" value={rulModel.tempPenalty} onChange={(e) => setRulModel({ ...rulModel, tempPenalty: Number(e.target.value) })} />
              </div>
              <div>
                <div className="input-label">Current Penalty</div>
                <input type="number" value={rulModel.currentPenalty} onChange={(e) => setRulModel({ ...rulModel, currentPenalty: Number(e.target.value) })} />
              </div>
              <div>
                <div className="input-label">Anomaly Penalty</div>
                <input type="number" value={rulModel.anomalyPenalty} onChange={(e) => setRulModel({ ...rulModel, anomalyPenalty: Number(e.target.value) })} />
              </div>
            </div>
            <button type="button" className="scenario-btn full-width" onClick={saveRulModel}>
              Apply RUL Formula
            </button>
          </section>

          <section className="side-section">
            <h3>Scenarios</h3>
            <div className="scenario-grid">
              <button type="button" className="scenario-btn" onClick={() => applyScenario("normal")}>Normal Aging</button>
              <button type="button" className="scenario-btn" onClick={() => applyScenario("capfail")}>Cap. Failure</button>
              <button type="button" className="scenario-btn" onClick={() => applyScenario("phosphor")}>Phosphor Deg.</button>
              <button type="button" className="scenario-btn" onClick={() => applyScenario("catastrophic")}>Catastrophic</button>
              <button type="button" className="scenario-btn wide" onClick={() => applyScenario("stress")}>Thermal Stress Test</button>
            </div>
          </section>

          <section className="side-section">
            <h3>Sensor Readouts</h3>
            <div className="readout-head">
              <span>TCS34725</span>
              <span>RGBC</span>
            </div>
            <div className="readout"><span>R</span><strong>{sim.sensors.rgb.R}</strong></div>
            <div className="readout"><span>G</span><strong>{sim.sensors.rgb.G}</strong></div>
            <div className="readout"><span>B</span><strong>{sim.sensors.rgb.B}</strong></div>
            <div className="readout"><span>C</span><strong>{sim.sensors.rgb.C}</strong></div>
            <div className="readout"><span>LDR ADC</span><strong>{sim.sensors.ldr}</strong></div>
            <div className="readout"><span>Ripple</span><strong>{sim.sensors.ripplePercent}%</strong></div>
          </section>
        </aside>
        <div
          className={`sidebar-resizer ${isResizingSidebar ? "active" : ""}`}
          onMouseDown={(event) => {
            resizeStartX.current = event.clientX;
            resizeStartWidth.current = sidebarWidth;
            setIsResizingSidebar(true);
          }}
          title="Drag to resize parameters panel"
          role="separator"
          aria-orientation="vertical"
        />

        <main className="main-grid">
          <section className="tile card">
            <div className="tile-head">
              <h3>TCS34725 Sensor</h3>
            </div>
            <BarChart
              data={[sim.sensors.rgb.R, sim.sensors.rgb.G, sim.sensors.rgb.B, sim.sensors.rgb.C]}
              labels={["R", "G", "B", "C"]}
              colors={["rgba(239, 68, 68, 0.78)", "rgba(34, 197, 94, 0.78)", "rgba(59, 130, 246, 0.78)", "rgba(180,180,180,0.75)"]}
              yLabel="Counts (ADC)"
              yMax={3200}
            />
          </section>

          <section className="tile card">
            <div className="tile-head">
              <h3>Ripple Waveform</h3>
            </div>
            <LineChart
              values={rippleTrace}
              color="#22c55e"
              yLabel="Ripple (%)"
              xLabel="Sample Index"
              yUnit="%"
              precision={1}
            />
          </section>

          <section className="tile span-2 card">
            <div className="tile-head">
              <h3>Sensor Timeline</h3>
            </div>
            <div className="timeline-grid">
              <LineChart
                values={cTrace}
                color="#f59e0b"
                yLabel="Clear Channel (C)"
                xLabel="Sample Index"
                precision={0}
              />
              <LineChart
                values={ldrTrace}
                color="#3b82f6"
                yLabel="LDR (ADC)"
                xLabel="Sample Index"
                precision={0}
              />
            </div>
          </section>

          <section className="gauge-row span-2">
            <DialGauge title="Anomaly" value={anomalyVal * 100} min={0} max={100} colorScheme="green-yellow-red" />
            <DialGauge title="RUL" value={sim.derived?.rulHours ?? 0} min={0} max={Math.max(1000, rulModel.baseLifeHours)} unit="h" colorScheme="red-yellow-green" />
            <DialGauge title="LDR ADC" value={sim.sensors.ldr} min={0} max={4095} colorScheme="dark-yellow" />
            <DialGauge title="Junction" value={junctionTemp} min={0} max={150} unit="°C" colorScheme="green-yellow-red" />
            <LedBulb r={displayR} g={displayG} b={displayB} intensity={rgbIntensity} theme={theme} />
          </section>

          <section className="tile span-2 card">
            <div className="tile-head">
              <h3>Instances Overview</h3>
            </div>
            <div className="instances-table-wrap">
              <table className="instances-table">
                <thead>
                  <tr>
                    <th>ID</th>
                    <th>Status</th>
                    <th>Location</th>
                    <th>Topic</th>
                    <th>RUL</th>
                    <th>Anomaly</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {instances.map((instance) => (
                    <tr key={instance.id} className={instance.id === selectedInstanceId ? "selected" : ""}>
                      <td>{instance.id}</td>
                      <td>
                        <span className={`status-pill ${instance.playing ? "ok" : "warn"}`}>
                          {instance.playing ? "RUNNING" : "PAUSED"}
                        </span>
                      </td>
                      <td>{`${instance.location?.site}/${instance.location?.floor}/${instance.location?.line}/${instance.location?.cell}`}</td>
                      <td className="topic-cell" title={instance.mqttTopic}>{instance.mqttTopic}</td>
                      <td>{Math.round(instance.rulHours ?? 0)}h</td>
                      <td>{(Number(instance.anomalyScore ?? 0) * 100).toFixed(0)}%</td>
                      <td className="row-actions">
                        <button type="button" className="scenario-btn compact" onClick={() => setSelectedInstanceId(instance.id)}>
                          Focus
                        </button>
                        <button type="button" className="scenario-btn compact" onClick={() => toggleInstancePlay(instance)}>
                          {instance.playing ? "Pause" : "Run"}
                        </button>
                        {instance.id !== defaultInstanceId && (
                          <button type="button" className="scenario-btn compact danger" onClick={() => deleteInstance(instance.id)}>
                            Delete
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="tile span-2 card">
            <div className="tile-head">
              <h3>Factory Lamp Map</h3>
            </div>
            <div className="factory-map">
              {siteMaps.map(({ site, floorMaps }) => (
                <div className="factory-site" key={site}>
                  <div className="factory-site-title">{site}</div>
                  {floorMaps.map(({ floor, lineKeys, cellKeys, matrix }) => (
                    <div className="factory-floor" key={`${site}-${floor}`}>
                      <div className="factory-floor-title">
                        {floor} ({lineKeys.length} lines x {cellKeys.length} cells)
                      </div>
                      <div className="factory-matrix">
                        <div className="matrix-row" style={{ gridTemplateColumns: `90px repeat(${cellKeys.length}, minmax(160px, 1fr))` }}>
                          <div className="matrix-corner">Line/Cell</div>
                          {cellKeys.map((cell) => (
                            <div key={cell} className="matrix-cell-header">{cell}</div>
                          ))}
                        </div>
                        {lineKeys.map((line) => (
                          <div className="matrix-row" key={line} style={{ gridTemplateColumns: `90px repeat(${cellKeys.length}, minmax(160px, 1fr))` }}>
                            <div className="matrix-line-label">{line}</div>
                            {cellKeys.map((cell) => {
                              const lamps = matrix[`${line}__${cell}`] || [];
                              return (
                                <div className="matrix-cell" key={`${line}-${cell}`}>
                                  <div className="lamp-stack">
                                    {lamps.map((lamp) => (
                                      <div key={lamp.id} className={`lamp-chip ${lamp.id === selectedInstanceId ? "active" : ""}`}>
                                        {lamp.id !== defaultInstanceId && (
                                          <button
                                            type="button"
                                            className="lamp-delete-btn"
                                            onClick={() => deleteInstance(lamp.id)}
                                            title={`Delete ${lamp.id}`}
                                            aria-label={`Delete ${lamp.id}`}
                                          >
                                            Del
                                          </button>
                                        )}
                                        <button
                                          type="button"
                                          className="lamp-chip-body"
                                          onClick={() => setSelectedInstanceId(lamp.id)}
                                          title={`${lamp.id} | RUL ${Math.round(lamp.rulHours ?? 0)}h | ${(Number(lamp.anomalyScore ?? 0) * 100).toFixed(0)}%`}
                                        >
                                          <div className="lamp-chip-top">
                                            <span className={`lamp-dot ${lamp.playing ? "ok" : "warn"}`} />
                                            <span className="lamp-chip-id">{lamp.id}</span>
                                          </div>
                                          <div className="lamp-chip-meta">
                                            RUL {Math.round(lamp.rulHours ?? 0)}h
                                          </div>
                                          <div className="lamp-chip-meta">
                                            ANM {(Number(lamp.anomalyScore ?? 0) * 100).toFixed(0)}%
                                          </div>
                                        </button>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          </section>
        </main>
      </div>
    </div>
  );
}
