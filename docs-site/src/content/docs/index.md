---
title: forage
description: Starts waggle's captures on time — a single Windmill instance whose only job is to decide when, never what
---

forage starts [waggle](https://uraitakahito.github.io/waggle/)'s captures **on
time**. That is the whole job.

waggle exposes `POST /api/runs` so that "when to run" can live outside it.
forage is that outside: one [Windmill](https://www.windmill.dev/) instance, a
cron expression, and a script that calls the endpoint.

## The boundary

|                    |                                                                                                 |
| ------------------ | ----------------------------------------------------------------------------------------------- |
| **forage decides** | when to run                                                                                     |
| **waggle decides** | what to capture and how (targets from `capture_targets`, formats from `WAGGLE_API_RUN_FORMATS`) |

So this repository contains **no URLs**. It contains a cron expression.

That split is worth keeping. A scheduler that also knows what to capture becomes
a second place to look when the wrong thing is captured — and the two places
disagree eventually.

## Two things it starts

**A run** — every enabled row of `capture_targets`, submitted in parallel. This
is the nightly job; see [Schedule](/schedule/).

**A crawl** — one seed URL, followed link by link. waggle hands forage
**one level at a time** and forage returns what it found; see
[Following links](/crawl/).

The crawl path is where the interesting constraints are, because it is the one
that touches someone else's server repeatedly.

## Where things are

| I want to…                            | Page                         |
| ------------------------------------- | ---------------------------- |
| bring the stack up for the first time | [Quickstart](/quickstart/)   |
| understand the crawl flow             | [Following links](/crawl/)   |
| change when the nightly job runs      | [Schedule](/schedule/)       |
| know what Windmill CE silently skips  | [Windmill CE](/windmill-ce/) |
| run or extend the tests               | [Testing](/testing/)         |
| push a change back to Windmill        | [Development](/development/) |
