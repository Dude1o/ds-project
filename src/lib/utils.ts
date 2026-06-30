import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

/** Conditional className combiner used by every shadcn/ui component. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}
