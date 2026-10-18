/**
 * Whether this process's heap is below what a long-used account needs.
 *
 * Node sizes its heap from the container's memory limit: the 1 GB limit older
 * compose files set gives 524 MB, the current default of 1536m gives 792 MB.
 * At 524 MB a long-used account fills the heap in normal operation, garbage
 * collection stalls requests, and a large import can run the process out of
 * memory, which restarts the whole instance. The support report and the admin
 * system status say so in one sentence, because the number alone ("Heap
 * limit: 524 MB") reads as a fact rather than as the cause (#1239).
 */
import { getHeapStatistics } from "node:v8";

/** Below this, the heap is flagged. Between the 1g (524) and 1536m (792) heaps. */
export const LOW_HEAP_LIMIT_MB = 700;

/** V8's heap limit for this process, in megabytes. */
export function heapLimitMb(): number {
  return Math.round(getHeapStatistics().heap_size_limit / 1024 / 1024);
}

export function isHeapLimitLow(limitMb: number): boolean {
  return limitMb < LOW_HEAP_LIMIT_MB;
}

/** The support report's sentence for a low heap limit. */
export function lowHeapLimitAdvice(limitMb: number): string {
  return (
    `The heap limit of ${limitMb} MB is below ${LOW_HEAP_LIMIT_MB} MB. The ` +
    "usual cause is a 1 GB container memory limit. A long-used account can " +
    "fill this heap, which slows requests and can restart the app. Set " +
    "APP_MEMORY_LIMIT=1536m in .env (about 792 MB of heap) and run " +
    "docker compose up -d."
  );
}
