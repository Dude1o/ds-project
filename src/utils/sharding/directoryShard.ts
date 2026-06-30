/**
 * Directory (lookup-table) sharding.
 * Distributed systems concept: an explicit `key → shardId` lookup table gives
 * full placement flexibility — any key can live on any shard, and shards can
 * be split or merged by editing the directory. The cost is a routing hop on
 * every access and a single point of failure in the directory itself.
 */
export class DirectoryShardRouter {
  private map: Map<string, string> = new Map();

  /** Assigns (or re-assigns) `key` to `shardId`. */
  assign(key: string, shardId: string): void {
    this.map.set(key, shardId);
  }

  /** Resolves `key` to its shardId, or `undefined` if unassigned. */
  resolve(key: string): string | undefined {
    return this.map.get(key);
  }

  /** Removes the assignment for `key` (no-op if not assigned). */
  unassign(key: string): void {
    this.map.delete(key);
  }

  /** Returns a plain-object shallow copy of the directory. */
  getDirectory(): Record<string, string> {
    const out: Record<string, string> = {};
    this.map.forEach((v, k) => {
      out[k] = v;
    });
    return out;
  }
}