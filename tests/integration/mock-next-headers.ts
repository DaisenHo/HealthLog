/**
 * Shared `next/headers` mock state for the integration suite.
 *
 * `environment-setup.ts` mocks `next/headers` for every file with a stand-in
 * that reads these jars, so a test sets a cookie or a header here and the
 * route handler under test sees it. Files are isolated (`isolate: true`), so
 * each file gets fresh jars; clear them in `beforeEach` to keep cases
 * independent. The route test kit (`tests/kit/`) fills them from the `auth`
 * option of `callRoute`, so a kit test never touches them directly.
 *
 * Many files still declare their own identical `vi.mock("next/headers")`.
 * That predates the shared one, is harmless (a file's own mock wins), and is
 * only needed where a file wants different behaviour, such as consuming
 * `queuedSessionIds` below.
 */
export const cookieJar = new Map<string, string>();
export const headerJar = new Map<string, string>();

/**
 * Session snapshots for invoking concurrent route handlers as different users.
 * A request consumes one entry when its mocked cookie store is created.
 */
export const queuedSessionIds: string[] = [];

/**
 * v1.37.0 — attach the record-session assertion the shipped browser client
 * attaches to every same-origin request.
 *
 * The record-session fence refuses a cookie request whose asserted context does
 * not match its session row, and it refuses a request that asserts nothing at
 * all once the session has been inside somebody's record. A test that moves
 * `acting_as_user_id` directly and then calls a route is therefore exercising
 * the fence's pre-fence-bundle arm, not whatever the test was written for — so
 * every such fixture calls this immediately after the switch.
 *
 * Truthful by construction: the values are read back off the row rather than
 * computed, so this can only ever say what the session actually holds. The
 * cases that want a STALE or ABSENT assertion set the headers themselves, and
 * they live in `tests/integration/record-session-fence*.test.ts`.
 *
 * Takes the epoch and scope rather than reading the database, so this module
 * keeps its single responsibility (shared mock state) and no test file has to
 * import a Prisma client it does not otherwise use.
 */
export function assertRecordContext(
  recordEpoch: number,
  actingAsUserId: string | null,
): void {
  headerJar.set("x-healthlog-record-epoch", String(recordEpoch));
  headerJar.set("x-healthlog-record-scope", actingAsUserId ?? "self");
}
