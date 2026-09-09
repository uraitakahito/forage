# forage

waggle の取り込みを、時刻どおりに起こす。

waggle には `POST /api/runs` がある —— 「いつ走らせるか」を外に出すための口で、
**forage がその外側**。[Windmill](https://www.windmill.dev/) を 1 つ立て、cron で
その口を叩く。

境界はこう引いてある:

|                     |                                                                                 |
| ------------------- | ------------------------------------------------------------------------------- |
| **forage が決める** | いつ走らせるか                                                                  |
| **waggle が決める** | 何を・どう投げるか（対象は `capture_targets`、形式は `WAGGLE_API_RUN_FORMATS`） |

だから、この repo に「どの URL を取るか」は 1 つも書いていない。書いてあるのは cron 式だけ。

## 立ち上げる

```sh
sudo container system dns create forage   # マシンごとに 1 度だけ
./setup.sh
container-compose up -d
pnpm install

pnpm run windmill:bootstrap   # workspace と token を作り、貼れる形で出力する
                              # → 出た WINDMILL_TOKEN= を .env に貼る
pnpm run windmill:push        # スクリプトと schedule を投入する
```

waggle 側（別のターミナル）:

```sh
cd ../waggle
# .env に:
#   WAGGLE_API_HOST=0.0.0.0                     コンテナから届くように
#   WAGGLE_OIDC_ISSUER=http://127.0.0.1:9099    JWT で受けるように
pnpm run oidc:issuer
pnpm run api
pnpm run fga:grant submitter windmill acme      # これが無いと 404
```

戻ってきて、鍵を渡す:

```sh
pnpm run windmill:waggle-token
```

`http://127.0.0.1:8000` で Windmill が開く。

## トークンの経路

```
host                                   │ コンテナ
  dev issuer 127.0.0.1:9099            │
      │ POST /token                    │
      ▼                                │
  windmill:waggle-token ───────────────┼──► secret 変数 u/admin/waggle_token
                                       │            │
  waggle-api 0.0.0.0:7070  ◄───────────┼── trigger_run.ts
```

**dev issuer は loopback から出さないこと。** あれは頼まれれば誰の名前でもトークンを出すので、
コンテナから引ける場所に置いた瞬間、ブリッジに届く誰もが `windmill` を名乗れる ——
`submitter` の付与を回り込めることになり、JWT にした意味が消える。

鍵を作る力は host に残し、跨がせるのは**出来上がったトークン 1 本**だけ。

**issuer を再起動したら `pnpm run windmill:waggle-token` をやり直すこと。**
issuer は起動のたびに鍵をメモリ上で作り直すので（意図された挙動）、古いトークンは 401 になる。

## picker が 401 になる

`WAGGLE_OIDC_ISSUER` を立てると、waggle は JWT だけを受け付けるようになり、
**ブラウザで開く picker（`http://127.0.0.1:7070/`）が 401 になる**。
JWT が dev ヘッダより優先されるのは意図された設計で、「両方設定された環境で弱いほうへ
落ちない」ため。

使い分けてください。picker を触るときは waggle の `.env` の `WAGGLE_OIDC_ISSUER` を
コメントアウトする。**両立させる仕組みは作っていない** —— それは identity の設計を
変える話で、別件。

## 変更のしかた

Windmill の UI で触った結果は、必ず git に戻すこと。

```sh
pnpm run windmill:diff   # UI と git の差を見る (push はしない)
pnpm run windmill:pull   # UI の変更を git に取り込む
pnpm run windmill:push   # git を正として UI に反映する
```

`windmill/wmill.yaml` は `includeSchedules: true` にしてある。既定では schedule は
同期されず、**「いつ走るか」だけが追跡から漏れる** —— この repo の唯一の仕事なのに。

秘密は同期しない（`skipSecrets`）。`u/admin/waggle_token` は
`scripts/waggle-token.mjs` が API 経由で入れる。

## 範囲外

1. **失敗しても誰にも知らせない。** schedule の error handler は Windmill の Enterprise 機能。
   失敗は実行履歴に赤で残るだけで、見に行くまで気づかない。
2. **本番構成は決めていない。** Apple Container は開発用。
3. **CLI との排他は保証されない。** `waggle: pnpm run capture` は `runs` に行を作らないので、
   forage が起こした実行と並んで走りうる（waggle 側の既知の穴）。

## ライセンス

Windmill 自体は AGPLv3。社内で自分たちのために動かすぶんには制約にならないが、
Windmill を製品の一部として外部に再提供するなら、AGPLv3 に従うか商用ライセンスが要る。
