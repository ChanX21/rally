/** Minutes shared by two time windows; zero when they do not overlap. */
export function overlapMinutes(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): number {
  const start = Math.max(aStart.getTime(), bStart.getTime());
  const end = Math.min(aEnd.getTime(), bEnd.getTime());
  return Math.max(0, Math.floor((end - start) / 60_000));
}

/** Coarse public hour, e.g. 2026-11-06T14. */
export function startBucket(date: Date): string {
  return date.toISOString().slice(0, 13);
}
