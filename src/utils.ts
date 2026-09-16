export interface ScoreThresholds {
  base: number;
  good: number;
  strong: number;
}

/**
 * Rounds a number to the nearest multiple of a given step (default 2).
 */
function roundToStep(value: number, step = 2): number {
  return Math.round(value / step) * step;
}

/**
 * Linearly scales threshold tiers between baseThreshold and 100,
 * rounded to the nearest multiple of 5.
 */
export function getDynamicThresholds(baseThreshold: number): ScoreThresholds {
  const range = 100 - baseThreshold;

  const rawGood = baseThreshold + range * (1 / 3);
  const rawStrong = baseThreshold + range * (2 / 3);

  return {
    base: roundToStep(baseThreshold),
    good: roundToStep(rawGood),
    strong: roundToStep(rawStrong),
  };
}
