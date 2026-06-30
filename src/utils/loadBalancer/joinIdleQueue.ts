import type { ILoadBalancer, ServerNode } from '@/types';

type WarningCallback = (nodeId: string, ageMs: number) => void;

/**
 * Join-Idle-Queue load balancer.
 * Distributed systems concept: models a worker-pool / thread-queue pattern — idle
 * servers wait in a FIFO queue; an arriving request dequeues the first idle worker,
 * which is re-enqueued only once it finishes. This keeps utilisation balanced and
 * avoids handing work to already-busy nodes.
 *
 * Defensive hardening: every `pick()` stamps the chosen worker with an in-flight
 * start time, and a reaper `setInterval` (default 5s check / 30s threshold) reclaims
 * any worker whose `onRequestEnd` was never called (caller crash, dropped error,
 * forgotten callback). Without the reaper, a single leaked request would silently
 * shrink the worker pool until the balancer degenerated to the least-connections
 * fallback. The `execute()` wrapper below is the preferred pattern: it guarantees
 * `onRequestEnd` runs in a `finally` even when the caller's work throws.
 */
export class JoinIdleQueueBalancer implements ILoadBalancer {
  private idleQueue: string[] = [];
  private busySet: Set<string> = new Set();
  /** nodeId → wall-clock timestamp when the worker was marked busy. */
  private inFlightSince: Map<string, number> = new Map();
  private lastSignature = '';
  private stats: Map<string, number> = new Map();
  private warningCallbacks: WarningCallback[] = [];

  private readonly reaperIntervalMs: number;
  private readonly maxInFlightMs: number;
  private reaperTimer: ReturnType<typeof setInterval> | null = null;

  constructor(reaperIntervalMs = 5000, maxInFlightMs = 30000) {
    this.reaperIntervalMs = reaperIntervalMs;
    this.maxInFlightMs = maxInFlightMs;
  }

  /** Rebuilds the idle queue when the healthy server set changes. */
  private sync(servers: ServerNode[]): ServerNode[] {
    const healthy = servers.filter((s) => s.healthy);
    const signature = healthy.map((s) => s.id).sort().join('|');
    if (signature !== this.lastSignature) {
      // Keep already-busy nodes out of the freshly rebuilt idle queue.
      this.idleQueue = healthy.filter((s) => !this.busySet.has(s.id)).map((s) => s.id);
      this.lastSignature = signature;
    }
    return healthy;
  }

  pick(servers: ServerNode[]): ServerNode {
    this.ensureReaper();
    const healthy = this.sync(servers);
    if (healthy.length === 0) {
      throw new Error('JoinIdleQueueBalancer: no healthy servers available.');
    }
    if (this.idleQueue.length === 0) {
      // All workers busy: refill the queue from currently idle (non-busy) nodes.
      this.idleQueue = healthy.filter((s) => !this.busySet.has(s.id)).map((s) => s.id);
    }
    if (this.idleQueue.length === 0) {
      // Truly everything busy — fall back to least-busy healthy node.
      let best = healthy[0]!;
      for (const s of healthy) {
        if (s.connections < best.connections) best = s;
      }
      this.stats.set(best.id, (this.stats.get(best.id) ?? 0) + 1);
      return best;
    }
    const id = this.idleQueue.shift()!;
    this.busySet.add(id);
    this.inFlightSince.set(id, Date.now());
    const chosen = healthy.find((s) => s.id === id)!;
    this.stats.set(chosen.id, (this.stats.get(chosen.id) ?? 0) + 1);
    return chosen;
  }

  /** Marks a node finished and re-enqueues it as idle. */
  onRequestEnd(nodeId: string): void {
    if (this.busySet.delete(nodeId)) {
      this.inFlightSince.delete(nodeId);
      if (!this.idleQueue.includes(nodeId)) this.idleQueue.push(nodeId);
    }
  }

  /**
   * Preferred execution wrapper. Picks a server, runs `fn`, and guarantees
   * `onRequestEnd` is invoked in a `finally` so a thrown `fn` cannot leak the
   * worker from the pool. Returns whatever `fn` returns (or rethrows its error
   * after cleanup). Callers that use this do not need to call `onRequestEnd`
   * themselves.
   */
  async execute<T>(servers: ServerNode[], fn: (node: ServerNode) => Promise<T>): Promise<T> {
    const node = this.pick(servers);
    try {
      return await fn(node);
    } finally {
      this.onRequestEnd(node.id);
    }
  }

  /** Subscribes to reaper warnings (fires when a worker exceeds `maxInFlightMs`). */
  onWarning(cb: WarningCallback): void {
    this.warningCallbacks.push(cb);
  }

  /** Lazily starts the reaper; idempotent. */
  private ensureReaper(): void {
    if (this.reaperTimer !== null) return;
    this.reaperTimer = setInterval(() => this.reap(), this.reaperIntervalMs);
    if (typeof this.reaperTimer.unref === 'function') this.reaperTimer.unref();
  }

  /** Reclaims workers that have been in flight longer than `maxInFlightMs`. */
  private reap(): void {
    const now = Date.now();
    for (const [id, since] of this.inFlightSince) {
      const age = now - since;
      if (age > this.maxInFlightMs) {
        this.busySet.delete(id);
        this.inFlightSince.delete(id);
        if (!this.idleQueue.includes(id)) this.idleQueue.push(id);
        for (const cb of this.warningCallbacks) cb(id, age);
      }
    }
  }

  getStats(): Record<string, number> {
    const out: Record<string, number> = {};
    this.stats.forEach((v, k) => {
      out[k] = v;
    });
    return out;
  }

  reset(): void {
    this.idleQueue = [];
    this.busySet.clear();
    this.inFlightSince.clear();
    this.lastSignature = '';
    this.stats.clear();
    if (this.reaperTimer !== null) {
      clearInterval(this.reaperTimer);
      this.reaperTimer = null;
    }
  }

  /** Stops the reaper timer (called by reset(); safe to call directly too). */
  dispose(): void {
    if (this.reaperTimer !== null) {
      clearInterval(this.reaperTimer);
      this.reaperTimer = null;
    }
  }
}