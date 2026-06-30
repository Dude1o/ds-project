import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { Heart, HeartCrack, ShieldAlert, Activity, Power } from 'lucide-react';
import type { HeartbeatEntry, HeartbeatTransition } from '@/types';
import { ServerRegistry, HeartbeatMonitor } from '@/utils/heartbeat';

const NODE_IDS = [
  'hb-node-1',
  'hb-node-2',
  'hb-node-3',
  'hb-node-4',
  'hb-node-5',
  'hb-node-6',
];

// Module-level singletons shared for the app lifetime of the monitor.
const registry = new ServerRegistry();
const monitor = new HeartbeatMonitor(registry, 1000, 3, 6);
for (const id of NODE_IDS) registry.register(id);

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString('en-US', { hour12: false });
}

const STATUS_META = {
  ALIVE: { color: 'text-green-400', ring: 'bg-green-500', label: 'ALIVE', Icon: Heart },
  SUSPECTED: { color: 'text-amber-400', ring: 'bg-amber-500', label: 'SUSPECTED', Icon: ShieldAlert },
  DEAD: { color: 'text-red-400', ring: 'bg-red-500', label: 'DEAD', Icon: HeartCrack },
} as const;

/**
 * HeartbeatPanel — failure detection across a 6-node cluster.
 * Distributed systems concept: each node emits periodic heartbeats; the monitor
 * declares a node SUSPECTED then DEAD as missed beats accumulate. Crashing a
 * node stops its beats so you can watch the detection timeline unfold.
 */
export function HeartbeatPanel() {
  const [entries, setEntries] = useState<HeartbeatEntry[]>(() => registry.getAll());
  const [transitions, setTransitions] = useState<HeartbeatTransition[]>(() => monitor.getTransitions());
  const crashedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    monitor.onStatusChange(() => {
      setEntries(registry.getAll().map((e) => ({ ...e })));
    });
    monitor.onTransition(() => {
      setTransitions(monitor.getTransitions());
    });
    monitor.start();

    // Heartbeat "beater": non-crashed nodes emit a beat every 800ms.
    const beater = setInterval(() => {
      for (const id of NODE_IDS) {
        if (!crashedRef.current.has(id)) monitor.simulateBeat(id);
      }
    }, 800);

    return () => {
      beater && clearInterval(beater);
      monitor.stop();
    };
  }, []);

  const handleCrash = (id: string) => {
    crashedRef.current.add(id);
    monitor.simulateCrash(id);
  };

  const handleRestore = (id: string) => {
    crashedRef.current.delete(id);
    monitor.restore(id);
    setEntries(registry.getAll().map((e) => ({ ...e })));
  };

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {entries.map((e) => {
          const meta = STATUS_META[e.status];
          const Icon = meta.Icon;
          const crashed = crashedRef.current.has(e.nodeId);
          return (
            <div
              key={e.nodeId}
              className={`relative overflow-hidden rounded-xl border p-4 text-center ${
                e.status === 'DEAD'
                  ? 'border-red-900/60 bg-red-950/20'
                  : e.status === 'SUSPECTED'
                    ? 'border-amber-900/60 bg-amber-950/20'
                    : 'border-zinc-800 bg-zinc-900/60'
              }`}
            >
              <div className="relative mx-auto mb-3 flex h-12 w-12 items-center justify-center">
                {e.status === 'ALIVE' && (
                  <span className="absolute inline-flex h-12 w-12 animate-heartbeat-pulse rounded-full bg-green-500/40" />
                )}
                <span
                  className={`relative flex h-10 w-10 items-center justify-center rounded-full ${meta.ring}/20 ${meta.color}`}
                >
                  <Icon className={`h-5 w-5 ${e.status === 'DEAD' ? 'rotate-12' : ''}`} />
                </span>
              </div>
              <div className="font-mono text-xs font-semibold">{e.nodeId}</div>
              <div className={`mt-1 text-xs font-medium ${meta.color}`}>{meta.label}</div>
              <div className="mt-1 text-[10px] text-zinc-500">missed: {e.missedBeats}</div>
              <div className="mt-3 flex flex-col gap-1">
                {crashed || e.status !== 'ALIVE' ? (
                  <button
                    onClick={() => handleRestore(e.nodeId)}
                    className="rounded-md bg-zinc-800 px-2 py-1 text-[11px] text-zinc-200 hover:bg-zinc-700"
                  >
                    <Power className="mr-1 inline h-3 w-3" /> Restore
                  </button>
                ) : (
                  <button
                    onClick={() => handleCrash(e.nodeId)}
                    className="rounded-md bg-red-900/40 px-2 py-1 text-[11px] text-red-300 hover:bg-red-900/70"
                  >
                    <Power className="mr-1 inline h-3 w-3" /> Crash
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4">
        <div className="mb-2 flex items-center gap-2 text-sm font-medium">
          <Activity className="h-4 w-4 text-indigo-400" /> Status Transition Timeline
        </div>
        <div className="max-h-56 space-y-1 overflow-y-auto scrollbar-thin">
          {transitions.length === 0 ? (
            <div className="py-4 text-center text-xs text-zinc-600">
              No transitions yet — crash a node to watch detection in action.
            </div>
          ) : (
            transitions.map((t, idx) => (
              <motion.div
                key={`${t.timestamp}-${idx}`}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                className="flex items-center gap-2 rounded-md bg-zinc-800/40 px-3 py-1.5 text-xs"
              >
                <span className="font-mono text-zinc-500">{formatTime(t.timestamp)}</span>
                <span className="font-mono text-indigo-300">{t.nodeId}</span>
                <span className="text-zinc-500">changed</span>
                <span className="font-medium text-zinc-300">{t.from}</span>
                <span className="text-zinc-500">→</span>
                <span className="font-medium text-zinc-300">{t.to}</span>
              </motion.div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
