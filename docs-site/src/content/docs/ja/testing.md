---
title: 試験
description: 何も要らない単体 44 件と、スタック一式が要る e2e 1 件。なぜ両方要るのか
---

```sh
pnpm run test        # 単体 44 件。スタック不要、数秒
pnpm run test:e2e    # e2e 1 件。スタックが要る
pnpm run check       # format / env / typecheck / 単体
```

`pretest:e2e` が先に `scripts/check-stack.mjs` を走らせ、足りないものを**全部まとめて**
名指しする。vitest の外に置いてあるのは意図的 —— global setup が throw すると vitest は
必ず「No test files found, exiting with code 1」を先に出し、中に書いたどんなメッセージも
その後ろに隠れるため。

## なぜ二層とも要るのか

この repo が実際に出した不具合は、**重ならない 2 つの層**に分かれる。

| 不具合                                                | 単体 | e2e |
| ----------------------------------------------------- | ---- | --- |
| `respect_robots` が `null` で robots が読まれなかった | ○    | ○   |
| 段の境目で間隔が 3000ms → **521ms** に潰れた          | ○    | △   |
| 本文の無い POST に `content-type` を付けて 400        | ○    | ○   |
| `hostParallelism` が camelCase で `null` になった     | ✗    | ○   |
| schema の既定値が webhook 実行では効かない            | ✗    | ○   |

下 2 つは*定義上*単体には見えない —— 引数を渡すのは `flow.yaml` であって TypeScript
ではないから。片方だけを選ぶと、穴の半分がそのまま残る。

## 単体は何も要らない

`windmill-client` は既に devDependency で、`plan_level.ts` が import するのは
`robots-parser` だけ。だから script はそのまま vitest に読み込める。IO は差し替える:
`vi.stubGlobal("fetch", …)` と `vi.mock("windmill-client", …)`。

`captureHost` を `crawl_host.ts` から export してあるのは、間隔のループを偽の client で
回すため —— `call()` は `client[method](req, cb)` を呼ぶだけなので、偽物はただの
オブジェクトで足りる。`pollMs` を引数にしてあるのは、**実タイマーの ms スケール**で
書くため。fake timer は、この workspace の別の場所で capture 系の sleep に対して試して
一往復溶かしている。

## e2e は本物のクロールを 1 本起こす

1 件、約 40 秒。Windmill の実行の口ではなく **waggle の API** を通す —— 目的が
「waggle が実際に送る引数」を運ぶことだから（5 つ。`respect_robots` は入っていない）。

見ているのは 3 つ:

1. **meadow が `/links/hidden` を一度も受け取っていない**こと。robots.txt が禁じている
   ページで、判定は**相手のリクエストログ**から採る —— 台帳は「記録したこと」しか
   言わない。
2. クロールが成功し、1 ページ以上取り込んでいること
3. `GET /api/search?q=hub` がヒットを返すこと —— 索引の step まで flow の中で
   終わっている証拠

`plan_level.ts` の `?? true` を消して配備すると、**単体と e2e が両方赤くなり**、
e2e のほうは meadow が禁じられたページを受け取ったことを示す。この対は一度わざと
確かめてある: 片方しか赤くならないなら、もう片方は見ているつもりで見ていない。

## 覆えていないもの

`trigger_run.ts` の待機ループ。`POLL_INTERVAL_MS` を引数に出せば書ける ——
`crawl_host.ts` に対して既にやった 3 行と同じ変更 —— が、いまのままだと sleep が
最初の問い合わせより前に入るので、1 本あたり 15 秒かかる。

その結果、**日次の実行が成功したかどうかを決めている 2 行**
（`if (run.status === "running") continue` と `failed` の throw）に**覆いが 1 つも無い**。
他に通るものも無い —— e2e が触るのはクロールの経路で、実行の経路ではない。
