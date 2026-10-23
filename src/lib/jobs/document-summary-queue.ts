/**
 * The queue facts of `document-summary.ts`: its name and, where it has them, its
 * schedule and concurrency. They live apart from the handler so the worker
 * registry and every sender can read them without loading the job.
 */
export const DOCUMENT_SUMMARY_QUEUE = "document-summary";

/** Serial concurrency — provider calls, kept off the request pool. */
export const DOCUMENT_SUMMARY_CONCURRENCY = 1;
