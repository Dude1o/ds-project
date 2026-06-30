import type { WALEntry } from '@/types';

/**
 * Write-Ahead Log manager.
 * Distributed systems concept: every mutation is appended to an in-memory
 * write-ahead log *before* being applied to in-memory state, matching real
 * database durability semantics. Log Sequence Numbers (LSNs) are monotonic,
 * gap-free, and strictly increasing — which lets replicas ask "give me
 * everything since LSN N" (`getSince`) and receive exactly the entries they
 * are missing, never duplicates, never gaps.
 *
 * The `applied` flag tracks whether each entry has been acknowledged by every
 * replica. Once all replicas have caught up past an entry's LSN, it can be
 * safely truncated via `truncate(upToLsn)`.
 */
export class WALManager {
  private log: WALEntry[] = [];
  private lsnCounter = 0;

  /** Appends a new entry, assigning the next monotonic LSN. */
  append(operation: WALEntry['operation'], table: string, payload: unknown): WALEntry {
    const lsn = ++this.lsnCounter;
    const entry: WALEntry = {
      lsn,
      timestamp: Date.now(),
      operation,
      table,
      payload,
      applied: false,
    };
    this.log.push(entry);
    return entry;
  }

  /** Returns a snapshot of the full log. */
  getLog(): WALEntry[] {
    return [...this.log];
  }

  /** Returns all entries with LSN strictly greater than `fromLsn` (replica pull). */
  getSince(fromLsn: number): WALEntry[] {
    return this.log.filter((e) => e.lsn > fromLsn);
  }

  /** Returns entries whose `applied` flag is still false (durability gate). */
  getUnflushed(): WALEntry[] {
    return this.log.filter((e) => !e.applied);
  }

  /** Marks the entry at `lsn` as applied (durably replicated). No-op if missing. */
  markApplied(lsn: number): void {
    const entry = this.log.find((e) => e.lsn === lsn);
    if (entry) entry.applied = true;
  }

  /** Truncates (compacts) entries with LSN ≤ upToLsn. */
  truncate(upToLsn: number): void {
    this.log = this.log.filter((e) => e.lsn > upToLsn);
  }

  /** Returns the highest LSN ever issued (counter; not affected by truncate). */
  getLastLSN(): number {
    return this.lsnCounter;
  }
}