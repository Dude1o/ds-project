import type { ReplicaNode, WALEntry } from '@/types';
import { delay } from '@/utils/delay';
import type { WALManager } from './WALManager';

/**
 * Per-replica serialization queues, keyed by `replica.id`.
 * Distributed systems concept: active replication requires every replica to
 * apply writes in *issuance order*. Because `delay()` carries jitter, concurrent
 * `activeReplicate()` calls would otherwise race on `replica.lastLSN` — two
 * writes (e1 then e2) could land out of order on a single replica, violating the
 * ordering guarantee that defines active replication.
 *
 * This map holds a Promise chain per replica.id. Each new write chains onto the
 * previous tail for that replica, so writes to the *same* replica are applied
 * sequentially, while *different* replicas still progress concurrently via the
 * outer `Promise.all` (the slowest replica still governs overall latency).
 */
const replicaQueues: Map<string, Promise<void>> = new Map();

/**
 * Active (eager) replication.
 * Distributed systems concept: a write is considered durable only once it has
 * been synchronously applied to *all* replicas. Strong consistency at the cost
 * of latency — the write completes when the slowest replica acknowledges.
 *
 * Per-replica writes are serialized via `replicaQueues` so that the
 * `lastLSN` of each replica advances in issuance order regardless of jitter.
 *
 * @param wal - the primary's WAL manager (entry already appended by caller)
 * @param replicas - replica nodes to apply the entry to
 * @param entry - the WAL entry being replicated
 */
export async function activeReplicate(
  wal: WALManager,
  replicas: ReplicaNode[],
  entry: WALEntry,
): Promise<void> {
  // Prune queue entries for replicas no longer in the set (handles membership
  // changes between calls so the map cannot grow unbounded on id churn).
  const liveIds = new Set(replicas.map((r) => r.id));
  for (const id of replicaQueues.keys()) {
    if (!liveIds.has(id)) replicaQueues.delete(id);
  }

  // Each replica gets a per-id Promise chain. `next` resolves when THIS entry
  // has been applied (in order); `stored` is the swallow-rejected tail kept in
  // the map so a failed write cannot poison the chain for subsequent writes.
  // `Promise.all` awaits `next` (not `stored`) so that a real apply failure
  // propagates to the caller and `markApplied` is correctly skipped.
  await Promise.all(
    replicas.map((replica) => {
      const prev = replicaQueues.get(replica.id) ?? Promise.resolve();
      const next = prev.then(() => applyToReplica(replica, entry));
      const stored = next.catch(() => {
        /* swallow: keep the chain alive for future writes even if this one failed */
      });
      replicaQueues.set(replica.id, stored);
      return next;
    }),
  );
  wal.markApplied(entry.lsn);
}

/** Applies a single WAL entry to a replica, honouring its simulated lag. */
async function applyToReplica(replica: ReplicaNode, entry: WALEntry): Promise<void> {
  await delay(replica.lag, true);
  replica.lastLSN = entry.lsn;
}

/** Resets all per-replica serialization queues (used by the UI's reset button). */
export function resetActiveReplicationQueues(): void {
  replicaQueues.clear();
}