import { hashCode } from '@/utils/hashing/hashCode';

/**
 * Hash-based sharding.
 * Distributed systems concept: `hashCode(key) % shardCount` gives a
 * deterministic, even, location-independent key spread with no central router
 * state. The trade-off is that adding/removing a shard reshuffles nearly every
 * key — the limitation consistent hashing addresses for load balancing.
 *
 * @param key - partitioning key
 * @param shardCount - number of shards in the keyspace
 * @returns the shard index in [0, shardCount - 1]
 */
export function getHashShard(key: string, shardCount: number): number {
  if (shardCount <= 0) throw new Error('getHashShard: shardCount must be positive.');
  return hashCode(key) % shardCount;
}