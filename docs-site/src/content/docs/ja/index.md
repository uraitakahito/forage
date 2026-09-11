---
title: capture-scheduler
description: capture-ledger の取り込みを時刻どおりに起こす —— 「いつ」だけを決め、「何を」は決めない Windmill
---

capture-scheduler は [capture-ledger](https://uraitakahito.github.io/capture-ledger/) の取り込みを
**時刻どおりに起こす**。仕事はそれだけ。

capture-ledger には `POST /api/crawls` がある —— 「いつ走らせるか」を外に出すための口で、
capture-scheduler がその外側。[Windmill](https://www.windmill.dev/) を 1 つ立て、cron で
その口を叩く。

## 境界

|                                |                                                                                         |
| ------------------------------ | --------------------------------------------------------------------------------------- |
| **capture-scheduler が決める** | いつ走らせるか                                                                          |
| **capture-ledger が決める**    | 何を・どう投げるか（対象は `capture_targets`、形式は `CAPTURE_LEDGER_CAPTURE_FORMATS`） |

だから、この repo に **URL は 1 つも書いていない**。書いてあるのは cron 式だけ。

この切り分けは守る価値がある。「何を取るか」も知っているスケジューラは、
おかしなものが取り込まれたときに**見る場所が 2 つ**になる —— そして 2 つは、
いつか食い違う。

## 起こすものは 1 つ

**クロール。** 日次の仕事は、`capture_targets` の有効な行を種にしたクロールを
capture-ledger に頼む（`fromTargets`）。深さは 0 —— 一覧は取り込むが、リンクは辿らない。
[いつ走るか](/schedule/) を見ること。

以前はもう 1 つ、**実行**があった —— 同じ対象を全部、並列に投げるもの。あれは
間隔を持たない深さ 0 のクロールだったので、クロールに畳んだ（`POST /api/runs` は
もう無い）。日次の取り込みにも、同じホストへの間隔が効くようになっている。

段を回すのも capture-scheduler —— 自分が起こしていないクロールも含めて、capture-ledger が **1 段ずつ**
渡し、capture-scheduler は見つけたものを返す。[リンクを辿る](/crawl/) を見ること。

面白い制約が集まっているのはこちら —— **他人のサーバを繰り返し叩く**のがこの道だから。

## どこに何があるか

| したいこと                           | ページ                           |
| ------------------------------------ | -------------------------------- |
| 初めて立ち上げる                     | [クイックスタート](/quickstart/) |
| クロールの flow を理解する           | [リンクを辿る](/crawl/)          |
| 日次の時刻を変える                   | [いつ走るか](/schedule/)         |
| Windmill CE が黙って飛ばすことを知る | [Windmill CE](/windmill-ce/)     |
| 試験を走らせる・足す                 | [試験](/testing/)                |
| 変更を Windmill に戻す               | [開発](/development/)            |
