export default function BarChart({ data, labels, colors, yLabel, yMax }) {
  const W = 560;
  const H = 220;
  const M = { top: 16, right: 16, bottom: 34, left: 50 };
  const plotW = W - M.left - M.right;
  const plotH = H - M.top - M.bottom;
  const barW = plotW / (data.length * 1.8);

  return (
    <svg className="chart-svg" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
      {[0, 0.25, 0.5, 0.75, 1].map((k) => {
        const y = M.top + k * plotH;
        const val = Math.round((1 - k) * yMax);
        return (
          <g key={`bar-y-${k}`}>
            <line x1={M.left} y1={y} x2={W - M.right} y2={y} className="grid-line" />
            <text x={M.left - 8} y={y + 3} className="axis-text axis-text-right">
              {val}
            </text>
          </g>
        );
      })}
      <line x1={M.left} y1={M.top} x2={M.left} y2={H - M.bottom} className="axis-line" />
      <line x1={M.left} y1={H - M.bottom} x2={W - M.right} y2={H - M.bottom} className="axis-line" />
      {data.map((v, i) => {
        const h = (Math.max(0, v) / yMax) * plotH;
        const x = M.left + ((i + 0.5) * plotW) / data.length - barW / 2;
        const y = H - M.bottom - h;
        return (
          <g key={labels[i]}>
            <rect x={x} y={y} width={barW} height={h} rx="4" fill={colors[i]} />
            <text x={x + barW / 2} y={Math.max(M.top + 10, y - 4)} className="axis-text axis-text-center">
              {Math.round(v)}
            </text>
            <text x={x + barW / 2} y={H - 12} className="axis-text axis-text-center">
              {labels[i]}
            </text>
          </g>
        );
      })}
      <text x={12} y={M.top + plotH / 2} className="axis-label" transform={`rotate(-90 12 ${M.top + plotH / 2})`}>
        {yLabel}
      </text>
    </svg>
  );
}
