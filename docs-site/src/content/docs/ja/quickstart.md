---
title: クイックスタート
description: Windmill を立て、waggle 用のトークンを渡し、UI を開くまで
---

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
  waggle-api 0.0.0.0:7070  ◄───────────┼── trigger_crawl.ts
```

**dev issuer は loopback から出さないこと。** あれは頼まれれば誰の名前でもトークンを
出すので、コンテナから引ける場所に置いた瞬間、ブリッジに届く誰もが `windmill` を
名乗れる —— `submitter` の付与を回り込めることになり、JWT にした意味が消える。

鍵を作る力は host に残し、跨がせるのは**出来上がったトークン 1 本**だけ。

**issuer を再起動したら `pnpm run windmill:waggle-token` をやり直すこと。**
issuer は起動のたびに鍵をメモリ上で作り直すので（意図された挙動）、古いトークンは
401 になる。`report_level.ts` と `trigger_crawl.ts` の失敗メッセージがそう書いてあるのは、
踏みやすく、かつ status だけからは辿れないため。

## picker が 401 になる

`WAGGLE_OIDC_ISSUER` を立てると、waggle は JWT **だけ**を受け付けるようになり、
ブラウザで開く picker（`http://127.0.0.1:7070/`）が 401 になる。

JWT が dev ヘッダより優先されるのは waggle 側の意図された設計で、「両方設定された
環境で弱いほうへ落ちない」ため。こちらで回避するものではない。

使い分けること。picker を触るときは waggle の `.env` の `WAGGLE_OIDC_ISSUER` を
コメントアウトする。**両立させる仕組みは作っていない** —— それは identity の設計を
変える話で、別件。
