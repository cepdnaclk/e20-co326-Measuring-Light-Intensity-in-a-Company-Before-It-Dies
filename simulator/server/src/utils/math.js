export const clamp = (v, min, max) => Math.min(max, Math.max(min, v));
export const noise = (v, ratio = 0.03) => v + (Math.random() - 0.5) * 2 * v * ratio;
