import type { ILoadBalancer, LBStrategy, ServerNode } from '@/types';
import { ConsistentHashRing } from '@/utils/hashing/consistentHash';

/**
 * Consistent-Hash load balancer.
 * Distributed systems concept: maps a `requestKey` onto a consistent hash ring
 * populated with virtual nodes per real node. The same key always lands on the
 * same server, and adding or removing a node redistributes only the keys in
 * the affected arc of the ring — not the whole keyspace.
 */
export class ConsistentHashBalancer implements ILoadBalancer {
  private virtualNodes: number;
  private ring: ConsistentHashRing;
  private lastSignature = '';
  private stats: Map<string, number> = new Map();

  constructor(virtualNodes = 150) {
    this.virtualNodes = virtualNodes;
    this.ring = new ConsistentHashRing(virtualNodes);
  }

  /** Re-syncs the ring with the current healthy set (no-op if unchanged). */
  private sync(servers: ServerNode[]): ServerNode[] {
    const healthy = servers.filter((s) => s.healthy);
    const signature = healthy.map((s) => s.id).sort().join('|');
    if (signature !== this.lastSignature) {
      const prev = this.ring.getRingSnapshot().nodes;
      for (const id of prev) this.ring.removeNode(id);
      for (const s of healthy) this.ring.addNode(s.id);
      this.lastSignature = signature;
    }
    return healthy;
  }

  pick(servers: ServerNode[], requestKey?: string): ServerNode {
    const healthy = this.sync(servers);
    if (healthy.length === 0) {
      throw new Error('ConsistentHashBalancer: no healthy servers available.');
    }
    const key = requestKey ?? `req-${Date.now()}-${Math.random()}`;
    const nodeId = this.ring.getNode(key);
    const chosen = healthy.find((s) => s.id === nodeId) ?? healthy[0]!;
    this.stats.set(chosen.id, (this.stats.get(chosen.id) ?? 0) + 1);
    return chosen;
  }

  getStats(): Record<string, number> {
    const out: Record<string, number> = {};
    this.stats.forEach((v, k) => {
      out[k] = v;
    });
    return out;
  }

  reset(): void {
    this.ring = new ConsistentHashRing(this.virtualNodes);
    this.lastSignature = '';
    this.stats.clear();
  }

  /** Returns the ring snapshot for visualisation. */
  getRing(): ConsistentHashRing {
    return this.ring;
  }

  /** The active strategy identifier. */
  get strategy(): LBStrategy {
    return 'consistentHash';
  }
}