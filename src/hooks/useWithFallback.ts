import { useCallback, useEffect, useRef, useState } from 'react';

interface UseWithFallbackResult<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  usedFallback: boolean;
  refetch: () => void;
}

/**
 * useWithFallback — tries a primary async source and transparently falls back
 * to a secondary source on failure.
 * Distributed systems concept: graceful degradation / fallback routing — if the
 * primary path is unavailable, the system still serves data from a replica or
 * cache instead of failing the whole request.
 */
export function useWithFallback<T>(
  primaryFn: () => Promise<T>,
  fallbackFn: () => Promise<T>,
): UseWithFallbackResult<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [usedFallback, setUsedFallback] = useState<boolean>(false);
  const [tick, setTick] = useState<number>(0);

  const primaryRef = useRef(primaryFn);
  const fallbackRef = useRef(fallbackFn);
  primaryRef.current = primaryFn;
  fallbackRef.current = fallbackFn;

  const refetch = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setUsedFallback(false);

    (async () => {
      try {
        const result = await primaryRef.current();
        if (!cancelled) {
          setData(result);
          setUsedFallback(false);
        }
      } catch (primaryErr) {
        try {
          const result = await fallbackRef.current();
          if (!cancelled) {
            setData(result);
            setUsedFallback(true);
          }
        } catch (fallbackErr) {
          if (!cancelled) {
            setError(
              fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr),
            );
          }
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [tick]);

  return { data, loading, error, usedFallback, refetch };
}
