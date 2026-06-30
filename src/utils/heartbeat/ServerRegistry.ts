import type { HeartbeatEntry, HeartbeatStatus } from '@/types';

/**
 * Authoritative membership view for the simulated cluster.
 * Distributed systems concept: the registry is the source of truth for which
 * nodes exist and what their current liveness status is. `HeartbeatMonitor`
 * reads and mutates these entries as beats arrive or are missed.
 *
 * All lookups are O(1) Map operations.
 */
export class ServerRegistry {
  private nodes: Map<string, HeartbeatEntry> = new Map();

  /** Registers a new node if not already known (idempotent by-nodeId). */
  register(nodeId: string): void {
    if (this.nodes.has(nodeId)) return;
    this.nodes.set(nodeId, {
      nodeId,
      status: 'ALIVE',
      lastSeen: Date.now(),
      missedBeats: 0,
    });
  }

  /** Records a fresh heartbeat beat for `nodeId`, resetting its missed counter. */
  recordBeat(nodeId: string): void {
    const entry = this.nodes.get(nodeId);
    if (!entry) return;
    entry.lastSeen = Date.now();
    entry.missedBeats = 0;
  }

  /** Returns a snapshot array of every registered entry (live references). */
  getAll(): HeartbeatEntry[] {
    return Array.from(this.nodes.values());
  }

  /** Returns the status of `nodeId`, or `DEAD` for unknown nodes (O(1)). */
  getStatus(nodeId: string): HeartbeatStatus {
    return this.nodes.get(nodeId)?.status ?? 'DEAD';
  }

  /** Updates the status and missed-beats counter for `nodeId` in place (O(1)). */
  setStatus(nodeId: string, status: HeartbeatStatus, missedBeats: number): void {
    const entry = this.nodes.get(nodeId);
    if (!entry) return;
    entry.status = status;
    entry.missedBeats = missedBeats;
  }

  /** Returns the live entry for `nodeId`, or undefined (O(1)). */
  get(nodeId: string): HeartbeatEntry | undefined {
    return this.nodes.get(nodeId);
  }

  /** Returns true if `nodeId` is registered. */
  has(nodeId: string): boolean {
    return this.nodes.has(nodeId);
  }
}