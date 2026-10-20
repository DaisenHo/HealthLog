"use client";

import { useState } from "react";
import type { Dispatch, SetStateAction } from "react";

/**
 * v1.4.23 — local state seeded from a controlled prop, reset on
 * prop change. Same render-phase pattern React's docs recommend in
 * place of `useEffect(() => setState(prop), [prop])` (which the
 * `react-hooks/set-state-in-effect` ESLint rule banned). The reset
 * runs during render: React detects the queued setState, restarts
 * the render with the new value, and commits a single coherent
 * snapshot — no double paint, no flash of stale state.
 *
 * v1.12.0 — lifted out of `coach-drawer.tsx` into its own module so the
 * shared `<CoachConversation>` surface (drawer + full-page) can seed its
 * composer from the same controlled-prefill contract without importing
 * the drawer shell.
 *
 * Exported so the drawer's prefill-reset behaviour can be unit-tested in
 * isolation without standing up the whole Sheet portal.
 */
export function useResettableValue<T>(
  controlledValue: T,
): [T, Dispatch<SetStateAction<T>>] {
  const [value, setValue] = useState<T>(controlledValue);
  // Mirror the last observed controlled value via a sibling useState
  // pair (per React docs:
  // https://react.dev/learn/you-might-not-need-an-effect#adjusting-some-state-when-a-prop-changes).
  // useRef is the wrong tool here — ESLint rejects ref read+write
  // during render, and useState already gives us identity tracking
  // with no extra cost.
  const [lastSeen, setLastSeen] = useState<T>(controlledValue);
  if (!Object.is(controlledValue, lastSeen)) {
    setLastSeen(controlledValue);
    setValue(controlledValue);
  }
  return [value, setValue];
}

/**
 * v1.4.23 — pure decision function behind `useResettableValue`.
 * Given the previous controlled value the hook recorded and the
 * incoming controlled value, returns either `{ reset: true, value }`
 * (the next render must seed local state with `value`) or
 * `{ reset: false }` (local state survives — the user's edits are
 * preserved). Pure + dependency-free so it tests cleanly without a
 * React renderer — pin the contract here and trust the hook
 * implementation to wire the same comparison.
 */
export function nextResettableValue<T>(
  previous: T,
  incoming: T,
): { reset: true; value: T } | { reset: false } {
  return Object.is(previous, incoming)
    ? { reset: false }
    : { reset: true, value: incoming };
}
