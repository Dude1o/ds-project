import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Database, FilePlus2, GitBranch, RefreshCw, Server } from 'lucide-react';
import type { ReplicaNode, WALEntry } from '@/types';
import { WALManager, activeReplicate, PassiveReplicationManager } from '@/utils/replication';

const OP_STYLES: Record<WALEntry['operation'], { label: string; cls: string }> = {
  INSERT: { label: 'INSERT', cls: 'bg-green-500/20 text-green-400' },
  UPDATE: { label: 'UPDATE', cls: 'bg-indigo-500/20 text-indigo-300' },
  DELETE: { label: 'DELETE', cls: 'bg-red-500/20 text-red-400' },
};

const TABLES = ['orders', 'payments', 'inventory', 'users'];

// Module-level singletons for the replication demo.
const wal = new WALManager();
const replicas: ReplicaNode[] = [
  { id: 'primary', role: 'PRIMARY', lag: 0, lastLSN: 0 },
  { id: 'replica-1', role: 'REPLICA', lag: 350, lastLSN: 0 },
  { id: 'replica-2', role: 'REPLICA', lag: 700, lastLSN: 0 },
  { id: 'replica-3', role: 'REPLICA', lag: 1100, lastLSN: 0 },
];
let writeSeq = 0;

/**
 * ReplicationPanel — PRIMARY + 3 REPLICAs with a streaming Write-Ahead Log.
 * Distributed systems concept: toggle eager (active) vs lazy (passive)
 * replication and watch WAL entries propagate to replicas with per-node lag.
 */
export function ReplicationPanel() {
  const [mode, setMode] = useState<'active' | 'passive'>('active');
  const [entries, setEntries] = useState<WALEntry[]>(() => wal.getLog());
  const [replicaState, setReplicaState] = useState<ReplicaNode[]>(() =>
    replicas.map((r) => ({ ...r })),
  );
  const [writing, setWriting] = useState(false);
  const passiveRef = useRef<PassiveReplicationManager | null>(null);

  // Manage the passive replication loop based on the active mode.
  useEffect(() => {
    const manager = new PassiveReplicationManager(wal, replicas, 400);
    passiveRef.current = manager;
    manager.onUpdate(() => {
      setReplicaState(replicas.map((r) => ({ ...r })));
    });
    return () => {
      manager.stop();
    };
  }, []);

  useEffect(() => {
    const manager = passiveRef.current;
    if (!manager) return;
    if (mode === 'passive') {
      manager.start();
    } else {
      manager.stop();
    }
  }, [mode]);

  // In passive mode, periodically refresh the WAL view so applied flags update.
  useEffect(() => {
    if (mode !== 'passive') return;
    const id = setInterval(() => {
      setEntries(wal.getLog());
      setReplicaState(replicas.map((r) => ({ ...r })));
    }, 350);
    return () => clearInterval(id);
  }, [mode]);

  const handleWrite = async () => {
    setWriting(true);
    const op: WALEntry['operation'] =
      writeSeq % 3 === 0 ? 'INSERT' : writeSeq % 3 === 1 ? 'UPDATE' : 'DELETE';
    const table = TABLES[writeSeq % TABLES.length]!;
    writeSeq += 1;
    const entry = wal.append(op, table, { seq: writeSeq, ts: Date.now() });
    setEntries(wal.getLog());

    if (mode === 'active') {
      await activeReplicate(wal, replicas, entry);
      setEntries(wal.getLog());
      setReplicaState(replicas.map((r) => ({ ...r })));
    }
    // In passive mode the polling manager propagates asynchronously.
    setWriting(false);
  };

  const primary = replicaState.find((r) => r.role === 'PRIMARY')!;
  const repls = replicaState.filter((r) => r.role === 'REPLICA');

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex rounded-lg border border-zinc-800 bg-zinc-900/80 p-1">
          <button
            onClick={() => setMode('active')}
            className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
              mode === 'active' ? 'bg-indigo-500 text-white' : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            Active (eager)
          </button>
          <button
            onClick={() => setMode('passive')}
            className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
              mode === 'passive' ? 'bg-indigo-500 text-white' : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            Passive (lazy)
          </button>
        </div>
        <button
          onClick={handleWrite}
          disabled={writing}
          className="inline-flex items-center gap-2 rounded-md bg-indigo-500 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-indigo-600 disabled:opacity-50"
        >
          <FilePlus2 className="h-4 w-4" /> Write Record
        </button>
      </div>

      <div className="grid gap-4 lg:grid-cols-[200px_1fr_260px]">
        {/* PRIMARY */}
        <div className="rounded-xl border border-indigo-900/50 bg-indigo-950/20 p-4">
          <div className="flex items-center gap-2 text-sm font-semibold text-indigo-300">
            <Server className="h-4 w-4" /> PRIMARY
          </div>
          <div className="mt-2 font-mono text-xs text-zinc-400">{primary.id}</div>
          <div className="mt-3 space-y-1 text-xs">
            <div className="flex justify-between">
              <span className="text-zinc-500">last LSN</span>
              <span className="font-mono text-indigo-300">{wal.getLastLSN()}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-zinc-500">role</span>
              <span className="font-mono text-zinc-300">PRIMARY</span>
            </div>
          </div>
        </div>

        {/* WAL stream */}
        <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
          <div className="mb-3 flex items-center gap-2 text-sm font-medium">
            <GitBranch className="h-4 w-4 text-indigo-400" /> Write-Ahead Log Stream
          </div>
          <div className="max-h-72 space-y-2 overflow-y-auto scrollbar-thin">
            <AnimatePresence initial={false}>
              {entries.length === 0 ? (
                <div className="py-8 text-center text-xs text-zinc-600">
                  <Database className="mx-auto mb-2 h-6 w-6 opacity-40" />
                  No log entries — press “Write Record”.
                </div>
              ) : (
                [...entries]
                  .reverse()
                  .map((e) => {
                    const op = OP_STYLES[e.operation];
                    return (
                      <motion.div
                        layout
                        key={e.lsn}
                        initial={{ opacity: 0, y: -12 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0 }}
                        className={`flex items-center gap-3 rounded-lg border px-3 py-2 text-xs ${
                          e.applied ? 'border-zinc-800 bg-zinc-900/40' : 'border-indigo-900/50 bg-indigo-950/20'
                        }`}
                      >
                        <span className="font-mono text-zinc-500">#{e.lsn}</span>
                        <span className={`rounded px-1.5 py-0.5 font-mono ${op.cls}`}>{op.label}</span>
                        <span className="font-mono text-zinc-300">{e.table}</span>
                        <span className="ml-auto">
                          {e.applied ? (
                            <span className="text-green-400">applied</span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-amber-400">
                              <RefreshCw className="h-3 w-3 animate-spin-slow" /> pending
                            </span>
                          )}
                        </span>
                      </motion.div>
                    );
                  })
              )}
            </AnimatePresence>
          </div>
        </div>

        {/* REPLICAS */}
        <div className="space-y-3">
          <div className="text-sm font-medium text-zinc-400">Replicas</div>
          {repls.map((r) => {
            const lagPct = wal.getLastLSN() === 0
              ? 100
              : Math.max(0, Math.min(100, (r.lastLSN / wal.getLastLSN()) * 100));
            return (
              <div key={r.id} className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-3">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-xs font-semibold">{r.id}</span>
                  <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-400">
                    lag {r.lag}ms
                  </span>
                </div>
                <div className="mt-2 flex items-center justify-between text-xs">
                  <span className="text-zinc-500">last LSN</span>
                  <motion.span
                    key={r.lastLSN}
                    initial={{ color: '#818cf8' }}
                    animate={{ color: '#e4e4e7' }}
                    className="font-mono"
                  >
                    {r.lastLSN}
                  </motion.span>
                </div>
                <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-zinc-800">
                  <motion.div
                    className="h-full bg-indigo-500"
                    animate={{ width: `${lagPct}%` }}
                    transition={{ duration: 0.4 }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
