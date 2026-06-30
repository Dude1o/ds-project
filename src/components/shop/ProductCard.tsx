import { motion } from 'framer-motion';
import { Boxes, Server } from 'lucide-react';
import type { Product } from '@/types';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

interface ProductCardProps {
  product: Product;
  onOrder: (product: Product) => void;
}

/** ProductCard — a single product tile with shard/server metadata badges. */
export function ProductCard({ product, onOrder }: ProductCardProps) {
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
    >
      <Card className="group h-full transition-colors hover:border-indigo-800/60">
        <CardContent className="flex h-full flex-col p-4">
          <div className="mb-3 flex aspect-square items-center justify-center rounded-lg bg-gradient-to-br from-indigo-500/10 to-zinc-800/40">
            <Boxes className="h-10 w-10 text-indigo-400/60" />
          </div>
          <div className="flex-1 space-y-1">
            <div className="flex items-start justify-between gap-2">
              <h3 className="text-sm font-semibold leading-tight">{product.name}</h3>
              <span className="shrink-0 font-mono text-sm text-indigo-300">
                ${product.price.toFixed(2)}
              </span>
            </div>
            <div className="flex items-center gap-2 text-xs text-zinc-500">
              <span>{product.category}</span>
              <span>·</span>
              <span>stock: {product.stock}</span>
            </div>
            <div className="flex flex-wrap gap-1 pt-1">
              {product.shardId && <Badge variant="info" className="text-[10px]">{product.shardId}</Badge>}
              {product.serverId && (
                <Badge variant="outline" className="gap-1 text-[10px]">
                  <Server className="h-2.5 w-2.5" /> {product.serverId}
                </Badge>
              )}
            </div>
          </div>
          <Button
            size="sm"
            className="mt-3 w-full"
            disabled={product.stock <= 0}
            onClick={() => onOrder(product)}
          >
            {product.stock <= 0 ? 'Out of stock' : 'Order'}
          </Button>
        </CardContent>
      </Card>
    </motion.div>
  );
}
