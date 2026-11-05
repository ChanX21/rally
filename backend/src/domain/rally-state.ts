import { AppError } from '../lib/errors.js';

export type RallyStatus =
  | 'draft'
  | 'open'
  | 'waiting'
  | 'proposed'
  | 'ready'
  | 'formed'
  | 'met'
  | 'completed'
  | 'cancelled'
  | 'expired';

const TRANSITIONS: Record<RallyStatus, readonly RallyStatus[]> = {
  draft: ['open', 'cancelled', 'expired'],
  open: ['waiting', 'proposed', 'ready', 'cancelled', 'expired'],
  waiting: ['open', 'proposed', 'ready', 'cancelled', 'expired'],
  proposed: ['ready', 'open', 'waiting', 'cancelled', 'expired'],
  ready: ['formed', 'open', 'proposed', 'cancelled', 'expired'],
  formed: ['met', 'open', 'proposed', 'cancelled', 'expired'],
  met: ['completed'],
  completed: [],
  cancelled: [],
  expired: [],
};

export function canTransition(from: RallyStatus, to: RallyStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export function assertTransition(from: RallyStatus, to: RallyStatus): void {
  if (!canTransition(from, to)) {
    throw new AppError(409, 'INVALID_STATE', `A rally cannot move from ${from} to ${to}`);
  }
}

/** Rallies the matching engine may still add people to. */
export const MATCHABLE: readonly RallyStatus[] = ['open', 'waiting', 'proposed'];
/** Rallies where a candidate holding an offer may still take a free seat. */
export const ACCEPTING: readonly RallyStatus[] = ['open', 'waiting', 'proposed', 'ready', 'formed'];
/** Rallies whose time can still run out. Met rallies did happen, so they never expire. */
export const EXPIRABLE: readonly RallyStatus[] = [
  'draft',
  'open',
  'waiting',
  'proposed',
  'ready',
  'formed',
];
export const EDITABLE_SCHEDULE: readonly RallyStatus[] = ['draft', 'open', 'waiting'];
export const CANCELLABLE: readonly RallyStatus[] = EXPIRABLE;
export const ROOM_VISIBLE: readonly RallyStatus[] = ['formed', 'met', 'completed'];
export const TERMINAL: readonly RallyStatus[] = ['completed', 'cancelled', 'expired'];

export type PublicStatus = 'open' | 'filling' | 'full' | 'closed';

/** Public listings use coarse states, so the chain never exposes private lifecycle detail. */
export function toPublicStatus(status: RallyStatus, openSeats: number): PublicStatus {
  if (status === 'met' || TERMINAL.includes(status)) return 'closed';
  if (openSeats === 0) return 'full';
  return status === 'open' || status === 'waiting' ? 'open' : 'filling';
}
