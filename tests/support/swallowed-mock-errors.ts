/**
 * A module mock that leaves out an export the code under test reaches throws
 * `No "X" export is defined on the "Y" mock` at the call. Where the code
 * catches and logs that (a best-effort tail, a fail-soft read), the test went
 * on green while the code path it meant to cover never ran: the Apple Health
 * import tests mocked the rollup module without its fold window, and the
 * import's cache invalidation never ran in any of them.
 *
 * `watchSwallowedMockErrors` wraps the console once per worker and returns
 * the check a setup file runs after each test: it throws, failing that test,
 * when such a line was logged during it.
 */
const MISSING_MOCK_EXPORT = /No "[^"]+" export is defined on the "[^"]+" mock/;

function textOf(arg: unknown): string {
  if (arg instanceof Error) return `${arg.message} ${String(arg.cause ?? "")}`;
  return typeof arg === "string" ? arg : "";
}

const SEEN = Symbol.for("healthlog.tests.swallowedMockErrors");

export function watchSwallowedMockErrors(): () => void {
  // A setup file runs once per test file, and a worker runs many files: the
  // console is wrapped once per worker, and every file shares what it saw.
  const slot = globalThis as unknown as { [SEEN]?: string[] };
  let seen = slot[SEEN];
  if (!seen) {
    const lines: string[] = [];
    seen = lines;
    slot[SEEN] = lines;
    for (const level of ["log", "info", "warn", "error"] as const) {
      const original = console[level].bind(console);
      console[level] = (...args: unknown[]) => {
        for (const arg of args) {
          const match = MISSING_MOCK_EXPORT.exec(textOf(arg));
          if (match) lines.push(match[0]);
        }
        original(...args);
      };
    }
  }
  const lines = seen;
  return () => {
    if (lines.length === 0) return;
    const found = [...new Set(lines)];
    lines.length = 0;
    throw new Error(
      "a module mock lacks an export the code under test reached, and the " +
        `error was caught and logged instead of failing: ${found.join("; ")}`,
    );
  };
}
