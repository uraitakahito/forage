---
title: いつ走るか
description: 毎日 04:00 Asia/Tokyo、重なっても安全な理由、このファイルのコメントが消える理由
---

`windmill/f/waggle/daily.schedule.yaml` —— **毎日 04:00 (Asia/Tokyo)**。

```yaml
schedule: 0 0 4 * * * # 秒 分 時 日 月 曜
timezone: Asia/Tokyo
enabled: true
```

止めたいときは `enabled: false` にして `pnpm run windmill:push`。

## 重なりは気にしなくてよい

Windmill は前の job が走っていても次を起こす。それで構わない —— waggle が走行中の
2 本目を **409** で拒み、`trigger_run.ts` はそれを「見送り」として緑で終える。

つまり時刻がどれだけ詰まっていても、走るのは常に 1 本。この保証は forage ではなく
**waggle の部分 unique index** が持っている。そこが正しい置き場所で、アプリ側の
フラグで守ると、プロセスが増えた日に黙って破れる。

## このファイルのコメントは消える

`wmill sync pull` は `daily.schedule.yaml` をサーバの状態から書き直し、サーバは
コメントを保存しない。**なぜこの時刻なのか**は YAML ではなく、このページに書くこと。

`windmill/wmill.yaml` が `includeSchedules: true` にしてあるのも同じ話。既定では
schedule は同期されず、**「いつ走るか」—— この repo が決める唯一のこと —— だけが
git から漏れる**ことになる。
