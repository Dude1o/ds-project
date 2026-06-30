import type { ILoadBalancer, ServerNode } from '@/types';

/**
 * Round-Robin load balancer.
 * Distributed systems concept: the simplest fair-share algorithm — distribute
 * requests cyclically over healthy nodes. No weighting, no probing, no state
 * aside from a single counter.
 */
export class RoundRobinBalancer implements ILoadBalancer {
  private currentIndex = -1;
  private stats: Map<string, number> = new Map();

  pick(servers: ServerNode[]): ServerNode {
    const healthy = servers.filter((s) => s.healthy);
    if (healthy.length === 0) {
      throw new Error('RoundRobinBalancer: no healthy servers available.');
    }
    this.currentIndex = (this.currentIndex + 1) % healthy.length;
    const chosen = healthy[this.currentIndex]!;
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
    this.currentIndex = -1;
    this.stats.clear();
  }
}