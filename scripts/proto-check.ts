#!/usr/bin/env node
/**
 * vendor した proto が capture-ledger の写しと一致しているかを見る。
 *
 * ## なぜ capture-ledger と比べるのか
 *
 * 契約の正は browserhive だが、**capture-ledger が既にその番人をしている** ——
 * `.upstream/browserhive` の submodule を持ち、`proto:check` が CI で差分を検出する。
 * capture-scheduler が browserhive を直接見に行くと、鎖が 2 本になって、capture-ledger が上げていないのに
 * capture-scheduler だけ新しい、という状態が作れてしまう。
 *
 * 鎖は 1 本にする: browserhive → (capture-ledger の proto:check) → capture-ledger → (これ) → capture-scheduler。
 *
 * ## これが無いと何が起きるか
 *
 * 手で写した契約は黙って腐る。waxlens で既に起きている —— あちらには browserhive の
 * ソースの行番号を指す注記が 6 箇所あり、何もそれを検査していない。同じものを増やさない。
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { repoRoot } from "./env.js";

const local = join(repoRoot(), "proto", "browserhive", "v1", "capture.proto");

const REPO = "uraitakahito/capture-ledger";
const PATH = "proto/browserhive/v1/capture.proto";
const REF = "main";

const fetchUpstream = () => {
  const result = spawnSync(
    "gh",
    ["api", `repos/${REPO}/contents/${PATH}?ref=${REF}`, "--jq", ".content"],
    { encoding: "utf8" },
  );
  if (result.status !== 0) {
    throw new Error(
      `capture-ledger の proto を引けません: ${String(result.stderr).slice(0, 200)}\n` +
        "  gh の認証は通っていますか (gh auth status)",
    );
  }
  return Buffer.from(result.stdout, "base64").toString("utf8");
};

const upstream = fetchUpstream();
const vendored = readFileSync(local, "utf8");

if (upstream === vendored) {
  const lines = vendored.split("\n").length;
  process.stdout.write(`✓ proto check passed: ${REPO}@${REF} と一致 (${String(lines)} 行)\n`);
  process.exit(0);
}

process.stderr.write(
  `vendor した proto が ${REPO}@${REF} と食い違っています。\n\n` +
    `  取り直す:  gh api repos/${REPO}/contents/${PATH}?ref=${REF} --jq .content \\\n` +
    `               | base64 -d > proto/browserhive/v1/capture.proto\n\n` +
    "  そのうえで `pnpm run windmill:push-proto` を忘れないこと ——\n" +
    "  Windmill が読むのは変数に入れた写しで、このファイルではありません。\n",
);
process.exit(1);
