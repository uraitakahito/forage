---
title: The UI
description: What the Windmill UI shows, and how much of it you may change there
---

Windmill ships its own web UI. In this deployment that UI **is**
capture-scheduler's admin screen — there is nothing extra to run.

## Opening it

```
http://127.0.0.1:8000
```

|          | Default              | Override            |
| -------- | -------------------- | ------------------- |
| email    | `admin@windmill.dev` | `WINDMILL_EMAIL`    |
| password | `changeme`           | `WINDMILL_PASSWORD` |

After logging in, pick the `crawler` workspace.

The port is **bound to loopback**. As the compose comment puts it, whoever
reaches it can rebuild the workspace — schedules, webhooks and secrets are
all editable from the UI — so it is never exposed to other machines.

## Finding your way around

| Screen              | What this deployment shows there                                                                                       |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| **Runs**            | Execution history of the flow and scripts: per-step inputs, outputs, errors, durations. Start here when a crawl fails  |
| **Schedules**       | `f/waggle/daily` — a cron that fires `trigger_crawl` at 04:00 Asia/Tokyo. See [Schedule](/schedule/) for what it means |
| **Variables**       | `u/admin/waggle_token` (secret) plus the ledger below                                                                  |
| **Resources**       | `u/admin/browserhive_proto` — the copy of the gRPC `.proto`                                                            |
| **Flows / Scripts** | The 6 scripts and 1 flow under `f/waggle/`                                                                             |

What the UI is for: looking, firing one run by hand, pausing something
temporarily. **Permanent changes are made in the repo and pushed.** Even the
schedule's `enabled` flag lives in `daily.schedule.yaml`, so a pause made in
the UI comes back to life on the next `windmill:push`. Sync deletes **in both
directions** — see [Development](/development/).

## The variable ledger — which script provisions what

`windmill:push` only uploads **what is in git** (scripts, the flow, the
schedule). Variables and resources are provisioned by separate scripts.
Confuse the two and push stays green while the flow dies with
`Resource not found`.

| Path                         | Contents                                                             | Provisioned by                  |
| ---------------------------- | -------------------------------------------------------------------- | ------------------------------- |
| `u/admin/waggle_token`       | JWT for capture-ledger (secret)                                      | `windmill:capture-ledger-token` |
| `u/admin/waggle_api_url`     | Where the capture-ledger API is (default `http://192.168.64.1:7070`) | same                            |
| `u/admin/browserhive_target` | gRPC target `browserhive.capture-ledger:50051`                       | same                            |
| `u/admin/browserhive_tls_ca` | TLS CA (empty = plaintext)                                           | same                            |
| `u/admin/browserhive_proto`  | Copy of `capture.proto` (read by `crawl_host`)                       | `windmill:push-proto`           |

**`windmill:push-proto` is not part of `windmill:push`.** Whenever the proto
is refreshed, run it again — Windmill reads this copy, not the submodule.

## Recovering from total loss

Deleting the windmill-db volume erases the workspace, tokens and variables.
The recovery order (measured on 2026-09-11):

```sh
pnpm run windmill:bootstrap            # recreates the workspace, prints a fresh token
                                       # → paste the WINDMILL_TOKEN= line into .env
pnpm run windmill:push                 # scripts / flow / schedule
pnpm run windmill:push-proto           # ← forget this and crawl_host dies with Resource not found
pnpm run windmill:capture-ledger-token # the four variables
cd ../capture-ledger
pnpm run fga:grant submitter windmill acme
```

If capture-ledger's OpenFGA store was wiped at the same time, run
`fga:migrate` → `fga:deploy` there first and paste the two printed IDs into
that repo's `.env` before granting.

**Recreating containers can change the bridge subnet.** The default
`u/admin/waggle_api_url` points at `192.168.64.1`; when the subnet moves,
the report step fails with `ConnectionRefused`. The current gateway is the
`bridge100` entry in `ifconfig`. The fix is setting `CAPTURE_LEDGER_API_URL`
in `.env` and re-running `windmill:capture-ledger-token`. Reachability can be
measured, not guessed:

```sh
container exec windmill.capture-scheduler \
  curl -s -o /dev/null -w '%{http_code}\n' -X POST http://192.168.66.1:7070/api/crawls
# 401 means reachable (waiting for auth). 000 means not reachable
```

## The name `f/waggle/`

The repo was renamed waggle → capture-ledger, but the Windmill folder is
still `f/waggle/`. **The folder path is part of the webhook URL**
(`/api/w/crawler/jobs/run/f/f/waggle/crawl_level`); changing it breaks the
webhook configured on the capture-ledger side. It stays not as a name but as
an external contract.
