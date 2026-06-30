import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowRight, Gauge, Network, Package, ShoppingCart } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';

const CARDS = [
  {
    to: '/shop',
    title: 'Shop',
    description: 'Consistent-hash load balancing + hash sharding across 5 nodes',
    icon: Package,
  },
  {
    to: '/orders',
    title: 'Orders',
    description: 'Least-connections routing, retry+backoff, WAL-durable writes',
    icon: ShoppingCart,
  },
  {
    to: '/monitor',
    title: 'Monitor',
    description: 'Live circuit breakers, heartbeats, replication & sharding',
    icon: Gauge,
  },
  {
    to: '/monitor',
    title: 'Architecture',
    description: 'The full distributed-systems dashboard in one place',
    icon: Network,
  },
] as const;

/** HomePage — animated hero + navigation cards to each showcase. */
export function HomePage() {
  return (
    <div className="space-y-12">
      <section className="relative overflow-hidden rounded-2xl border border-zinc-800 bg-gradient-to-br from-indigo-950/40 via-zinc-900/40 to-zinc-900/10 px-6 py-16 text-center sm:px-12 sm:py-24">
        <div className="pointer-events-none absolute inset-0 opacity-30 [background-image:radial-gradient(circle_at_20%_20%,rgba(99,102,241,0.25),transparent_40%),radial-gradient(circle_at_80%_60%,rgba(99,102,241,0.15),transparent_45%)]" />
        <motion.h1
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
          className="relative bg-gradient-to-r from-indigo-300 via-indigo-400 to-purple-300 bg-clip-text text-4xl font-bold tracking-tight text-transparent sm:text-6xl"
        >
          Distributed E-Commerce
          <br /> Simulator
        </motion.h1>
        <motion.p
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.15 }}
          className="relative mx-auto mt-5 max-w-2xl text-balance text-zinc-400 sm:text-lg"
        >
          A living, interactive showcase of distributed systems concepts — round-robin
          load balancing, circuit breakers, WAL replication, consistent hashing and more,
          running in real time through a polished simulated backend.
        </motion.p>
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.3 }}
          className="relative mt-8 flex flex-wrap items-center justify-center gap-3"
        >
          <Link
            to="/shop"
            className="inline-flex items-center gap-2 rounded-md bg-indigo-500 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-indigo-600"
          >
            Explore the Shop <ArrowRight className="h-4 w-4" />
          </Link>
          <Link
            to="/monitor"
            className="inline-flex items-center gap-2 rounded-md border border-zinc-700 px-5 py-2.5 text-sm font-medium text-zinc-200 transition-colors hover:bg-zinc-800"
          >
            Open the Monitor
          </Link>
        </motion.div>
      </section>

      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {CARDS.map((c, i) => {
          const Icon = c.icon;
          return (
            <motion.div
              key={c.title}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, delay: 0.1 * i }}
            >
              <Link to={c.to} className="block h-full">
                <Card className="group h-full transition-all hover:-translate-y-1 hover:border-indigo-800/60">
                  <CardContent className="flex h-full flex-col p-6">
                    <span className="mb-4 flex h-11 w-11 items-center justify-center rounded-lg bg-indigo-500/15 text-indigo-400 ring-1 ring-indigo-500/30 transition-transform group-hover:scale-110">
                      <Icon className="h-5 w-5" />
                    </span>
                    <h3 className="text-lg font-semibold">{c.title}</h3>
                    <p className="mt-1 flex-1 text-sm text-zinc-400">{c.description}</p>
                    <span className="mt-4 inline-flex items-center gap-1 text-sm text-indigo-400">
                      Open <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-1" />
                    </span>
                  </CardContent>
                </Card>
              </Link>
            </motion.div>
          );
        })}
      </section>
    </div>
  );
}
