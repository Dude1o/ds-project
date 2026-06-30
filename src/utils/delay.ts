/**
 * Simulates async network latency for the e-commerce simulator.
 * Distributed systems concept: every "network call" in this app is fake but
 * deterministic-looking, so the UI can visualise real-world I/O delays.
 *
 * @param ms - base delay in milliseconds
 * @param jitter - when true, adds ±30% random jitter to mimic real network variance
 * @returns a Promise that resolves after the computed delay
 */
export function delay(ms: number, jitter = false): Promise<void> {
  const actual = jitter ? ms * (0.7 + Math.random() * 0.6) : ms;
  return new Promise<void>((resolve) => {
    setTimeout(resolve, Math.max(0, actual));
  });
}