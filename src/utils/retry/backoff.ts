import type { RetryConfig } from '@/types';

/**
 * Exponential backoff delay calculator with optional full-jitter.
 * Distributed systems concept: spacing out retries exponentially prevents a
 * thundering-herd of retried requests hammering a recovering service. Full
 * jitter additionally randomises the delay to decorrelate competing clients.
 *
 * Formula: `min(maxDelay, baseDelay * 2^attempt)`, then × random() when jittered.
 *
 * @param attempt - zero-based attempt index
 * @param config - retry configuration
 * @returns the delay in milliseconds to wait before the next attempt
 */
export function computeBackoff(attempt: number, config: RetryConfig): number {
  const exp = config.baseDelayMs * Math.pow(2, attempt);
  const capped = Math.min(config.maxDelayMs, exp);
  return config.jitter ? capped * Math.random() : capped;
}