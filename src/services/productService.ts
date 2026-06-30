import type {
  CBConfig,
  CBTransition,
  FetchMeta,
  LBRequestLogEntry,
  LBStrategy,
  Product,
  RetryConfig,
  ServerNode,
} from '@/types';
import { delay } from '@/utils/delay';
import { CircuitBreaker } from '@/utils/circuitBreaker';
import { withRetry } from '@/utils/retry';
import { createLoadBalancer } from '@/utils/loadBalancer';
import type { ILoadBalancer } from '@/types';
import { getHashShard } from '@/utils/sharding';

/** Failure rate used to inject transient faults so retries & the circuit breaker are observable. */
const PRODUCT_FAILURE_RATE = 0.1;
/** Number of hash shards the product keyspace is split across. */
const PRODUCT_SHARD_COUNT = 3;

/** Tunable circuit-breaker config for the product service. */
const PRODUCT_CB_CONFIG: CBConfig = {
  failureThreshold: 4,
  successThreshold: 2,
  timeout: 6000,
};

/** Tunable retry config for the product service. */
const PRODUCT_RETRY_CONFIG: RetryConfig = {
  maxAttempts: 4,
  baseDelayMs: 200,
  maxDelayMs: 1500,
  jitter: true,
};

/** Human-readable explanation of why each strategy picks a given node. */
const STRATEGY_REASON: Record<LBStrategy, string> = {
  roundRobin: 'round-robin: next healthy node in cycle',
  weightedRoundRobin: 'weighted round-robin: weighted slot rotation',
  consistentHash: 'consistent hash: ring lookup for session key',
  stickySession: 'sticky session: pinned node for this session',
  leastConnections: 'least-connections: fewest in-flight requests',
  joinIdleQueue: 'join-idle-queue: first idle worker dequeued',
  latencyBased: 'latency-based: lowest observed latency (EWMA)',
};

/** Shared simulated 5-node cluster backing the product service (visualised in the LB panel). */
export const PRODUCT_SERVERS: ServerNode[] = [
  { id: 'server-1', weight: 5, latency: 45, connections: 0, healthy: true, lastHeartbeat: Date.now() },
  { id: 'server-2', weight: 3, latency: 80, connections: 0, healthy: true, lastHeartbeat: Date.now() },
  { id: 'server-3', weight: 7, latency: 30, connections: 0, healthy: true, lastHeartbeat: Date.now() },
  { id: 'server-4', weight: 2, latency: 120, connections: 0, healthy: true, lastHeartbeat: Date.now() },
  { id: 'server-5', weight: 4, latency: 60, connections: 0, healthy: true, lastHeartbeat: Date.now() },
];

/** Internal simulated product database: 20 diverse records. */
const PRODUCTS_DB: Product[] = [
  { id: 'p-001', name: 'Mechanical Keyboard', price: 129.99, stock: 42, category: 'Peripherals' },
  { id: 'p-002', name: 'Wireless Mouse', price: 49.99, stock: 130, category: 'Peripherals' },
  { id: 'p-003', name: '27" 4K Monitor', price: 389.0, stock: 18, category: 'Displays' },
  { id: 'p-004', name: 'USB-C Hub', price: 34.5, stock: 210, category: 'Accessories' },
  { id: 'p-005', name: 'Noise-Cancelling Headphones', price: 219.99, stock: 27, category: 'Audio' },
  { id: 'p-006', name: 'Webcam 1080p', price: 79.0, stock: 64, category: 'Peripherals' },
  { id: 'p-007', name: 'Standing Desk Mat', price: 59.99, stock: 88, category: 'Office' },
  { id: 'p-008', name: 'Ergonomic Chair', price: 449.0, stock: 11, category: 'Office' },
  { id: 'p-009', name: 'SSD 1TB NVMe', price: 99.99, stock: 150, category: 'Storage' },
  { id: 'p-010', name: 'Portable SSD 500GB', price: 69.0, stock: 95, category: 'Storage' },
  { id: 'p-011', name: 'Mechanical Pencil Set', price: 14.99, stock: 320, category: 'Stationery' },
  { id: 'p-012', name: 'Desk Lamp LED', price: 39.0, stock: 72, category: 'Office' },
  { id: 'p-013', name: 'Bluetooth Speaker', price: 89.99, stock: 54, category: 'Audio' },
  { id: 'p-014', name: 'Laptop Stand Aluminium', price: 45.0, stock: 120, category: 'Accessories' },
  { id: 'p-015', name: 'External HDD 4TB', price: 109.0, stock: 40, category: 'Storage' },
  { id: 'p-016', name: 'Graphics Tablet', price: 259.99, stock: 22, category: 'Peripherals' },
  { id: 'p-017', name: 'Smart Notebooks 3-Pack', price: 24.99, stock: 200, category: 'Stationery' },
  { id: 'p-018', name: 'Cable Organiser Kit', price: 19.99, stock: 260, category: 'Accessories' },
  { id: 'p-019', name: 'Curved Ultrawide Monitor', price: 549.0, stock: 9, category: 'Displays' },
  { id: 'p-020', name: 'Wireless Charging Pad', price: 29.0, stock: 175, category: 'Accessories' },
].map((p) => ({ ...p, shardId: `shard-${getHashShard(p.id, PRODUCT_SHARD_COUNT)}` }));

// ─── Module-level singletons ─────────────────────────────────────────────────
let currentStrategy: LBStrategy = 'consistentHash';
let balancer: ILoadBalancer = createLoadBalancer(currentStrategy);
const circuitBreaker = new CircuitBreaker('product', PRODUCT_CB_CONFIG);

// Live request log (most-recent-first) for the LoadBalancerPanel.
let requestLog: LBRequestLogEntry[] = [];
let logSeq = 0;
type RequestListener = (entry: LBRequestLogEntry) => void;
const requestListeners: RequestListener[] = [];

// Server-change subscription so panels can re-render when servers are edited.
const serversChangedCallbacks: Array<() => void> = [];
function notifyServersChanged() {
  for (const cb of serversChangedCallbacks) cb();
}

/** Records a pick in the shared request log and notifies subscribers. */
function logPick(serverId: string, strategy: LBStrategy): void {
  const entry: LBRequestLogEntry = {
    id: ++logSeq,
    timestamp: Date.now(),
    serverId,
    strategy,
    reason: STRATEGY_REASON[strategy],
  };
  requestLog = [entry, ...requestLog].slice(0, 20);
  for (const cb of requestListeners) cb(entry);
}

/**
 * Product service.
 * Distributed systems concept: a façade that combines consistent-hash load
 * balancing, hash-based sharding, a circuit breaker, and retry-with-backoff to
 * serve product data from a simulated 5-node cluster with 10% injected failures.
 */
export const productService = {
  /** The shared server pool backing this service (mutated by the monitor UI). */
  servers: PRODUCT_SERVERS,

  /** Returns all products, routed through the LB + CB + retry stack. */
  async fetchAll(sessionId: string): Promise<{ data: Product[]; meta: FetchMeta }> {
    const start = Date.now();
    let attempts = 0;
    let pickedServerId = 'unknown';
    let pickedShardId = 'shard-0';

    const result = await circuitBreaker.execute(async () => {
      return withRetry(
        async () => {
          attempts += 1;
          const server = balancer.pick(PRODUCT_SERVERS, sessionId);
          pickedServerId = server.id;
          pickedShardId = 'all';
          logPick(server.id, currentStrategy);
          await delay(server.latency, true);
          if (Math.random() < PRODUCT_FAILURE_RATE) {
            throw new Error(`productService: transient failure on ${server.id}`);
          }
          return PRODUCTS_DB.map((p) => ({ ...p, serverId: server.id }));
        },
        PRODUCT_RETRY_CONFIG,
        (attempt) => {
          attempts = Math.max(attempts, attempt + 1);
        },
      );
    });

    return {
      data: result,
      meta: {
        serverId: pickedServerId,
        strategy: currentStrategy,
        shardId: pickedShardId,
        latencyMs: Date.now() - start,
        attempts,
      },
    };
  },

  /** Returns a single product by id (routed through the same resilient stack). */
  async fetchById(id: string): Promise<Product> {
    const product = PRODUCTS_DB.find((p) => p.id === id);
    if (!product) throw new Error(`productService: product ${id} not found.`);
    const server = balancer.pick(PRODUCT_SERVERS, id);
    logPick(server.id, currentStrategy);
    await delay(server.latency, true);
    if (Math.random() < PRODUCT_FAILURE_RATE) {
      throw new Error(`productService: transient failure fetching ${id}`);
    }
    return { ...product, serverId: server.id };
  },

  /** Decrements stock for a product (simulated write). */
  async decrementStock(id: string, qty: number): Promise<void> {
    const product = PRODUCTS_DB.find((p) => p.id === id);
    if (!product) throw new Error(`productService: product ${id} not found.`);
    if (product.stock < qty) {
      throw new Error(`productService: insufficient stock for ${id}.`);
    }
    const server = balancer.pick(PRODUCT_SERVERS, id);
    logPick(server.id, currentStrategy);
    await delay(server.latency, true);
    product.stock -= qty;
  },

  // ─── Monitor exposure ──────────────────────────────────────────────────────
  /** Returns the active load-balancer strategy. */
  getStrategy(): LBStrategy {
    return currentStrategy;
  },

  /** Swaps the active load balancer (rebuilding internal state) at runtime. */
  setStrategy(strategy: LBStrategy): void {
    if (strategy === currentStrategy) return;
    currentStrategy = strategy;
    balancer = createLoadBalancer(strategy);
    balancer.reset();
  },

  /** Returns a copy of the recent request log (most-recent-first). */
  getRequestLog(): LBRequestLogEntry[] {
    return [...requestLog];
  },

  /** Subscribes to live request-pick events. Returns an unsubscribe function. */
  subscribeRequests(cb: RequestListener): () => void {
    requestListeners.push(cb);
    return () => {
      const idx = requestListeners.indexOf(cb);
      if (idx >= 0) requestListeners.splice(idx, 1);
    };
  },

  /** Returns the product circuit breaker (for the CircuitBreakerPanel). */
  getCircuitBreaker(): CircuitBreaker {
    return circuitBreaker;
  },

  /** Returns the product circuit breaker's transition timeline. */
  getCircuitBreakerTransitions(): CBTransition[] {
    return circuitBreaker.getTransitions();
  },

  /** Resets the product circuit breaker to CLOSED (Reset button). */
  resetCircuitBreaker(): void {
    circuitBreaker.reset();
  },

  /** Forces `count` guaranteed failures through the breaker to drive it toward OPEN. */
  async triggerFailures(count: number): Promise<void> {
    for (let i = 0; i < count; i++) {
      try {
        await circuitBreaker.execute(async () => {
          throw new Error('productService: forced failure');
        });
      } catch {
        /* expected — drives the breaker toward OPEN */
      }
    }
  },

  /** Fires `count` lightweight balancer picks (no failure/CB layer) for the LB demo. */
  sendDemoRequests(count: number, sessionId: string): LBRequestLogEntry[] {
    const picks: LBRequestLogEntry[] = [];
    for (let i = 0; i < count; i++) {
      const server = balancer.pick(PRODUCT_SERVERS, `${sessionId}:${i}`);
      logPick(server.id, currentStrategy);
      picks.push({
        id: logSeq,
        timestamp: Date.now(),
        serverId: server.id,
        strategy: currentStrategy,
        reason: STRATEGY_REASON[currentStrategy],
      });
    }
    return picks;
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
    const server = PRODUCT_SERVERS.find((s) => s.id === id);
    if (!server) return;
    Object.assign(server, patch);
    notifyServersChanged();
  },

  /** Toggles a server's health to demonstrate unhealthy-node skipping. */
  toggleServerHealth(serverId: string): void {
    const server = PRODUCT_SERVERS.find((s) => s.id === serverId);
    if (!server) return;
    this.updateServer(serverId, { healthy: !server.healthy });
  },

  /** Resets the cluster to fully-healthy defaults. */
  resetServers(): void {
    for (const s of PRODUCT_SERVERS) {
      s.healthy = true;
      s.connections = 0;
    }
    notifyServersChanged();
  },

  /** Subscribes to server change events. Returns an unsubscribe function. */
  onServersChanged(cb: () => void): () => void {
    serversChangedCallbacks.push(cb);
    return () => {
      const idx = serversChangedCallbacks.indexOf(cb);
      if (idx >= 0) serversChangedCallbacks.splice(idx, 1);
    };
  },
};
