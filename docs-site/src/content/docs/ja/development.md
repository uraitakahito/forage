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
（`skipSecrets`）。`u/admin/waggle_token` は `scripts/waggle-token.mjs` が API 経由で入れる。

## どこに何があるか

| path                                           | 何か                                                                             |
| ---------------------------------------------- | -------------------------------------------------------------------------------- |
| `windmill/f/waggle/*.ts`                       | Windmill が Bun で動かす script                                                  |
| `windmill/f/waggle/crawl_level.flow/flow.yaml` | クロール 1 段を回す flow                                                         |
| `windmill/f/waggle/daily.schedule.yaml`        | 日次の実行が起きる時刻                                                           |
| `test/`                                        | 単体試験。**`windmill/f/` の下には置かないこと** —— `sync push` が配備してしまう |
| `scripts/*.mjs`                                | host 側の道具（bootstrap、トークン、点検）                                       |

環境変数を足すのは 3 点契約で、`scripts/check-env.mjs` が両方向に検査する:
`.env.example`、`scripts/env.mjs` の名前の一覧、そしてリテラル文字列での読み取り。

## 範囲外

1. **失敗しても誰にも知らせない。** schedule の error handler は Windmill の Enterprise
   機能。失敗は実行履歴に赤で残るだけで、見に行くまで気づかない。
2. **本番構成は決めていない。** Apple Container は開発用。
3. **CLI との排他は保証されない。** `waggle: pnpm run capture` は `runs` に行を作らないので、
   forage が起こした実行と並んで走りうる（waggle 側の既知の穴）。

## ライセンス

Windmill 自体は AGPLv3。社内で自分たちのために動かすぶんには制約にならないが、
Windmill を製品の一部として外部に再提供するなら、AGPLv3 に従うか商用ライセンスが要る。
