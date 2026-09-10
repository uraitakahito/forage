---
title: forage
description: Starts waggle's captures on time — a single Windmill instance whose only job is to decide when, never what
---

forage starts [waggle](https://uraitakahito.github.io/waggle/)'s captures **on
time**. That is the whole job.

waggle exposes `POST /api/crawls` so that "when to run" can live outside it.
forage is that outside: one [Windmill](https://www.windmill.dev/) instance, a
cron expression, and a script that calls the endpoint.

## The boundary

|                    |                                                                                                 |
| ------------------ | ----------------------------------------------------------------------------------------------- |
| **forage decides** | when to run                                                                                     |
| **waggle decides** | what to capture and how (targets from `capture_targets`, formats from `WAGGLE_CAPTURE_FORMATS`) |

So this repository contains **no URLs**. It contains a cron expression.

That split is worth keeping. A scheduler that also knows what to capture becomes
a second place to look when the wrong thing is captured — and the two places
disagree eventually.

## One thing it starts

**A crawl.** The nightly job asks waggle for a crawl seeded from every enabled
row of `capture_targets` (`fromTargets`), at depth 0 — the list is captured, its
links are not followed. See [Schedule](/schedule/).

There used to be a second thing, a _run_: the same set of targets, submitted all
at once. A run was a depth-0 crawl without the pacing, so it was folded into the
crawl and `POST /api/runs` is gone. The nightly capture now waits between pages
of the same host, like every other crawl.

forage also **runs every level of every crawl**, including the ones it did not
start: waggle hands it **one level at a time** and forage returns what it found;
see [Following links](/crawl/).

That path is where the interesting constraints are, because it is the one that
touches someone else's server repeatedly.

## Where things are

| I want to…                            | Page                         |
| ------------------------------------- | ---------------------------- |
| bring the stack up for the first time | [Quickstart](/quickstart/)   |
| understand the crawl flow             | [Following links](/crawl/)   |
| change when the nightly job runs      | [Schedule](/schedule/)       |
| know what Windmill CE silently skips  | [Windmill CE](/windmill-ce/) |
| run or extend the tests               | [Testing](/testing/)         |
| push a change back to Windmill        | [Development](/development/) |
