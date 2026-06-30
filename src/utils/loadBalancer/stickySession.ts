import type { ILoadBalancer, ServerNode } from '@/types';

/**
 * Sticky-Session load balancer.
 * Distributed systems concept: session affinity — the same request key (e.g.
 * session id) routes to the same backend node for the lifetime of that session.
 * If the pinned node becomes unhealthy, the balancer falls back to a
 * round-robin pick and re-pins the session to the new node.
 */
export class StickySessionBalancer implements ILoadBalancer {
  private sessionMap: Map<string, string> = new Map();
  private rrIndex = -1;
  private stats: Map<string, number> = new Map();

  pick(servers: ServerNode[], requestKey?: string): ServerNode {
    const healthy = servers.filter((s) => s.healthy);
    if (healthy.length === 0) {
      throw new Error('StickySessionBalancer: no healthy servers available.');
    }

    if (requestKey) {
      const pinnedId = this.sessionMap.get(requestKey);
      if (pinnedId) {
        const pinned = healthy.find((s) => s.id === pinnedId);
        if (pinned) {
          this.stats.set(pinned.id, (this.stats.get(pinned.id) ?? 0) + 1);
          return pinned;
        }
        // Pinned node is gone/unhealthy — re-pin via round-robin below.
      }
      const chosen = this.roundRobinPick(healthy);
      this.sessionMap.set(requestKey, chosen.id);
      this.stats.set(chosen.id, (this.stats.get(chosen.id) ?? 0) + 1);
      return chosen;
    }

    // No session key: behave like plain round-robin.
    const chosen = this.roundRobinPick(healthy);
    this.stats.set(chosen.id, (this.stats.get(chosen.id) ?? 0) + 1);
    return chosen;
  }

  private roundRobinPick(healthy: ServerNode[]): ServerNode {
    this.rrIndex = (this.rrIndex + 1) % healthy.length;
    return healthy[this.rrIndex]!;
  }

  getStats(): Record<string, number> {
    const out: Record<string, number> = {};
    this.stats.forEach((v, k) => {
      out[k] = v;
    });
    return out;
  }

  reset(): void {
    this.sessionMap.clear();
    this.rrIndex = -1;
    this.stats.clear();
  }
}