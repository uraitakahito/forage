#!/usr/bin/env node
/**
 * `wmill` を `.env` の設定で呼ぶ。
 *
 * CLI 自身も `wmill workspace add` で接続先を覚えられるが、それは **`~/.config` に
 * 状態を作る** —— このマシンでだけ動く設定が repo の外に生まれ、`.env` を書き換えても
 * 効かなくなる。接続先は毎回 flag で渡し、出どころを `.env` 1 つに保つ。
 *
 * `wmill.yaml` は `windmill/` に在るので、そこを cwd にして呼ぶ。
 */
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { guardEnv, optional, required, windmillUrl, windmillWorkspace } from "./env.mjs";

guardEnv();

const here = dirname(fileURLToPath(import.meta.url));
const syncRoot = join(here, "..", "windmill");

const token = required(
  "WINDMILL_TOKEN",
  "pnpm run windmill:bootstrap の出力を .env に貼ってください",
);

const args = process.argv.slice(2);
if (args.length === 0) {
  process.stderr.write("usage: wmill.mjs <wmill の引数...>\n");
  process.exit(1);
}

// `--base-url` を使うときは `--token` と `--workspace` が必須。3 つ揃えて渡す。
const result = spawnSync(
  "wmill",
  [...args, "--base-url", windmillUrl(), "--token", token, "--workspace", windmillWorkspace()],
  {
    cwd: syncRoot,
    stdio: "inherit",
    env: { ...process.env, NO_COLOR: optional("NO_COLOR", "") === "" ? undefined : "1" },
  },
);

if (result.error !== undefined) {
  process.stderr.write(
    `wmill を起動できません: ${result.error.message}\n  pnpm install は済んでいますか\n`,
  );
  process.exit(1);
}
process.exit(result.status ?? 1);
