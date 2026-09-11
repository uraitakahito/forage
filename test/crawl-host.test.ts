import { describe, it, expect } from "vitest";
import {
  captureHost,
  NOT_FOUND_REASON,
  ServerUnavailable,
  toTarget,
} from "../windmill/f/waggle/crawl_host.js";

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
 * 試験で使う取り込みの設定。
 *
 * **既定値を持たせない形にしてある**ので、呼ぶ側が必ず渡す。渡し忘れを既定値が
 * 隠すと、`png` を頼んだ配備が黙って `wacz` だけを取り続けることになる。
 */
const CAPTURE = {
  formats: { png: false, webp: false, html: false, links: true, mhtml: false, wacz: true },
  signing: false,
};

/** gRPC の誤りの形。実物は `code` を持った Error なので、それに寄せる。 */
const grpcError = (code: number, message: string): Error =>
  Object.assign(new Error(message), { code });

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
  /** `getCapture` がこの誤りを返す。 */
  getCaptureError?: Error;
  /** `submitCapture` がこの誤りを返す。 */
  submitError?: Error;
}) => {
  const states = options.states ?? ["CAPTURE_STATE_DONE"];
  let n = 0;
  return {
    submitCapture: (req: { url: string }, cb: (e: unknown, r?: unknown) => void) => {
      options.calls?.push({ method: `submit:${req.url}`, at: Date.now() });
      if (options.submitError !== undefined) return cb(options.submitError);
      if (options.failOn?.includes(req.url) === true) return cb(new Error("投げられなかった"));
      cb(null, { accepted: true, taskId: `task-${req.url}` });
    },
    getCapture: (_req: unknown, cb: (e: unknown, r?: unknown) => void) => {
      if (options.getCaptureError !== undefined) return cb(options.getCaptureError);
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

    await captureHost(client, "m", ["a", "b", "c"], "c1", CAPTURE, 60, 0, 5);

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
    await captureHost(fakeClient({ calls }), "m", ["a"], "c1", CAPTURE, 0, 80, 5);
    expect(calls[0]!.at - started).toBeGreaterThanOrEqual(75);
  });

  it("間隔が 0 なら待たない", async () => {
    const calls: Call[] = [];
    const started = Date.now();
    await captureHost(fakeClient({ calls }), "m", ["a", "b"], "c1", CAPTURE, 0, 0, 5);
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
    const [result] = await captureHost(client, "m", ["a"], "c1", CAPTURE, 0, 0, 5);

    expect(result!.status).toBe("captured");
    expect(result!.taskId).toBe("task-a");
  });

  it("DONE かつ SUCCESS でなければ失敗として、理由に status を残す", async () => {
    const client = fakeClient({ status: "CAPTURE_STATUS_FAILED" });
    const [result] = await captureHost(client, "m", ["a"], "c1", CAPTURE, 0, 0, 5);

    expect(result!.status).toBe("failed");
    expect(result!.skipReason).toBe("CAPTURE_STATUS_FAILED");
  });
});

describe("成果物の場所", () => {
  it("成功していれば linksLocation を運ぶ", async () => {
    const [result] = await captureHost(fakeClient({}), "m", ["a"], "c1", CAPTURE, 0, 0, 5);
    expect(result!.linksLocation).toBe("s3://b/x.links.json");
  });

  it("空文字なら linksLocation を付けない", async () => {
    // 空文字を成果物の場所として渡すと、capture-ledger 側が S3 の鍵として使ってしまう。
    const [result] = await captureHost(
      fakeClient({ links: "" }),
      "m",
      ["a"],
      "c1",
      CAPTURE,
      0,
      0,
      5,
    );
    expect(result).not.toHaveProperty("linksLocation");
  });

  it("失敗していれば linksLocation を付けない", async () => {
    const client = fakeClient({ status: "CAPTURE_STATUS_FAILED" });
    const [result] = await captureHost(client, "m", ["a"], "c1", CAPTURE, 0, 0, 5);
    expect(result).not.toHaveProperty("linksLocation");
  });
});

describe("1 件の失敗", () => {
  it("残りを止めない", async () => {
    // 木の 1 枝が折れても、他の枝は進めてよい。ここで投げると段が丸ごと落ちる。
    const client = fakeClient({ failOn: ["b"] });
    const results = await captureHost(client, "m", ["a", "b", "c"], "c1", CAPTURE, 0, 0, 5);

    expect(results).toHaveLength(3);
    expect(results.map((r) => r.status)).toEqual(["captured", "failed", "captured"]);
    expect(results[1]!.skipReason).toBe("投げられなかった");
  });
});

describe("gRPC の誤りの見分け", () => {
  /**
   * **ここが「server が落ちているクロールが成功で完了する」を止めている。**
   *
   * 潰すと、届かなかったことが「このページは取れない」として台帳に残り、しかも
   * リンクが辿れないので木がそこで切れる。取れなかったのはページのせいではない。
   */
  it("UNAVAILABLE は 1 ページの失敗にせず、段ごと落とす", async () => {
    const client = fakeClient({ getCaptureError: grpcError(14, "no connection established") });
    await expect(
      captureHost(client, "example.com", ["https://example.com/a"], "c1", CAPTURE, 0, 0, 5),
    ).rejects.toThrow(ServerUnavailable);
  });

  it("投入が UNAVAILABLE でも段ごと落ちる", async () => {
    // 投入は `captureOne` の外で throw するので、`captureHost` の catch が
    // 拾う経路。ここも潰さないと、server 不在が「投げられなかった 1 ページ」になる。
    const client = fakeClient({ submitError: grpcError(14, "no connection established") });
    await expect(
      captureHost(client, "example.com", ["https://example.com/a"], "c1", CAPTURE, 0, 0, 5),
    ).rejects.toThrow(ServerUnavailable);
  });

  /**
   * **NOT_FOUND は「無かった」ではない。**
   *
   * BrowserHive の結果キャッシュには上限があり、15 分待つ間に押し出されうる。
   * 取り込み自体は成功していて成果物も S3 に在るので、capture-ledger が manifest から
   * 拾い直せるように **taskId を必ず載せる**。ここを落とすと、S3 に在る成果物が
   * 永久に台帳へ入らない。
   */
  it("NOT_FOUND は taskId 付きで返す（capture-ledger が拾い直せる形）", async () => {
    const client = fakeClient({ getCaptureError: grpcError(5, "unknown task") });
    const [page] = await captureHost(
      client,
      "example.com",
      ["https://example.com/a"],
      "c1",
      CAPTURE,
      0,
      0,
      5,
    );
    expect(page.status).toBe("failed");
    expect(page.skipReason).toBe(NOT_FOUND_REASON);
    expect(page.taskId).toBe("task-https://example.com/a");
    expect(page.correlationId).toBe("c1");
  });

  it("知らない gRPC の誤りも taskId 付きで返す", async () => {
    // 拾い直しの対象は「taskId を持つ全件」なので、種類を問わず id を載せる。
    // 逆に id を載せない経路が 1 つでもあると、そこだけ静かに取りこぼす。
    const client = fakeClient({ getCaptureError: grpcError(13, "internal") });
    const [page] = await captureHost(
      client,
      "example.com",
      ["https://example.com/a"],
      "c1",
      CAPTURE,
      0,
      0,
      5,
    );
    expect(page.status).toBe("failed");
    expect(page.taskId).toBe("task-https://example.com/a");
    expect(page.skipReason).toContain("internal");
  });

  it("投入そのものが落ちたときは taskId が無い", async () => {
    // **これは取りこぼしではない。** 投入が通っていないので id は存在しない。
    // capture-ledger 側も「taskId を持つもの」だけを拾い直すので、対象にならないのが正しい。
    const client = fakeClient({ failOn: ["https://example.com/a"] });
    const [page] = await captureHost(
      client,
      "example.com",
      ["https://example.com/a"],
      "c1",
      CAPTURE,
      0,
      0,
      5,
    );
    expect(page.status).toBe("failed");
    expect(page.taskId).toBeUndefined();
  });
});

describe("宛先の正規化", () => {
  it("scheme を落とす", () => {
    // gRPC の宛先は URL ではなく `host:port`。scheme を残したまま渡すと
    // `http` という名前の host を DNS に引きに行く。
    expect(toTarget("http://browserhive.capture-ledger:50051")).toBe(
      "browserhive.capture-ledger:50051",
    );
    expect(toTarget("https://bh:50051")).toBe("bh:50051");
  });

  it("末尾のスラッシュを落とす", () => {
    expect(toTarget("browserhive.capture-ledger:50051/")).toBe("browserhive.capture-ledger:50051");
  });

  it("すでに host:port ならそのまま", () => {
    expect(toTarget("localhost:50051")).toBe("localhost:50051");
  });
});

describe("取り込む形式", () => {
  it("渡された 6 つをそのまま送る", async () => {
    // **6 つ全部を送る。** proto3 では未設定と false が別物で、落とすと
    // 「指定なし」として届く。何を立てるかを決めるのは capture-ledger 側。
    let sent: unknown;
    const client = {
      submitCapture: (req: unknown, cb: (e: unknown, r?: unknown) => void) => {
        sent = req;
        cb(null, { accepted: true, taskId: "t1" });
      },
      getCapture: (_req: unknown, cb: (e: unknown, r?: unknown) => void) =>
        cb(null, {
          state: "CAPTURE_STATE_DONE",
          report: { status: "CAPTURE_STATUS_SUCCESS", artifacts: {} },
        }),
    } as unknown as Record<string, unknown>;

    const capture = {
      formats: { png: true, webp: false, html: true, links: false, mhtml: false, wacz: true },
      signing: true,
    };
    await captureHost(client, "m", ["a"], "c1", capture, 0, 0, 5);

    expect((sent as { captureFormats: unknown }).captureFormats).toEqual(capture.formats);
    expect((sent as { signing: unknown }).signing).toBe(true);
  });
});

describe("成果物の送り先", () => {
  /** 要求を握って返す最小の client。 */
  const capturingClient = (seen: { req?: unknown }) =>
    ({
      submitCapture: (req: unknown, cb: (e: unknown, r?: unknown) => void) => {
        seen.req = req;
        cb(null, { accepted: true, taskId: "t1" });
      },
      getCapture: (_req: unknown, cb: (e: unknown, r?: unknown) => void) =>
        cb(null, {
          state: "CAPTURE_STATE_DONE",
          report: { status: "CAPTURE_STATUS_SUCCESS", artifacts: {} },
        }),
    }) as unknown as Record<string, unknown>;

  const formats = {
    png: false,
    webp: false,
    html: false,
    links: false,
    mhtml: false,
    wacz: true,
  };

  it("渡されたらそのまま送る", async () => {
    const seen: { req?: unknown } = {};
    const sink = { url: "http://capture-ledger:7070/api/sink/c1", token: "tok" };

    await captureHost(
      capturingClient(seen),
      "m",
      ["a"],
      "c1",
      { formats, signing: false, artifactSink: sink },
      0,
      0,
      5,
    );

    expect((seen.req as { artifactSink?: unknown }).artifactSink).toEqual(sink);
  });

  it("渡されなければ載せない —— 従来どおり自前の保管庫へ書かせる", async () => {
    // **ここが空でないと、受け口を建てていない配備で取り込みが全部失敗する。**
    const seen: { req?: unknown } = {};

    await captureHost(
      capturingClient(seen),
      "m",
      ["a"],
      "c1",
      { formats, signing: false },
      0,
      0,
      5,
    );

    expect((seen.req as { artifactSink?: unknown }).artifactSink).toBeUndefined();
  });
});
