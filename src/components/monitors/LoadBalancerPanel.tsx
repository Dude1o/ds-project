import React, { useCallback, useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Activity, Cpu, Gauge, Network, Send } from "lucide-react";
import type { LBRequestLogEntry, LBStrategy, ServerNode } from "@/types";
import { productService } from "@/services/productService";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

const STRATEGY_OPTIONS: { value: LBStrategy; label: string }[] = [
  { value: "roundRobin", label: "Round Robin" },
  { value: "weightedRoundRobin", label: "Weighted Round Robin" },
  { value: "consistentHash", label: "Consistent Hash" },
  { value: "stickySession", label: "Sticky Session" },
  { value: "leastConnections", label: "Least Connections" },
  { value: "joinIdleQueue", label: "Join Idle Queue" },
  { value: "latencyBased", label: "Latency Based" },
];

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString("en-US", { hour12: false });
}

/**
 * LoadBalancerPanel — visualises the product service's load-balancing cluster.
 * Distributed systems concept: live request distribution across 5 nodes with a
 * swappable strategy, unhealthy-node skipping, and an animated pick pulse.
 */
export function LoadBalancerPanel() {
  const sessionIdRef = useRef(`sess-${Math.random().toString(36).slice(2)}`);
  const [strategy, setStrategy] = useState<LBStrategy>(
    productService.getStrategy(),
  );
  const [servers, setServers] = useState<ServerNode[]>(() =>
    productService.servers.map((s) => ({ ...s })),
  );
  const [log, setLog] = useState<LBRequestLogEntry[]>(() =>
    productService.getRequestLog(),
  );
  const [litNode, setLitNode] = useState<string | null>(null);
  const [pulseKey, setPulseKey] = useState(0);
  const [sending, setSending] = useState(false);
  const [tick, setTick] = useState(0);
  const [dirtyValues, setDirtyValues] = useState<Record<string, Partial<Record<'weight' | 'latency' | 'connections', string>>>>({});

  // Subscribe to live request-pick events from the product service.
  useEffect(() => {
    const unsub = productService.subscribeRequests((entry) => {
      setLog(productService.getRequestLog());
      setLitNode(entry.serverId);
      setPulseKey((k) => k + 1);
    });
    return unsub;
  }, []);

  // Subscribe to server-change events (edits from other panels/tabs).
  useEffect(() => {
    const unsub = productService.onServersChanged(() => setTick((t) => t + 1));
    return unsub;
  }, []);

  // Refresh the server snapshot periodically (health/connections mutate in place).
  useEffect(() => {
    const id = setInterval(() => {
      setServers(productService.servers.map((s) => ({ ...s })));
    }, 600);
    return () => clearInterval(id);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick]);

  const handleStrategyChange = (value: LBStrategy) => {
    productService.setStrategy(value);
    setStrategy(value);
  };

  const handleSend = async () => {
    setSending(true);
    const picks = productService.sendDemoRequests(10, sessionIdRef.current);
    // Stagger the visual pulses so each pick is visible.
    for (let i = 0; i < picks.length; i++) {
      const pick = picks[i]!;
      setLitNode(pick.serverId);
      setPulseKey((k) => k + 1);
      // eslint-disable-next-line no-await-in-loop
      await new Promise((r) => setTimeout(r, 120));
    }
    setLog(productService.getRequestLog());
    setServers(productService.servers.map((s) => ({ ...s })));
    setSending(false);
  };

  const handleFieldChange = useCallback(
    (serverId: string, field: 'weight' | 'latency' | 'connections', raw: string) => {
      setDirtyValues((prev) => ({
        ...prev,
        [serverId]: { ...prev[serverId], [field]: raw },
      }));
    },
    [],
  );

  const handleFieldBlur = useCallback(
    (serverId: string, field: 'weight' | 'latency' | 'connections') => {
      setDirtyValues((prev) => {
        const dirty = prev[serverId]?.[field];
        if (dirty === undefined) return prev;
        let parsed = Number(dirty);
        if (Number.isNaN(parsed)) parsed = 1;
        if (field === 'weight' || field === 'latency') {
          parsed = Math.max(1, parsed);
        } else {
          parsed = Math.max(0, Math.round(parsed));
        }
        productService.updateServer(serverId, { [field]: parsed });
        const next = { ...prev };
        if (next[serverId]) {
          const updated = { ...next[serverId] };
          delete updated[field];
          if (Object.keys(updated).length === 0) {
            delete next[serverId];
          } else {
            next[serverId] = updated;
          }
        }
        return next;
      });
    },
    [],
  );

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Network className="h-5 w-5 text-indigo-400" /> Load Balancer
                Cluster
              </CardTitle>
              <CardDescription>
                5 simulated nodes · strategy swappable at runtime · unhealthy
                nodes skipped
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              <Select
                value={strategy}
                onValueChange={(v) => handleStrategyChange(v as LBStrategy)}
              >
                <SelectTrigger className="w-[210px]">
                  <SelectValue placeholder="Strategy" />
                </SelectTrigger>
                <SelectContent>
                  {STRATEGY_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button onClick={handleSend} disabled={sending}>
                <Send className="h-4 w-4" /> Send 10
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            {servers.map((s) => {
              const dirty = dirtyValues[s.id] ?? {};
              const displayWeight = dirty.weight ?? String(s.weight);
              const displayConns = dirty.connections ?? String(s.connections);
              const displayLatency = dirty.latency ?? String(s.latency);
              return (
                <div
                  key={s.id}
                  className={`relative overflow-hidden rounded-xl border p-4 transition-colors ${
                    s.healthy
                      ? "border-zinc-800 bg-zinc-900/60"
                      : "border-red-900/60 bg-red-950/20"
                  } ${litNode === s.id ? "ring-2 ring-indigo-500/60" : ""}`}
                >
                  <AnimatePresence>
                    {litNode === s.id && (
                      <motion.span
                        key={pulseKey}
                        initial={{ scale: 0.6, opacity: 0.7 }}
                        animate={{ scale: 2.2, opacity: 0 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.8 }}
                        className="pointer-events-none absolute left-1/2 top-1/2 h-24 w-24 -translate-x-1/2 -translate-y-1/2 rounded-full bg-indigo-500/30"
                      />
                    )}
                  </AnimatePresence>
                  <div className="relative flex items-center justify-between">
                    <span className="font-mono text-sm font-semibold">
                      {s.id}
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        productService.updateServer(s.id, { healthy: !s.healthy });
                        setServers(productService.servers.map((x) => ({ ...x })));
                      }}
                      className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-1 ${
                        s.healthy
                          ? "border-green-700 bg-green-600"
                          : "border-red-800 bg-red-900/60"
                      }`}
                      role="switch"
                      aria-checked={s.healthy}
                      aria-label={`${s.id} healthy`}
                    >
                      <span
                        className={`pointer-events-none inline-block h-3.5 w-3.5 rounded-full bg-white shadow-sm transition-transform ${
                          s.healthy ? "translate-x-4" : "translate-x-1"
                        }`}
                      />
                    </button>
                  </div>
                  <dl className="relative mt-3 space-y-1 text-xs text-zinc-400">
                    <div className="flex items-center justify-between">
                      <dt className="flex items-center gap-1">
                        <Cpu className="h-3 w-3" /> weight
                      </dt>
                      <dd>
                        <Input
                          type="number"
                          min={1}
                          value={displayWeight}
                          onChange={(e) => handleFieldChange(s.id, 'weight', e.target.value)}
                          onBlur={() => handleFieldBlur(s.id, 'weight')}
                          className="h-7 w-[72px] px-2 py-1 text-right font-mono text-xs"
                        />
                      </dd>
                    </div>
                    <div className="flex items-center justify-between">
                      <dt className="flex items-center gap-1">
                        <Activity className="h-3 w-3" /> conns
                      </dt>
                      <dd>
                        <Input
                          type="number"
                          min={0}
                          value={displayConns}
                          onChange={(e) => handleFieldChange(s.id, 'connections', e.target.value)}
                          onBlur={() => handleFieldBlur(s.id, 'connections')}
                          className="h-7 w-[72px] px-2 py-1 text-right font-mono text-xs"
                        />
                      </dd>
                    </div>
                    <div className="flex items-center justify-between">
                      <dt className="flex items-center gap-1">
                        <Gauge className="h-3 w-3" /> latency
                      </dt>
                      <dd className="flex items-center gap-1">
                        <Input
                          type="number"
                          min={1}
                          value={displayLatency}
                          onChange={(e) => handleFieldChange(s.id, 'latency', e.target.value)}
                          onBlur={() => handleFieldBlur(s.id, 'latency')}
                          className="h-7 w-[72px] px-2 py-1 text-right font-mono text-xs"
                        />
                        <span className="text-zinc-500">ms</span>
                      </dd>
                    </div>
                  </dl>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Live Request Log</CardTitle>
          <CardDescription>
            Last {Math.min(20, Math.max(log.length, 1))} routing decisions
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="max-h-72 overflow-y-auto scrollbar-thin">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Time</TableHead>
                  <TableHead>Server</TableHead>
                  <TableHead>Strategy</TableHead>
                  <TableHead className="hidden md:table-cell">Reason</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {log.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={4}
                      className="text-center text-zinc-500"
                    >
                      No requests yet — press “Send 10”.
                    </TableCell>
                  </TableRow>
                ) : (
                  log.map((entry, index) => (
                    <React.Fragment key={entry.id}>
                      <TableRow>
                        <TableCell className="font-mono text-xs">
                          {formatTime(entry.timestamp)}
                        </TableCell>
                        <TableCell className="font-mono text-indigo-300">
                          {entry.serverId}
                        </TableCell>
                        <TableCell>
                          <Badge variant="info">{entry.strategy}</Badge>
                        </TableCell>
                        <TableCell className="hidden max-w-md truncate text-xs text-zinc-400 md:table-cell">
                          {entry.reason}
                        </TableCell>
                      </TableRow>

                      {/* Every 10 items (except the absolute last item), insert a spacing row */}
                      {(index + 1) % 10 === 0 && index !== log.length - 1 && (
                        <TableRow className="hover:bg-transparent">
                          <TableCell colSpan={4} className="p-0">
                            {/* This div acts as your <br />, creating a 24px invisible gap */}
                            <div className="h-6 bg-transparent" />
                            {/* OPTIONAL: If you want a physical line divider instead of just space, uncomment below: */}
                            {/* <div className="h-[1px] bg-zinc-700 my-3" /> */}
                          </TableCell>
                        </TableRow>
                      )}
                    </React.Fragment>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
