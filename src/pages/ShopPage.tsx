import { useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Loader2, RefreshCw, Server, Layers, Activity, Zap } from 'lucide-react';
import type { LBStrategy, Product } from '@/types';
import { productService } from '@/services/productService';
import { useProducts } from '@/hooks/useProducts';
import { useOrders } from '@/hooks/useOrders';
import { ProductGrid } from '@/components/shop/ProductGrid';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

const STRATEGY_OPTIONS: { value: LBStrategy; label: string }[] = [
  { value: 'roundRobin', label: 'Round Robin' },
  { value: 'weightedRoundRobin', label: 'Weighted Round Robin' },
  { value: 'consistentHash', label: 'Consistent Hash' },
  { value: 'stickySession', label: 'Sticky Session' },
  { value: 'leastConnections', label: 'Least Connections' },
  { value: 'joinIdleQueue', label: 'Join Idle Queue' },
  { value: 'latencyBased', label: 'Latency Based' },
];

/** ShopPage — product catalogue served through the distributed stack, with a live routing badge and strategy switcher. */
export function ShopPage() {
  const sessionIdRef = useRef(`sess-${Math.random().toString(36).slice(2)}`);
  const { products, meta, loading, error, refetch } = useProducts(sessionIdRef.current);
  const { placeOrder } = useOrders();
  const [strategy, setStrategy] = useState<LBStrategy>(productService.getStrategy());
  const [toast, setToast] = useState<string | null>(null);
  const [ordering, setOrdering] = useState<string | null>(null);

  const handleStrategyChange = (value: LBStrategy) => {
    productService.setStrategy(value);
    setStrategy(value);
    refetch();
  };

  const handleOrder = async (product: Product) => {
    setOrdering(product.id);
    try {
      await placeOrder(product.id, 1, product.price);
      setToast(`Order placed for ${product.name}`);
      refetch();
    } catch (err) {
      setToast(err instanceof Error ? err.message : 'Order failed');
    } finally {
      setOrdering(null);
      setTimeout(() => setToast(null), 2500);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Shop</h1>
          <p className="text-sm text-zinc-400">20 products · 3 shards · 5-node cluster</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-2">
            <Zap className="h-4 w-4 text-indigo-400" />
            <Select value={strategy} onValueChange={(v) => handleStrategyChange(v as LBStrategy)}>
              <SelectTrigger className="w-[200px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STRATEGY_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button variant="outline" size="icon" onClick={refetch} disabled={loading}>
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          </Button>
        </div>
      </div>

      {/* Live routing badge */}
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-zinc-800 bg-zinc-900/60 px-4 py-3 text-sm">
        {loading ? (
          <span className="flex items-center gap-2 text-zinc-400">
            <Loader2 className="h-4 w-4 animate-spin" /> Routing request…
          </span>
        ) : error ? (
          <span className="text-red-400">Error: {error}</span>
        ) : meta ? (
          <>
            <span className="text-zinc-400">Served by</span>
            <Badge variant="info" className="gap-1"><Server className="h-3 w-3" /> {meta.serverId}</Badge>
            <span className="text-zinc-500">·</span>
            <Badge variant="outline">{meta.strategy}</Badge>
            <span className="text-zinc-500">·</span>
            <Badge variant="info" className="gap-1"><Layers className="h-3 w-3" /> {meta.shardId}</Badge>
            <span className="text-zinc-500">·</span>
            <span className="inline-flex items-center gap-1 font-mono text-zinc-300">
              <Activity className="h-3 w-3 text-indigo-400" /> {meta.latencyMs}ms
            </span>
            <span className="text-zinc-500">·</span>
            <span className="font-mono text-xs text-zinc-500">{meta.attempts} attempt(s)</span>
          </>
        ) : null}
      </div>

      {loading ? (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
          {Array.from({ length: 10 }).map((_, i) => (
            <div key={i} className="h-64 animate-pulse rounded-xl border border-zinc-800 bg-zinc-900/40" />
          ))}
        </div>
      ) : error ? (
        <div className="rounded-xl border border-red-900/50 bg-red-950/20 p-8 text-center text-sm text-red-300">
          {error}
        </div>
      ) : (
        <ProductGrid products={products} onOrder={handleOrder} />
      )}

      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-lg border border-zinc-700 bg-zinc-900 px-4 py-2.5 text-sm shadow-lg"
          >
            {toast}
          </motion.div>
        )}
      </AnimatePresence>

      {ordering && (
        <div className="fixed bottom-6 right-6 z-50 flex items-center gap-2 rounded-lg border border-zinc-700 bg-zinc-900 px-4 py-2.5 text-sm shadow-lg">
          <Loader2 className="h-4 w-4 animate-spin text-indigo-400" /> Placing order…
        </div>
      )}
    </div>
  );
}
