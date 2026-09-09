import { describe, it, expect, vi, afterEach } from "vitest";
import { main } from "../windmill/f/waggle/trigger_run.js";

/**
 * 日次の引き金。**import が 1 つも無く、接続先もトークンも引数で受ける** ——
 * 5 本の中で最も試験しやすい。
 *
 * ## ここで見ていないこと
 *
 * 完了を待つループは見ていない。`POLL_INTERVAL_MS` が 15 秒の定数で、
 * **最初の 1 回目の問い合わせの前にも必ず待つ**ため、1 本書くたびに 15 秒かかる。
 * `crawl_host` のように引数へ出すこともできるが、そこは本体を変えることになるので
 * 今回は見送った (`captureHost` の切り出しだけに留める判断)。
 *
 * 結果として、ここが押さえるのは **起こし方と、失敗したときの言い分**。
 * 待つ側は e2e が通る経路で確かめる。
 */

const responding = (status: number, body: unknown) => {
  const seen: { url: string; init: RequestInit }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string, init: RequestInit) => {
      seen.push({ url: String(url), init });
      return Promise.resolve({
        ok: status >= 200 && status < 300,
        status,
        json: () => Promise.resolve(body),
        text: () => Promise.resolve(typeof body === "string" ? body : JSON.stringify(body)),
      } as Response);
    }),
  );
  return seen;
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("起こし方", () => {
  it("limit を渡さなければ本文は空のまま", async () => {
    // `{ limit: undefined }` にすると JSON.stringify が鍵ごと落とすので同じに見えるが、
    // 明示的に空を送ることで「上限なし」を waggle 側の既定に委ねている。
    const seen = responding(409, {});
    await main("http://waggle:7070", "tok");

    expect(seen[0]!.url).toBe("http://waggle:7070/api/runs");
    expect(seen[0]!.init.body).toBe("{}");
  });

  it("limit を渡せば載せる", async () => {
    const seen = responding(409, {});
    await main("http://waggle:7070", "tok", 5);
    expect(JSON.parse(String(seen[0]!.init.body))).toEqual({ limit: 5 });
  });

  it("トークンを Bearer で送る", async () => {
    const seen = responding(409, {});
    await main("http://waggle:7070", "tok");
    const headers = seen[0]!.init.headers as Record<string, string>;
    expect(headers["authorization"]).toBe("Bearer tok");
  });
});

describe("既に走っているとき", () => {
  it("409 は見送りで、再試行しない", async () => {
    // waggle は走行中の 2 本目を部分 unique index で弾く。ここで再試行すると
    // 定期実行が終わらない —— 見送るのが正しい。
    const seen = responding(409, { error: "run already in progress" });
    await expect(main("http://waggle:7070", "tok")).resolves.toEqual({ outcome: "skipped" });

    // **問い合わせに進んでいないこと。** 進むと存在しない runId を追いかける。
    expect(seen).toHaveLength(1);
  });
});

describe("失敗したときの言い分", () => {
  it("401 には issuer 再起動の示唆を付ける", async () => {
    responding(401, { error: "unauthenticated" });
    await expect(main("http://waggle:7070", "tok")).rejects.toThrow(/issuer/);
  });

  it("404 には付与のしかたまで書く", async () => {
    // 「見てはいけない」と「存在しない」を waggle は区別せずに答えるので、
    // 404 だけでは辿れない。叩くべきコマンドまで書いてある。
    responding(404, { error: "not found" });
    await expect(main("http://waggle:7070", "tok")).rejects.toThrow(/fga:grant submitter/);
  });

  it("本文を必ず読む", async () => {
    // status だけだと waggle が返している理由が消える。
    responding(500, { error: "internal error" });
    await expect(main("http://waggle:7070", "tok")).rejects.toThrow(/internal error/);
  });

  it("202 でも 409 でもない成功系は失敗として扱う", async () => {
    // 200 は「起こした」を意味しない。202 だけが受理。
    responding(200, { runId: "r1" });
    await expect(main("http://waggle:7070", "tok")).rejects.toThrow(/200/);
  });
});
