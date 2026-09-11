---
title: Following links
description: How one crawl level runs — grouped by host, parallel across hosts, sequential within one, with the gap after completion
---

capture-ledger's `POST /api/crawls` takes seed URLs — or `fromTargets`, the enabled rows
of `capture_targets` — and hands capture-scheduler **one level at a time**. The flow is
`f/waggle/crawl_level`; one execution is one level.

```
plan_level    group by host, fetch robots.txt once per host
  ↓
for-each      parallel across hosts (parallelism = host_parallelism)
  crawl_host    sequential within a host: finish → wait → next
  ↓
report_level  report to capture-ledger, receive the next level
  ↓
index_level   ask capture-ledger to index what landed in the ledger
```

**capture-ledger does the repeating.** This flow ends after one level. Putting the loop
in Windmill was tried: a minimal flow with `stop_after_if` **ran 643 iterations
without stopping**. A mechanism for not overloading someone else's server does
not belong on top of a loop that can run away. The stopping conditions live in
capture-ledger and have unit tests.

## Politeness is enforced by the shape of the loop

**Windmill CE's per-key concurrency limit cannot be used** — see
[Windmill CE](/windmill-ce/) for why it silently passes everything through. What
does work is the for-loop's `parallelism`, so politeness is expressed as loop
structure:

- **across hosts** — the for-loop's `parallelism`
- **within a host** — `crawl_host` runs sequentially and waits _after_ each completion
- **across levels** — capture-ledger passes the time it last finished touching that host, and `plan_level` subtracts it

### The gap goes after completion, not before submission

This is the part that looks like a detail and is not.

BrowserHive's `TaskQueue` has **no capacity limit and never refuses a
submission**. The only thing bounding concurrency is the number of workers. So
submitting three URLs with pauses between the submissions changes nothing — they
queue up and run back to back. **A gap on the submitting side never reaches the
other server.**

The gap only becomes real when it sits between one page finishing and the next
being submitted:

```ts file="windmill/f/waggle/crawl_host.ts#pacing"

```

### The third rule was added later

Without it, the gap held _within_ a level and vanished _between_ levels. Measured
against a 3000 ms setting, the boundary collapsed to **521 ms**.

`plan_level` computes what remains, and takes robots.txt seriously in both
directions — if the site asks for longer, the site wins:

```ts file="windmill/f/waggle/plan_level.ts#delay"

```

Note `Math.max`, not `Math.min`. **We do not shorten what the other side asked
for.** The two-sided test in `test/plan-level.test.ts` exists because an
implementation that simply always used robots' value passes a one-sided test.

## Settings come from variables, not arguments

`crawl_host`, `report_level` and `index_level` do **not** take their connection
settings as arguments. Windmill fills schema defaults **only for UI-triggered
runs**, so a webhook run gets nothing — `browserhive_target` arrived `undefined`
and the job died with "Channel target must be a string".

What does arrive as arguments is what capture-ledger decides for that crawl and always
sends: the URLs, the delay, and `capture_formats` / `signing`.

```sh
pnpm run windmill:capture-ledger-token   # waggle_token / waggle_api_url /
                                 # browserhive_target / browserhive_tls_ca
pnpm run windmill:push-proto     # BrowserHive's proto (a resource)
```

`u/admin/browserhive_tls_ca` is the CA certificate (PEM) for the gRPC leg to
BrowserHive, and **an empty value means plaintext**. The variable is written even
when it is empty, on purpose: if it were simply absent, `getVariable` would throw,
and a script that reads "could not fetch it" as "no TLS wanted" turns a read
failure into a plaintext connection. There is no "TLS with the system roots"
mode — BrowserHive's TLS assumes a private CA, and needing a public certificate
would mean the server is on the public internet. The development stack is
plaintext.

The proto is a **resource** rather than a variable because it is 16,315 bytes and
the variable limit sits between 10,000 and 20,000. `pnpm run proto:check` diffs it
against capture-ledger's copy — a contract copied by hand rots silently, so it gets a
guard.
