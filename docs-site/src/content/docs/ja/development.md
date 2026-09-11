---
title: 開発
description: git と Windmill の往復、意図的に範囲外にしていること、ライセンス
---

## 変更のしかた

Windmill の UI で触った結果は、必ず git に戻すこと。

```sh
pnpm run windmill:diff   # UI と git の差を見る (push はしない)
pnpm run windmill:pull   # UI の変更を git に取り込む
pnpm run windmill:push   # git を正として UI に反映する
```

**両方向とも削除する。** `push` はローカルに無い remote の項目を、`pull` は remote に
無いローカルのファイルを消す。同期の前にコミットし、pull の前に push すること ——
[Windmill CE](/windmill-ce/) に実例がある。

`windmill/wmill.yaml` は `includeSchedules: true` にしてある。秘密は同期しない
（`skipSecrets`）。`u/admin/waggle_token` は `scripts/capture-ledger-token.mjs` が API 経由で入れる。

## スクリーンショットを撮り直す

[管理画面](/windmill-ui/) の PNG は `scripts/docs-shots.mjs` の生成物。手で撮った絵は
無い。UI が変わったら（＝ `docker-compose.yml` の Windmill の pin を上げたら）撮り直す。
`check-doc-refs` が「compose の pin と `shots-manifest.json` の版が食い違っていたら落とす」
ので、忘れても CI が止める。

```sh
# 1. スタックを上げ、run 履歴を作る（下の 3 種が要る。無いと script が止まる）
./setup.sh && container-compose up -d -b   # + capture-ledger 側の API / issuer
#    - crawl_level の成功が 1 本
#    - crawl_host の失敗（browserhive_proto が無い状態で 1 本）
#    - report_level の失敗（何らかの失敗が 1 本）
# 2. 撮る（Chromium は初回だけ手で取得。puppeteer は docs 撮影専用）
./node_modules/.bin/puppeteer browsers install chrome
node scripts/docs-shots.mjs
```

`puppeteer` を消すときは `package.json` の `//devDependencies` の註も消すこと。

## どこに何があるか

| path                                           | 何か                                                                             |
| ---------------------------------------------- | -------------------------------------------------------------------------------- |
| `windmill/f/waggle/*.ts`                       | Windmill が Bun で動かす script                                                  |
| `windmill/f/waggle/crawl_level.flow/flow.yaml` | クロール 1 段を回す flow                                                         |
| `windmill/f/waggle/daily.schedule.yaml`        | 日次のクロールが起きる時刻                                                       |
| `test/`                                        | 単体試験。**`windmill/f/` の下には置かないこと** —— `sync push` が配備してしまう |
| `scripts/*.mjs`                                | host 側の道具（bootstrap、トークン、点検）                                       |

環境変数を足すのは 3 点契約で、`scripts/check-env.mjs` が両方向に検査する:
`.env.example`、`scripts/env.mjs` の名前の一覧、そしてリテラル文字列での読み取り。

## 範囲外

1. **失敗しても誰にも知らせない。** schedule の error handler は Windmill の Enterprise
   機能。失敗は実行履歴に赤で残るだけで、見に行くまで気づかない。
2. **本番構成は決めていない。** Apple Container は開発用。

## ライセンス

Windmill 自体は AGPLv3。社内で自分たちのために動かすぶんには制約にならないが、
Windmill を製品の一部として外部に再提供するなら、AGPLv3 に従うか商用ライセンスが要る。
