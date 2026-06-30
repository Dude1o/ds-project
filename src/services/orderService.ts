import type {
  CBConfig,
  CBTransition,
  Order,
  RetryConfig,
  ServerNode,
} from '@/types';
import { delay } from '@/utils/delay';
import { CircuitBreaker } from '@/utils/circuitBreaker';
import { withRetry } from '@/utils/retry';
import { LeastConnectionsBalancer } from '@/utils/loadBalancer';
import { WALManager } from '@/utils/replication';
import { paymentService } from '@/services/paymentService';

/** Failure rate injected into order placement so retries are visibly exercised. */
const ORDER_FAILURE_RATE = 0.2;

const ORDER_CB_CONFIG: CBConfig = {
  failureThreshold: 5,
  successThreshold: 2,
  timeout: 7000,
};

const ORDER_RETRY_CONFIG: RetryConfig = {
  maxAttempts: 4,
  baseDelayMs: 250,
  maxDelayMs: 2000,
  jitter: true,
};

/** Simulated order-processing cluster (least-connections routed). */
const ORDER_SERVERS: ServerNode[] = [
  { id: 'order-node-1', weight: 4, latency: 70, connections: 0, healthy: true, lastHeartbeat: Date.now() },
  { id: 'order-node-2', weight: 4, latency: 90, connections: 0, healthy: true, lastHeartbeat: Date.now() },
  { id: 'order-node-3', weight: 4, latency: 55, connections: 0, healthy: true, lastHeartbeat: Date.now() },
];

// ─── Module-level singletons ─────────────────────────────────────────────────
const balancer = new LeastConnectionsBalancer();
const circuitBreaker = new CircuitBreaker('order', ORDER_CB_CONFIG);
const walManager = new WALManager();

const serversChangedCallbacks: Array<() => void> = [];
function notifyServersChanged() {
  for (const cb of serversChangedCallbacks) cb();
}

/** Internal in-memory orders database. */
let ORDERS_DB: Order[] = [];
let orderSeq = 0;

/**
 * Order service.
 * Distributed systems concept: order placement is routed by least-connections
 * load balancing, guarded by its own circuit breaker, hardened with retry+backoff,
 * and made durable via a Write-Ahead Log INSERT on every successful placement.
 * 20% of attempts fail transiently so retries and the breaker are observable.
 */
export const orderService = {
  /**
   * Places a new order, then charges the payment gateway.
   * Distributed systems concept: the order placement is a two-phase transactional
   * flow — (1) place the order through the least-connections routed order cluster
   * with its own circuit breaker + retry, and (2) charge via the weighted-round-robin
   * routed payment gateway with its own breaker + retry. The order transitions to
   * CONFIRMED only when *both* succeed. If the order placement succeeds but the
   * payment fails (or its breaker is OPEN), the order is marked FAILED with its
   * paymentStatus set, surfacing the partial-failure state in the dashboard. The
   * payment gateway has its own independent circuit breaker so a payment cascade
   * cannot tank the order placement path (and vice-versa).
   *
   * @param productId - product identifier being ordered
   * @param quantity - number of units
   * @param amount - total amount to charge the payment gateway
   */
  async placeOrder(productId: string, quantity: number, amount: number): Promise<Order> {
    let attempts = 0;
    let processedServerId = 'unknown';

    const order: Order = {
      id: `ord-${++orderSeq}`,
      productId,
      quantity,
      amount,
      status: 'PENDING',
      createdAt: Date.now(),
      retryCount: 0,
    };

    try {
      const confirmed = await circuitBreaker.execute(async () => {
        return withRetry(
          async () => {
            attempts += 1;
            const server = balancer.pick(ORDER_SERVERS);
            balancer.onRequestStart(server.id, ORDER_SERVERS);
            processedServerId = server.id;
            try {
              await delay(server.latency, true);
              if (Math.random() < ORDER_FAILURE_RATE) {
                throw new Error(`orderService: transient failure on ${server.id}`);
              }
              return server.id;
            } finally {
              balancer.onRequestEnd(server.id, ORDER_SERVERS);
            }
          },
          ORDER_RETRY_CONFIG,
        );
      });

      walManager.append('INSERT', 'orders', { orderId: order.id, productId, quantity });
      order.serverId = confirmed;
      order.retryCount = Math.max(0, attempts - 1);

      // Phase 2 — charge the payment gateway. If this fails, the order is
      // durably logged (it was INSERT-ed above) but its final status is FAILED,
      // just as a real e-commerce backend would leave a placed-but-unpaid order.
      try {
        const payment = await paymentService.processPayment(order.id, amount);
        order.status = 'CONFIRMED';
        order.paymentStatus = 'PAID';
        order.paymentServerId = payment.serverId;
        order.paymentRetryCount = payment.retryCount;
      } catch (paymentErr) {
        // Payment failed even after its own retries + breaker — flag as FAILED.
        // Keep the order in history so operators can see the partial failure.
        order.paymentStatus = 'FAILED';
        order.status = 'FAILED';
        ORDERS_DB = [order, ...ORDERS_DB];
        throw paymentErr instanceof Error ? paymentErr : new Error(String(paymentErr));
      }

      ORDERS_DB = [order, ...ORDERS_DB];
      return order;
    } catch (err) {
      order.status = 'FAILED';
      order.serverId = processedServerId;
      order.retryCount = Math.max(0, attempts - 1);
      ORDERS_DB = [order, ...ORDERS_DB];
      throw err instanceof Error ? err : new Error(String(err));
    }
  },

  /** Returns all orders (newest first). */
  async fetchOrders(): Promise<Order[]> {
    await delay(60, true);
    return [...ORDERS_DB];
  },

  /** Cancels an order by id (appends a WAL DELETE). */
  async cancelOrder(orderId: string): Promise<void> {
    const order = ORDERS_DB.find((o) => o.id === orderId);
    if (!order) throw new Error(`orderService: order ${orderId} not found.`);
    await delay(50, true);
    walManager.append('DELETE', 'orders', { orderId });
    order.status = 'FAILED';
  },

  // ─── Monitor exposure ──────────────────────────────────────────────────────
  getCircuitBreaker(): CircuitBreaker {
    return circuitBreaker;
  },

  getCircuitBreakerTransitions(): CBTransition[] {
    return circuitBreaker.getTransitions();
  },

  resetCircuitBreaker(): void {
    circuitBreaker.reset();
  },

  async triggerFailures(count: number): Promise<void> {
    for (let i = 0; i < count; i++) {
      try {
        await circuitBreaker.execute(async () => {
          throw new Error('orderService: forced failure');
        });
      } catch {
        /* expected */
      }
    }
  },

  /**
   * Patches one or more editable fields on a server node.
   * NOTE: `connections` can be manually overridden here, but live traffic
   * (onRequestStart/onRequestEnd in orderService) may concurrently
   * increment/decrement it. A manual edit can be overwritten by an
   * in-flight request resolving shortly after. This is intentional —
   * it demonstrates that real traffic counters take precedence over
   * manual overrides, not a bug to fix.
   */
  updateServer(
    id: string,
    patch: Partial<Pick<ServerNode, 'weight' | 'latency' | 'connections' | 'healthy'>>,
  ): void {
    const server = ORDER_SERVERS.find((s) => s.id === id);
    if (!server) return;
    Object.assign(server, patch);
    notifyServersChanged();
  },

  /** Returns the order cluster (used by the LB panel's least-connections view). */
  getServers(): ServerNode[] {
    return ORDER_SERVERS;
  },

  /** Subscribes to server change events. Returns an unsubscribe function. */
  onServersChanged(cb: () => void): () => void {
    serversChangedCallbacks.push(cb);
    return () => {
      const idx = serversChangedCallbacks.indexOf(cb);
      if (idx >= 0) serversChangedCallbacks.splice(idx, 1);
    };
  },

  /** Returns the Write-Ahead Log (durability visualisation). */
  getWAL() {
    return walManager.getLog();
  },
};
