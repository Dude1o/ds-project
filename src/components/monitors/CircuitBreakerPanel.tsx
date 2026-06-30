import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { AlertTriangle, RotateCcw, ShieldCheck, Skull, Zap } from 'lucide-react';
import type { CBState, CBSnapshot, CBTransition } from '@/types';
import { productService } from '@/services/productService';
import { orderService } from '@/services/orderService';
import { paymentService } from '@/services/paymentService';
import type { CircuitBreaker } from '@/utils/circuitBreaker';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';

interface CBPresenter {
  key: string;
  label: string;
  description: string;
  getBreaker: () => CircuitBreaker;
  triggerFailures: (n: number) => Promise<void>;
  reset: () => void;
}

const BREAKERS: CBPresenter[] = [
  {
    key: 'product',
    label: 'Product Service',
    description: 'consistent-hash routing · 10% failure',
    getBreaker: () => productService.getCircuitBreaker(),
    triggerFailures: (n) => productService.triggerFailures(n),
    reset: () => productService.resetCircuitBreaker(),
  },
  {
    key: 'order',
    label: 'Order Service',
    description: 'least-connections routing · 20% failure',
    getBreaker: () => orderService.getCircuitBreaker(),
    triggerFailures: (n) => orderService.triggerFailures(n),
    reset: () => orderService.resetCircuitBreaker(),
  },
  {
    key: 'payment',
    label: 'Payment Service',
    description: 'weighted round-robin · 15% failure',
    getBreaker: () => paymentService.getCircuitBreaker(),
    triggerFailures: (n) => paymentService.triggerFailures(n),
    reset: () => paymentService.resetCircuitBreaker(),
  },
];

const STATE_STYLES: Record<CBState, { variant: 'success' | 'danger' | 'warning'; icon: typeof ShieldCheck }> = {
  CLOSED: { variant: 'success', icon: ShieldCheck },
  OPEN: { variant: 'danger', icon: Skull },
  HALF_OPEN: { variant: 'warning', icon: AlertTriangle },
};

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString('en-US', { hour12: false });
}

interface PanelState {
  snapshot: CBSnapshot;
  transitions: CBTransition[];
  threshold: number;
}

/**
 * CircuitBreakerPanel — three independent circuit breakers side by side.
 * Distributed systems concept: each downstream service gets its own breaker so
 * a failure cascade in one service trips isolation without affecting the others.
 */
export function CircuitBreakerPanel() {
  const [panels, setPanels] = useState<Record<string, PanelState>>(() => {
    const init: Record<string, PanelState> = {};
    for (const b of BREAKERS) {
      const br = b.getBreaker();
      init[b.key] = {
        snapshot: br.getSnapshot(),
        transitions: br.getTransitions(),
        threshold: br.getConfig().failureThreshold,
      };
    }
    return init;
  });
  const [busy, setBusy] = useState<Record<string, boolean>>({});

  useEffect(() => {
    const unsubs: Array<() => void> = [];
    for (const b of BREAKERS) {
      const br = b.getBreaker();
      const update = () => {
        setPanels((prev) => ({
          ...prev,
          [b.key]: {
            snapshot: br.getSnapshot(),
            transitions: br.getTransitions(),
            threshold: br.getConfig().failureThreshold,
          },
        }));
      };
      br.on('stateChange', update);
      br.on('transition', update);
      unsubs.push(() => br.off('stateChange', update));
      unsubs.push(() => br.off('transition', update));
    }
    return () => {
      for (const u of unsubs) u();
    };
  }, []);

  const handleTrigger = async (b: CBPresenter) => {
    setBusy((prev) => ({ ...prev, [b.key]: true }));
    await b.triggerFailures(5);
    const br = b.getBreaker();
    setPanels((prev) => ({
      ...prev,
      [b.key]: {
        snapshot: br.getSnapshot(),
        transitions: br.getTransitions(),
        threshold: br.getConfig().failureThreshold,
      },
    }));
    setBusy((prev) => ({ ...prev, [b.key]: false }));
  };

  const handleReset = (b: CBPresenter) => {
    b.reset();
    const br = b.getBreaker();
    setPanels((prev) => ({
      ...prev,
      [b.key]: {
        snapshot: br.getSnapshot(),
        transitions: br.getTransitions(),
        threshold: br.getConfig().failureThreshold,
      },
    }));
  };

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      {BREAKERS.map((b) => {
        const panel = panels[b.key]!;
        const snap = panel.snapshot;
        const style = STATE_STYLES[snap.state];
        const Icon = style.icon;
        const failurePct = Math.min(100, (snap.failures / panel.threshold) * 100);
        return (
          <Card key={b.key} className="flex flex-col">
            <CardHeader>
              <CardTitle className="flex items-center justify-between text-base">
                {b.label}
                <AnimatePresence mode="wait">
                  <motion.div
                    key={snap.state}
                    initial={{ scale: 0.7, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    exit={{ scale: 0.7, opacity: 0 }}
                    transition={{ duration: 0.25 }}
                  >
                    <Badge variant={style.variant} className="gap-1">
                      <Icon className="h-3 w-3" /> {snap.state}
                    </Badge>
                  </motion.div>
                </AnimatePresence>
              </CardTitle>
              <CardDescription>{b.description}</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-1 flex-col gap-4">
              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-xs text-zinc-400">
                  <span>Failures</span>
                  <span className="font-mono text-zinc-200">
                    {snap.failures} / {panel.threshold}
                  </span>
                </div>
                <Progress value={failurePct} indicatorClassName={style.variant === 'danger' ? 'bg-red-500' : style.variant === 'warning' ? 'bg-amber-500' : 'bg-green-500'} />
              </div>

              <div className="flex items-center justify-between text-xs text-zinc-400">
                <span>Successes (half-open)</span>
                <span className="font-mono text-zinc-200">{snap.successes}</span>
              </div>
              <div className="flex items-center justify-between text-xs text-zinc-400">
                <span>Last state change</span>
                <span className="font-mono text-zinc-200">{formatTime(snap.lastStateChange)}</span>
              </div>

              <div className="flex-1">
                <div className="mb-1 text-xs font-medium text-zinc-400">Transition timeline</div>
                <div className="max-h-32 space-y-1 overflow-y-auto scrollbar-thin">
                  {panel.transitions.length === 0 ? (
                    <div className="text-xs text-zinc-600">No transitions yet.</div>
                  ) : (
                    panel.transitions.slice(0, 10).map((t, idx) => (
                      <div key={`${t.timestamp}-${idx}`} className="flex items-center gap-2 text-xs">
                        <span className="font-mono text-zinc-500">{formatTime(t.timestamp)}</span>
                        <Badge variant="outline" className="px-1.5 py-0 text-[10px]">{t.from}</Badge>
                        <span className="text-zinc-500">→</span>
                        <Badge variant="outline" className="px-1.5 py-0 text-[10px]">{t.to}</Badge>
                      </div>
                    ))
                  )}
                </div>
              </div>

              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="destructive"
                  className="flex-1"
                  disabled={busy[b.key]}
                  onClick={() => handleTrigger(b)}
                >
                  <Zap className="h-3.5 w-3.5" /> Trigger Failures
                </Button>
                <Button size="sm" variant="outline" onClick={() => handleReset(b)}>
                  <RotateCcw className="h-3.5 w-3.5" /> Reset
                </Button>
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
