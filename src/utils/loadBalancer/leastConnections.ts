import type { ILoadBalancer, ServerNode } from '@/types';

/**
 * Least-Connections load balancer.
 * Distributed systems concept: routes each request to the healthy node with
 * the fewest in-flight connections, adapting to live load rather than static
 * capacity. Accurate counters require explicit `onRequestStart` / `onRequestEnd`
 * lifecycle calls from the caller; failing to balance those calls leaks a
 * connection on a node and silently skews future picks.
 */
export class LeastConnectionsBalancer implements ILoadBalancer {
  private stats: Map<string, number> = new Map();

  pick(servers: ServerNode[]): ServerNode {
    const healthy = servers.filter((s) => s.healthy);
    if (healthy.length === 0) {
      throw new Error('LeastConnectionsBalancer: no healthy servers available.');
    }
    let best = healthy[0]!;
    for (const s of healthy) {
      if (s.connections < best.connections) best = s;
    }
    this.stats.set(best.id, (this.stats.get(best.id) ?? 0) + 1);
    return best;
  }

  /** Increments the in-flight connection counter for `nodeId` (call before work). */
  onRequestStart(nodeId: string, servers: ServerNode[]): void {
    const node = servers.find((s) => s.id === nodeId);
    if (node) node.connections += 1;
  }

  /** Decrements the in-flight connection counter for `nodeId` (call after work). */
  onRequestEnd(nodeId: string, servers: ServerNode[]): void {
    const node = servers.find((s) => s.id === nodeId);
    if (node && node.connections > 0) node.connections -= 1;
  }

  getStats(): Record<string, number> {
    const out: Record<string, number> = {};
    this.stats.forEach((v, k) => {
      out[k] = v;
    });
    return out;
  }

  reset(): void {
    this.stats.clear();
  }
}