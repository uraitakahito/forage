---
title: Development
description: Round-tripping changes between git and Windmill, what is deliberately out of scope, and the licence
---

## Changing things

Whatever you touch in the Windmill UI has to come back to git.

```sh
pnpm run windmill:diff   # what differs between the UI and git (does not push)
pnpm run windmill:pull   # take the UI's changes into git
pnpm run windmill:push   # make git authoritative and apply it
```

**Both directions delete.** `push` removes remote items that are absent locally;
`pull` removes local files that are absent remotely. Commit before syncing and
push before pulling — see [Windmill CE](/windmill-ce/).

`windmill/wmill.yaml` sets `includeSchedules: true`. Secrets are not synced
(`skipSecrets`); `u/admin/waggle_token` is injected through the API by
`scripts/waggle-token.mjs`.

## Layout

| path                                           | what                                                                                |
| ---------------------------------------------- | ----------------------------------------------------------------------------------- |
| `windmill/f/waggle/*.ts`                       | the scripts Windmill runs, under Bun                                                |
| `windmill/f/waggle/crawl_level.flow/flow.yaml` | the flow that runs one crawl level                                                  |
| `windmill/f/waggle/daily.schedule.yaml`        | when the nightly crawl fires                                                        |
| `test/`                                        | unit tests; **never put these under `windmill/f/`** — `sync push` would deploy them |
| `scripts/*.mjs`                                | host-side helpers (bootstrap, tokens, checks)                                       |

Adding an environment variable is a three-part contract, checked in both
directions by `scripts/check-env.mjs`: `.env.example`, the name lists in
`scripts/env.mjs`, and a literal-string read.

## Out of scope

1. **Nobody is told when it fails.** Schedule error handlers are a Windmill
   Enterprise feature. A failure leaves a red entry in the run history and waits
   to be noticed.
2. **No production topology is decided.** Apple Container is for development.

## Licence

Windmill itself is AGPLv3. Running it internally for your own purposes is
unconstrained; redistributing it as part of a product means complying with
AGPLv3 or buying a commercial licence.
