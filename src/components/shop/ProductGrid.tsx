import type { Product } from '@/types';
import { ProductCard } from './ProductCard';

interface ProductGridProps {
  products: Product[];
  onOrder: (product: Product) => void;
}

/** ProductGrid — responsive grid of product cards. */
export function ProductGrid({ products, onOrder }: ProductGridProps) {
  if (products.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-zinc-800 p-12 text-center text-sm text-zinc-500">
        No products available.
      </div>
    );
  }
  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
      {products.map((p) => (
        <ProductCard key={p.id} product={p} onOrder={onOrder} />
      ))}
    </div>
  );
}
