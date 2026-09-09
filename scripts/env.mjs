/**
 * 環境変数の読み口。waggle の `src/config/env.ts` と同じ規約に揃えてある。
 *
 * どちらの getter も空文字を「無い」と同じに扱う。POSIX の `${VAR:-word}` 側の
 * 意味で、`??` (`${VAR-word}` 側) は使わない —— `.env` の `NAME=` は既定値を
 * 潰したうえで、名前が一言も出ないエラーになるため。
 */

/**
 * この repo が読む環境変数の全体。**`guardEnv` の検査対象そのもの** なので、
 * 変数を足したらここにも足すこと。`.env.example` との突き合わせは
 * `scripts/check-env.mjs` が行う。
 */
export const OPTIONAL_ENV = [
  "WINDMILL_URL",
  "WINDMILL_WORKSPACE",
  "WINDMILL_EMAIL",
  "WINDMILL_PASSWORD",
  "WAGGLE_API_URL",
  "WAGGLE_OIDC_ISSUER",
  "WAGGLE_SUBJECT",
  "WAGGLE_ORGANIZATIONS",
  "WAGGLE_TOKEN_EXPIRES_IN",
  "WAGGLE_BROWSERHIVE_TARGET",
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

export const optional = (name, fallback) => {
  const value = process.env[name];
  return value === undefined || value === "" ? fallback : value;
};

export const required = (name, hint) => {
  const value = process.env[name];
  if (value === undefined || value === "") {
    throw new Error(`${name} is not set${hint === undefined ? "" : ` (${hint})`}`);
  }
  return value;
};

/** よく使う 3 つ。既定値は `.env.example` のコメントと一致させること。 */
export const windmillUrl = () => optional("WINDMILL_URL", "http://127.0.0.1:8000");
export const windmillWorkspace = () => optional("WINDMILL_WORKSPACE", "crawler");
export const waggleApiUrl = () => optional("WAGGLE_API_URL", "http://192.168.64.1:7070");

/**
 * Windmill の API を叩く。
 *
 * 失敗の本文をそのまま投げる —— Windmill は理由を本文で返すので、status だけに
 * すると「400 でした」しか分からなくなる。
 */
export const windmillFetch = async (path, { token, method = "GET", body } = {}) => {
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
