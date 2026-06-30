import { AnimatePresence, motion } from 'framer-motion';
import { Clock, CreditCard, RotateCw, Server, X } from 'lucide-react';
import type { Order } from '@/types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

interface OrderListProps {
  orders: Order[];
  onCancel?: (orderId: string) => void;
}

const STATUS_BADGE: Record<Order['status'], { variant: 'warning' | 'success' | 'danger'; label: string }> = {
  PENDING: { variant: 'warning', label: 'PENDING' },
  CONFIRMED: { variant: 'success', label: 'CONFIRMED' },
  FAILED: { variant: 'danger', label: 'FAILED' },
};

const PAYMENT_BADGE: Record<NonNullable<Order['paymentStatus']>, { variant: 'success' | 'danger'; label: string }> = {
  PAID: { variant: 'success', label: 'PAID' },
  FAILED: { variant: 'danger', label: 'PAYMENT FAILED' },
};

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString('en-US', { hour12: false });
}

/** OrderList — tabular view of orders with status, retry count, serving node, and payment outcome. */
export function OrderList({ orders, onCancel }: OrderListProps) {
  if (orders.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-zinc-800 p-12 text-center text-sm text-zinc-500">
        No orders yet — place one above.
      </div>
    );
  }

  return (
    <div className="overflow-auto rounded-xl border border-zinc-800 bg-zinc-900/60">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Order</TableHead>
            <TableHead>Product</TableHead>
            <TableHead>Qty</TableHead>
            <TableHead>Amount</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Order node</TableHead>
            <TableHead>Retries</TableHead>
            <TableHead>Payment</TableHead>
            <TableHead>Gateway</TableHead>
            <TableHead>Time</TableHead>
            {onCancel && <TableHead className="text-right"> </TableHead>}
          </TableRow>
        </TableHeader>
        <TableBody>
          <AnimatePresence initial={false}>
            {orders.map((o) => {
              const badge = STATUS_BADGE[o.status];
              const paymentBadge = o.paymentStatus ? PAYMENT_BADGE[o.paymentStatus] : null;
              return (
                <motion.tr
                  key={o.id}
                  layout
                  initial={{ opacity: 0, backgroundColor: 'rgba(99,102,241,0.15)' }}
                  animate={{ opacity: 1, backgroundColor: 'rgba(0,0,0,0)' }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.4 }}
                >
                  <TableCell className="font-mono text-xs text-indigo-300">{o.id}</TableCell>
                  <TableCell className="font-mono text-xs">{o.productId}</TableCell>
                  <TableCell>{o.quantity}</TableCell>
                  <TableCell className="font-mono text-xs text-zinc-300">
                    {o.amount != null ? `$${o.amount.toFixed(2)}` : <span className="text-zinc-600">—</span>}
                  </TableCell>
                  <TableCell>
                    <Badge variant={badge.variant}>{badge.label}</Badge>
                  </TableCell>
                  <TableCell>
                    {o.serverId ? (
                      <span className="inline-flex items-center gap-1 text-xs text-zinc-400">
                        <Server className="h-3 w-3" /> {o.serverId}
                      </span>
                    ) : (
                      <span className="text-xs text-zinc-600">—</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <span className="inline-flex items-center gap-1 text-xs text-zinc-400">
                      <RotateCw className="h-3 w-3" /> {o.retryCount}
                    </span>
                  </TableCell>
                  <TableCell>
                    {paymentBadge ? (
                      <Badge variant={paymentBadge.variant}>{paymentBadge.label}</Badge>
                    ) : (
                      <span className="text-xs text-zinc-600">—</span>
                    )}
                  </TableCell>
                  <TableCell>
                    {o.paymentServerId ? (
                      <span className="inline-flex items-center gap-1 text-xs text-zinc-400">
                        <CreditCard className="h-3 w-3" /> {o.paymentServerId}
                        {o.paymentRetryCount != null && o.paymentRetryCount > 0 && (
                          <span className="font-mono text-zinc-500">×{o.paymentRetryCount + 1}</span>
                        )}
                      </span>
                    ) : (
                      <span className="text-xs text-zinc-600">—</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <span className="inline-flex items-center gap-1 text-xs text-zinc-500">
                      <Clock className="h-3 w-3" /> {formatTime(o.createdAt)}
                    </span>
                  </TableCell>
                  {onCancel && (
                    <TableCell className="text-right">
                      {o.status === 'CONFIRMED' && (
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 px-2 text-xs text-zinc-400 hover:text-red-400"
                          onClick={() => onCancel(o.id)}
                        >
                          <X className="h-3.5 w-3.5" /> Cancel
                        </Button>
                      )}
                    </TableCell>
                  )}
                </motion.tr>
              );
            })}
          </AnimatePresence>
        </TableBody>
      </Table>
    </div>
  );
}
