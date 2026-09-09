---
title: リンクを辿る
description: 1 段の流れ —— ホストで束ね、ホスト間は並列、ホスト内は逐次、間隔は完了の後
---

waggle の `POST /api/crawls` が種を受け取り、**1 段ずつ** flow に投げる。flow は
`f/waggle/crawl_level` で、1 回の実行が 1 段。

```
plan_level    ホストで束ね、robots.txt を 1 ホスト 1 回引く
  ↓
for-each      ホストごとに並列（parallelism = host_parallelism）
  crawl_host    1 ホスト内は逐次。完了 → 間隔 → 次
  ↓
report_level  waggle に報告し、次の段があるかを受け取る
  ↓
index_level   台帳に載ったぶんを索引に載せるよう waggle に頼む
```

**繰り返すのは waggle。** この flow は 1 段で終わる。Windmill の while ループに
繰り返しを持たせようとしたが、`stop_after_if` を付けた最小の flow が
**643 回まで回り続けた**。相手のサーバに負荷をかけない仕組みを、暴走しうるループの
上には載せない。上限の判定は waggle 側にあり、単体試験が付いている。

## 礼儀はループの形で守る

**Windmill CE の per-key concurrency limit は使えない** —— 無言で素通しになる理由は
[Windmill CE](/windmill-ce/) に。代わりに効くのは for-loop の `parallelism` なので、
礼儀を**ループの構造として**表す:

- **ホスト間** の同時数 = for-loop の `parallelism`
- **ホスト内** は `crawl_host` が逐次に回し、**完了の後**に間隔を空ける
- **段の境目** は waggle が「そのホストを最後に触り終えた時刻」を渡し、残りを待たせる

### 間隔は完了の後。投入の前ではない

細部に見えて、そうではないところ。

BrowserHive の `TaskQueue` に**容量制限は無く、投入は決して拒まれない**。同時に走る数を
決めているのは worker の数だけ。だから 3 件を間を空けて投げても何も変わらない ——
キューに並んで連続して実行される。**投入側の間隔は相手のサーバに届かない。**

間隔が意味を持つのは、「前のページが終わってから、次を投げるまで」に置いたときだけ:

```ts file="windmill/f/waggle/crawl_host.ts#pacing"

```

### 3 つ目は後から足した

無いと、間隔は段の**中**では効き、段の**境目**で消える。3000ms 設定に対して、実測で
**521ms** まで詰まった。

残りを計算するのは `plan_level`。robots.txt は両方向に効く —— 相手がより長い値を
言っているなら、相手が勝つ:

```ts file="windmill/f/waggle/plan_level.ts#delay"

```

`Math.min` ではなく `Math.max`。**相手が言っている値をこちらの都合で縮めない。**
`test/plan-level.test.ts` に両側の試験があるのは、「robots があれば常に robots を採る」
実装が片側の試験を通ってしまうから。

## 設定は変数から読む

`crawl_host` と `report_level` と `index_level` は接続先を**引数では受けない**。
Windmill は schema の既定値を **UI からの実行にしか埋めない**ので、webhook で
起こすと何も届かない —— `browserhive_target` が undefined で
「Channel target must be a string」になった。

```sh
pnpm run windmill:waggle-token   # waggle_token / waggle_api_url / browserhive_target
pnpm run windmill:push-proto     # browserhive の proto (resource)
```

proto が **resource** で変数でないのは、変数の上限（10,000〜20,000 バイトの間）を
16,315 バイトの proto が超えるため。`pnpm run proto:check` が waggle の写しとの差分を
見る —— 手で写した契約は黙って腐るので、番人を置く。
