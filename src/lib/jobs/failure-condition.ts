/**
 * The database condition behind a failure, as a stable code.
 *
 * Prisma puts the Postgres SQLSTATE in the message ("Database error. Code:
 * `57014`. Message: `canceling statement due to statement timeout`") and not
 * in a form the support report's error class recognised, so a statement that
 * ran past the 60-second `statement_timeout` read as the bare class "Error"
 * (#1239). The code is the part an operator can act on, and it carries no
 * account data, so it is what the report and a job's failure reason show.
 */

/** SQLSTATEs worth a name; any other one is shown as `sqlstate_<code>`. */
const SQLSTATE_CONDITIONS: Readonly<Record<string, string>> = {
  "57014": "statement_timeout",
  "55P03": "lock_timeout",
  "40P01": "deadlock",
  "40001": "serialization_failure",
  "25P03": "idle_in_transaction_timeout",
  "53100": "disk_full",
  "53200": "out_of_memory",
  "53300": "too_many_connections",
  "57P01": "admin_shutdown",
};

/** Conditions named by the message text alone, in the order they are tried. */
const TEXT_CONDITIONS: ReadonlyArray<readonly [RegExp, string]> = [
  [/statement[ _]timeout/i, "statement_timeout"],
  [/lock[ _]timeout/i, "lock_timeout"],
  [/deadlock/i, "deadlock"],
  [/transaction already closed|expired transaction/i, "transaction_closed"],
  // `pg`'s own words when no pooled connection came free in time, and
  // Prisma's for the same.
  [
    /timeout exceeded when trying to connect|new connection from the connection pool/i,
    "pool_timeout",
  ],
  [
    /connection terminated|connection_lost|server closed the connection/i,
    "connection_lost",
  ],
];

/** The condition a failure message names, or null when it names none. */
export function failureCondition(text: string): string | null {
  const sqlstate = /\bCode: `([0-9A-Z]{5})`/.exec(text)?.[1];
  if (sqlstate) {
    return SQLSTATE_CONDITIONS[sqlstate] ?? `sqlstate_${sqlstate}`;
  }
  for (const [pattern, condition] of TEXT_CONDITIONS) {
    if (pattern.test(text)) return condition;
  }
  return null;
}

/**
 * A thrown value as a short, account-free code for a job's failure reason:
 * its database condition, else its class name.
 */
export function failureCode(error: unknown): string {
  if (error instanceof Error) {
    return failureCondition(error.message) ?? error.name;
  }
  return typeof error === "string"
    ? (failureCondition(error) ?? "error")
    : "error";
}
