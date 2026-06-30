import { useCallback, useEffect, useState } from 'react';
import type { FetchMeta, Product } from '@/types';
import { productService } from '@/services/productService';

interface UseProductsResult {
  products: Product[];
  meta: FetchMeta | null;
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

/**
 * useProducts — React bridge to the product service.
 * Distributed systems concept: the hook surfaces the distributed-systems
 * metadata (serving node, strategy, shard, latency, attempts) returned by the
 * service so the UI can display "served by … via … shard … Nms".
 */
export function useProducts(sessionId: string): UseProductsResult {
  const [products, setProducts] = useState<Product[]>([]);
  const [meta, setMeta] = useState<FetchMeta | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState<number>(0);

  const refetch = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    (async () => {
      try {
        const { data, meta: fetchedMeta } = await productService.fetchAll(sessionId);
        if (!cancelled) {
          setProducts(data);
          setMeta(fetchedMeta);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [sessionId, tick]);

  return { products, meta, loading, error, refetch };
}
