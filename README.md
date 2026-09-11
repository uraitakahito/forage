# capture-scheduler

Starts [capture-ledger](https://github.com/uraitakahito/capture-ledger)'s captures **on time**.
capture-ledger exposes `POST /api/crawls` so that "when to run" can live outside it —
capture-scheduler is that outside: one [Windmill](https://www.windmill.dev/) instance, a
cron expression, and a script that calls the endpoint. It also drives the
link-following crawl, one level per flow execution.

This repository contains **no URLs**. What to capture is capture-ledger's decision; when
is this one's.

## Documentation

Everything — bringing the stack up, how the crawl stays polite, what Windmill's
Community Edition silently does not enforce, and how the tests are split — lives
on the docs site:

- **English** — <https://uraitakahito.github.io/capture-scheduler/>
- **日本語** — <https://uraitakahito.github.io/capture-scheduler/ja/>

## Related Projects

- [capture-ledger](https://github.com/uraitakahito/capture-ledger) — decides what to capture and talks to BrowserHive; capture-scheduler only decides when.
- [BrowserHive](https://github.com/uraitakahito/browserhive) — the web-capture server at the far end of the chain.

## License

Windmill itself is AGPLv3. Running it internally is unconstrained; redistributing
it as part of a product means complying with AGPLv3 or buying a commercial
licence.
