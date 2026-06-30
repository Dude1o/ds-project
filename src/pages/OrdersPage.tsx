import { useState } from 'react';
import { AlertCircle, Loader2 } from 'lucide-react';
import { useProducts } from '@/hooks/useProducts';
import { useOrders } from '@/hooks/useOrders';
import { OrderForm } from '@/components/shop/OrderForm';
import { OrderList } from '@/components/shop/OrderList';

/** OrdersPage — place new orders and inspect the durable, retry-aware order log. */
export function OrdersPage() {
  const { products, loading: productsLoading } = useProducts('orders-page-session');
  const { orders, placeOrder, cancelOrder, loading: ordersLoading, error } = useOrders();
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (productId: string, quantity: number) => {
    setSubmitting(true);
    try {
      const product = products.find((p) => p.id === productId);
      const amount = product ? product.price * quantity : 0;
      await placeOrder(productId, quantity, amount);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Orders</h1>
        <p className="text-sm text-zinc-400">
          Routed by least-connections · guarded by a circuit breaker · retried with backoff ·
          durably logged via WAL
        </p>
      </div>

      <OrderForm products={products} onSubmit={handleSubmit} submitting={submitting} />

      {error && (
        <div className="flex items-center gap-2 rounded-lg border border-red-900/50 bg-red-950/20 px-4 py-3 text-sm text-red-300">
          <AlertCircle className="h-4 w-4" /> {error}
        </div>
      )}

      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Order History</h2>
        {ordersLoading && (
          <span className="flex items-center gap-2 text-xs text-zinc-500">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> syncing…
          </span>
        )}
      </div>

      {productsLoading ? (
        <div className="h-32 animate-pulse rounded-xl border border-zinc-800 bg-zinc-900/40" />
      ) : (
        <OrderList orders={orders} onCancel={cancelOrder} />
      )}
    </div>
  );
}
