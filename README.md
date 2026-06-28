# Distributed Systems E-Commerce Simulator

> An interactive, single-page React + TypeScript application that demonstrates **seven core distributed-systems concepts** — load balancing, circuit breaking, retry with backoff, consistent hashing, sharding, heartbeat failure detection, and replication over a write-ahead log — by simulating an e-commerce backend entirely in the browser, with no real network endpoints.

---

## Table of Contents

- [Distributed Systems Concepts](#distributed-systems-concepts)
- [Tech Stack](#tech-stack)
- [Project Structure](#project-structure)
- [How to Run](#how-to-run)
- [Architecture](#architecture)
- [Lecture Coverage](#lecture-coverage)
- [License](#license)

---

## Distributed Systems Concepts

The project implements seven distributed-systems concepts as real, deterministic algorithms running in-memory. Every algorithm lives in a pure TypeScript utility with no React dependency, so it is fully testable in isolation and composed into the service layer that powers the user-facing shop and orders pages.

A placed order flows through a **two-phase transactional path**: it is first routed, retried, and WAL-logged by `orderService` (least-connections cluster), then synchronously charged via `paymentService` (weighted-round-robin payment-gateway cluster). The order reaches `CONFIRMED` only when both phases succeed; a payment failure leaves the order durably logged but flagged `FAILED` with `paymentStatus: 'FAILED'`, surfacing the partial-failure state in the dashboard. Critically, each service owns its **own independent circuit breaker** so a cascade in the payment gateways cannot tank order placement, and vice-versa — the isolation is now demonstrated in live user traffic, not only via the monitor's "Trigger Failures" button.

### 1. Load Balancing — 7 Strategies

Each load balancer implements a common `ILoadBalancer` contract (`pick`, `getStats`, `reset`) and is selected at runtime via an exhaustive `createLoadBalancer(strategy)` factory (`src/utils/loadBalancer/index.ts`). The strategies are:

- **Round Robin** (`roundRobin.ts`) — cyclic counter modulo the healthy-node count.
- **Weighted Round Robin** (`weightedRoundRobin.ts`) — each node is expanded into `weight` slots in a rotation array; the array is lazily rebuilt when the healthy set or any weight changes (tracked via a sorted `id:weight` signature).
- **Consistent Hash** (`consistentHash.ts`) — wraps the `ConsistentHashRing` class with 150 virtual nodes per real node, binary-searched for the nearest clockwise position; minimal redistribution on node join/leave.
- **Sticky Session** (`stickySession.ts`) — pins `requestKey → nodeId`; falls back to round-robin and re-pins if the pinned node becomes unhealthy.
- **Least Connections** (`leastConnections.ts`) — picks the healthy node with the minimum in-flight `connections` counter; counters are maintained via explicit `onRequestStart` / `onRequestEnd` lifecycle hooks.
- **Join Idle Queue** (`joinIdleQueue.ts`) — FIFO worker-pool pattern; idle servers wait in a queue, each request dequeues one, and `onRequestEnd` re-enqueues the worker. A background reaper reclaims workers whose `onRequestEnd` was never called (defensive against caller-side leaks).
- **Latency Based** (`latencyBased.ts`) — picks the lowest estimated latency via an Exponentially Weighted Moving Average (α = 0.3); fire-and-forget background probes refresh estimates for **all** healthy candidates, not just the chosen one.

### 2. Circuit Breaker

A three-state finite-state machine — `CLOSED → OPEN → HALF_OPEN` — implemented as a **pure transition function** (`src/utils/circuitBreaker/CircuitBreakerState.ts`) plus a stateful async wrapper (`CircuitBreaker.ts`). The wrapper fail-fasts while `OPEN`, auto-advances to `HALF_OPEN` after a configurable cool-down timeout, and allows exactly one concurrent probe in `HALF_OPEN` (single-probe gating via an in-flight flag, cleared unconditionally in a `finally` block so the breaker self-recovers for `successThreshold > 1`). Each service owns its own breaker so a cascade in one service cannot propagate to others.

### 3. Retry with Exponential Backoff + Full Jitter

`computeBackoff(attempt, config)` (`src/utils/retry/backoff.ts`) implements `min(maxDelay, baseDelay × 2^attempt) × Math.random()` — the AWS-style "full jitter" pattern that decorrelates competing clients and prevents thundering-herd retries. `withRetry(fn, config, onAttempt)` (`retry.ts`) calls `fn` up to `maxAttempts` times, sleeping via `computeBackoff` between attempts (never after the last). Critically, the load balancer's `pick()` runs **inside** the retry closure, so each retry attempt can route to a different server, giving genuine fault isolation across the cluster.

### 4. Consistent Hashing

`ConsistentHashRing` (`src/utils/hashing/consistentHash.ts`) places each node on a 32-bit hash ring at `virtualNodes` positions (default 150), using the `djb2` hash function (`hashCode.ts`) over `"<nodeId>:vnode:<i>"`. Lookup is a lower-bound binary search for the first position ≥ the key's hash, with wrap-around to position zero when the hash exceeds all positions. The constructor throws on `virtualNodes ≤ 0`, and `addNode` deduplicates positions to prevent collision-induced `getNode()` crashes. The same `hashCode` powers hash sharding.

### 5. Sharding — 3 Strategies

Three sharding strategies live side by side in `src/utils/sharding/`:

- **Hash** (`hashShard.ts`) — `hashCode(key) % shardCount`. Deterministic, even spread; adding a shard reshuffles nearly all keys (the limitation consistent hashing addresses for load balancing).
- **Range** (`rangeShard.ts`) — linear scan over contiguous numeric `[min, max]` partitions; **throws** on out-of-range keys with no default route, surfacing range sharding's requirement to provision for the full keyspace up front.
- **Directory** (`directoryShard.ts`) — a `Map<string, string>` lookup table with `assign` / `resolve` / `unassign`; full placement flexibility at the cost of a routing hop on every access.

### 6. Heartbeat Failure Detection

`ServerRegistry` (`src/utils/heartbeat/ServerRegistry.ts`) holds the authoritative membership view with O(1) Map lookups. `HeartbeatMonitor` (`HeartbeatMonitor.ts`) ticks on a configurable interval and computes `missedBeats = floor(elapsed / intervalMs)` per node; crossing `suspectThreshold` transitions the node to `SUSPECTED` and crossing `deadThreshold` to `DEAD`. Non-crashed nodes auto-renew their heartbeat on every tick, so the detector watches for the **absence** of beats — only nodes explicitly added to the `crashedNodes` set accumulate missed beats and progress through the two-phase `ALIVE → SUSPECTED → DEAD` sequence. The default config is `interval = 1000ms`, `suspect = 3`, `dead = 6`.

### 7. Replication — Active + Passive over a WAL

A single `WALManager` (`src/utils/replication/WALManager.ts`) provides an append-only log with monotonically increasing Log Sequence Numbers (`++lsnCounter`), `getSince(fromLsn)` for replica pulls, `getUnflushed()` for the apply gate, `markApplied(lsn)`, and `truncate(upToLsn)` for compaction.

- **Active (eager) replication** (`activeReplication.ts`) — `Promise.all` over all replicas; the WAL entry is marked applied only after every replica acknowledges, giving **strong consistency** at the cost of write latency. Per-replica serialization queues (a `Map<id, Promise<void>>` of chained tails) guarantee each replica applies writes in issuance order despite delay jitter.
- **Passive (lazy) replication** (`passiveReplication.ts`) — replicas independently pull `getSince(lastLSN)` on a polling interval with per-replica simulated lag, giving **eventual consistency** with observable divergence. An `inFlight` set guarded by a `try/finally` prevents overlapping polls per replica; entries are marked applied only once the minimum `lastLSN` across all replicas catches up past the entry — the all-replicas-caught-up gate.

In the live data path, `orderService` appends a WAL `INSERT` on every successful placement and a `DELETE` on every cancel, while `paymentService` appends a WAL `UPDATE` on every successful charge — so the order-flow's two phases are durability-logged through the same WAL primitive the replication panel visualises.

---

## Tech Stack

| Layer | Choice |
|---|---|
| Framework | React 18 (Vite, not CRA) |
| Language | TypeScript 5 (`strict` + `noUncheckedIndexedAccess`) |
| UI Library | shadcn/ui (Tailwind CSS v3) |
| Icons | lucide-react |
| Animations | tailwindcss-animate + Framer Motion (state-machine transitions) |
| State | React built-in hooks only (no Redux/Zustand) |
| Routing | React Router v6 |
| Tooling | Node 18+, npm |

---

## Project Structure

```
ds-project/
├── index.html
├── package.json
├── tsconfig.json                  ← strict + noUncheckedIndexedAccess
├── vite.config.ts
├── tailwind.config.ts
└── src/
    ├── App.tsx                    ← Router + route table
    ├── main.tsx                   ← Vite entry; applies dark class
    ├── index.css                  ← Tailwind + theme variables
    ├── types/
    │   └── index.ts               ← All shared TypeScript types & interfaces
    ├── lib/
    │   └── utils.ts               ← shadcn cn() class-merge helper
    ├── utils/
    │   ├── delay.ts               ← Simulated async latency with jitter
    │   ├── circuitBreaker/
    │   │   ├── CircuitBreakerState.ts   ← Pure FSM: transition()
    │   │   ├── CircuitBreaker.ts        ← Stateful async wrapper
    │   │   └── index.ts
    │   ├── retry/
    │   │   ├── backoff.ts              ← computeBackoff (full jitter)
    │   │   ├── retry.ts                ← withRetry()
    │   │   └── index.ts
    │   ├── hashing/
    │   │   ├── hashCode.ts             ← djb2 32-bit hash
    │   │   ├── consistentHash.ts       ← ConsistentHashRing class
    │   │   └── index.ts
    │   ├── sharding/
    │   │   ├── hashShard.ts
    │   │   ├── rangeShard.ts
    │   │   ├── directoryShard.ts
    │   │   └── index.ts
    │   ├── heartbeat/
    │   │   ├── ServerRegistry.ts
    │   │   ├── HeartbeatMonitor.ts
    │   │   └── index.ts
    │   ├── replication/
    │   │   ├── WALManager.ts
    │   │   ├── activeReplication.ts
    │   │   ├── passiveReplication.ts
    │   │   └── index.ts
    │   └── loadBalancer/
    │       ├── roundRobin.ts
    │       ├── weightedRoundRobin.ts
    │       ├── consistentHash.ts
    │       ├── stickySession.ts
    │       ├── leastConnections.ts
    │       ├── joinIdleQueue.ts
    │       ├── latencyBased.ts
    │       └── index.ts                ← createLoadBalancer() factory
    ├── services/
    │   ├── productService.ts           ← consistent-hash + 10% failure
    │   ├── orderService.ts             ← least-connections + 20% failure + WAL
    │   │                                  (orchestrates the two-phase order→payment flow)
    │   └── paymentService.ts           ← weighted-RR + 15% failure + WAL UPDATE
    │                                      (invoked by orderService.placeOrder on every order)
    ├── hooks/
    │   ├── useWithFallback.ts
    │   ├── useProducts.ts
    │   └── useOrders.ts
    ├── components/
    │   ├── layout/                     ← AppShell, Navbar
    │   ├── monitors/                   ← LoadBalancer, CircuitBreaker,
    │   │                                  Heartbeat, Replication, Sharding panels
    │   ├── shop/                       ← ProductCard, ProductGrid, OrderForm, OrderList
    │   └── ui/                         ← shadcn/ui primitives
    └── pages/
        ├── HomePage.tsx
        ├── ShopPage.tsx
        ├── OrdersPage.tsx
        └── MonitorPage.tsx
```

---

## How to Run

Requires Node 18+ and npm.

```bash
# 1. Install dependencies
npm install

# 2. Start the dev server (opens http://localhost:5173)
npm run dev

# 3. Type-check (strict mode, no emit)
npm run typecheck

# 4. Production build (type-checks then bundles via Vite)
npm run build

# 5. Preview the production build
npm run preview
```

The application opens on the home page. The `/shop` and `/orders` routes are the user-facing e-commerce surface; the `/monitor` route is the five-tab dashboard where every distributed-systems algorithm is observable live.

---

## Architecture

### Why simulated async instead of a real backend

The project deliberately replaces real network endpoints with `delay(ms, jitter)` (`src/utils/delay.ts`), which wraps `setTimeout` in a `Promise<void>` with ±30 % jitter. Every "network call" in the app — load-balancer picks, service calls, heartbeat ticks, replication polls — flows through this function. There are three reasons for this choice:

1. **Zero infrastructure.** The entire simulation runs in the browser. No Docker, no databases, no message brokers — a hiring committee or university examiner can open the app and watch every algorithm run live without setup.
2. **Deterministic observability.** Because the algorithms run in-memory with callback-based event streams, the dashboard can render every load-balancer pick, every circuit-breaker transition, every heartbeat status change, and every WAL append in real time. A real backend would require tracing infrastructure to expose the same level of internal state.
3. **Faithful external interface.** Although the calls are simulated, the service layer (`productService`, `orderService`, `paymentService`) exposes a real asynchronous API — `async` functions returning `Promise`s, throwing on failure, retrying with backoff. Components and hooks consume these exactly as they would a real fetch-based client, so the simulation exercises the full resilience stack.

### Two-phase transactional order flow

A placed order is a **two-phase transaction** spanning two independent service clusters:

```
placeOrder(productId, qty, amount)
   │
   ▼  Phase 1 — orderService (least-connections, 3-node, 20% failure, own breaker, WAL INSERT)
   │     ✓ confirmed → phase 2
   │     ✗ failure  → order FAILED, rethrow (no payment attempted)
   ▼  Phase 2 — paymentService (weighted-RR, 3-node, 15% failure, own breaker, WAL UPDATE)
   │     ✓ paid     → order CONFIRMED, paymentStatus='PAID', paymentServerId, paymentRetryCount
   │     ✗ failure  → order FAILED, paymentStatus='FAILED', kept in history (partial-failure surfaced)
   ▼
return Order
```

The `orderService.placeOrder` signature is `(productId, quantity, amount)` — the `amount` is computed by the caller (`product.price * quantity` on the shop page; the order form on the orders page) and threaded through `useOrders` into the service. On the order row, four new fields surface the payment outcome to the dashboard: `amount`, `paymentStatus` (`'PAID'|'FAILED'`), `paymentServerId`, and `paymentRetryCount`. The `OrderList` renders dedicated Amount / Payment / Gateway columns so a viewer can immediately see which orders paid and which failed at the payment stage.

The two breakers are **independent module-level singletons** (`new CircuitBreaker('order', ORDER_CB_CONFIG)` in `orderService.ts`, `new CircuitBreaker('payment', PAYMENT_CB_CONFIG)` in `paymentService.ts`), with different thresholds and timeouts. A sustained failure in the payment gateways trips the payment breaker OPEN and fail-fasts further charges, but the order cluster keeps accepting placements — exactly the isolation property the monitor's "three breakers side by side" view claims. Differentiated failure rates (10% product / 20% order / 15% payment) make retry counts visibly different across services in the dashboard.

### Layered separation of concerns

The codebase enforces a strict four-layer architecture:

```
┌─────────────────────────────────────────────────────────┐
│  Components / Pages   (React, Framer Motion, shadcn/ui) │
│              ▲                                          │
│              │ only via hooks                            │
│  Hooks        (useProducts, useOrders, useWithFallback)  │
│              ▲                                          │
│              │ pure async calls                          │
│  Services     (productService, orderService, ...)        │
│              ▲                                          │
│              │ compose                                   │
│  Utils        (load balancers, CB, retry, WAL, ...)      │
│              ▲                                          │
│              │ pure functions / classes                  │
│  Types        (single source of truth)                   │
└─────────────────────────────────────────────────────────┘
```

- **Utils know nothing about React.** They are pure TypeScript classes and functions, fully testable in isolation.
- **Services know nothing about components.** They orchestrate utils and expose async APIs plus monitor hooks.
- **Hooks are the only bridge** between services and React; they translate service state into React state.
- **Module-level singletons.** Each service file instantiates its own `CircuitBreaker`, `ILoadBalancer`, and `WALManager` at module scope, mirroring how real backend singletons behave and ensuring the shop, orders, and monitor pages share the same state.

---

## Lecture Coverage

| Lecture | Concept | Primary files |
|---------|---------|---------------|
| L1 — Foundations & System Design | Multiple independent node clusters, two-phase transactional order→payment flow, per-service circuit-breaker isolation, layered architecture | `src/services/orderService.ts`, `paymentService.ts`, `productService.ts`, `src/types/index.ts` |
| L3 — Replication | Active (eager) + Passive (lazy) replication over a Write-Ahead Log with monotonic LSNs | `src/utils/replication/WALManager.ts`, `activeReplication.ts`, `passiveReplication.ts` |
| L4 — Sharding & Data Partitioning | Hash, Range, and Directory sharding strategies | `src/utils/sharding/hashShard.ts`, `rangeShard.ts`, `directoryShard.ts` |
| L4 — Consistent Hashing | Virtual-node consistent hash ring with binary-search lookup | `src/utils/hashing/consistentHash.ts`, `hashCode.ts` |
| L5 — Fault Tolerance | Heartbeat failure detection (ALIVE → SUSPECTED → DEAD), Circuit Breaker (3-state FSM), Retry with exponential backoff + full jitter | `src/utils/heartbeat/`, `src/utils/circuitBreaker/`, `src/utils/retry/` |
| L6 — Load Balancing | Seven strategies: RR, Weighted RR, Consistent Hash, Sticky Session, Least Connections, Join Idle Queue, Latency-Based (EWMA) | `src/utils/loadBalancer/*.ts` |

---

## License

This project is provided as-is for educational and portfolio purposes.