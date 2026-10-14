-- v1.42.3 — remember what an integration's upstream refuses by contract.
--
-- Withings split its public API into plans on 2026-10-12. A self-hoster's own
-- developer app sits on the free plan, and a request that names a meastype
-- outside that plan is refused whole with status 277. The sync now drops the
-- gated types and keeps the rest; this column remembers which ones per
-- connection so later runs skip them without a refused round trip, plus when
-- that was last checked so a plan upgrade is noticed within a week.
--
-- Oura's current authorization server enforces scopes per collection. A grant
-- issued before HealthLog asked for `spo2` and `heart_health` answers 401 on
-- the collections behind them while every other collection succeeds. This
-- column holds those collection names so the Oura card can ask for a single
-- reconnect instead of painting the connection as broken.
--
-- Additive only: two nullable columns, no default, no rewrite, no data change.
ALTER TABLE "withings_connections" ADD COLUMN IF NOT EXISTS "api_plan_state" JSONB;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "oura_scope_denied" JSONB;
