import { useCallback, useEffect, useState } from 'react';
import type { Order } from '@/types';
import { orderService } from '@/services/orderService';
import { productService } from '@/services/productService';

interface UseOrdersResult {
  orders: Order[];
  placeOrder: (productId: string, qty: number, amount: number) => Promise<void>;
  cancelOrder: (orderId: string) => Promise<void>;
  loading: boolean;
  error: string | null;
}

/**
 * useOrders — React bridge to the order service.
 * Distributed systems concept: placing an order flows through least-connections
 * routing, retry+backoff, the circuit breaker, and a WAL INSERT; this hook keeps
 * React state in sync with the in-memory orders store and surfaces failures.
 */
export function useOrders(): UseOrdersResult {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const fetched = await orderService.fetchOrders();
      setOrders(fetched);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const placeOrder = useCallback(
    async (productId: string, qty: number, amount: number) => {
      setError(null);
      try {
        await productService.decrementStock(productId, qty);
        await orderService.placeOrder(productId, qty, amount);
        await refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        await refresh();
      }
    },
    [refresh],
  );

  const cancelOrder = useCallback(
    async (orderId: string) => {
      setError(null);
      try {
        await orderService.cancelOrder(orderId);
        await refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        await refresh();
      }
    },
    [refresh],
  );

  return { orders, placeOrder, cancelOrder, loading, error };
}
