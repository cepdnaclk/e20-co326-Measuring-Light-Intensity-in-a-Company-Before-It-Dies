export default function LedBulb({ r, g, b, intensity, theme }) {
  const safeIntensity = Math.max(0.08, Math.min(1, intensity));
  const glowOpacity = theme === "light" ? 0.55 + safeIntensity * 0.35 : 0.45 + safeIntensity * 0.45;
  const visibleR = Math.max(r, 28);
  const visibleG = Math.max(g, 28);
  const visibleB = Math.max(b, 28);
  const bulbColor = `rgba(${visibleR}, ${visibleG}, ${visibleB}, ${0.58 + safeIntensity * 0.34})`;
  const glowColor =
    theme === "light"
      ? `rgba(250, 204, 21, ${glowOpacity})`
      : `rgba(${visibleR}, ${visibleG}, ${visibleB}, ${glowOpacity})`;
  const stageBg =
    theme === "light"
      ? "radial-gradient(circle, rgba(250,204,21,0.12) 0%, rgba(250,204,21,0.05) 45%, rgba(250,204,21,0) 75%)"
      : "radial-gradient(circle, rgba(15,23,42,0.35) 0%, rgba(15,23,42,0.14) 52%, rgba(15,23,42,0) 78%)";

  return (
    <div className="led-card">
      <div className="dial-title">LED Output</div>
      <div className="led-stage" style={{ background: stageBg }}>
        <div className="led-glow" style={{ background: `radial-gradient(circle, ${glowColor} 0%, rgba(0,0,0,0) 70%)` }} />
        <div
          className="led-bulb"
          style={{
            background: `radial-gradient(circle at 35% 30%, rgba(255,255,255,0.95), ${bulbColor})`,
            boxShadow: `0 0 ${18 + safeIntensity * 18}px ${glowColor}`,
          }}
        />
        <div className="led-base-top" />
        <div className="led-leg left" />
        <div className="led-leg right" />
      </div>
    </div>
  );
}
