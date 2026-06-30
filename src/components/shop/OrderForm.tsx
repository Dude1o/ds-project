import { useState } from 'react';
import { ShoppingCart } from 'lucide-react';
import type { Product } from '@/types';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

interface OrderFormProps {
  products: Product[];
  onSubmit: (productId: string, quantity: number) => Promise<void>;
  submitting?: boolean;
}

/** OrderForm — product picker + quantity for placing a new order. */
export function OrderForm({ products, onSubmit, submitting }: OrderFormProps) {
  const [productId, setProductId] = useState<string>(products[0]?.id ?? '');
  const [quantity, setQuantity] = useState<number>(1);

  const inStock = products.filter((p) => p.stock > 0);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!productId) return;
    await onSubmit(productId, Math.max(1, quantity));
    setQuantity(1);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <ShoppingCart className="h-4 w-4 text-indigo-400" /> Place an Order
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4 sm:flex-row sm:items-end">
          <div className="flex-1 space-y-1.5">
            <Label htmlFor="product">Product</Label>
            <Select value={productId} onValueChange={setProductId}>
              <SelectTrigger id="product">
                <SelectValue placeholder="Select product" />
              </SelectTrigger>
              <SelectContent>
                {inStock.length === 0 ? (
                  <SelectItem value="none" disabled>No products in stock</SelectItem>
                ) : (
                  inStock.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name} · ${p.price.toFixed(2)} · stock {p.stock}
                    </SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
          </div>
          <div className="w-28 space-y-1.5">
            <Label htmlFor="qty">Quantity</Label>
            <Input
              id="qty"
              type="number"
              min={1}
              value={quantity}
              onChange={(e) => setQuantity(Number(e.target.value) || 1)}
            />
          </div>
          <Button type="submit" disabled={submitting || !productId || productId === 'none'}>
            Place Order
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
