/**
 * 1 つのホストぶんの URL を取り込む。**礼儀はここで守る。**
 *
 * ## なぜ逐次なのか
 *
 * このスクリプトが 1 度に触るホストは 1 つで、その中の URL は **1 件ずつ順に**処理する。
 * flow 側の for-loop がホストを並列にするので、全体としては
 * 「ホストは同時に何本か、1 ホストの中は 1 本ずつ」になる。
 *
 * Windmill の per-key concurrency limit を使わないのは、**Community Edition で効かない**
 * から。実装は `jobs_ee.rs` にあり、OSS ビルドは常に許可を返すスタブになっている
 * (`update_concurrency_counter` が `Ok((true, None))`)。設定は保存も読み取りもされるので、
 * UI では効いて見えて、ゲートだけが素通しになる。**無言で失敗する機能には乗せない。**
 *
 * ## なぜ間隔を「完了の後」に置くのか
 *
 * BrowserHive の `TaskQueue` に容量制限は無く、投入は決して拒まれない。同時に走る数を
 * 決めているのは worker の数だけ。だから 3 件まとめて投げれば、投入を間引いたつもりでも
 * キューの中で連続して実行される —— **投入時の間隔は相手のサーバに届かない。**
 *
 * 間隔は「前のページが終わってから、次を投げるまで」に置く。そうして初めて、相手から見た
 * アクセスの間隔になる。
 *
 * ## 1 ページは 1 リクエストではない
 *
 * ブラウザはサブリソースまで取るので、1 回の取り込みは相手から見れば数十本のバースト。
 * 既定の 2 秒はそれを踏まえた値で、robots.txt に `Crawl-delay` があればそちらが勝つ。
 */
import * as wmill from "windmill-client";

type CaptureState =
  | "CAPTURE_STATE_UNSPECIFIED"
  | "CAPTURE_STATE_PENDING"
  | "CAPTURE_STATE_PROCESSING"
  | "CAPTURE_STATE_DONE";

type CaptureStatus =
  | "CAPTURE_STATUS_UNSPECIFIED"
  | "CAPTURE_STATUS_SUCCESS"
  | "CAPTURE_STATUS_FAILED"
  | "CAPTURE_STATUS_TIMEOUT"
  | "CAPTURE_STATUS_HTTP_ERROR";

export interface PageResult {
  url: string;
  status: "captured" | "failed" | "skipped";
  skipReason?: string;
  taskId?: string;
  correlationId?: string;
  /** 礼儀の証拠。waggle がこの 2 つを保存し、後から間隔と重なりを測れるようにする。 */
  submittedAt?: string;
  finishedAt?: string;
  /**
   * `.links.json` の置き場所。**中身は読まない。**
   *
   * 読むのは waggle の仕事にしてある —— あちらは既に S3 の client を持っていて、
   * 範囲の絞り込みと重複排除もあちらに在る。ここで読むと、S3 の資格情報と到達性を
   * Windmill にも用意することになり (別ドメインのコンテナからは seaweedfs に届かない)、
   * 「見つけた URL は何か」の判断材料が 2 か所に散る。
   */
  linksLocation?: string;
}

/** 取り込み 1 件を諦めるまで。BrowserHive 側の予算より余裕を持たせる。 */
const CAPTURE_TIMEOUT_MS = 15 * 60 * 1000;
const POLL_INTERVAL_MS = 3000;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * proto を実行時に読み、client を 1 つ作る。
 *
 * 生成コードを持ち込まないのは、6308 行を Windmill の script に置きたくないから。
 * proto は 586 行で import も無い自己完結なので、`proto-loader` で足りる。
 * 中身は `scripts/push-proto.mjs` が変数に入れている。
 */
const connect = async (target: string): Promise<Record<string, unknown>> => {
  const [protoLoader, grpc, fs, path, os] = await Promise.all([
    import("@grpc/proto-loader"),
    import("@grpc/grpc-js"),
    import("node:fs"),
    import("node:path"),
    import("node:os"),
  ]);
  const source = await wmill.getVariable("u/admin/browserhive_proto");

  // `loadSync` はファイルしか受けないので、一度だけ書き出す。
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "bh-")), "capture.proto");
  fs.writeFileSync(file, source);

  const definition = protoLoader.loadSync(file, {
    keepCase: false,
    longs: String,
    // enum を名前で受け取る。数値だと `0` が UNSPECIFIED なのか未設定なのか読めない。
    enums: String,
    defaults: true,
    oneofs: true,
  });
  const pkg = grpc.loadPackageDefinition(definition) as unknown as {
    browserhive: { v1: { CaptureService: new (t: string, c: unknown) => Record<string, unknown> } };
  };
  return new pkg.browserhive.v1.CaptureService(target, grpc.credentials.createInsecure());
};

const call = <T>(client: Record<string, unknown>, method: string, request: unknown): Promise<T> =>
  new Promise((resolve, reject) => {
    (client[method] as (req: unknown, cb: (e: unknown, r: T) => void) => void)(
      request,
      (err, res) => (err ? reject(err instanceof Error ? err : new Error(String(err))) : resolve(res)),
    );
  });

interface GetCaptureResponse {
  state: CaptureState;
  report?: { status: CaptureStatus; artifacts?: { links?: string } };
}

/**
 * 1 件取り込み、終わるまで見届ける。
 *
 * **`state === "CAPTURE_STATE_DONE"` を確かめてから report を読む。** PENDING と
 * PROCESSING はどちらも「まだ終わっていない」側で、`GetCapture` はその両方を返す。
 * 確かめずに読むと `CAPTURE_STATUS_UNSPECIFIED` を掴み、「SUCCESS でない」は
 * 「失敗した」と区別が付かないので、**走行中の取り込みが失敗として台帳に載る。**
 */
const captureOne = async (
  client: Record<string, unknown>,
  url: string,
  crawlId: string,
): Promise<PageResult> => {
  const submittedAt = new Date().toISOString();

  const submitted = await call<{ accepted: boolean; taskId: string }>(client, "submitCapture", {
    url,
    labels: [],
    correlationId: crawlId,
    // links が本体 —— これが無いと辿れない。wacz は成果物として残すため。
    captureFormats: { png: false, webp: false, html: false, links: true, mhtml: false, wacz: true },
  });

  const deadline = Date.now() + CAPTURE_TIMEOUT_MS;
  for (;;) {
    if (Date.now() > deadline) {
      return {
        url,
        status: "failed",
        taskId: submitted.taskId,
        submittedAt,
        finishedAt: new Date().toISOString(),
        skipReason: "timed out waiting for the capture",
      };
    }
    await sleep(POLL_INTERVAL_MS);

    const got = await call<GetCaptureResponse>(client, "getCapture", { taskId: submitted.taskId });
    if (got.state !== "CAPTURE_STATE_DONE") continue;

    const finishedAt = new Date().toISOString();
    const ok = got.report?.status === "CAPTURE_STATUS_SUCCESS";
    const links = got.report?.artifacts?.links;
    return {
      url,
      status: ok ? "captured" : "failed",
      taskId: submitted.taskId,
      correlationId: crawlId,
      submittedAt,
      finishedAt,
      ...(ok ? {} : { skipReason: got.report?.status ?? "no report" }),
      ...(ok && links !== undefined && links !== "" ? { linksLocation: links } : {}),
    };
  }
};

export async function main(
  browserhive_target: string,
  crawl_id: string,
  host: string,
  urls: string[],
  per_host_delay_ms: number,
): Promise<PageResult[]> {
  const client = await connect(browserhive_target);
  const results: PageResult[] = [];

  for (const [index, url] of urls.entries()) {
    // **間隔は完了の後。** 1 件目の前には置かない —— 前のページが無いので、空ける相手が居ない。
    if (index > 0 && per_host_delay_ms > 0) await sleep(per_host_delay_ms);

    console.log(`[${host}] ${String(index + 1)}/${String(urls.length)} ${url}`);
    try {
      results.push(await captureOne(client, url, crawl_id));
    } catch (err) {
      // 1 件の失敗でこのホストを止めない。木の他の枝は進めてよい。
      results.push({
        url,
        status: "failed",
        submittedAt: new Date().toISOString(),
        finishedAt: new Date().toISOString(),
        skipReason: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return results;
}
