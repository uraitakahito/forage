/**
 * docs-site/ の Starlight のドキュメントが嘘をつかないことを確かめる。
 *
 * **`astro build` はこれを守らない。** region が欠けていると
 * "Failed to parse Markdown file" と log には出るのに、Starlight の docs loader が
 * 例外を捕まえるので、全ページをビルドしたと報告して 0 で終わる (waggle と meadow が
 * 実測して docstring に残している。落ちるのは `.mdx` のときだけで、forage は全部
 * `.md`)。ビルドに任せると、ドキュメントは空のコードフェンスのまま出てしまう。
 *
 * 見るのは 3 つ:
 *
 *   1. 訳の欠落 —— 日本語版の無い英語ページ、あるいは英語の原文が無い日本語ページ。
 *      Starlight はページが無いと黙って英語に落とすので、**半分だけ訳したサイトも
 *      緑でビルドできる**。読み手が違う言語に着地するまで誰も気づかない。
 *   2. 壊れた `#region` の抜粋。
 *   3. 死んだソースのパス —— コードスパンに書かれた `windmill/….ts` のうち、その後
 *      名前が変わったか消えたもの。
 *
 * 訳について見るのはページの **存在** だけで、構造は一切見ない。両方の言語に同じ
 * 見出しを強いると日本語が悪くなる。ページの歩調を合わせるのは人の仕事で、
 * ページが消えないようにするのがこちらの仕事。
 *
 * ## 他の repo との違い
 *
 * waggle と meadow の同名スクリプトは `src/` を直書きしている。**forage に `src/` は
 * 無い** —— TypeScript は `windmill/f/waggle/` に在り、Windmill の worker (bun) が
 * 動かす。そのまま持ってくると meadow 版は ENOENT で落ちる。
 *
 * `pnpm run site:check` (ビルド + このスクリプト) から走る。問題の一覧を出して 1 で
 * 終わるので、CI が PR を落とす。
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const DOCS = resolve(ROOT, "docs-site/src/content/docs");
const JA = resolve(DOCS, "ja");
/** ソースの根。waggle / meadow はここが `src`。 */
const SOURCE_ROOT = "windmill/f";

/** 配下のページを再帰で集める。`ja/` は呼ぶ側が分ける。 */
const pagesIn = (dir, skipJa = false) => {
  const out = [];
  const walk = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) {
        if (skipJa && full === JA) continue;
        walk(full);
      } else if (/\.mdx?$/.test(entry.name)) {
        out.push(relative(skipJa ? DOCS : JA, full));
      }
    }
  };
  walk(skipJa ? DOCS : JA);
  return out;
};

const problems = [];

// ── 1. 訳の対応 ──────────────────────────────────────────────────────
const en = pagesIn(DOCS, true);
const ja = new Set(existsSync(JA) ? pagesIn(JA) : []);

for (const page of en) {
  if (!ja.has(page)) {
    problems.push(`ja/${page} is missing (English page has no Japanese counterpart)`);
  }
}
for (const page of ja) {
  if (!en.includes(page)) {
    problems.push(`${page} is missing (orphan Japanese page with no English original)`);
  }
}

// ── 2. ソースへの参照 ────────────────────────────────────────────────
for (const page of [...en.map((p) => join(DOCS, p)), ...[...ja].map((p) => join(JA, p))]) {
  const rel = relative(ROOT, page);
  const text = readFileSync(page, "utf8");

  // コードスパンに書かれたソースのパス。
  for (const [, path] of text.matchAll(
    new RegExp("`(" + SOURCE_ROOT + "/[A-Za-z0-9_\\-/]+\\.ts)`", "g"),
  )) {
    if (!existsSync(resolve(ROOT, path))) {
      problems.push(`${rel}: \`${path}\` does not exist (renamed or moved?)`);
    }
  }

  // 埋め込み: ```ts file="windmill/…#region"
  for (const [, path, region] of text.matchAll(/file="([^"#]+)#([^"]+)"/g)) {
    const abs = resolve(ROOT, path);
    if (!existsSync(abs)) {
      problems.push(`${rel}: file="${path}" does not exist`);
      continue;
    }
    // 名前は行末まで続いていなければならない。extract.ts と同じ規則。`\b` では
    // 足りない: `y` と `-` の間に単語の境界が在るので、`delay` を求めると
    // `#region delay-v2` という印にも当たってしまう —— そして非 0 で終わるのは
    // この検査だけなので、ここが緩いとずれがそのまま出荷される。
    const re = new RegExp(
      String.raw`//\s*#region\s+${region}[ \t]*\r?$[\s\S]*?//\s*#endregion`,
      "m",
    );
    if (!re.test(readFileSync(abs, "utf8"))) {
      problems.push(
        `${rel}: region "${region}" not found in ${path} (renamed, removed, or missing #endregion?)`,
      );
    }
  }
}

if (problems.length > 0) {
  console.error("doc-ref check failed:");
  for (const p of problems) console.error(`  ${p}`);
  process.exit(1);
}

console.log(
  `✓ doc-ref check passed: ${en.length} pages in English and Japanese, all source paths resolve`,
);
