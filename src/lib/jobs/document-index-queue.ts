/**
 * The queue facts of `document-index.ts`: its name and, where it has them, its
 * schedule and concurrency. They live apart from the handler so the worker
 * registry and every sender can read them without loading the job.
 */
export const DOCUMENT_INDEX_QUEUE = "document-index";

/** Serial concurrency — provider calls + PDF parse, kept off the request pool. */
export const DOCUMENT_INDEX_CONCURRENCY = 1;
