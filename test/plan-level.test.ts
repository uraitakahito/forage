import { describe, it, expect, vi, afterEach } from "vitest";
import { main, type Candidate } from "../windmill/f/waggle/plan_level.js";

/**
 * 段の計画。**この repo の Windmill script で唯一、判断が集まっている場所。**
 *
 * IO は robots.txt を取る `fetch` 1 つだけなので、それを差し替えれば全部見える。
 * Windmill も capture-ledger も browserhive も要らない。
 *
 * ここに試験が無かった間に、`respect_robots` が `null` で届いて robots が一度も
 * 読まれない状態が出荷された。**クロールは成功し、アーカイブも正常に見えた** ——
 * capture-fixtures のフィクスチャで実際に取りに行った先を見るまで気づけなかった。
 */

/** robots.txt を返す fetch。呼ばれた URL を記録する。 */
const robotsServing = (body: string | undefined) => {
  const calls: string[] = [];
  const fake = vi.fn((input: string | URL) => {
    calls.push(String(input));
    if (body === undefined) return Promise.resolve({ ok: false, status: 404 } as Response);
    return Promise.resolve({ ok: true, text: () => Promise.resolve(body) } as Response);
  });
  vi.stubGlobal("fetch", fake);
  return calls;
};

const at = (url: string, lastFinishedAt?: string | null): Candidate => ({
  url,
  host: new URL(url).host,
  ...(lastFinishedAt === undefined ? {} : { lastFinishedAt }),
});

const HIDDEN = "User-agent: *\nDisallow: /links/hidden\n";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("robots を読むかどうか", () => {
  it("respect_robots が null でも読む", async () => {
    // **これが本丸。** flow の input_transform は、渡されていない引数を JavaScript の
    // `undefined` として評価するが、Windmill はそれを JSON の `null` にして渡す。
    // TypeScript の既定引数が効くのは `undefined` のときだけなので、`null` は素通りし、
    // falsy なので robots が一度も読まれない。
    //
    // schema に `default: true` があっても救われない —— 既定値は UI からの実行にしか
    // 埋まらず、capture-ledger は webhook で起こす (実測で確認済み)。守っているのは
    // `?? true` の 1 か所だけ。
    const calls = robotsServing(HIDDEN);
    const plan = await main([at("http://m:8080/links/hidden")], 1000, null);

    expect(calls).toEqual(["http://m:8080/robots.txt"]);
    expect(plan.groups).toHaveLength(0);
    expect(plan.skipped).toEqual([{ url: "http://m:8080/links/hidden", reason: "robots" }]);
  });

  it("respect_robots を渡さなくても読む", async () => {
    const calls = robotsServing(HIDDEN);
    const plan = await main([at("http://m:8080/links/hidden")], 1000);
    expect(calls).toHaveLength(1);
    expect(plan.skipped).toHaveLength(1);
  });

  it("false なら一度も取りに行かない", async () => {
    // 「尊重しない」と「取得に失敗した」を同じ挙動にしない。取りに行かないことを
    // 押さえるので、`fetchRobots` が握り潰す形に変わっても赤くなる。
    const calls = robotsServing(HIDDEN);
    const plan = await main([at("http://m:8080/links/hidden")], 1000, false);

    expect(calls).toEqual([]);
    expect(plan.groups[0]!.urls).toEqual(["http://m:8080/links/hidden"]);
    expect(plan.skipped).toEqual([]);
  });

  it("robots が無ければ制限なしとして扱う", async () => {
    // 404 も接続失敗も同じ。robots.txt が無いことは「取ってはいけない」ではない。
    robotsServing(undefined);
    const plan = await main([at("http://m:8080/links/hidden")], 1000, true);
    expect(plan.groups[0]!.urls).toHaveLength(1);
  });

  it("取得が投げても止まらない", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.reject(new Error("ECONNREFUSED"))),
    );
    const plan = await main([at("http://m:8080/a")], 1000, true);
    expect(plan.groups[0]!.urls).toEqual(["http://m:8080/a"]);
  });
});

describe("Crawl-delay の扱い", () => {
  it("robots のほうが長ければ robots を採る", async () => {
    robotsServing("User-agent: *\nCrawl-delay: 3\n");
    const plan = await main([at("http://m:8080/a")], 500, true);
    expect(plan.groups[0]!.delayMs).toBe(3000);
  });

  it("設定のほうが長ければ設定を採る", async () => {
    // **上と対になっていることに意味がある。** ただし理由は `Math.min` ではない ——
    // それは上の 1 本でも赤くなる (反証で確認)。この 1 本だけが捕まえるのは
    // **「robots があれば常に robots を採る」** という実装。上の 1 本は素通りする。
    // 「長いほうを採る」を言い切るには、設定のほうが長い場合が要る。
    robotsServing("User-agent: *\nCrawl-delay: 1\n");
    const plan = await main([at("http://m:8080/a")], 5000, true);
    expect(plan.groups[0]!.delayMs).toBe(5000);
  });

  it("Crawl-delay が無ければ設定のまま", async () => {
    robotsServing("User-agent: *\n");
    const plan = await main([at("http://m:8080/a")], 2000, true);
    expect(plan.groups[0]!.delayMs).toBe(2000);
  });
});

describe("段をまたぐ待ち", () => {
  it("直前に触っていれば残りぶんだけ待つ", async () => {
    // 3000ms の間隔で、1000ms 前に終わっている → 残り 2000ms。
    robotsServing("User-agent: *\n");
    const oneSecondAgo = new Date(Date.now() - 1000).toISOString();
    const plan = await main([at("http://m:8080/a", oneSecondAgo)], 3000, true);

    // 実時間が僅かに進むので幅で見る。押さえたいのは「差し引いている」こと。
    expect(plan.groups[0]!.initialDelayMs).toBeGreaterThan(1800);
    expect(plan.groups[0]!.initialDelayMs).toBeLessThanOrEqual(2000);
  });

  it("間隔より前に終わっていれば待たない", async () => {
    // 負の値を返さないこと。`Math.max(0, …)` が無いと負の待ちが段に載る。
    robotsServing("User-agent: *\n");
    const longAgo = new Date(Date.now() - 60_000).toISOString();
    const plan = await main([at("http://m:8080/a", longAgo)], 3000, true);
    expect(plan.groups[0]!.initialDelayMs).toBe(0);
  });

  it("最初の段は待たない", async () => {
    // `lastFinishedAt` が null。触ったことがないので差し引くものが無い。
    robotsServing("User-agent: *\n");
    const plan = await main([at("http://m:8080/a", null)], 3000, true);
    expect(plan.groups[0]!.initialDelayMs).toBe(0);
  });
});

describe("ホストで束ねる", () => {
  it("ホストごとに 1 group にまとめる", async () => {
    // 束ねる単位が並列度の単位になる。崩れると 1 ホストに同時に当たる。
    robotsServing("User-agent: *\n");
    const plan = await main(
      [at("http://a:8080/1"), at("http://b:8080/1"), at("http://a:8080/2")],
      1000,
      true,
    );

    expect(plan.groups).toHaveLength(2);
    expect(plan.groups.find((g) => g.host === "a:8080")!.urls).toEqual([
      "http://a:8080/1",
      "http://a:8080/2",
    ]);
  });

  it("robots を引くのはホストにつき 1 回", async () => {
    const calls = robotsServing("User-agent: *\n");
    await main([at("http://a:8080/1"), at("http://a:8080/2"), at("http://a:8080/3")], 1000, true);
    expect(calls).toEqual(["http://a:8080/robots.txt"]);
  });

  it("全部 disallow されたホストは group ごと消える", async () => {
    // 空の group を段に残さない。残すと flow の for-loop が空回りし、
    // 「触ったが 0 件だった」と「触らなかった」の区別が付かなくなる。
    robotsServing("User-agent: *\nDisallow: /\n");
    const plan = await main([at("http://a:8080/1"), at("http://a:8080/2")], 1000, true);

    expect(plan.groups).toEqual([]);
    expect(plan.skipped).toHaveLength(2);
    expect(plan.skipped.every((s) => s.reason === "robots")).toBe(true);
  });

  it("同じホストで許可と禁止が混ざれば許可だけ残る", async () => {
    robotsServing(HIDDEN);
    const plan = await main(
      [at("http://m:8080/links/hidden"), at("http://m:8080/links/leaf/1")],
      1000,
      true,
    );

    expect(plan.groups[0]!.urls).toEqual(["http://m:8080/links/leaf/1"]);
    expect(plan.skipped).toEqual([{ url: "http://m:8080/links/hidden", reason: "robots" }]);
  });
});
