# Heap diagnostics

A Node process that reaches its heap limit stops with `JavaScript heap out of memory` and writes nothing else: no stack, no record of what it was doing. HealthLog therefore logs its own heap while it is still alive.

## What is always on

Two background wide events, no configuration needed:

- `runtime.heap.sampled` (info), every five minutes, and every minute while the heap is at or above 70 % of its limit. It goes to stdout and Loki but not to Admin > App logs, so it cannot push other events out of that page's 500-entry buffer. It carries `heap_used_mb`, `heap_total_mb`, `heap_limit_mb`, `heap_used_ratio`, the used size of each heap space (`new_space_mb`, `old_space_mb`, `code_space_mb`, `large_object_space_mb`, `new_large_object_space_mb`, `code_large_object_space_mb`, `trusted_space_mb`, `read_only_space_mb`, and `other_spaces_mb` for any space not named), `rss_mb`, `external_mb`, `array_buffers_mb`, `active_requests`, `active_jobs`, `in_flight_dropped` and `uptime_s`. The spaces add up to `heap_used_mb`: a large buffer or string (a profile picture held in memory, a long response body) shows in `large_object_space_mb`, not in `old_space_mb`, and memory outside the V8 heap shows in `external_mb` and `array_buffers_mb`.
- `runtime.heap.pressure` (warn), the first time the heap reaches 85 % of its limit. Besides the figures above it lists the 50 oldest requests and jobs in flight (`in_flight_oldest`: kind, method, route, age in seconds, whether it was a server action) and the routes most of them share (`in_flight_by_route`). Routes are reduced to their shape: no query string, secret path segments replaced by `[REDACTED]`, ids by `:id`, anything unusual by `:x`. It writes again only after the heap has dropped below 70 % and thirty minutes have passed. One exception: when the heap reaches 95 %, the same report is written again at once, with `pressure_ratio: 0.95`, whatever the cooldown; that tier re-arms as soon as the heap is back under 85 %. A heap that climbs to its limit shortly after an 85 % report therefore still leaves a report naming the work that pushed it over.

The heap is read every five seconds, a single call that takes microseconds. Tracking requests costs one map insert and one delete per request.

To find the last lines before a crash:

```sh
docker compose logs app --since 2h | grep '"runtime.heap.'
```

## The report Node writes when the heap runs out

The image sets `NODE_OPTIONS="--report-on-fatalerror --report-filename=stderr --report-exclude-env --report-exclude-network"`. When the process runs out of heap, Node writes a diagnostic report, about 10 KB of JSON with `"trigger": "OOMError"`, to stderr just before it exits: the JavaScript stack at the failed allocation, the native stack, the heap spaces and the open handles. It lands in the container log beside the `runtime.heap.*` lines:

```sh
docker compose logs app --since 2h | grep -A400 '"trigger": "OOMError"'
```

The two exclude flags keep environment variables (keys, passwords, the database URL) and network interfaces out of the report. If you set `NODE_OPTIONS` yourself, for example to raise `--max-old-space-size`, your value replaces the image's; add the four flags to it to keep the report.

## Optional heap snapshot

A snapshot shows what the heap is made of, which the events above cannot. Turn it on only while you are chasing a specific crash:

```sh
HEALTHLOG_HEAP_SNAPSHOT=1
HEALTHLOG_DIAG_DIR=/tmp   # default; a path inside the container
```

With the switch set, the first `runtime.heap.pressure` event is followed by one `v8.writeHeapSnapshot()` and a `runtime.heap.snapshot` event naming the file. At most one snapshot is written per process. The file goes into a new directory with a random name, `healthlog-heap-XXXXXX`, created with mode 0700 and checked to be a real directory owned by the app's user before anything is written; the file itself is mode 0600. The event names the full path.

**A heap snapshot contains everything the process held in memory: decrypted health records, session data, API tokens and the encryption keys.** Treat it like a database dump with the keys attached.

- HealthLog never uploads or logs a snapshot. Only its path appears in the log.
- Copy it off the container only to a machine you trust, for example `docker compose cp app:/tmp/healthlog-heap-XXXXXX ./`, and open it in Chrome DevTools (Memory tab, Load).
- Delete it as soon as you are done, inside the container and wherever you copied it: `docker compose exec app rm -rf /tmp/healthlog-heap-XXXXXX`. A file under `/tmp` in the container also disappears when the container is recreated, not when it restarts.
- Do not attach a snapshot to an issue or send it to anyone.

Writing a snapshot blocks the process for several seconds and needs memory roughly the size of the heap on top of what is in use. Near the container's memory limit that can end the process sooner than the heap would have. The pressure report is written before the snapshot starts, so it is on record either way. Turn the switch off again when you have what you need.
