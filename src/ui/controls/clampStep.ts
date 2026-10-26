/** 把数值吸附到步长上，并限制在 [min, max]。 */
export const clampStep = (v: number, min: number, max: number, step: number) =>
  Math.min(max, Math.max(min, Math.round((v - min) / step) * step + min));
