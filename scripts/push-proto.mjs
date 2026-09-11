#!/usr/bin/env node
/**
 * vendor した proto を Windmill の resource に入れる。
 *
 * ## なぜ resource なのか
 *
 * Windmill の script は container の中で走るので、この repo のファイルを読めない。
 * `wmill.yaml` の `includes: [f/**]` が同期するのも script と flow だけで、任意の
 * ファイルは運べない。
 *
 * 残る道は 3 つ —— script に埋め込む / 変数に入れる / resource に入れる。
 *
 * **変数には入らない。** 上限は 10,000〜20,000 バイトの間にあり、この proto は
 * 16,315 バイトで超える (実測: 10,000 は 200、20,000 は 400)。resource には入った。
 *
 * 埋め込みを採らなかったのは、proto を更新するたびに TypeScript を書き換えることになり、
 * 差分が「契約が変わった」なのか「コードが変わった」なのか読めなくなるため。
 *
 * ## 生成コードを使わない理由
 *
 * waggle は 6308 行の生成クライアントを持っているが、`@grpc/proto-loader` は proto を
 * **実行時に**読める。運ぶのが 586 行で済み、型は失うが、この用途で使う RPC は 2 つだけ
 * (`SubmitCapture` / `GetCapture`)。
 *
 * 秘密ではないので伏せない —— 伏せるとログから消えて、食い違ったときに読めなくなる。
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { guardEnv, windmillFetch, windmillWorkspace } from "./env.mjs";

guardEnv();

const here = dirname(fileURLToPath(import.meta.url));
const PROTO_PATH = "u/admin/browserhive_proto";

/** `waggle-token.mjs` と同じ形 —— create が 400 なら update に落ちる。 */
const upsertResource = async (token, path, value) => {
  const workspace = windmillWorkspace();
  const body = { path, value, resource_type: "state", description: "capture-scheduler が設定" };
  try {
    await windmillFetch(`/api/w/${workspace}/resources/create`, { token, method: "POST", body });
    return "作成";
  } catch {
    await windmillFetch(`/api/w/${workspace}/resources/update/${path}`, {
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

  const proto = readFileSync(
    join(here, "..", "proto", "browserhive", "v1", "capture.proto"),
    "utf8",
  );
  const action = await upsertResource(windmillToken, PROTO_PATH, { proto });

  process.stderr.write(
    `${PROTO_PATH} を${action} (${String(proto.split("\n").length)} 行)\n\n` +
      "proto を取り直したら、これも実行し直すこと —— Windmill が読むのはこの写しです。\n",
  );
};

main().catch((err) => {
  process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
