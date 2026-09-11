/**
 * `scripts/env.ts` の読み口の試験。
 *
 * **TypeScript 化で初めて書けるようになったもの。** `.mjs` だった頃は
 * 型が無く、vitest から import しても補完も検査も効かなかったので、
 * scripts に対する単体試験は 1 本も無かった (host 側の道具は「動かして
 * 確かめる」しかなかった)。
 *
 * ここで試すのは **空文字の扱い**に絞る。この repo が `??` ではなく
 * `optional` を使う理由そのもので、間違えると「`.env` に `NAME=` と
 * 書いた人が、名前の出ないエラーを遠くで踏む」という形で壊れる。
 * dist ではなくソース (`../scripts/env.js`) を import しているのは、
 * 試験が build に依存すると「ソースが悪いのか古い dist を見ているのか」
 * が分からなくなるため。
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { optional, repoRoot, required } from "../scripts/env.js";

const KEY = "CAPTURE_SCHEDULER_TEST_ONLY";

describe("optional", () => {
  beforeEach(() => {
    delete process.env[KEY];
  });
  afterEach(() => {
    delete process.env[KEY];
  });

  it("未設定なら既定値を返す", () => {
    expect(optional(KEY, "fallback")).toBe("fallback");
  });

  it("値があればそれを返す", () => {
    process.env[KEY] = "value";
    expect(optional(KEY, "fallback")).toBe("value");
  });

  it("空文字は「無い」と同じに扱う —— `??` との違いはここ", () => {
    process.env[KEY] = "";
    expect(optional(KEY, "fallback")).toBe("fallback");
  });
});

describe("required", () => {
  beforeEach(() => {
    delete process.env[KEY];
  });
  afterEach(() => {
    delete process.env[KEY];
  });

  it("未設定なら名前を含めて投げる", () => {
    expect(() => required(KEY)).toThrow(KEY);
  });

  it("空文字でも投げる（既定値を潰したまま先へ進ませない）", () => {
    process.env[KEY] = "";
    expect(() => required(KEY)).toThrow(KEY);
  });

  it("hint を渡すとメッセージに載る", () => {
    expect(() => required(KEY, "setup.sh を走らせること")).toThrow("setup.sh を走らせること");
  });

  it("値があればそれを返す", () => {
    process.env[KEY] = "value";
    expect(required(KEY)).toBe("value");
  });
});

describe("repoRoot", () => {
  it("cwd を返す —— dist 経由で動いても根を見失わないため", () => {
    expect(repoRoot()).toBe(process.cwd());
  });
});
