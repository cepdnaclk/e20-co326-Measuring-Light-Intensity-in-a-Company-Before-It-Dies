# ML Approaches for LED Bulb Predictive Failure System

## Your Current Situation

Your system currently uses **static thresholds** on LDR brightness values:

| LDR Value | Status | Action |
|-----------|--------|--------|
| > 3000 | BRIGHT (Good) | None |
| 1000–3000 | NORMAL (Degrading) | — |
| < 1000 | DARK (Failed) | Relay switches |

**Problems with this approach:**
- No time-based prediction ("will fail in X days")
- No probability quantification ("73% chance of failure")
- Can't distinguish gradual degradation from sudden failure
- Ignores environmental context (temperature, current, humidity)
- Same thresholds for all bulb types/ages

---

## What You Actually Need (3 Output Types)

Your system needs to produce **three distinct outputs**:

```
┌─────────────────────────────────────────────────────┐
│  OUTPUT 1: Current Status                           │
│  "Bulb is currently: HEALTHY / DEGRADING / FAILED"  │
│                                                     │
│  OUTPUT 2: Predictive Failure Probability            │
│  "X% probability of failure within 14 days"         │
│                                                     │
│  OUTPUT 3: Sudden Failure Alert                      │
│  "ALERT: Unexpected rapid degradation detected"     │
└─────────────────────────────────────────────────────┘
```

Each output can be solved differently. **You don't need one giant ML model — you need the right tool for each job.**

---

## The 4 Candidate ML Approaches

### Approach 1: Degradation Curve Fitting (Regression)
**Complexity: ★☆☆☆☆ — Recommended Starting Point**

**What it is:** Fit an exponential decay curve to historical brightness readings, then extrapolate to predict *when* brightness will cross the failure threshold.

**How it works:**
```
Brightness
   │
4000├──●●●●●●
   │         ●●●
3000├────────────●●●──── Warning threshold
   │               ●●
   │                 ●●●
1000├─────────────────────●●── Failure threshold
   │                        ●●●
   ├───┬───┬───┬───┬───┬───┬───→ Days
   0   30  60  90  120 150 180

   Model: brightness(t) = A × e^(-λt) + C
   Predict: t_failure = when brightness(t) < 1000
```

**Features needed:**
- Rolling average brightness (last 24h, 7d, 14d)
- Operating hours accumulated
- Rate of brightness decline (slope of last 7 days)

**Outputs:**
| Output | How |
|--------|-----|
| Current Status | Direct threshold on smoothed brightness |
| Failure in X days | Extrapolate curve to threshold crossing |
| Probability | Confidence interval from curve fit residuals |
| Sudden failure | If actual value drops > 3σ below predicted curve |

**Pros:**
- Very interpretable ("brightness is declining at X lux/day")
- Works with limited data (even 2 weeks of history)
- Lightweight — can run on ESP32 or Node-RED
- No training dataset required — fits per-bulb

**Cons:**
- Assumes smooth degradation (LEDs often fail suddenly)
- Doesn't leverage environmental features
- Probability estimation is naive

> [!TIP]
> **This is what your simulator already approximates.** Your `simulate()` function uses `Math.exp(-0.00006 * state.timeHours)` — that's literally an exponential decay model. The ML version just learns the parameters from real data instead of hardcoding them.

---

### Approach 2: Gradient Boosted Classifier (XGBoost / LightGBM)
**Complexity: ★★☆☆☆ — Best Balance of Accuracy vs. Effort**

**What it is:** Train a classification model: given the last N readings + environment features → *"Will this bulb fail within 14 days?"* with a probability.

**How it works:**
```
┌──────────────────────────────────────────────────┐
│              Feature Engineering                  │
│                                                  │
│  Raw Sensor Data         Engineered Features     │
│  ─────────────────       ──────────────────────  │
│  LDR value          →   mean_brightness_7d       │
│  RGB (R,G,B,C)      →   brightness_slope_7d      │
│  Ripple %            →   brightness_variance_7d   │
│  Temperature         →   rate_of_change_24h       │
│  Humidity            →   cumulative_hours         │
│  Drive Current       →   max_brightness_drop_24h  │
│  Operating Hours     →   ripple_trend             │
│                      →   temp_stress_hours         │
│                      →   color_shift_magnitude     │
└──────────────┬───────────────────────────────────┘
               │
               ▼
     ┌─────────────────┐
     │   XGBoost /      │
     │   LightGBM       │  → P(failure in 14 days) = 0.73
     │   Classifier     │  → P(failure in 7 days)  = 0.41
     └─────────────────┘
```

**Key Features to Engineer:**

| Feature | Description | Why It Matters |
|---------|-------------|----------------|
| `mean_brightness_7d` | 7-day rolling mean of LDR | Baseline health indicator |
| `brightness_slope_7d` | Linear regression slope over 7 days | Rate of degradation |
| `brightness_variance_24h` | Variance of last 24h readings | Flickering = near failure |
| `max_drop_24h` | Largest single-period brightness drop | Sudden degradation signal |
| `cumulative_hours` | Total operating hours | Age factor |
| `ripple_percent_mean` | Mean ripple over 7 days | Driver circuit health |
| `color_shift` | `|R/G ratio now - R/G ratio at install|` | Phosphor degradation |
| `temp_above_25_hours` | Hours spent above 25°C | Thermal stress |
| `current_deviation` | Std dev of drive current | Power instability |

**Outputs:**
| Output | How |
|--------|-----|
| Current Status | Separate simple classifier (or threshold on model features) |
| Failure in 14 days | `model.predict_proba(features)` → direct probability |
| Failure in 7/3/1 days | Train separate models or multi-output for different windows |
| Sudden failure | If `max_drop_24h` exceeds 2× historical norm |

**Pros:**
- Handles non-linear relationships
- Probability output is well-calibrated with proper training
- Feature importance tells you *why* a bulb is flagged
- Industry standard for predictive maintenance (used by Siemens, GE, Philips)

**Cons:**
- Needs labeled training data (or synthetic data from your simulator)
- Runs on server, not on ESP32

> [!IMPORTANT]
> **Your existing dataset (`street_light_fault_prediction_dataset.csv`, ~34K rows) has columns for power consumption, voltage, current fluctuations, temperature, and fault types.** This is directly usable for training an XGBoost model. The `fault_type` column (values 0-4) is your label.

---

### Approach 3: Survival Analysis (Weibull / Cox Proportional Hazards)
**Complexity: ★★★☆☆ — Most Statistically Rigorous**

**What it is:** Models "time until event" — gives you a hazard function that directly answers *"What is the probability this bulb survives the next 14 days?"*

**How it works:**
```
Survival Probability
  1.0 ├──●●●●●●
      │         ●●●●
  0.8 ├              ●●●
      │                 ●●
  0.6 ├                   ●●●
      │                      ●●
  0.4 ├                        ●●●
      │                           ●●
  0.2 ├                             ●●●
      │                                ●●●
  0.0 ├────┬────┬────┬────┬────┬────┬────→ Days
      0    30   60   90  120  150  180

  S(t) = P(survive beyond time t)
  Hazard: h(t) = -dS(t)/dt / S(t)
  
  Your query: S(t+14) / S(t) = P(survive 14 more days | alive at t)
```

**Weibull Model:** `S(t) = exp(-(t/λ)^k)` where:
- `λ` = scale (characteristic life)
- `k` = shape (k < 1: infant mortality, k = 1: random, k > 1: wear-out)

**Cox Proportional Hazards** adds covariates:
- `h(t|X) = h₀(t) × exp(β₁·temp + β₂·ripple + β₃·current + ...)`
- Covariates shift the baseline hazard up/down

**Outputs:**
| Output | How |
|--------|-----|
| Current Status | From current survival probability |
| Failure in 14 days | `1 - S(t+14)/S(t)` directly |
| Probability | Exact — this is what survival analysis is built for |
| Sudden failure | Sudden jump in hazard rate |

**Pros:**
- Mathematically designed for exactly this problem
- Handles censored data (bulbs still alive at end of observation)
- Small model, efficient inference
- Industry standard in reliability engineering

**Cons:**
- Requires time-to-failure data (or simulation-generated data)
- Less flexible than tree-based methods for non-linear interactions
- Slightly harder to explain to non-technical stakeholders

---

### Approach 4: LSTM / Temporal Convolutional Network
**Complexity: ★★★★☆ — Over-engineering for your case**

**What it is:** Feed raw time-series sensor windows directly into a neural network.

```
┌─────────────────────────────────────────┐
│   Input: Last 14 days of sensor data    │
│   [brightness₁, temp₁, ripple₁, ...]   │
│   [brightness₂, temp₂, ripple₂, ...]   │
│   ...                                   │
│   [brightness_n, temp_n, ripple_n, ...] │
└─────────────┬───────────────────────────┘
              │
              ▼
    ┌───────────────────┐
    │  LSTM / TCN        │  → P(failure in 14 days)
    │  (Deep Learning)   │  → P(failure in 7 days)
    └───────────────────┘
```

**Pros:**
- Can learn complex temporal patterns automatically
- No manual feature engineering needed

**Cons:**
- Needs much more data (tens of thousands of failure sequences)
- Computationally expensive
- Black box — hard to explain decisions
- **Overkill for a sensor with 5-6 features**

> [!WARNING]
> **I would not recommend this approach for your project.** Your sensor feature space is small (LDR + RGB + ripple + temp + current + humidity). LSTM shines when the raw temporal patterns are complex and feature engineering is difficult. Here, handcrafted features + XGBoost will match or beat LSTM with 10× less effort.

---

## Comparison Matrix

| Criteria | Curve Fitting | XGBoost | Survival Analysis | LSTM |
|----------|:---:|:---:|:---:|:---:|
| **Prediction accuracy** | ★★☆ | ★★★★ | ★★★★ | ★★★★ |
| **Probability calibration** | ★★☆ | ★★★☆ | ★★★★★ | ★★★☆ |
| **Implementation effort** | ★★★★★ | ★★★★☆ | ★★★☆☆ | ★★☆☆☆ |
| **Data requirement** | Minimal | Moderate | Moderate | Large |
| **Interpretability** | ★★★★★ | ★★★★☆ | ★★★☆☆ | ★☆☆☆☆ |
| **Edge deployable (ESP32)** | ✅ Yes | ❌ Server | ❌ Server | ❌ Server |
| **Industry adoption** | Medium | Very High | High | Medium |
| **Handles sudden failure** | ★★☆ | ★★★★ | ★★★☆ | ★★★★ |

---

## ⭐ My Recommendation: Hybrid Approach (Practical & Industry-Aligned)

Don't pick one — combine the best of each where it fits:

```
┌─────────────────────────────────────────────────────────────┐
│                    EDGE (ESP32)                              │
│                                                             │
│  Layer 1: Moving Average + Sudden Drop Detection            │
│  ─────────────────────────────────────────────────          │
│  • 20-sample moving window (you already have this)          │
│  • If drop > 3σ from moving average → SUDDEN FAILURE ALERT  │
│  • Publish raw readings via MQTT every 1 second             │
│                                                             │
└────────────────────────┬────────────────────────────────────┘
                         │ MQTT
                         ▼
┌─────────────────────────────────────────────────────────────┐
│                  SERVER (Node-RED → Python)                  │
│                                                             │
│  Layer 2: Feature Engineering + Storage                     │
│  ─────────────────────────────────────────────────          │
│  • Node-RED aggregates readings into InfluxDB               │
│  • Python service queries InfluxDB every hour               │
│  • Engineers features (slopes, variances, trends)           │
│                                                             │
│  Layer 3: XGBoost Classifier                                │
│  ─────────────────────────────────────────────────          │
│  • Input: engineered features per bulb                      │
│  • Output: P(failure in 14d), P(failure in 7d)              │
│  • Trained on your street light dataset + simulator data    │
│  • Retrained monthly with real data                         │
│                                                             │
│  Layer 4: Alert Engine                                      │
│  ─────────────────────────────────────────────────          │
│  • P > 70% + 14 days → Warning notification                 │
│  • P > 70% + 7 days  → Urgent notification                  │
│  • Sudden drop detected → Immediate alert                   │
│  • Publish alerts to MQTT topic `led/alerts`                │
│                                                             │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│              DASHBOARD (Grafana)                             │
│                                                             │
│  • Bulb health status panel (HEALTHY/DEGRADING/FAILED)       │
│  • Failure probability gauge (0–100%)                        │
│  • Predicted days to failure                                 │
│  • Alert history                                             │
│  • Brightness trend chart with predicted trajectory          │
└─────────────────────────────────────────────────────────────┘
```

### Why This Hybrid Works

| Your Requirement | Solution Layer |
|-----------------|----------------|
| Current bulb status | Edge: threshold on smoothed LDR (your existing logic, refined) |
| Sudden failure alert | Edge: drop detection (> 3σ from moving average, immediate MQTT alert) |
| "X% chance of failure in 14 days" | Server: XGBoost classifier with probability output |
| "Replace bulb soon" warning | Server: Alert engine based on XGBoost probability thresholds |

### Implementation Steps

1. **Keep your edge logic simple** — moving average + anomaly detection on ESP32
2. **Store time-series data** — you already have InfluxDB; store every reading
3. **Add a Python microservice** — runs XGBoost prediction hourly
4. **Train on your existing dataset** — 34K rows from `street_light_fault_prediction_dataset.csv`
5. **Augment with simulator** — your simulator can generate degradation sequences for training
6. **Alert via MQTT** — publish predictions to a topic, Node-RED routes to Grafana/notifications

---

## Data Strategy

### Using Your Existing Dataset

Your `street_light_fault_prediction_dataset.csv` has:
```
bulb_number, timestamp, power_consumption (Watts), voltage_levels (Volts),
current_fluctuations (Amperes), temperature (Celsius), 
environmental_conditions, current_fluctuations_env (Amperes), fault_type
```

`fault_type` values (0–4) can be mapped to:
- 0 → No fault (HEALTHY)
- 1–4 → Different fault types

**For 14-day prediction:** You'll need to restructure this into a time-window format:
- For each bulb, look at features at time T
- Label = "did this bulb have a fault within 14 days of T?"

### Using Your Simulator for Augmentation

Your simulator already models realistic degradation with:
- Exponential brightness decay
- Temperature/humidity/current effects
- Anomaly injection
- RUL (Remaining Useful Life) calculation

**Generate synthetic training data** by running simulations with different parameters and recording the degradation trajectories.

---

## Open Questions

> [!IMPORTANT]
> **Q1: Sensor availability** — In your real deployment, which sensors do you have? Just LDR? Or also RGB (TCS34725) + temperature + current? This determines which features are available.

> [!IMPORTANT]
> **Q2: Data collection period** — How long have you been collecting real sensor data? If < 1 month, you'll rely heavily on simulator-generated training data initially.

> [!IMPORTANT]
> **Q3: Alert delivery** — How should warnings reach the user? Grafana alerts? MQTT → mobile push? Email? This affects the alert engine implementation.

> [!IMPORTANT]
> **Q4: Deployment target** — Should the XGBoost model run as a Docker container alongside your existing stack? Or as a standalone Python script?
