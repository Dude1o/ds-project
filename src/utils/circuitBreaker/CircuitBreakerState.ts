import type { CBState } from '@/types';

/**
 * Circuit Breaker transition event.
 * Distributed systems concept: the breaker is driven by exactly two events —
 * `onSuccess` (a call resolved) and `onFailure` (a call rejected/errored).
 * `onTimeoutElapsed` is a synthetic event fired by the wrapper when the
 * cool-down timeout has expired, allowing the FSM to drive itself toward
 * HALF_OPEN without manually polling time.
 */
export type CBEvent =
  | { type: 'onSuccess' }
  | { type: 'onFailure' }
  | { type: 'onTimeoutElapsed' };

/** Configurable thresholds supplied to the pure transition function. */
export interface CBTransitionInput {
  current: CBState;
  event: CBEvent;
  failures: number;
  successes: number;
  failureThreshold: number;
  successThreshold: number;
}

/** Result of advancing the FSM by one event. The function is pure: it reads no
 * external state and returns a fresh result object. */
export interface CBTransitionResult {
  state: CBState;
  failures: number;
  successes: number;
  /** True iff the FSM transitioned to a different state on this event. */
  changed: boolean;
  /** Human-readable explanation of what happened. */
  reason: string;
}

/**
 * Pure finite-state machine for the circuit breaker.
 * Distributed systems concept: a 3-state FSM — CLOSED ↔ OPEN ↔ HALF_OPEN — that
 * trips OPEN after `failureThreshold` consecutive failures and closes again once
 * `successThreshold` probes succeed in HALF_OPEN. The function is pure: given
 * (state, event, counters, thresholds) it returns the next state and counters
 * with no side effects, making it trivially testable in isolation from the
 * wrapper that drives it.
 *
 * Transition rules:
 *   CLOSED   + onFailure  + failures+1 < failureThreshold → CLOSED (failures++)
 *   CLOSED   + onFailure  + failures+1 >= failureThreshold → OPEN  (changed)
 *   CLOSED   + onSuccess                                  → CLOSED (failures=0, successes++)
 *   OPEN     + onTimeoutElapsed                           → HALF_OPEN (changed)
 *   OPEN     + onSuccess/onFailure  (timeout not elapsed) → OPEN  (no-op)
 *   HALF_OPEN + onSuccess + successes+1 < successThreshold → HALF_OPEN (successes++)
 *   HALF_OPEN + onSuccess + successes+1 >= successThreshold → CLOSED (changed)
 *   HALF_OPEN + onFailure                              → OPEN   (changed)
 */
export function transition(input: CBTransitionInput): CBTransitionResult {
  const { current, event, failures, successes, failureThreshold, successThreshold } = input;

  if (current === 'CLOSED') {
    if (event.type === 'onFailure') {
      const f = failures + 1;
      if (f >= failureThreshold) {
        return { state: 'OPEN', failures: f, successes: 0, changed: true, reason: `failures (${f}) reached threshold (${failureThreshold})` };
      }
      return { state: 'CLOSED', failures: f, successes: 0, changed: false, reason: 'failure recorded' };
    }
    // onSuccess in CLOSED
    return { state: 'CLOSED', failures: 0, successes: successes + 1, changed: false, reason: 'success recorded' };
  }

  if (current === 'OPEN') {
    if (event.type === 'onTimeoutElapsed') {
      return { state: 'HALF_OPEN', failures, successes: 0, changed: true, reason: 'cool-down elapsed — probing' };
    }
    // Any other event while OPEN is a no-op (the wrapper should have fail-fasted).
    return { state: 'OPEN', failures, successes, changed: false, reason: 'still OPEN — cool-down not elapsed' };
  }

  // current === 'HALF_OPEN'
  if (event.type === 'onSuccess') {
    const s = successes + 1;
    if (s >= successThreshold) {
      return { state: 'CLOSED', failures: 0, successes: 0, changed: true, reason: `probes (${s}) reached success threshold (${successThreshold})` };
    }
    return { state: 'HALF_OPEN', failures: 0, successes: s, changed: false, reason: 'probe succeeded' };
  }
  // onFailure in HALF_OPEN — re-open immediately, regardless of count.
  return { state: 'OPEN', failures: failures + 1, successes: 0, changed: true, reason: 'probe failed, re-opening circuit' };
}

/** Re-exported enum for callers that want named state constants. */
export const CircuitBreakerState = {
  CLOSED: 'CLOSED' as const,
  OPEN: 'OPEN' as const,
  HALF_OPEN: 'HALF_OPEN' as const,
};