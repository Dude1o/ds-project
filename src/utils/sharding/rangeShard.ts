/**
 * A contiguous numeric partition owned by a single shard.
 * Distributed systems concept: range sharding maps contiguous key ranges to
 * shards. Efficient for range queries (e.g. "give me all ids between 1000 and
 * 1999") but prone to hotspots if workload skews toward one end of the range.
 */
export interface RangePartition {
  shardId: string;
  /** Inclusive lower bound of the partition. */
  min: number;
  /** Inclusive upper bound of the partition. */
  max: number;
}

/**
 * Range-based sharding.
 * Distributed systems concept: each partition owns a contiguous numeric range
 * [min, max]. The function linearly scans the partitions to find the one
 * containing the supplied value. Throws on out-of-range values — surfacing the
 * requirement that the directory of partitions must cover the entire keyspace,
 * with **no default route** for un-covered values.
 *
 * @param value - numeric key to assign
 * @param partitions - non-empty array of contiguous range partitions
 * @returns the shardId owning the value
 */
export function getRangeShard(value: number, partitions: RangePartition[]): string {
  for (const p of partitions) {
    if (value >= p.min && value <= p.max) return p.shardId;
  }
  throw new Error(`getRangeShard: no partition covers value ${value}.`);
}