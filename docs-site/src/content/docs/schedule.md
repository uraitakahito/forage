---
title: Schedule
description: Daily at 04:00 Asia/Tokyo, why overlap is safe, and why comments in the schedule file disappear
---

`windmill/f/waggle/daily.schedule.yaml` — **daily at 04:00 (Asia/Tokyo)**.

```yaml
schedule: 0 0 4 * * * # sec min hour day month weekday
timezone: Asia/Tokyo
enabled: true
```

To stop it, set `enabled: false` and run `pnpm run windmill:push`.

## Overlap is not a problem

Windmill starts the next job even if the previous one is still running. That is
fine here: waggle refuses a second concurrent run with **409**, and
`trigger_run.ts` treats that as a skip and finishes green.

So however tightly the schedule is packed, exactly one run is ever in flight.
The guarantee lives in waggle's partial unique index, not in forage — which is
the right place for it, because an application-side flag breaks silently the day
a second process appears.

## Comments in this file disappear

`wmill sync pull` rewrites `daily.schedule.yaml` from the server's state, and the
server does not store comments. Anything explaining _why_ the schedule is what it
is has to live here, on this page, not in the YAML.

That is also why `windmill/wmill.yaml` sets `includeSchedules: true`: by default
schedules are not synced at all, and **"when it runs" — the only thing this
repository decides — would be the one setting missing from git.**
