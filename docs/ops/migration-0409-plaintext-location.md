# Upgrade stopped at migration 0409

v1.43 removes the readable location columns that v1.42 replaced with sealed
copies (`users.home_lat/home_lon/home_label`,
`environment_contexts.lat/lon/location_label`,
`environment_travel_locations.lat/lon/label`). Before it drops anything,
migration `0409_drop_plaintext_location` checks that the v1.42 encryption
backfill has sealed every one of those values. If any row still holds a
readable location, the migration stops and the app container does not start.

## What you see

The container exits during the migration step with:

```text
A migration failed to apply. New migrations cannot be applied before the error is recovered from. ...
Migration name: 0409_drop_plaintext_location
Database error code: P0001
Database error:
ERROR: HealthLog migration 0409 stopped: 3 home location(s), 0 location period(s) and 12 daily location(s) are still stored in plaintext. ...
```

On every later start, Prisma refuses with `P3009` ("migrate found failed
migrations in the target database") until the failed attempt is cleared.

## What it means

Nothing was lost and nothing was dropped. The check runs before any other
statement in the migration, so the location columns and their values are all
still there. The migrations before 0409 in the same image did apply; they only
add tables, columns and enum values, so the previous release runs on top of
them unchanged.

The cause is a v1.42 instance that was not running long enough for its
encryption backfill to reach every account, for example a host that went from
v1.41 straight to v1.43, or one that was stopped soon after updating to v1.42.

## How to recover

The order matters: clear the failed attempt first, because the previous
release runs `prisma migrate deploy` on start as well and refuses to boot
while a failed migration is on record.

```bash
# 1. Mark the failed 0409 attempt as rolled back. The entrypoint is replaced
#    so the container does not try to migrate first.
docker compose run --rm --entrypoint sh app -c \
  'NODE_PATH=/opt/prisma-cli/node_modules node /opt/prisma-cli/node_modules/prisma/build/index.js migrate resolve --rolled-back 0409_drop_plaintext_location'

# 2. Start the previous release. Set this in the compose `.env` (or your
#    platform's environment) and recreate the container.
#      HEALTHLOG_IMAGE_REF=:v1.42.4
docker compose up -d app
```

The previous release starts the encryption backfill about three minutes after
boot and again once a day. It works through the accounts one at a time. Watch
it with the three counts the migration checks; all three must reach 0:

```bash
docker compose exec -T db psql -U healthlog healthlog -c "
  SELECT
    (SELECT count(*) FROM users WHERE home_lat IS NOT NULL) AS home,
    (SELECT count(*) FROM environment_travel_locations WHERE lat IS NOT NULL) AS periods,
    (SELECT count(*) FROM environment_contexts WHERE lat IS NOT NULL) AS days;"
```

The app log shows each pass as
`[free-text-encryption-backfill] user=... ` lines. If the counts stop going
down, look for `[free-text-encryption-backfill] user=... failed` in the log;
the error on the line after it names the cause.

Once all three counts are 0:

```bash
# 3. Dump the database. This is the copy you go back to if anything else
#    goes wrong; keep it with your encryption key.
docker compose exec -T db pg_dump -U healthlog healthlog \
  | gzip > healthlog-before-0409-$(date +%F).sql.gz

# 4. Upgrade again: remove the pin (or set it to the new version) and
#    recreate the container. Migration 0409 now runs through.
docker compose pull app
docker compose up -d app
curl -s http://localhost:3000/api/version
```

## What not to do

- Do not clear the readable columns by hand to get past the check. The
  check exists because those values have no sealed copy yet; setting them to
  `NULL` deletes the location for good.
- Do not run `migrate resolve --applied 0409_drop_plaintext_location`. That
  records the migration as done while the columns are still there, and the
  v1.43 schema no longer matches the database.

Background: [`deploy.md`](deploy.md) for the general update and rollback
order, [`backup-restore.md`](backup-restore.md) for restoring a dump.
