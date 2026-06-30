import type { CBConfig, CBState, CBSnapshot, CBTransition } from '@/types';
import { CircuitBreakerState, transition, type CBEvent } from './CircuitBreakerState';

type StateChangeCallback = (snap: CBSnapshot) => void;
type TransitionCallback = (t: CBTransition) => void;

/**
 * Circuit Breaker wrapper around an async operation.
 * Distributed systems concept: trips OPEN after `failureThreshold` consecutive
 * failures to fail-fast and protect downstream services, auto-probes HALF_OPEN
 * after a cool-down, and closes again once enough probes succeed.
 */
export class CircuitBreaker {
  readonly name: string;
  private config: CBConfig;
  private state: CBState = 'CLOSED';
  private failures = 0;
  private successes = 0;
  private lastStateChange: number;
  private stateChangeCallbacks: StateChangeCallback[] = [];
  private transitionCallbacks: TransitionCallback[] = [];
  private transitionHistory: CBTransition[] = [];
  private openSince: number | null = null;
  private halfOpenProbeInFlight = false;

  constructor(name: string, config: CBConfig) {
    this.name = name;
    this.config = config;
    this.lastStateChange = Date.now();
  }

  /** Executes `fn` through the circuit breaker, enforcing fail-fast semantics. */
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state === 'OPEN') {
      if (this.openSince !== null && Date.now() - this.openSince >= this.config.timeout) {
        this.applyEvent({ type: 'onTimeoutElapsed' }, 'cool-down elapsed');
      } else {
        throw new Error(`CircuitBreaker[${this.name}] is OPEN — request rejected (fail-fast).`);
      }
    }

    if (this.state === 'HALF_OPEN') {
      if (this.halfOpenProbeInFlight) {
        throw new Error(`CircuitBreaker[${this.name}] is HALF_OPEN — probe already in flight, request rejected.`);
      }
      this.halfOpenProbeInFlight = true;
    }

    try {
      const result = await fn();
      this.applyEvent({ type: 'onSuccess' }, 'call succeeded');
      return result;
    } catch (err) {
      this.applyEvent({ type: 'onFailure' }, 'call failed');
      throw err;
    } finally {
      // Clear the probe-in-flight flag unconditionally. The flag exists only to
      // serialize a single probe within one execute() window; it must not
      // persist across separate execute() calls, otherwise a HALF_OPEN state
      // that requires successThreshold > 1 probes would deadlock the breaker
      // after the first probe (the FSM keeps the breaker in HALF_OPEN with
      // changed:false while accumulating successes).
      this.halfOpenProbeInFlight = false;
    }
  }

  /** Applies an event through the pure transition function and emits callbacks. */
  private applyEvent(event: CBEvent, reason: string): void {
    const result = transition({
      current: this.state,
      event,
      failures: this.failures,
      successes: this.successes,
      failureThreshold: this.config.failureThreshold,
      successThreshold: this.config.successThreshold,
    });
    this.failures = result.failures;
    this.successes = result.successes;
    if (result.changed) {
      this.emitTransition(this.state, result.state, result.reason);
    } else {
      // Counter-only update still notifies snapshot subscribers.
      this.notifyState();
    }
    void reason;
  }

  /** Records a transition in history and notifies all subscribers. */
  private emitTransition(from: CBState, to: CBState, reason: string): void {
    this.state = to;
    this.lastStateChange = Date.now();
    if (to === 'OPEN') this.openSince = Date.now();
    else if (to === 'CLOSED') this.openSince = null;
    const tr: CBTransition = { timestamp: this.lastStateChange, from, to, reason };
    this.transitionHistory.push(tr);
    if (this.transitionHistory.length > 50) this.transitionHistory.shift();
    for (const cb of this.transitionCallbacks) cb(tr);
    this.notifyState();
  }

  private notifyState(): void {
    const snap = this.getSnapshot();
    for (const cb of this.stateChangeCallbacks) cb(snap);
  }

  /** Returns the breaker's current configuration (thresholds/timeout). */
  getConfig(): CBConfig {
    return { ...this.config };
  }

  /** Returns an immutable point-in-time snapshot. */
  getSnapshot(): CBSnapshot {
    return {
      state: this.state,
      failures: this.failures,
      successes: this.successes,
      lastStateChange: this.lastStateChange,
    };
  }

  /** Returns the recorded transition timeline (most-recent-first). */
  getTransitions(): CBTransition[] {
    return [...this.transitionHistory].reverse();
  }

  /** Subscribes to snapshot changes (state and counters). */
  on(event: 'stateChange', cb: StateChangeCallback): void;
  on(event: 'transition', cb: TransitionCallback): void;
  on(event: 'stateChange' | 'transition', cb: StateChangeCallback | TransitionCallback): void {
    if (event === 'stateChange') this.stateChangeCallbacks.push(cb as StateChangeCallback);
    else this.transitionCallbacks.push(cb as TransitionCallback);
  }

  /** Removes a previously-registered callback (mirror of `on` for clean teardown). */
  off(event: 'stateChange' | 'transition', cb: StateChangeCallback | TransitionCallback): void {
    if (event === 'stateChange') {
      this.stateChangeCallbacks = this.stateChangeCallbacks.filter((c) => c !== cb);
    } else {
      this.transitionCallbacks = this.transitionCallbacks.filter((c) => c !== cb);
    }
  }

  /** Forces the breaker back to CLOSED, clearing counters (used by the Reset button). */
  reset(): void {
    const prev = this.state;
    this.failures = 0;
    this.successes = 0;
    this.openSince = null;
    this.halfOpenProbeInFlight = false;
    if (prev !== 'CLOSED') {
      this.emitTransition(prev, 'CLOSED', 'manual reset');
    } else {
      this.lastStateChange = Date.now();
      this.notifyState();
    }
  }

  /** Exposes the enum for callers that want to compare against named states. */
  static State = CircuitBreakerState;
}