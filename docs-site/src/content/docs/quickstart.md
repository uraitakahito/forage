---
title: Quickstart
description: Bring up Windmill, hand it a token for capture-ledger, and open the UI
---

## Bring it up

```sh
sudo container system dns create capture-scheduler   # once per machine
./setup.sh
container-compose up -d
pnpm install

pnpm run windmill:bootstrap   # creates the workspace and a token, printed ready to paste
                              # → paste the WINDMILL_TOKEN= line into .env
pnpm run windmill:push        # upload the scripts and the schedule
```

On the capture-ledger side, in another terminal:

```sh
cd ../capture-ledger
# in .env:
#   CAPTURE_LEDGER_API_HOST=0.0.0.0                     so containers can reach it
#   CAPTURE_LEDGER_OIDC_ISSUER=http://127.0.0.1:9099    so it accepts JWTs
pnpm run oidc:issuer
pnpm run api
pnpm run fga:grant submitter windmill acme      # without this you get 404
```

Back here, hand over the key:

```sh
pnpm run windmill:capture-ledger-token
```

Windmill opens at `http://127.0.0.1:8000`.

## How the token gets there

```
host                                   │ container
  dev issuer 127.0.0.1:9099            │
      │ POST /token                    │
      ▼                                │
  windmill:capture-ledger-token ───────────────┼──► secret variable u/admin/waggle_token
                                       │            │
  capture-api 0.0.0.0:7070  ◄───────────┼── trigger_crawl.ts
```

**Keep the dev issuer on loopback.** It mints a token for whoever asks, under
whatever name they ask for. Put it somewhere a container can reach and everyone
on the bridge can claim to be `windmill` — which routes around the `submitter`
grant and undoes the point of using JWTs at all.

The power to mint keys stays on the host. What crosses the boundary is **one
finished token**.

**Re-run `pnpm run windmill:capture-ledger-token` after restarting the issuer.** It
generates its keys in memory on every start (deliberately), so the old token
starts returning 401. The error messages in `report_level.ts` and
`trigger_crawl.ts` say so, because this is easy to hit and hard to guess.

## The picker returns 401

Setting `CAPTURE_LEDGER_OIDC_ISSUER` makes capture-ledger accept **only** JWTs, which means the
browser picker at `http://127.0.0.1:7070/` starts returning 401.

That precedence is deliberate on capture-ledger's side: when both are configured, it
must not fall back to the weaker one. So this is not a bug to work around here.

Use one at a time. To use the picker, comment out `CAPTURE_LEDGER_OIDC_ISSUER` in
capture-ledger's `.env`. **Nothing makes both work at once** — that would mean changing
capture-ledger's identity design, which is a separate question.
