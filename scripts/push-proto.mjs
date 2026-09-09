#!/usr/bin/env node
/**
 * vendor した proto を Windmill の変数に入れる。
 *
 * ## なぜ変数なのか
 *
 * Windmill の script は container の中で走るので、この repo のファイルを読めない。
 * `wmill.yaml` の `includes: [f/**]` が同期するのも script と flow だけで、任意の
 * ファイルは運べない。
 *
 * 残る道は 2 つ —— script の中に文字列として埋め込むか、変数に入れるか。後者にした。
 * 埋め込むと proto を更新するたびに TypeScript を書き換えることになり、差分が
 * 「契約が変わった」なのか「コードが変わった」なのか読めなくなる。
 *
 * ## 生成コードを使わない理由
 *
 * waggle は 6308 行の生成クライアントを持っているが、`@grpc/proto-loader` は proto を
 * **実行時に**読める。運ぶのが 586 行で済み、型は失うが、この用途で使う RPC は 2 つだけ
 * (`SubmitCapture` / `GetCapture`)。
 *
 * 秘密ではないので `is_secret` は立てない —— 立てるとログで伏せられて、
 * 食い違ったときに読めなくなる。
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { guardEnv, windmillFetch, windmillWorkspace } from "./env.mjs";

guardEnv();

const here = dirname(fileURLToPath(import.meta.url));
const PROTO_PATH = "u/admin/browserhive_proto";

/** `waggle-token.mjs` と同じ形 —— create が 400 なら update に落ちる。 */
const upsertVariable = async (token, path, value, isSecret) => {
  const workspace = windmillWorkspace();
  const body = { path, value, is_secret: isSecret, description: "forage が設定" };
  try {
    await windmillFetch(`/api/w/${workspace}/variables/create`, { token, method: "POST", body });
    return "作成";
  } catch {
    await windmillFetch(`/api/w/${workspace}/variables/update/${path}`, {
      token,
      method: "POST",
      body,
    });
    return "更新";
  }
};

const main = async () => {
  const windmillToken = process.env["WINDMILL_TOKEN"];
  if (windmillToken === undefined || windmillToken === "") {
    throw new Error(
      "WINDMILL_TOKEN is not set —— pnpm run windmill:bootstrap の出力を .env に貼ってください",
    );
  }

  const proto = readFileSync(join(here, "..", "proto", "browserhive", "v1", "capture.proto"), "utf8");
  const action = await upsertVariable(windmillToken, PROTO_PATH, proto, false);

  process.stderr.write(
    `${PROTO_PATH} を${action} (${String(proto.split("\n").length)} 行)\n\n` +
      "proto を取り直したら、これも実行し直すこと —— Windmill が読むのはこの写しです。\n",
  );
};

main().catch((err) => {
  process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
