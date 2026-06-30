import { Activity, Database, Heart, Network, ShieldCheck } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { LoadBalancerPanel } from '@/components/monitors/LoadBalancerPanel';
import { CircuitBreakerPanel } from '@/components/monitors/CircuitBreakerPanel';
import { HeartbeatPanel } from '@/components/monitors/HeartbeatPanel';
import { ReplicationPanel } from '@/components/monitors/ReplicationPanel';
import { ShardingPanel } from '@/components/monitors/ShardingPanel';

/** MonitorPage — the centrepiece distributed-systems dashboard with five live tabs. */
export function MonitorPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">System Monitor</h1>
        <p className="text-sm text-zinc-400">
          Real-time observation of every distributed-systems algorithm in the simulator.
        </p>
      </div>

      <Tabs defaultValue="loadbalancer" className="w-full">
        <TabsList className="flex w-full flex-wrap justify-start gap-1 h-auto">
          <TabsTrigger value="loadbalancer" className="gap-1.5">
            <Network className="h-4 w-4" /> Load Balancer
          </TabsTrigger>
          <TabsTrigger value="circuitbreaker" className="gap-1.5">
            <ShieldCheck className="h-4 w-4" /> Circuit Breaker
          </TabsTrigger>
          <TabsTrigger value="heartbeat" className="gap-1.5">
            <Heart className="h-4 w-4" /> Heartbeat
          </TabsTrigger>
          <TabsTrigger value="replication" className="gap-1.5">
            <Database className="h-4 w-4" /> Replication
          </TabsTrigger>
          <TabsTrigger value="sharding" className="gap-1.5">
            <Activity className="h-4 w-4" /> Sharding
          </TabsTrigger>
        </TabsList>

        <TabsContent value="loadbalancer">
          <LoadBalancerPanel />
        </TabsContent>
        <TabsContent value="circuitbreaker">
          <CircuitBreakerPanel />
        </TabsContent>
        <TabsContent value="heartbeat">
          <HeartbeatPanel />
        </TabsContent>
        <TabsContent value="replication">
          <ReplicationPanel />
        </TabsContent>
        <TabsContent value="sharding">
          <ShardingPanel />
        </TabsContent>
      </Tabs>
    </div>
  );
}
