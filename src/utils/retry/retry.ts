import type { RetryConfig } from '@/types';
import { delay } from '@/utils/delay';
import { computeBackoff } from './backoff';

type AttemptCallback = (attempt: number, err: Error) => void;

/**
 * Retry executor with exponential backoff + full jitter.
 * Distributed systems concept: a recovering service should not be hammered by
 * a thundering herd of retries; spacing them exponentially (and jittering)
 * decorrelates competing clients and gives the dependency a chance to recover.
 *
 * `fn` is invoked up to `maxAttempts` times. Between attempts the executor
 * sleeps for `computeBackoff(attempt, config)` milliseconds, never sleeping
 * after the final attempt. If `fn` returns, the result is propagated; if every
 * attempt fails, the last error is re-thrown.
 *
 * @param fn - the async operation to retry
 * @param config - retry configuration
 * @param onAttempt - optional callback fired on each *failed* attempt
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  config: RetryConfig,
  onAttempt?: AttemptCallback,
): Promise<T> {
  let lastError: Error | null = null;
  for (let attempt = 0; attempt < config.maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (onAttempt) onAttempt(attempt, lastError);
      const isLast = attempt === config.maxAttempts - 1;
      if (!isLast) {
        await delay(computeBackoff(attempt, config));
      }
    }
  }
  throw lastError ?? new Error('withRetry exhausted attempts with no error captured.');
}