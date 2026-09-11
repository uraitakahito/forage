/**
 * 環境変数の読み口。capture-ledger の `src/config/env.ts` と同じ規約に揃えてある。
 *
 * どちらの getter も空文字を「無い」と同じに扱う。POSIX の `${VAR:-word}` 側の
 * 意味で、`??` (`${VAR-word}` 側) は使わない —— `.env` の `NAME=` は既定値を
 * 潰したうえで、名前が一言も出ないエラーになるため。
 */

/**
 * この repo が読む環境変数の全体。**`guardEnv` の検査対象そのもの** なので、
 * 変数を足したらここにも足すこと。`.env.example` との突き合わせは
 * `scripts/check-env.ts` が行う。
 */
export const OPTIONAL_ENV = [
  "WINDMILL_URL",
  "WINDMILL_WORKSPACE",
  "WINDMILL_EMAIL",
  "WINDMILL_PASSWORD",
  "CAPTURE_LEDGER_API_URL",
  "CAPTURE_LEDGER_OIDC_ISSUER",
  "CAPTURE_LEDGER_SUBJECT",
  "CAPTURE_LEDGER_ORGANIZATIONS",
  "CAPTURE_LEDGER_TOKEN_EXPIRES_IN",
  "CAPTURE_LEDGER_BROWSERHIVE_TARGET",
  "CAPTURE_LEDGER_BROWSERHIVE_TLS_CA_PEM",
];

/** 値を貼るまで空でいる変数。`guardEnv` の対象外。 */
export const PASTED_ENV = ["WINDMILL_TOKEN"];

/**
 * 空で設定されている optional な変数があれば、起動時に落とす。
 *
 * 空文字は無害ではない。既定値を通り抜けて、その変数名がどこにも出ない形で
 * ずっと先で失敗する。行ごと消せば即座に名指しで落ちる。
 */
export const guardEnv = () => {
  const blank = OPTIONAL_ENV.filter((name) => process.env[name] === "");
  if (blank.length === 0) return;
  process.stderr.write(
    `空で設定されている環境変数:\n${blank.map((n) => `  - ${n}`).join("\n")}\n\n` +
      "  値を書くか、行ごと消すこと。空文字は既定値を潰します。\n",
  );
  process.exit(1);
};

export const optional = (name: string, fallback: string): string => {
  const value = process.env[name];
  return value === undefined || value === "" ? fallback : value;
};

export const required = (name: string, hint?: string): string => {
  const value = process.env[name];
  if (value === undefined || value === "") {
    throw new Error(`${name} is not set${hint === undefined ? "" : ` (${hint})`}`);
  }
  return value;
};

/**
 * repo の根。**dist 経由で動くことを前提に解く。**
 *
 * script は `dist/scripts/foo.js` として実行されるので、自分の位置から
 * `..` を 1 つ登ると `dist/` で止まる —— `.env.example` も `proto/` も
 * `docs-site/` もそこには無い。TypeScript 化のときに実際に踏んだ
 * (`ENOENT: dist/.env.example`)。
 *
 * `process.cwd()` を使うのは、**package.json の script から呼ばれる**ため。
 * pnpm は repo の根で実行するので、どこから叩いても根が返る。`import.meta.url`
 * に頼ると「ソースの位置」と「実行される位置」が別物になった瞬間に壊れる。
 */
export const repoRoot = (): string => process.cwd();

/** よく使う 3 つ。既定値は `.env.example` のコメントと一致させること。 */
export const windmillUrl = () => optional("WINDMILL_URL", "http://127.0.0.1:8000");
export const windmillWorkspace = () => optional("WINDMILL_WORKSPACE", "crawler");
export const ledgerApiUrl = () => optional("CAPTURE_LEDGER_API_URL", "http://192.168.64.1:7070");

/**
 * Windmill の API を叩く。
 *
 * 失敗の本文をそのまま投げる —— Windmill は理由を本文で返すので、status だけに
 * すると「400 でした」しか分からなくなる。
 */
export interface WindmillFetchOptions {
  /** 付けると Authorization: Bearer に載る。bootstrap の前は無い。 */
  token?: string;
  method?: string;
  /** JSON にして送る。undefined なら content-type も付けない。 */
  body?: unknown;
}

/**
 * 戻り値が `unknown` なのは、**endpoint ごとに形が違うから**。呼ぶ側が
 * 自分の期待する形に絞る (型アサーションか、必要なら検証) —— ここで
 * `any` を返すと、絞り忘れが型検査を素通りする。
 */
export const windmillFetch = async (
  path: string,
  { token, method = "GET", body }: WindmillFetchOptions = {},
): Promise<unknown> => {
  const res = await fetch(`${windmillUrl()}${path}`, {
    method,
    headers: {
      ...(token === undefined ? {} : { authorization: `Bearer ${token}` }),
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`${method} ${path} → ${String(res.status)} ${text.slice(0, 300)}`);
  }
  try {
    return JSON.parse(text);
  } catch {
    // token の発行など、素の文字列を返す endpoint がある。
    return text;
  }
};
