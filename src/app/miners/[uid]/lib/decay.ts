
export interface DecayParams {
  graceHours: number;
  midpoint: number;
  steepness: number;
  floor: number;
}

export const DEFAULT_DECAY_PARAMS: DecayParams = {
  graceHours: 12,
  midpoint: 10,
  steepness: 0.4,
  floor: 0.05,
};

export function decayAt(
  daysSinceMerge: number,
  params: DecayParams = DEFAULT_DECAY_PARAMS,
): number {
  if (daysSinceMerge <= params.graceHours / 24) return 1;
  const sigmoid = 1 / (1 + Math.exp(params.steepness * (daysSinceMerge - params.midpoint)));
  return Math.max(sigmoid, params.floor);
}
