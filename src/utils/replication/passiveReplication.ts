import type { ReplicaNode } from '@/types';
import { delay } from '@/utils/delay';
import type { WALManager } from './WALManager';

type ReplicaUpdateCallback = (replica: ReplicaNode) => void;

/**
 * Passive (lazy) replication manager.
 * Distributed systems concept: the primary commits writes locally and replicas
 * pull new WAL entries asynchronously on a polling interval. Lower write latency
 * and eventual consistency, at the cost of replica lag and a brief divergence
 * window.
 */
export class PassiveReplicationManager {
  private wal: WALManager;
  private replicas: ReplicaNode[];
  private pollIntervalMs: number;
  private timer: ReturnType<typeof setInterval> | null = null;
  private updateCallbacks: ReplicaUpdateCallback[] = [];
  private inFlight: Set<string> = new Set();

  constructor(wal: WALManager, replicas: ReplicaNode[], pollIntervalMs: number) {
    this.wal = wal;
    this.replicas = replicas;
    this.pollIntervalMs = pollIntervalMs;
  }

  /** Begins polling for new WAL entries on each replica. */
  start(): void {
    if (this.timer !== null) return;
    this.timer = setInterval(() => {
      void this.pollAll();
    }, this.pollIntervalMs);
  }

  /** Stops polling. */
  stop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** Subscribes to per-replica progress updates (used by the live UI). */
  onUpdate(cb: ReplicaUpdateCallback): void {
    this.updateCallbacks.push(cb);
  }

  /** Returns a snapshot of the current replica state. */
  getReplicaState(): ReplicaNode[] {
    return this.replicas.map((r) => ({ ...r }));
  }

  /** Triggers one replication poll cycle across all replicas concurrently. */
  private async pollAll(): Promise<void> {
    await Promise.all(this.replicas.map((replica) => this.pollOne(replica)));

    const minLastLSN = this.replicas.reduce((m, r) => Math.min(m, r.lastLSN), Infinity);
    if (Number.isFinite(minLastLSN)) {
      for (const entry of this.wal.getUnflushed()) {
        if (entry.lsn <= minLastLSN) this.wal.markApplied(entry.lsn);
      }
    }
  }

  private async pollOne(replica: ReplicaNode): Promise<void> {
    if (this.inFlight.has(replica.id)) return;
    this.inFlight.add(replica.id);
    // try/finally guarantees the in-flight guard is released even if the
    // callback at line below (or any await between add and delete) throws.
    // Without this, a single thrown callback would wedge this replica.id in
    // `inFlight` permanently — every future pollOne would early-return and
    // the replica would silently diverge from the primary with no recovery.
    try {
      const pending = this.wal.getSince(replica.lastLSN);
      for (const entry of pending) {
        await delay(replica.lag, true);
        replica.lastLSN = entry.lsn;
        for (const cb of this.updateCallbacks) cb({ ...replica });
      }
    } finally {
      this.inFlight.delete(replica.id);
    }
  }
}