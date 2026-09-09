---
title: Testing
description: 44 unit tests that need nothing, one end-to-end test that needs the whole stack, and why both layers are required
---

```sh
pnpm run test        # 44 unit tests, no stack, a few seconds
pnpm run test:e2e    # 1 end-to-end test, needs the stack
pnpm run check       # format, env, typecheck, unit tests
```

`pretest:e2e` runs `scripts/check-stack.mjs` first and names **everything**
missing at once. It lives outside vitest deliberately: vitest prints
"No test files found, exiting with code 1" whenever a global setup throws, and no
message written inside can survive that.

## Why both layers

The defects this repository actually produced fall into two groups that **do not
overlap**:

| defect                                             | unit | e2e |
| -------------------------------------------------- | ---- | --- |
| `respect_robots` arrived `null`, robots never read | ○    | ○   |
| level-boundary gap collapsed 3000 ms → **521 ms**  | ○    | △   |
| `content-type` on a bodyless POST → 400            | ○    | ○   |
| `hostParallelism` in camelCase arrived `null`      | ✗    | ○   |
| schema defaults not applied on webhook runs        | ✗    | ○   |

The bottom two are invisible to unit tests **by definition**: arguments are
passed by `flow.yaml`, not by TypeScript. Pick one layer and half of the holes
stay open.

## The unit tests need nothing

`windmill-client` is already a dev dependency and `plan_level.ts` imports only
`robots-parser`, so the scripts import into vitest directly. IO is stubbed:
`vi.stubGlobal("fetch", …)` and `vi.mock("windmill-client", …)`.

`captureHost` is exported from `crawl_host.ts` so the pacing loop can be driven
with a fake client — `call()` only does `client[method](req, cb)`, so the fake is
a plain object. Its `pollMs` argument exists so tests run on **real timers at
millisecond scale**; fake timers were tried against capture-style sleeps
elsewhere in this workspace and cost a round trip.

## The end-to-end test starts a real crawl

One test, about 40 seconds. It goes through waggle's API — **not** Windmill's
run endpoint — because the point is to carry the arguments waggle actually sends
(five of them; `respect_robots` is not among them).

It asserts three things:

1. **meadow never received `/links/hidden`**, which its robots.txt disallows. The
   verdict comes from the _other end's_ request log, because the ledger can only
   say what it recorded.
2. the crawl succeeded and captured at least one page
3. `GET /api/search?q=hub` returns a hit — so the indexing step completed inside
   the flow

Breaking `?? true` in `plan_level.ts` and deploying turns **both** the unit test
and the e2e red, and the e2e shows meadow receiving the forbidden page. That pair
was checked once on purpose: if only one layer goes red, the other is watching
something it thinks it is watching and is not.

## What is not covered

`trigger_run.ts`'s polling loop. `POLL_INTERVAL_MS` is a 3-line change away from
being injectable — the same change already made to `crawl_host.ts` — but as it
stands every test of that loop costs 15 seconds, because the sleep happens before
the first poll.

That leaves the two lines deciding whether the nightly run succeeded
(`if (run.status === "running") continue` and the `failed` throw) with **no
coverage at all**, and nothing else exercises them: the e2e drives the crawl path,
not the run path.
