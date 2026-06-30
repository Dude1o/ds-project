import type {
  CBConfig,
  CBTransition,
  Payment,
  RetryConfig,
  ServerNode,
} from '@/types';
import { delay } from '@/utils/delay';
import { CircuitBreaker } from '@/utils/circuitBreaker';
import { withRetry } from '@/utils/retry';
import { WeightedRoundRobinBalancer } from '@/utils/loadBalancer';
import { WALManager } from '@/utils/replication';

/** Failure rate injected into payment processing. */
const PAYMENT_FAILURE_RATE = 0.15;

const PAYMENT_CB_CONFIG: CBConfig = {
  failureThreshold: 4,
  successThreshold: 2,
  timeout: 5000,
};

const PAYMENT_RETRY_CONFIG: RetryConfig = {
  maxAttempts: 3,
  baseDelayMs: 300,
  maxDelayMs: 1800,
  jitter: true,
};

/** Simulated payment-gateway cluster weighted by capacity. */
const PAYMENT_SERVERS: ServerNode[] = [
  { id: 'pay-gw-1', weight: 6, latency: 110, connections: 0, healthy: true, lastHeartbeat: Date.now() },
  { id: 'pay-gw-2', weight: 2, latency: 180, connections: 0, healthy: true, lastHeartbeat: Date.now() },
  { id: 'pay-gw-3', weight: 4, latency: 90, connections: 0, healthy: true, lastHeartbeat: Date.now() },
];

// ─── Module-level singletons ─────────────────────────────────────────────────
const balancer = new WeightedRoundRobinBalancer();
const circuitBreaker = new CircuitBreaker('payment', PAYMENT_CB_CONFIG);
const walManager = new WALManager();

const serversChangedCallbacks: Array<() => void> = [];
function notifyServersChanged() {
  for (const cb of serversChangedCallbacks) cb();
}

/**
 * Payment service.
 * Distributed systems concept: payment processing is routed by weighted
 * round-robin (higher-capacity gateways get more traffic), guarded by its own
 * circuit breaker, hardened with retry+backoff, and recorded via a WAL UPDATE
 * on success. 15% transient failure rate makes retries visible.
 */
export const paymentService = {
  /** Processes a payment for `orderId`, routing through the resilient stack. */
  async processPayment(orderId: string, amount: number): Promise<Payment> {
    let processedServerId = 'unknown';
    let attempts = 0;

    await circuitBreaker.execute(async () => {
      return withRetry(
        async () => {
          attempts += 1;
          const server = balancer.pick(PAYMENT_SERVERS);
          processedServerId = server.id;
          await delay(server.latency, true);
          if (Math.random() < PAYMENT_FAILURE_RATE) {
            throw new Error(`paymentService: transient failure on ${server.id}`);
          }
          return true;
        },
        PAYMENT_RETRY_CONFIG,
      );
    });

    walManager.append('UPDATE', 'payments', { orderId, amount });
    const payment: Payment = {
      orderId,
      amount,
      status: 'SUCCESS',
      processedAt: Date.now(),
      serverId: processedServerId,
      retryCount: Math.max(0, attempts - 1),
    };
    return payment;
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
          throw new Error('paymentService: forced failure');
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
    const server = PAYMENT_SERVERS.find((s) => s.id === id);
    if (!server) return;
    Object.assign(server, patch);
    notifyServersChanged();
  },

  getServers(): ServerNode[] {
    return PAYMENT_SERVERS;
  },

  /** Subscribes to server change events. Returns an unsubscribe function. */
  onServersChanged(cb: () => void): () => void {
    serversChangedCallbacks.push(cb);
    return () => {
      const idx = serversChangedCallbacks.indexOf(cb);
      if (idx >= 0) serversChangedCallbacks.splice(idx, 1);
    };
  },

  getWAL() {
    return walManager.getLog();
  },
};
