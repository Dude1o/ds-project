import type { ILoadBalancer, LBStrategy } from '@/types';
import { RoundRobinBalancer } from './roundRobin';
import { WeightedRoundRobinBalancer } from './weightedRoundRobin';
import { ConsistentHashBalancer } from './consistentHash';
import { StickySessionBalancer } from './stickySession';
import { LeastConnectionsBalancer } from './leastConnections';
import { JoinIdleQueueBalancer } from './joinIdleQueue';
import { LatencyBasedBalancer } from './latencyBased';

export { RoundRobinBalancer } from './roundRobin';
export { WeightedRoundRobinBalancer } from './weightedRoundRobin';
export { ConsistentHashBalancer } from './consistentHash';
export { StickySessionBalancer } from './stickySession';
export { LeastConnectionsBalancer } from './leastConnections';
export { JoinIdleQueueBalancer } from './joinIdleQueue';
export { LatencyBasedBalancer } from './latencyBased';

/**
 * Factory for load balancers.
 * Distributed systems concept: a single seam that swaps the active strategy at
 * runtime. The exhaustive switch uses the TypeScript `never` check so adding a
 * new `LBStrategy` variant without a corresponding case fails to compile.
 */
export function createLoadBalancer(strategy: LBStrategy): ILoadBalancer {
  switch (strategy) {
    case 'roundRobin':
      return new RoundRobinBalancer();
    case 'weightedRoundRobin':
      return new WeightedRoundRobinBalancer();
    case 'consistentHash':
      return new ConsistentHashBalancer();
    case 'stickySession':
      return new StickySessionBalancer();
    case 'leastConnections':
      return new LeastConnectionsBalancer();
    case 'joinIdleQueue':
      return new JoinIdleQueueBalancer();
    case 'latencyBased':
      return new LatencyBasedBalancer();
    default: {
      const _exhaustive: never = strategy;
      throw new Error(`Unknown load balancer strategy: ${String(_exhaustive)}`);
    }
  }
}