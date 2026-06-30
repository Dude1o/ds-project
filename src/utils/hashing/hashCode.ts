/**
 * djb2 string hash function.
 * Distributed systems concept: a fast, well-distributed 32-bit hash is the
 * backbone of consistent hashing, hash-based sharding, and load-balancer ring
 * lookups. Returns an unsigned 32-bit integer so modulo arithmetic cannot go
 * negative.
 *
 * @param key - string to hash
 * @returns unsigned 32-bit hash value in [0, 2^32 - 1]
 */
export function hashCode(key: string): number {
  let hash = 5381;
  for (let i = 0; i < key.length; i++) {
    hash = ((hash << 5) + hash) + key.charCodeAt(i);
    hash = hash & 0xffffffff;
  }
  return hash >>> 0;
}