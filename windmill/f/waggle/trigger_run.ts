/**
 * waggle に取り込みを 1 回起こし、終わるまで見届ける。
 *
 * Windmill が決めるのは「いつ」だけ。「何を・どう投げるか」は waggle の側にある
 * (取り込む形式は waggle の `WAGGLE_API_RUN_FORMATS`)。ここから渡せるのは `limit` だけで、
 * それも省ける —— 知らない鍵を送ると waggle は 400 を返す。
 *
 * ## 終わるまで待つ理由
 *
 * `POST /api/runs` は 202 を返して即座に戻る。そこで終わりにすると、**この job は
 * 取り込みが失敗しても緑のまま**になる。Windmill の実行履歴に赤を残せるのは
 * ここで throw したときだけなので、終端まで見てから決める。
 *
 * ## 409 は失敗ではない
 *
 * waggle は走行中の 2 本目を 409 で拒む (構造的に 1 本しか走れない)。これは
 * 「今回は見送る」であって異常ではないので、**緑で終わる**。再試行してもいけない ——
 * 走っている 1 本が終わるまで、何度投げても同じ答えが返るだけ。
 */

type Terminal = "succeeded" | "failed";

interface RunState {
  runId: string;
  status: "running" | Terminal;
  startedAt: string;
  finishedAt: string | null;
  submitted: number | null;
  accepted: number | null;
  rejected: number | null;
  error: string | null;
}

export interface Result {
  outcome: Terminal | "skipped";
  runId?: string;
  submitted?: number;
  accepted?: number;
  rejected?: number;
}

/** 取り込みは数十分に達しうる。既定は 2 時間で諦める。 */
const DEFAULT_TIMEOUT_MS = 2 * 60 * 60 * 1000;
const POLL_INTERVAL_MS = 15_000;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * 本文を必ず読んでから投げる。status だけにすると、waggle が返している理由
 * (`{"error":"..."}`) が消えて「404 でした」しか残らない。
 */
const failure = async (res: Response, what: string): Promise<Error> => {
  const body = await res.text();
  const hint =
    res.status === 401
      ? " —— トークンが古いかもしれません (issuer を再起動しましたか)"
      : res.status === 404
        ? " —— submitter の付与がありますか (waggle: pnpm run fga:grant submitter <sub> <org>)"
        : "";
  return new Error(`${what} → ${String(res.status)} ${body.slice(0, 300)}${hint}`);
};

export async function main(
  waggle_url: string,
  token: string,
  limit?: number,
  timeout_ms: number = DEFAULT_TIMEOUT_MS,
): Promise<Result> {
  const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };

  const started = await fetch(`${waggle_url}/api/runs`, {
    method: "POST",
    headers,
    body: JSON.stringify(limit === undefined ? {} : { limit }),
  });

  if (started.status === 409) {
    // 走行中。今回は見送る —— 再試行しない。
    console.log("既に走っているので見送ります (409)");
    return { outcome: "skipped" };
  }
  if (started.status !== 202) {
    throw await failure(started, "POST /api/runs");
  }

  const { runId } = (await started.json()) as { runId: string };
  console.log(`起こしました: ${runId}`);

  const deadline = Date.now() + timeout_ms;
  for (;;) {
    if (Date.now() > deadline) {
      // 走ったまま残る。ここで殺す術は無い (waggle に中断の口が無い)。
      throw new Error(
        `${runId} が ${String(Math.round(timeout_ms / 60000))} 分で終わりませんでした。` +
          " まだ走っているかもしれません —— GET /api/runs/:id で見てください",
      );
    }
    await sleep(POLL_INTERVAL_MS);

    const res = await fetch(`${waggle_url}/api/runs/${runId}`, { headers });
    if (!res.ok) throw await failure(res, `GET /api/runs/${runId}`);
    const run = (await res.json()) as RunState;
    if (run.status === "running") continue;

    const counts = {
      submitted: run.submitted ?? 0,
      accepted: run.accepted ?? 0,
      rejected: run.rejected ?? 0,
    };
    if (run.status === "failed") {
      throw new Error(`${runId} は失敗しました: ${run.error ?? "(理由なし)"}`);
    }
    // succeeded は「最後まで走った」であって「全部取れた」ではない。
    // 投げたものが全部拒まれていても succeeded で終わる —— 内訳は counts が語る。
    console.log(`完了: ${JSON.stringify(counts)}`);
    return { outcome: "succeeded", runId, ...counts };
  }
}
