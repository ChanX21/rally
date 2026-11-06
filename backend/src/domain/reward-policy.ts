/** The order must match the Action enum in contracts/src/RallyLedger.sol. */
export const REWARD_ACTIONS = [
  'OnTime',
  'HostCompleted',
  'Vouched',
  'Late',
  'LateCancel',
  'NoShow',
  'ComplaintUpheld',
  'FalseComplaint',
  'RallyCompleted',
] as const;
export type RewardAction = (typeof REWARD_ACTIONS)[number];
export type PolicyAmounts = Record<RewardAction, number>;

export const EARNING_ACTIONS: readonly RewardAction[] = ['OnTime', 'HostCompleted', 'Vouched', 'RallyCompleted'];

export const DEFAULT_POLICY_VERSION = 1;
/** Must match the amounts in contracts/script/DeployLedger.s.sol, which publish version 1. */
export const DEFAULT_AMOUNTS: PolicyAmounts = {
  OnTime: 10,
  HostCompleted: 5,
  Vouched: 25,
  Late: -5,
  LateCancel: -10,
  NoShow: -20,
  ComplaintUpheld: -15,
  FalseComplaint: -10,
  RallyCompleted: 10,
};

/** Must match MAX_AMOUNT in the contract, so anything saved here can also be published there. */
export const MAX_POLICY_AMOUNT = 100;

export const MAX_EARNED_PER_DAY = 100;
export const MAX_PER_COUNTERPARTY = 50;
export const REPEAT_GROUP_DAYS = 7;

export const ON_TIME_GRACE_MIN = 5;
export const LATE_AFTER_MIN = 15;
export const LATE_CANCEL_WINDOW_MIN = 120;
export const ARRIVE_OPENS_BEFORE_MIN = 30;
export const NO_SHOW_HOLD_HOURS = 24;
export const DISPUTE_TIMEOUT_HOURS = 72;

export function policyError(amounts: PolicyAmounts): string | null {
  for (const action of REWARD_ACTIONS) {
    const amount = amounts[action];
    const earning = EARNING_ACTIONS.includes(action);
    if (action === 'RallyCompleted' && amount < 1) return 'RallyCompleted must be a whole number from 1 to 100';
    const valid = earning
      ? amount >= 0 && amount <= MAX_POLICY_AMOUNT
      : amount <= 0 && amount >= -MAX_POLICY_AMOUNT;
    if (!Number.isInteger(amount) || !valid) {
      return earning
        ? `${action} must be a whole number from 0 to ${MAX_POLICY_AMOUNT}`
        : `${action} must be a whole number from -${MAX_POLICY_AMOUNT} to 0`;
    }
  }
  return null;
}

export type Tier = 'Rebuilding' | 'New' | 'Reliable' | 'Trusted';

export function tierFor(net: number): Tier {
  if (net < 0) return 'Rebuilding';
  if (net < 100) return 'New';
  if (net < 500) return 'Reliable';
  return 'Trusted';
}

/** The agreed time, or the start of the window if the host never set one. */
export function meetTime(rally: { meetAt: Date | null; windowStart: Date }): Date {
  return rally.meetAt ?? rally.windowStart;
}

/**
 * What a tap on "I'm here" earns. A window can run for hours, so lateness only counts against a time
 * the host actually set. A start-of-window default must never make everyone late.
 */
export function arrivalAction(
  rally: { meetAt: Date | null; windowStart: Date },
  arrivedAt: Date,
): 'OnTime' | 'Late' | null {
  const minutesLate = (arrivedAt.getTime() - meetTime(rally).getTime()) / 60_000;
  if (minutesLate <= ON_TIME_GRACE_MIN) return 'OnTime';
  if (rally.meetAt && minutesLate > LATE_AFTER_MIN) return 'Late';
  return null;
}
