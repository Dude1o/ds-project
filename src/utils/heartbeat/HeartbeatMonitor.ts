import type { HeartbeatEntry, HeartbeatStatus, HeartbeatTransition } from '@/types';
import { ServerRegistry } from './ServerRegistry';

type StatusChangeCallback = (entry: HeartbeatEntry) => void;
type TransitionCallback = (t: HeartbeatTransition) => void;

/**
 * Heartbeat-based failure detector.
 * Distributed systems concept: each node periodically reports a heartbeat;
 * the monitor measures elapsed time per node and computes `missedBeats =
 * floor(elapsed / interval)`. Crossing `suspectThreshold` transitions the
 * node to SUSPECTED (soft-failure); crossing `deadThreshold` marks it DEAD.
 *
 * Crucially, the monitor auto-renews heartbeats for every node *except* those
 * explicitly placed in the `crashedNodes` set via `simulateCrash()`. This
 * means the detector watches for the *absence* of beats — only crashed nodes
 * accumulate missedBeats and progress through ALIVE → SUSPECTED → DEAD.
 */
export class HeartbeatMonitor {
  private registry: ServerRegistry;
  private intervalMs: number;
  private suspectThreshold: number;
  private deadThreshold: number;
  private timer: ReturnType<typeof setInterval> | null = null;
  private crashedNodes: Set<string> = new Set();
  private statusChangeCallbacks: StatusChangeCallback[] = [];
  private transitionCallbacks: TransitionCallback[] = [];
  private transitionHistory: HeartbeatTransition[] = [];

  constructor(
    registry: ServerRegistry,
    intervalMs: number,
    suspectThreshold: number,
    deadThreshold: number,
  ) {
    this.registry = registry;
    this.intervalMs = intervalMs;
    this.suspectThreshold = suspectThreshold;
    this.deadThreshold = deadThreshold;
  }

  /** Begins the periodic tick. Idempotent. */
  start(): void {
    if (this.timer !== null) return;
    this.timer = setInterval(() => this.tick(), this.intervalMs);
  }

  /** Stops the periodic tick. Idempotent. */
  stop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** Marks `nodeId` as crashed: subsequent ticks will stop renewing its beat. */
  simulateCrash(nodeId: string): void {
    this.crashedNodes.add(nodeId);
  }

  /** Whether `nodeId` is currently in the crashed set. */
  isCrashed(nodeId: string): boolean {
    return this.crashedNodes.has(nodeId);
  }

  /** Restores `nodeId` by emitting a fresh beat and removing it from the crash set. */
  simulateBeat(nodeId: string): void {
    this.crashedNodes.delete(nodeId);
    this.registry.recordBeat(nodeId);
    const entry = this.registry.get(nodeId);
    if (entry && entry.status !== 'ALIVE') {
      this.applyStatus(nodeId, 'ALIVE', 0);
    }
  }

  /** Alias of simulateBeat — semantically "un-crash and revive". */
  restore(nodeId: string): void {
    this.simulateBeat(nodeId);
  }

  /** Subscribes to per-node status changes. Returns an unsubscribe function. */
  onStatusChange(cb: StatusChangeCallback): () => void {
    this.statusChangeCallbacks.push(cb);
    return () => {
      const idx = this.statusChangeCallbacks.indexOf(cb);
      if (idx >= 0) this.statusChangeCallbacks.splice(idx, 1);
    };
  }

  /** Subscribes to recorded transitions (ALIVE→SUSPECTED, etc). */
  onTransition(cb: TransitionCallback): () => void {
    this.transitionCallbacks.push(cb);
    return () => {
      const idx = this.transitionCallbacks.indexOf(cb);
      if (idx >= 0) this.transitionCallbacks.splice(idx, 1);
    };
  }

  /** Returns the recorded transition timeline (most-recent-first). */
  getTransitions(): HeartbeatTransition[] {
    return [...this.transitionHistory].reverse();
  }

  /** One tick — evaluates every registered node's liveness. */
  private tick(): void {
    const now = Date.now();
    for (const entry of this.registry.getAll()) {
      if (!this.crashedNodes.has(entry.nodeId)) {
        this.registry.recordBeat(entry.nodeId);
      }
      const elapsed = now - entry.lastSeen;
      const missedBeats = Math.floor(elapsed / this.intervalMs);
      let nextStatus: HeartbeatStatus = entry.status;
      if (missedBeats >= this.deadThreshold) {
        nextStatus = 'DEAD';
      } else if (missedBeats >= this.suspectThreshold) {
        nextStatus = 'SUSPECTED';
      } else {
        nextStatus = 'ALIVE';
      }
      if (nextStatus !== entry.status) {
        this.applyStatus(entry.nodeId, nextStatus, missedBeats);
      } else {
        this.registry.setStatus(entry.nodeId, entry.status, missedBeats);
      }
    }
  }

  /** Records a transition, updates the registry, and fires callbacks. */
  private applyStatus(nodeId: string, status: HeartbeatStatus, missedBeats: number): void {
    const entry = this.registry.get(nodeId);
    const from = entry?.status ?? 'DEAD';
    this.registry.setStatus(nodeId, status, missedBeats);
    const tr: HeartbeatTransition = {
      timestamp: Date.now(),
      nodeId,
      from,
      to: status,
    };
    this.transitionHistory.push(tr);
    if (this.transitionHistory.length > 50) this.transitionHistory.shift();
    for (const cb of this.transitionCallbacks) cb(tr);
    if (entry) {
      for (const cb of this.statusChangeCallbacks) cb({ ...entry, status, missedBeats });
    }
  }
}