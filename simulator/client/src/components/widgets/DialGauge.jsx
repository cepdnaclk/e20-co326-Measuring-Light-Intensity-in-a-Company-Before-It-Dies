function arcPath(cx, cy, r, startDeg, endDeg) {
  const start = (Math.PI / 180) * startDeg;
  const end = (Math.PI / 180) * endDeg;
  const x1 = cx + r * Math.cos(start);
  const y1 = cy + r * Math.sin(start);
  const x2 = cx + r * Math.cos(end);
  const y2 = cy + r * Math.sin(end);
  const large = endDeg - startDeg > 180 ? 1 : 0;
  return `M ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2}`;
}

function lerp(a, b, t) {
  return Math.round(a + (b - a) * t);
}

function gaugeColorFromPct(pct, scheme = "red-yellow-green") {
  const p = Math.max(0, Math.min(1, pct));
  const toRgb = (a, b, t) => `rgb(${lerp(a[0], b[0], t)}, ${lerp(a[1], b[1], t)}, ${lerp(a[2], b[2], t)})`;

  if (scheme === "green-yellow-red") {
    const green = [34, 197, 94];
    const yellow = [250, 204, 21];
    const red = [239, 68, 68];
    if (p <= 0.5) return toRgb(green, yellow, p / 0.5);
    return toRgb(yellow, red, (p - 0.5) / 0.5);
  }

  if (scheme === "dark-yellow") {
    const dark = [35, 39, 58];
    const yellowSoft = [245, 198, 72];
    return toRgb(dark, yellowSoft, p);
  }

  const red = [239, 68, 68];
  const yellow = [250, 204, 21];
  const green = [34, 197, 94];
  if (p <= 0.5) return toRgb(red, yellow, p / 0.5);
  return toRgb(yellow, green, (p - 0.5) / 0.5);
}

export default function DialGauge({ title, value, min, max, unit = "", colorScheme = "red-yellow-green" }) {
  const pct = Math.max(0, Math.min(1, (value - min) / Math.max(1, max - min)));
  const startDeg = 180;
  const endDeg = 360;
  const valueDeg = startDeg + (endDeg - startDeg) * pct;
  const display = `${Math.round(value)}${unit}`;
  const dialColor = gaugeColorFromPct(pct, colorScheme);

  const ticks = new Array(11).fill(0).map((_, i) => {
    const deg = 180 + i * 18;
    const rad = (Math.PI / 180) * deg;
    const x1 = 70 + 42 * Math.cos(rad);
    const y1 = 70 + 42 * Math.sin(rad);
    const x2 = 70 + 47 * Math.cos(rad);
    const y2 = 70 + 47 * Math.sin(rad);
    return <line key={deg} x1={x1} y1={y1} x2={x2} y2={y2} className="dial-tick" />;
  });

  return (
    <div className="dial-card">
      <div className="dial-title">{title}</div>
      <svg viewBox="0 0 140 95" className="dial-svg">
        <path d={arcPath(70, 70, 48, 180, 360)} className="dial-track" />
        <path d={arcPath(70, 70, 48, 180, valueDeg)} className="dial-progress" style={{ stroke: dialColor }} />
        {ticks}
      </svg>
      <div className="dial-value" style={{ color: dialColor }}>
        {display}
      </div>
    </div>
  );
}
