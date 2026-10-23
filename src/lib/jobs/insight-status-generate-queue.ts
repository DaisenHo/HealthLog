/**
 * The queue facts of `insight-status-generate-shared.ts`: its name and, where it has them, its
 * schedule, concurrency and send options. They live apart from the job so the
 * worker registry and every sender can read them without loading it.
 */
export const INSIGHT_STATUS_GENERATE_QUEUE = "insight-status-generate";

/**
 * Low concurrency keeps the on-demand warm pass from saturating the
 * Prisma pool or fanning out an unbounded number of concurrent provider
 * calls when several cards request generation on the same first visit.
 */
export const INSIGHT_STATUS_GENERATE_CONCURRENCY = 2;
