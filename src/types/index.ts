/**
 * Shared TypeScript types & interfaces for the Distributed Systems E-Commerce Simulator.
 * Every type used across more than one file is declared here to keep a single source of truth.
 */

// ─── Server / Node representation ────────────────────────────────────────────
/** Represents a single backend node in the simulated cluster. */
export interface ServerNode {
  /** Stable identifier, e.g. "server-1". */
  id: string;
  /** Relative capacity weight 1–10, consumed by WeightedRoundRobin. */
  weight: number;
  /** Simulated network latency in milliseconds, consumed by LatencyBased. */
  latency: number;
  /** Active in-flight connection count, consumed by LeastConnections. */
  connections: number;
  /** Whether the node currently passes health checks. */
  healthy: boolean;
  /** Date.now() timestamp of the most recent heartbeat. */
  lastHeartbeat: number;
}

// ─── Load Balancer ───────────────────────────────────────────────────────────
/** Discriminated union of every supported load-balancing algorithm. */
export type LBStrategy =
  | 'roundRobin'
  | 'weightedRoundRobin'
  | 'consistentHash'
  | 'stickySession'
  | 'leastConnections'
  | 'joinIdleQueue'
  | 'latencyBased';

/** Common contract implemented by every load-balancing algorithm. */
export interface ILoadBalancer {
  pick(servers: ServerNode[], requestKey?: string): ServerNode;
  getStats(): Record<string, number>;
  reset(): void;
}

/** A single entry in the live request log shown in the LoadBalancerPanel. */
export interface LBRequestLogEntry {
  id: number;
  timestamp: number;
  serverId: string;
  strategy: LBStrategy;
  reason: string;
}

// ─── Circuit Breaker ─────────────────────────────────────────────────────────
export type CBState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

/** Tunable configuration for a CircuitBreaker instance. */
export interface CBConfig {
  /** Consecutive failures required to trip OPEN. */
  failureThreshold: number;
  /** Successes required in HALF_OPEN to close the circuit. */
  successThreshold: number;
  /** Milliseconds the circuit stays OPEN before probing HALF_OPEN. */
  timeout: number;
}

/** Immutable point-in-time view of a CircuitBreaker. */
export interface CBSnapshot {
  state: CBState;
  failures: number;
  successes: number;
  lastStateChange: number;
}

/** A recorded state transition for the CB timeline UI. */
export interface CBTransition {
  timestamp: number;
  from: CBState;
  to: CBState;
  reason: string;
}

// ─── Retry ───────────────────────────────────────────────────────────────────
/** Tunable configuration for the retry-with-backoff utility. */
export interface RetryConfig {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
  jitter: boolean;
}

// ─── Hashing ─────────────────────────────────────────────────────────────────
/** Serializable snapshot of a consistent-hash ring. */
export interface HashRing {
  virtualNodes: number;
  /** hash position → nodeId */
  ring: Map<number, string>;
  nodes: string[];
}

// ─── Sharding ────────────────────────────────────────────────────────────────
export type ShardStrategy = 'hash' | 'range' | 'directory';

/** Map of shardId → list of keys stored on that shard. */
export interface ShardMap {
  strategy: ShardStrategy;
  shards: Record<string, string[]>;
}

// ─── Heartbeat ───────────────────────────────────────────────────────────────
export type HeartbeatStatus = 'ALIVE' | 'SUSPECTED' | 'DEAD';

/** Registry entry tracking liveness for a single node. */
export interface HeartbeatEntry {
  nodeId: string;
  status: HeartbeatStatus;
  lastSeen: number;
  missedBeats: number;
}

/** A recorded heartbeat status transition for the timeline UI. */
export interface HeartbeatTransition {
  timestamp: number;
  nodeId: string;
  from: HeartbeatStatus;
  to: HeartbeatStatus;
}

// ─── Replication ─────────────────────────────────────────────────────────────
/** A single Write-Ahead Log entry. */
export interface WALEntry {
  /** Monotonically increasing Log Sequence Number. */
  lsn: number;
  timestamp: number;
  operation: 'INSERT' | 'UPDATE' | 'DELETE';
  table: string;
  payload: unknown;
  applied: boolean;
}

/** A node participating in replication. */
export interface ReplicaNode {
  id: string;
  role: 'PRIMARY' | 'REPLICA';
  /** Simulated replication lag in milliseconds. */
  lag: number;
  /** Last WAL LSN applied on this replica. */
  lastLSN: number;
}

// ─── Domain ──────────────────────────────────────────────────────────────────
/** A sellable product record. */
export interface Product {
  id: string;
  name: string;
  price: number;
  stock: number;
  category: string;
  image?: string;
  /** Which simulated server served the most recent request for this product. */
  serverId?: string;
  /** Which shard this record physically lives in. */
  shardId?: string;
}

/** A customer order. */
export interface Order {
  id: string;
  productId: string;
  quantity: number;
  status: 'PENDING' | 'CONFIRMED' | 'FAILED';
  createdAt: number;
  retryCount: number;
  serverId?: string;
  /** Amount charged to the payment gateway on confirmation. */
  amount?: number;
  /** Outcome of the payment-gateway call (only set once payment has been attempted). */
  paymentStatus?: 'PAID' | 'FAILED';
  /** Identifies the payment gateway that processed (or attempted) the charge. */
  paymentServerId?: string;
  /** Number of payment-gateway attempts (analogous to `retryCount` for orders). */
  paymentRetryCount?: number;
}

/** Result of a payment attempt. */
export interface Payment {
  orderId: string;
  amount: number;
  status: 'SUCCESS' | 'FAILED';
  processedAt: number;
  serverId?: string;
  /** Number of attempts before the gateway confirmed (only meaningful on SUCCESS). */
  retryCount?: number;
}

// ─── Service metadata ────────────────────────────────────────────────────────
/** Metadata returned alongside service calls to surface distributed-systems behaviour. */
export interface FetchMeta {
  serverId: string;
  strategy: LBStrategy;
  shardId: string;
  latencyMs: number;
  attempts: number;
}
