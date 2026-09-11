import { describe, it, expect, vi, afterEach } from "vitest";
import { main } from "../windmill/f/waggle/index_level.js";

/**
 * 索引の step。**判断はゼロで、渡すのは crawl_id だけ** —— 押さえるのはその形。
 *
 * どの archive がまだ索引されていないかは capture-ledger が知っている
 * (`archives.indexed_at IS NULL`)。id の一覧をここで組み立てる形に変わったら、
 * 「何を索引すべきか」の判断が試験の無い場所へ移ったということ。
 */

const VARS: Record<string, string> = {
  "u/admin/waggle_api_url": "http://capture-ledger:7070",
  "u/admin/waggle_token": "tok",
};

vi.mock("windmill-client", () => ({
  getVariable: (path: string) => Promise.resolve(VARS[path]),
}));

/** 応答を決める fetch。渡された Request の中身を記録する。 */
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
        text: () => Promise.resolve(JSON.stringify(body)),
      } as Response);
    }),
  );
  return seen;
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("capture-ledger への頼み方", () => {
  it("crawl_id だけを URL に載せ、本文は送らない", async () => {
    const seen = responding(202, { indexed: 3, pages: 3 });
    await main("c-1");

    expect(seen[0]!.url).toBe("http://capture-ledger:7070/api/crawls/c-1/index");
    expect(seen[0]!.init.method).toBe("POST");
    expect(seen[0]!.init.body).toBeUndefined();
  });

  it("content-type を送らない", async () => {
    // **本文の無い POST に `application/json` を名乗ると、Fastify が
    // `FST_ERR_CTP_EMPTY_JSON_BODY` で 400 を返す。** 実際に踏んで、flow の
    // index step が赤くなった。「JSON だと言ったのに空」という言い分は正しい。
    const seen = responding(202, { indexed: 0, pages: 0 });
    await main("c-1");

    const headers = seen[0]!.init.headers as Record<string, string>;
    expect(headers).not.toHaveProperty("content-type");
    expect(headers["authorization"]).toBe("Bearer tok");
  });

  it("件数をそのまま返す", async () => {
    responding(202, { indexed: 3, pages: 7 });
    await expect(main("c-1")).resolves.toEqual({ indexed: 3, pages: 7, skipped: false });
  });
});

describe("索引が無い配備", () => {
  it("404 は飛ばす（投げない）", async () => {
    // `CAPTURE_LEDGER_OPENSEARCH_URL` を設定していない capture-ledger は口ごと出さない。
    // それは正しい答えなので、一律に投げるとクロールが毎回赤くなる。
    responding(404, { error: "not found" });
    await expect(main("c-1")).resolves.toEqual({ indexed: 0, pages: 0, skipped: true });
  });

  it("500 は投げる", async () => {
    // 索引の失敗を黙らせない。飛ばしてよいのは 404 だけ。
    responding(500, { error: "internal error" });
    await expect(main("c-1")).rejects.toThrow(/500/);
  });

  it("401 も投げる", async () => {
    responding(401, { error: "unauthenticated" });
    await expect(main("c-1")).rejects.toThrow(/401/);
  });
});
