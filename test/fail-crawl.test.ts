import { describe, it, expect, vi, afterEach } from "vitest";
import { describe as describeError } from "../windmill/f/waggle/fail_crawl.js";

/**
 * 落ちた段を capture-ledger に伝える経路。
 *
 * `main` は Windmill の変数を読むので単体では回せない。ここで押さえるのは
 * **誤りを 1 行に潰す部分**で、そこがこの script の判断らしい判断のすべて。
 */

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("誤りを 1 行に潰す", () => {
  it("どの段で落ちたかを頭に出す", () => {
    // **あとから読むときにいちばん効く手がかり。** 「届かなかった」だけだと、
    // 投入で落ちたのか報告で落ちたのかが分からない。
    expect(describeError({ message: "BrowserHive に届きません", step_id: "cap" })).toBe(
      "[cap] BrowserHive に届きません",
    );
  });

  it("step_id が無ければ本文だけ", () => {
    expect(describeError({ message: "何かが起きた" })).toBe("何かが起きた");
  });

  it("文字列はそのまま", () => {
    expect(describeError("素の文字列")).toBe("素の文字列");
  });

  it("形の分からないものも落とさずに残す", () => {
    // 潰して空文字にすると、capture-ledger 側の `error` 列が「理由なし」で埋まる。
    expect(describeError({ weird: 1 })).toContain("weird");
  });

  it("null も文字にする", () => {
    expect(describeError(null)).toBe("null");
  });
});
