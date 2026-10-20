# `attempt_number` signal vs alert semantics

Two numbers describe a failing integration sync, and they can diverge.
Operators reading an `integrations.sync.failed` log line alongside an admin
alert should expect the alert number to be smaller than (or equal to) the
logged number, never the other way around.

Since v1.43.7 a failed sync is a `warn` signal in the log store, not an
audit-log row: the audit log records what a person or an admin did to an
account, and a provider answering 503 is neither. The provider's message is
not on the signal; it stays encrypted on the integration's status row and
shows in the integration's settings.

## The two numbers

`integrations.sync.failed` signals carry
`attempt_number = transient + reauth_required + persistent` — the **sum**
of all three failure buckets. This is the historical "consecutive
failures" running total carried by the legacy
`IntegrationStatus.consecutiveFailures` column (dropped in migration
`0077`, v1.4.47). An operator looking at a single line sees one integer
that captures how many failures the bucket ledger has accumulated since
the last success.

The persistent-failure alert dispatcher in
`src/lib/integrations/status.ts` (the v1.4.43 W14 block) uses
`Math.max(...Object.values(buckets))` — the
**max** across the three buckets. A 3-deep persistent streak pages even
when the transient bucket is empty, and a flapping integration that
ping-pongs between transient and reauth_required never trips a
single-bucket threshold even if its sum looks alarming.

## When the two diverge

A typed-failure-streak edge case: integration fails 2× transient, then
2× reauth_required, then 1× persistent. The last signal shows
`attempt_number: 5`. The alert number is `max(2, 2, 1) = 2`, which is below
the default threshold of 3, so no page fires. From the log this
looks like a sustained 5-failure outage; from the alert dispatcher it
looks like three small bumps that never crossed a single-bucket
ceiling.

Both readings are correct for their purpose. The signal records what
happened end-to-end; the alert dispatcher only fires when a single
failure mode persists, because mixed-bucket streaks usually indicate a
transient network blip layered on top of an unrelated reauth prompt —
two problems, neither of which is the "this integration is broken" page
we want to wake someone up for.

## Runbook implication

If you see a signal with `attempt_number >= threshold` but no alert
was dispatched, check the per-bucket counts on
`IntegrationStatus.consecutiveFailuresByKind` (DB column
`consecutive_failures_by_kind`) for that user/integration pair. The
sum may be high while every individual bucket sits below the threshold.
This is working as designed; manually investigate only if a single
bucket is at or above the threshold and `alertedAt` is unset (broken
dispatcher) or set within the last 24 hours (rate-limited, see the
`ALERT_REPEAT_WINDOW_MS` constant).
