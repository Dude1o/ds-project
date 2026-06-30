import type { ILoadBalancer, ServerNode } from '@/types';

/**
 * Weighted Round-Robin load balancer.
 * Distributed systems concept: each node is expanded into `weight` virtual
 * slots in a rotation array. Higher-weight nodes occupy proportionally more
 * slots and therefore receive proportionally more traffic. The rotation is
 * rebuilt lazily when the healthy set or any weight changes (detected via a
 * sorted "id:weight" signature).
 */
export class WeightedRoundRobinBalancer implements ILoadBalancer {
  private rotation: string[] = [];
  private cursor = 0;
  private lastSignature = '';
  private stats: Map<string, number> = new Map();

  /** Rebuilds the rotation array if the healthy set or weights have changed. */
  private rebuild(servers: ServerNode[]): ServerNode[] {
    const healthy = servers.filter((s) => s.healthy);
    const signature = healthy.map((s) => `${s.id}:${s.weight}`).sort().join('|');
    if (signature !== this.lastSignature) {
      this.rotation = [];
      for (const s of healthy) {
        const w = Math.max(1, Math.round(s.weight));
        for (let i = 0; i < w; i++) this.rotation.push(s.id);
      }
      this.cursor = 0;
      this.lastSignature = signature;
    }
    return healthy;
  }

  pick(servers: ServerNode[]): ServerNode {
    const healthy = this.rebuild(servers);
    if (this.rotation.length === 0) {
      throw new Error('WeightedRoundRobinBalancer: no healthy servers available.');
    }
    const id = this.rotation[this.cursor % this.rotation.length]!;
    this.cursor = (this.cursor + 1) % this.rotation.length;
    const chosen = healthy.find((s) => s.id === id)!;
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
    this.rotation = [];
    this.cursor = 0;
    this.lastSignature = '';
    this.stats.clear();
  }
}