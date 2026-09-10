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

/**
 * 何をどう取り込むか。**waggle が決めて、dispatch の payload で渡す。**
 *
 * ここに既定値を置かないのは意図的 —— flow の schema の既定値は webhook 起動では
 * 埋まらないので、「渡し忘れ」を既定値が隠すと、`png` を頼んだ配備が黙って
 * `wacz` だけを取り続ける。渡されなければ落ちるのが正しい。
 */
export interface CaptureSettings {
  formats: {
    png: boolean;
    webp: boolean;
    html: boolean;
    links: boolean;
    mhtml: boolean;
    wacz: boolean;
  };
  signing: boolean;
  /**
   * 成果物の押し出し先。**在れば BrowserHive は自前の保管庫へ書かない。**
   *
   * waggle が crawl ごとに 1 回きりで発行するので、ここには「運んできたもの」しか
   * 入らない —— この層は中身を見ないし、作りもしない。
   */
  artifactSink?: { url: string; token: string };
}

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

/**
 * gRPC の status code。**数値は wire protocol の一部**なので変わらない
 * (`@grpc/grpc-js` の `status` と同じ値)。
 *
 * ここで名前を付けているのは、`@grpc/grpc-js` を module の先頭で import すると
 * この file の試験に gRPC が要るようになるから —— `captureHost` を偽の client で
 * 回せることがこの分割の取り柄で、それを潰したくない。
 */
const GRPC_NOT_FOUND = 5;
const GRPC_UNAVAILABLE = 14;

/** waggle が manifest から拾い直す合図。この綴りは `waggle/src/api/crawls.ts` と対。 */
export const NOT_FOUND_REASON = "capture-not-found";

/**
 * BrowserHive に届かない。**1 ページの失敗として扱ってはいけない。**
 *
 * 潰すと、server が落ちているクロールが「全ページ失敗のクロール」として
 * **成功で完了する**。取れなかったのはページのせいではないのに、台帳には
 * 「このページは取れない」と残り、しかもリンクが辿れないので木がそこで切れる。
 *
 * flow は `skip_failures: false` なので、ここで throw すれば段ごと失敗し、
 * waggle が `crawls` を `failed` で締める。
 */
export class ServerUnavailable extends Error {}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** gRPC の誤りから status code を取り出す。code を持たないものは `undefined`。 */
const grpcStatus = (err: unknown): number | undefined =>
  typeof err === "object" && err !== null && typeof (err as { code?: unknown }).code === "number"
    ? (err as { code: number }).code
    : undefined;

/**
 * proto を実行時に読み、client を 1 つ作る。
 *
 * 生成コードを持ち込まないのは、6308 行を Windmill の script に置きたくないから。
 * proto は 586 行で import も無い自己完結なので、`proto-loader` で足りる。
 * 中身は `scripts/push-proto.mjs` が resource に入れている。
 */
/**
 * gRPC の宛先は URL ではなく `host:port`。それでも scheme を書く設定 —— 癖で、
 * あるいは HTTP 転送の時代に書かれたものから —— に対しては、`http` という名前の
 * host へ繋ぎに行くのではなく scheme を落とす。waggle の `rpc/client.ts` と同じ規則。
 */
export const toTarget = (server: string): string =>
  server.replace(/^[a-z]+:\/\//, "").replace(/\/+$/, "");

const connect = async (target: string, caPem: string): Promise<Record<string, unknown>> => {
  const [protoLoader, grpc, fs, path, os] = await Promise.all([
    import("@grpc/proto-loader"),
    import("@grpc/grpc-js"),
    import("node:fs"),
    import("node:path"),
    import("node:os"),
  ]);
  // 変数ではなく resource。proto は 16KB あり、変数の上限を超える。
  const { proto: source } = (await wmill.getResource("u/admin/browserhive_proto")) as {
    proto: string;
  };

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
  // **CA が名指しされているときだけ TLS。** 「システムの root で TLS」は用意しない ——
  // BrowserHive の TLS は私設 CA を想定したもので、公開の証明書が要るということは
  // server が公開インターネット上に在るという意味になるが、そうではない。
  const creds =
    caPem === ""
      ? grpc.credentials.createInsecure()
      : grpc.credentials.createSsl(Buffer.from(caPem, "utf8"));
  return new pkg.browserhive.v1.CaptureService(toTarget(target), creds);
};

const call = <T>(client: Record<string, unknown>, method: string, request: unknown): Promise<T> =>
  new Promise((resolve, reject) => {
    (client[method] as (req: unknown, cb: (e: unknown, r: T) => void) => void)(
      request,
      (err, res) =>
        err ? reject(err instanceof Error ? err : new Error(String(err))) : resolve(res),
    );
  });

/**
 * `call` に「server が居ない」の見分けを足したもの。
 *
 * **`UNAVAILABLE` だけは種類が違う。** 他の誤りは「この取り込みは駄目だった」だが、
 * これは「相手が居ない」なので、次のページを試しても同じ答えしか返らない。
 */
const callOrFail = async <T>(
  client: Record<string, unknown>,
  method: string,
  request: unknown,
): Promise<T> => {
  try {
    return await call<T>(client, method, request);
  } catch (err) {
    if (grpcStatus(err) === GRPC_UNAVAILABLE) {
      throw new ServerUnavailable(
        `BrowserHive に届きません (${method}): ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    throw err;
  }
};

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
  capture: CaptureSettings,
  pollMs: number = POLL_INTERVAL_MS,
): Promise<PageResult> => {
  const submittedAt = new Date().toISOString();

  const submitted = await callOrFail<{ accepted: boolean; taskId: string }>(
    client,
    "submitCapture",
    {
      url,
      labels: [],
      correlationId: crawlId,
      // **6 つ全部を送る。** proto3 では未設定と false が別物で、落とすと
      // 「指定なし」として届く。何を立てるかを決めるのは waggle。
      captureFormats: capture.formats,
      signing: capture.signing,
      // 在れば BrowserHive はここへ押し出し、自前の保管庫へは書かない。
      ...(capture.artifactSink === undefined ? {} : { artifactSink: capture.artifactSink }),
    },
  );

  /**
   * 失敗として返す。**必ず `taskId` を載せる。**
   *
   * 投入は成功しているので id は在る。waggle はこれを鍵に `.result.json` を引いて
   * 拾い直せる —— id を落とすと、成果物が S3 に在っても永久に台帳へ入らない。
   */
  const failure = (skipReason: string): PageResult => ({
    url,
    status: "failed",
    taskId: submitted.taskId,
    correlationId: crawlId,
    submittedAt,
    finishedAt: new Date().toISOString(),
    skipReason,
  });

  const deadline = Date.now() + CAPTURE_TIMEOUT_MS;
  for (;;) {
    if (Date.now() > deadline) return failure("timed out waiting for the capture");
    await sleep(pollMs);

    let got: GetCaptureResponse;
    try {
      got = await callOrFail<GetCaptureResponse>(client, "getCapture", {
        taskId: submitted.taskId,
      });
    } catch (err) {
      if (err instanceof ServerUnavailable) throw err;
      // **`NOT_FOUND` は「無かった」ではない。** BrowserHive の結果キャッシュには
      // 上限があり、15 分待つ間に押し出されうる。取り込み自体は成功していて
      // 成果物も S3 に在るので、waggle が manifest から拾い直す。
      if (grpcStatus(err) === GRPC_NOT_FOUND) return failure(NOT_FOUND_REASON);
      return failure(err instanceof Error ? err.message : String(err));
    }
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

/**
 * 1 ホストぶんを順に取り込む。**礼儀の本体はここ。**
 *
 * `main` から切り出してあるのは、**client を受け取る形なら試験できる**から。
 * `call()` は `client[method](req, cb)` を呼ぶだけなので、偽物はただのオブジェクトで
 * 足りる —— gRPC も Windmill も要らない。`main` に残るのは「変数を読む →
 * つなぐ → ここへ委ねる」だけで、そちらは往復でしか確かめられない。
 *
 * `pollMs` を引数にしているのも試験のため。既定の 3 秒のままだと 1 件ごとに
 * 3 秒かかる。**fake timer は使わない** —— capture 系の sleep で一度溶かしている
 * (browserhive PR #253)。実タイマーの ms スケールで回す。
 */
export const captureHost = async (
  client: Record<string, unknown>,
  host: string,
  urls: string[],
  crawlId: string,
  capture: CaptureSettings,
  perHostDelayMs: number,
  initialDelayMs = 0,
  pollMs: number = POLL_INTERVAL_MS,
): Promise<PageResult[]> => {
  const results: PageResult[] = [];

  // #region pacing
  // **段をまたぐぶんの待ち。** 前の段でこのホストを触っていれば、その完了からの経過を
  // 差し引いた残りをここで待つ。これが無いと段の境目だけ間隔が空かない (実測 521ms)。
  if (initialDelayMs > 0) {
    console.log(`[${host}] 前の段からの間隔を空ける: ${String(initialDelayMs)}ms`);
    await sleep(initialDelayMs);
  }

  for (const [index, url] of urls.entries()) {
    // **間隔は完了の後。** 1 件目の前は上で済ませてある。
    if (index > 0 && perHostDelayMs > 0) await sleep(perHostDelayMs);

    // #endregion pacing

    console.log(`[${host}] ${String(index + 1)}/${String(urls.length)} ${url}`);
    try {
      results.push(await captureOne(client, url, crawlId, capture, pollMs));
    } catch (err) {
      // **server が居ないなら、次を試しても同じ答えしか返らない。** 段ごと落とす。
      if (err instanceof ServerUnavailable) throw err;
      // 1 件の失敗でこのホストを止めない。木の他の枝は進めてよい。
      //
      // ここに来るのは**投入そのものが落ちた**ときだけ (`captureOne` は投入より
      // 後の誤りを自分で `failure()` にして返す)。だから taskId はまだ無い。
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
};

export async function main(
  crawl_id: string,
  host: string,
  urls: string[],
  per_host_delay_ms: number,
  capture_formats: CaptureSettings["formats"],
  signing: boolean,
  initial_delay_ms = 0,
  /**
   * 成果物の押し出し先。waggle が crawl ごとに 1 回きりで発行する。
   *
   * **省ける。** 省けば BrowserHive は従来どおり自前の保管庫へ書くので、2 つの経路が
   * 同時に生きる。ここを必須にすると、受け口を建てていない配備が動かなくなる。
   *
   * flow は運ぶだけで中身を見ない —— 発行するのも、置き場所を決めるのも waggle。
   */
  artifact_sink?: { url: string; token: string },
): Promise<PageResult[]> {
  // **設定は変数から読む。引数では受けない。**
  // Windmill は schema の既定値を UI からの実行にしか埋めない —— webhook で起こすと
  // 引数は素通りで、`browserhive_target` が undefined のまま
  // 「Channel target must be a string」で落ちる (実測)。waggle は自分がコンテナから
  // どう見えるかを知らないので、送らせることもできない。
  const target = await wmill.getVariable("u/admin/browserhive_target");
  // **空文字は「TLS を使わない」。** 変数そのものが無いなら落ちるのが正しい ——
  // 黙って平文に落ちると、TLS のつもりの配備が気づかないまま平文で喋る。
  const caPem = await wmill.getVariable("u/admin/browserhive_tls_ca");
  const client = await connect(target, caPem);
  return captureHost(
    client,
    host,
    urls,
    crawl_id,
    {
      formats: capture_formats,
      signing,
      ...(artifact_sink === undefined ? {} : { artifactSink: artifact_sink }),
    },
    per_host_delay_ms,
    initial_delay_ms,
  );
}
