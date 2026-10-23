/**
 * The queue facts of `offhost-purge.ts`: its name and, where it has them, its
 * schedule, concurrency and send options. They live apart from the job so the
 * worker registry and every sender can read them without loading it.
 */
export const OFFHOST_PURGE_QUEUE = "offhost-backup-purge";

/** 03:40, after the nightly upload (02:30) has had its hour. */
export const OFFHOST_PURGE_CRON = "40 3 * * *";
