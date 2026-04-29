export default function LineChart({ values, color, yLabel, xLabel, yUnit = "", precision = 0 }) {
  const W = 560;
  const H = 220;
  const M = { top: 16, right: 16, bottom: 34, left: 50 };
  const plotW = W - M.left - M.right;
  const plotH = H - M.top - M.bottom;
  const safeValues = values.length ? values : [0, 0];
  const min = Math.min(...safeValues);
  const max = Math.max(...safeValues);
  const pad = Math.max(1, (max - min) * 0.08);
  const yMin = Math.max(0, min - pad);
  const yMax = max + pad;
  const span = Math.max(1e-6, yMax - yMin);
  const formatY = (v) => `${v.toFixed(precision)}${yUnit}`;

  const points = safeValues
    .map((v, i) => {
      const x = M.left + (i / Math.max(safeValues.length - 1, 1)) * plotW;
      const y = M.top + (1 - (v - yMin) / span) * plotH;
      return `${x},${y}`;
    })
    .join(" ");

  return (
    <svg className="chart-svg" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
      {[0, 0.25, 0.5, 0.75, 1].map((k) => {
        const y = M.top + k * plotH;
        const val = yMax - k * span;
        return (
          <g key={`y-${k}`}>
            <line x1={M.left} y1={y} x2={W - M.right} y2={y} className="grid-line" />
            <text x={M.left - 8} y={y + 3} className="axis-text axis-text-right">
              {formatY(val)}
            </text>
          </g>
        );
      })}
      {[0, 0.25, 0.5, 0.75, 1].map((k) => {
        const x = M.left + k * plotW;
        const idx = Math.round(k * Math.max(safeValues.length - 1, 0));
        return (
          <g key={`x-${k}`}>
            <line x1={x} y1={M.top} x2={x} y2={H - M.bottom} className="grid-line v" />
            <text x={x} y={H - 12} className="axis-text axis-text-center">
              {idx}
            </text>
          </g>
        );
      })}
      <line x1={M.left} y1={M.top} x2={M.left} y2={H - M.bottom} className="axis-line" />
      <line x1={M.left} y1={H - M.bottom} x2={W - M.right} y2={H - M.bottom} className="axis-line" />
      <polyline points={points} fill="none" stroke={color} strokeWidth="1.4" />
      <text x={12} y={M.top + plotH / 2} className="axis-label" transform={`rotate(-90 12 ${M.top + plotH / 2})`}>
        {yLabel}
      </text>
      <text x={M.left + plotW / 2} y={H - 2} className="axis-label axis-text-center">
        {xLabel}
      </text>
    </svg>
  );
}
