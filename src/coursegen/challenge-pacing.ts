/**
 * Challenge pacing: planner picks a coarse band; coursegen maps to seconds.
 * LLMs should never invent raw timer durations.
 */

export const CHALLENGE_PACINGS = ['relaxed', 'steady', 'brisk'] as const;
export type ChallengePacing = (typeof CHALLENGE_PACINGS)[number];

export type ChallengeTimerSeconds = {
  /** Seconds available at the start of an item / after a miss. */
  start: number;
  /** Floor after successive correct answers. */
  min: number;
  /** Seconds removed from the next item after a correct answer. */
  shrink: number;
};

const PACING_TIMERS: Record<ChallengePacing, ChallengeTimerSeconds> = {
  // Multi-step reasoning, reading, construction, younger audiences
  relaxed: { start: 22, min: 14, shrink: 1 },
  // Default light pressure for single-step fluency
  steady: { start: 16, min: 10, shrink: 1 },
  // Rapid retrieval of already-simple facts
  brisk: { start: 12, min: 8, shrink: 1 }
};

export const DEFAULT_CHALLENGE_PACING: ChallengePacing = 'steady';

export function isChallengePacing(value: unknown): value is ChallengePacing {
  return typeof value === 'string' && (CHALLENGE_PACINGS as readonly string[]).includes(value);
}

export function resolveChallengePacing(value: unknown): ChallengePacing {
  return isChallengePacing(value) ? value : DEFAULT_CHALLENGE_PACING;
}

export function challengeTimerSeconds(pacing: ChallengePacing = DEFAULT_CHALLENGE_PACING): ChallengeTimerSeconds {
  return { ...PACING_TIMERS[pacing] };
}
