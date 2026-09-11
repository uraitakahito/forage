---
title: 管理画面
description: Windmill の UI で何が見え、どこまでを UI で変えてよいか
---

Windmill は Web の管理画面を同梱している。この配備ではそれがそのまま
capture-scheduler の管理画面になる。別に何かを立てる必要はない。

## 開き方

```
http://127.0.0.1:8000
```

|          | 既定                 | 上書き              |
| -------- | -------------------- | ------------------- |
| email    | `admin@windmill.dev` | `WINDMILL_EMAIL`    |
| password | `changeme`           | `WINDMILL_PASSWORD` |

ログイン後、workspace `crawler` を選ぶ。

port は **loopback に閉じてある**。compose のコメントの通り、ここに届く者は
workspace を作り替えられる —— schedule も webhook も secret も UI から
書き換えられるので、他のマシンには出さない。

## 画面の歩き方

| 画面                | この配備で見えるもの                                                                                                    |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| **Runs**            | flow と script の実行履歴。段ごとの入出力・エラー・所要時間。クロールの失敗を掘るならまずここ                           |
| **Schedules**       | `f/waggle/daily` — 毎日 04:00 (Asia/Tokyo) に `trigger_crawl` を起こす cron。意味は [いつ走るか](/schedule/) を見ること |
| **Variables**       | `u/admin/waggle_token` (secret) ほか、下の台帳の 4 つ                                                                   |
| **Resources**       | `u/admin/browserhive_proto` — gRPC の `.proto` の写し                                                                   |
| **Flows / Scripts** | `f/waggle/` の 6 script と 1 flow                                                                                       |

UI でやってよいのは「見る」「1 回だけ手で起こす」「一時的に止める」まで。
**恒久的な変更は repo を直して push する。** schedule の `enabled` も
`daily.schedule.yaml` に入っているので、UI で止めても次の `windmill:push` で
動き出す。同期が**両方向とも削除**であることは [開発](/development/) を見ること。

## 変数の台帳 —— どの script が何を入れるか

`windmill:push` が入れるのは **git にあるものだけ**（script・flow・schedule）。
変数とリソースは別の script が入れる。ここを混同すると、push が緑なのに
flow が `Resource not found` で落ちる。

| 置き場                       | 中身                                                         | 入れる script                   |
| ---------------------------- | ------------------------------------------------------------ | ------------------------------- |
| `u/admin/waggle_token`       | capture-ledger への JWT (secret)                             | `windmill:capture-ledger-token` |
| `u/admin/waggle_api_url`     | capture-ledger API の宛先（既定 `http://192.168.64.1:7070`） | 同上                            |
| `u/admin/browserhive_target` | gRPC の宛先 `browserhive.capture-ledger:50051`               | 同上                            |
| `u/admin/browserhive_tls_ca` | TLS の CA（空 = 平文）                                       | 同上                            |
| `u/admin/browserhive_proto`  | `capture.proto` の写し（`crawl_host` が読む）                | `windmill:push-proto`           |

**`windmill:push-proto` は `windmill:push` に含まれない。** proto を取り直したら
これも実行し直すこと —— Windmill が読むのはこの写しで、submodule ではない。

## 全部消えたときの復旧

windmill-db の volume を消すと、workspace・token・変数が全部消える。
復旧の順序（2026-09-11 に実測）:

```sh
pnpm run windmill:bootstrap            # workspace を作り直し、新しい token を出す
                                       # → 出た WINDMILL_TOKEN= を .env に貼り直す
pnpm run windmill:push                 # script / flow / schedule
pnpm run windmill:push-proto           # ← 忘れると crawl_host が Resource not found
pnpm run windmill:capture-ledger-token # 変数 4 つ
cd ../capture-ledger
pnpm run fga:grant submitter windmill acme
```

capture-ledger 側の OpenFGA も同時に消えていたら、grant の前に
`fga:migrate` → `fga:deploy` で store を作り直し、出てきた 2 つの ID を
あちらの `.env` に貼る。

**コンテナを作り直すと bridge の subnet が変わりうる。**
`u/admin/waggle_api_url` の既定は `192.168.64.1` で、subnet が変わると
report の段が `ConnectionRefused` になる。いまの gateway は `ifconfig` の
`bridge100` で分かる。直すのは `.env` の `CAPTURE_LEDGER_API_URL` を書いて
`windmill:capture-ledger-token` を再実行。届いているかは実測できる:

```sh
container exec windmill.capture-scheduler \
  curl -s -o /dev/null -w '%{http_code}\n' -X POST http://192.168.66.1:7070/api/crawls
# 401 なら届いている（認証待ち）。000 なら届いていない
```

## `f/waggle/` という名前

repo は waggle → capture-ledger と改名したが、Windmill の folder は
`f/waggle/` のまま。**folder のパスは webhook URL の一部**
（`/api/w/crawler/jobs/run/f/f/waggle/crawl_level`）で、変えると
capture-ledger 側に設定した webhook が壊れる。名前ではなく外部契約として
据え置いてある。
