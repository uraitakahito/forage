import { describe, it, expect } from "vitest";
import { captureHost } from "../windmill/f/waggle/crawl_host.js";

/**
 * 1 ホストぶんの取り込み。**礼儀と、終わったかどうかの判定。**
 *
 * `captureHost` は client を引数で受け、`call()` は `client[method](req, cb)` を
 * 呼ぶだけなので、偽物はただのオブジェクトで足りる —— gRPC も Windmill も要らない。
 *
 * **fake timer は使わない。** capture 系の sleep はここで race される形になりうるし、
 * browserhive で一度それに溶かしている (PR #253)。実タイマーの ms スケールで回す
 * (`pollMs` を 5 にできるのはそのため)。
 */

interface Call {
  method: string;
  at: number;
}

/**
 * 偽の browserhive。
 *
 * `states` は `getCapture` が順に返す状態。最後のものが以後ずっと返る ——
 * 「PENDING が 2 回来てから DONE」のような並びを作れる。
 */
const fakeClient = (options: {
  states?: string[];
  status?: string;
  links?: string;
  failOn?: string[];
  calls?: Call[];
}) => {
  const states = options.states ?? ["CAPTURE_STATE_DONE"];
  let n = 0;
  return {
    submitCapture: (req: { url: string }, cb: (e: unknown, r?: unknown) => void) => {
      options.calls?.push({ method: `submit:${req.url}`, at: Date.now() });
      if (options.failOn?.includes(req.url) === true) return cb(new Error("投げられなかった"));
      cb(null, { accepted: true, taskId: `task-${req.url}` });
    },
    getCapture: (_req: unknown, cb: (e: unknown, r?: unknown) => void) => {
      const state = states[Math.min(n, states.length - 1)];
      n += 1;
      cb(null, {
        state,
        report:
          state === "CAPTURE_STATE_DONE"
            ? {
                status: options.status ?? "CAPTURE_STATUS_SUCCESS",
                artifacts: { links: options.links ?? "s3://b/x.links.json" },
              }
            : undefined,
      });
    },
  } as unknown as Record<string, unknown>;
};

describe("間隔をどこに置くか", () => {
  it("間隔は完了の後に入る（投入の前ではない）", async () => {
    // **BrowserHive の TaskQueue に容量制限は無く、投入は決して拒まれない。**
    // だから 3 件まとめて投げれば、投入を間引いたつもりでもキューの中で連続して
    // 走る —— 投入時の間隔は相手のサーバに届かない。間隔が意味を持つのは
    // 「前のページが終わってから、次を投げるまで」に置いたときだけ。
    const calls: Call[] = [];
    const client = fakeClient({ calls });
    const started = Date.now();

    await captureHost(client, "m", ["a", "b", "c"], "c1", 60, 0, 5);

    // 3 件、投入の間隔が 60ms 以上空いていること。
    expect(calls).toHaveLength(3);
    expect(calls[1]!.at - calls[0]!.at).toBeGreaterThanOrEqual(55);
    expect(calls[2]!.at - calls[1]!.at).toBeGreaterThanOrEqual(55);
    // 1 件目の前には待たない。
    expect(calls[0]!.at - started).toBeLessThan(50);
  });

  it("initial_delay_ms は 1 件目の前に効く", async () => {
    // 段をまたぐぶん。これが無いと段の境目だけ間隔が空かない (実測 521ms)。
    const calls: Call[] = [];
    const started = Date.now();
    await captureHost(fakeClient({ calls }), "m", ["a"], "c1", 0, 80, 5);
    expect(calls[0]!.at - started).toBeGreaterThanOrEqual(75);
  });

  it("間隔が 0 なら待たない", async () => {
    const calls: Call[] = [];
    const started = Date.now();
    await captureHost(fakeClient({ calls }), "m", ["a", "b"], "c1", 0, 0, 5);
    expect(Date.now() - started).toBeLessThan(200);
  });
});

describe("終わったかどうかの判定", () => {
  it("DONE になるまで report を読まない", async () => {
    // **PENDING と PROCESSING はどちらも「まだ終わっていない」側で、GetCapture は
    // その両方を返す。** 確かめずに読むと report が無く、「SUCCESS でない」は
    // 「失敗した」と区別が付かないので、走行中の取り込みが失敗として台帳に載る。
    const client = fakeClient({
      states: ["CAPTURE_STATE_PENDING", "CAPTURE_STATE_PROCESSING", "CAPTURE_STATE_DONE"],
    });
    const [result] = await captureHost(client, "m", ["a"], "c1", 0, 0, 5);

    expect(result!.status).toBe("captured");
    expect(result!.taskId).toBe("task-a");
  });

  it("DONE かつ SUCCESS でなければ失敗として、理由に status を残す", async () => {
    const client = fakeClient({ status: "CAPTURE_STATUS_FAILED" });
    const [result] = await captureHost(client, "m", ["a"], "c1", 0, 0, 5);

    expect(result!.status).toBe("failed");
    expect(result!.skipReason).toBe("CAPTURE_STATUS_FAILED");
  });
});

describe("成果物の場所", () => {
  it("成功していれば linksLocation を運ぶ", async () => {
    const [result] = await captureHost(fakeClient({}), "m", ["a"], "c1", 0, 0, 5);
    expect(result!.linksLocation).toBe("s3://b/x.links.json");
  });

  it("空文字なら linksLocation を付けない", async () => {
    // 空文字を成果物の場所として渡すと、waggle 側が S3 の鍵として使ってしまう。
    const [result] = await captureHost(fakeClient({ links: "" }), "m", ["a"], "c1", 0, 0, 5);
    expect(result).not.toHaveProperty("linksLocation");
  });

  it("失敗していれば linksLocation を付けない", async () => {
    const client = fakeClient({ status: "CAPTURE_STATUS_FAILED" });
    const [result] = await captureHost(client, "m", ["a"], "c1", 0, 0, 5);
    expect(result).not.toHaveProperty("linksLocation");
  });
});

describe("1 件の失敗", () => {
  it("残りを止めない", async () => {
    // 木の 1 枝が折れても、他の枝は進めてよい。ここで投げると段が丸ごと落ちる。
    const client = fakeClient({ failOn: ["b"] });
    const results = await captureHost(client, "m", ["a", "b", "c"], "c1", 0, 0, 5);

    expect(results).toHaveLength(3);
    expect(results.map((r) => r.status)).toEqual(["captured", "failed", "captured"]);
    expect(results[1]!.skipReason).toBe("投げられなかった");
  });
});
