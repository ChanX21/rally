export interface ScoreInput {
  overlapMin: number;
  durationMin: number;
  hasWaitingIntent: boolean;
  /** Position of the category in the candidate's interests; null when not listed. */
  interestRank: number | null;
  declaredSkills: readonly string[];
  neededRole: string;
  vibeMatch: boolean;
  mutualEncore: boolean;
}

/**
 * Playbook weights: feasibility 45%, complementary fit 30%, acceptance likelihood 15%, prior mutual
 * encore 10%. This is a ranking heuristic, not a calibrated probability.
 */
export function scoreCandidate(input: ScoreInput): number {
  const feasibility = Math.min(input.overlapMin / input.durationMin, 1);
  const complementary = input.declaredSkills.includes(input.neededRole)
    ? 1
    : input.vibeMatch
      ? 0.6
      : 0.3;
  const acceptance = input.hasWaitingIntent
    ? 1
    : input.interestRank === null
      ? 0.3
      : 0.8 - input.interestRank * 0.2;
  const encore = input.mutualEncore ? 1 : 0;
  return Math.round(45 * feasibility + 30 * complementary + 15 * acceptance + 10 * encore);
}

export interface RankedCandidate {
  userId: string;
  score: number;
}

/** Stable order so the same inputs always produce the same group. */
export function rankCandidates<T extends RankedCandidate>(candidates: readonly T[]): T[] {
  return [...candidates].sort(
    (a, b) => b.score - a.score || a.userId.localeCompare(b.userId),
  );
}
