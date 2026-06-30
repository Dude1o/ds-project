import type { ILoadBalancer, ServerNode } from '@/types';
import { delay } from '@/utils/delay';

/**
 * Latency-Based load balancer.
 * Distributed systems concept: picks the healthy node with the lowest observed
 * latency, then continually refines latency estimates via probing using an
 * Exponential Weighted Moving Average (EWMA, α = 0.3) so the choice adapts to
 * changing network conditions rather than staying static.
 *
 * Probing fires for *every* healthy candidate after each pick, not just the
 * chosen one — otherwise the lowest-static-latency node would always be picked
 * and always be probed, starving all other nodes of measurement and pinning
 * the algorithm at "lowest static latency, always". Dedup via the `probing`
 * set prevents overlapping probes for the same node within a window.
 */
export class LatencyBasedBalancer implements ILoadBalancer {
  private stats: Map<string, number> = new Map();
  private probedLatency: Map<string, number> = new Map();
  private probing: Set<string> = new Set();

  pick(servers: ServerNode[], requestKey?: string): ServerNode {
    void requestKey;
    const healthy = servers.filter((s) => s.healthy);
    if (healthy.length === 0) {
      throw new Error('LatencyBasedBalancer: no healthy servers available.');
    }
    // Use probed EWMA latency when available, else the node's static latency.
    let best = healthy[0]!;
    let bestLatency = this.probedLatency.get(best.id) ?? best.latency;
    for (const s of healthy) {
      const lat = this.probedLatency.get(s.id) ?? s.latency;
      if (lat < bestLatency) {
        best = s;
        bestLatency = lat;
      }
    }
    this.stats.set(best.id, (this.stats.get(best.id) ?? 0) + 1);
    // Fire-and-forget probes for ALL healthy candidates so every node's EWMA
    // estimate stays fresh. This is critical: probing only the chosen node
    // would leave other nodes' estimates stuck at their static latency, which
    // (combined with always picking the minimum) degenerates the algorithm to
    // "lowest static latency, always". Dedup via `probing` prevents overlap.
    for (const s of healthy) {
      void this.probe(s);
    }
    return best;
  }

  /** Probes a node and blends the measured latency into the EWMA estimate. */
  private async probe(node: ServerNode): Promise<void> {
    if (this.probing.has(node.id)) return;
    this.probing.add(node.id);
    try {
      // Simulated RTT measurement: declared latency ± 20%. Using a clean
      // formula instead of Date.now()-based timing produces a smooth EWMA
      // that visibly converges in the dashboard rather than being dominated
      // by setTimeout-clamp noise. The `await delay` keeps the probe
      // non-blocking in wall-clock time so the dedup guard and `probing`
      // set remain meaningful.
      await delay(node.latency, true);
      const measured = node.latency * (0.8 + Math.random() * 0.4);
      const prev = this.probedLatency.get(node.id) ?? node.latency;
      const ALPHA = 0.3;
      const ewma = ALPHA * measured + (1 - ALPHA) * prev;
      this.probedLatency.set(node.id, ewma);
    } finally {
      // Unconditional cleanup so a thrown body cannot strand the id in
      // `probing` and silence future probes for that node.
      this.probing.delete(node.id);
    }
  }

  getStats(): Record<string, number> {
    const out: Record<string, number> = {};
    this.stats.forEach((v, k) => {
      out[k] = v;
    });
    return out;
  }

  /** Returns the current EWMA latency estimate per node. */
  getLatencyEstimates(): Record<string, number> {
    const out: Record<string, number> = {};
    this.probedLatency.forEach((v, k) => {
      out[k] = Math.round(v);
    });
    return out;
  }

  reset(): void {
    this.stats.clear();
    this.probedLatency.clear();
    this.probing.clear();
  }
}