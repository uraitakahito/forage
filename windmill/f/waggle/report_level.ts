/**
 * 1 段ぶんの結果を waggle に報告し、次の段があるかを受け取る。
 *
 * ## この 1 往復に判断が全部入っている
 *
 * こちらが送るのは「何が起きたか」だけ。範囲の絞り込みも、重複排除も、上限の判定も
 * waggle が行う —— 方針は `crawls` の行に在り、重複排除は `crawl_pages` の unique index が
 * 持っているので、判断材料が両方あちらに在る。ここに写すと、2 か所が食い違ったときに
 * どちらが正しいのか言えなくなる。
 *
 * ## 次の段はこちらから起こさない
 *
 * `next` は返ってくるが、**それを使って次を起こすのは waggle**。この flow は 1 段で
 * 終わる。Windmill の while ループに繰り返しを持たせようとしたが、`stop_after_if` を
 * 付けた最小の flow が 643 回まで回り続けた (実測) ので、暴走しうるループの上に
 * 「相手に負荷をかけない」仕組みを載せないことにした。
 *
 * 返り値は log と、この段が何をしたかの記録として残す。
 */

export interface PageResult {
  url: string;
  status: "captured" | "failed" | "skipped";
  skipReason?: string;
  taskId?: string;
  correlationId?: string;
  submittedAt?: string;
  finishedAt?: string;
  linksLocation?: string;
}

export interface NextPage {
  url: string;
  host: string;
  depth: number;
}

export interface LevelOutcome {
  next: NextPage[];
  stopReason: string | null;
}

export async function main(
  waggle_url: string,
  token: string,
  crawl_id: string,
  depth: number,
  results: PageResult[],
): Promise<LevelOutcome> {
  const res = await fetch(`${waggle_url}/api/crawls/${crawl_id}/pages`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ depth, results }),
  });

  if (!res.ok) {
    // 本文を必ず読む。status だけだと waggle が返している理由が消える。
    const body = await res.text();
    const hint =
      res.status === 401
        ? " —— トークンが古いかもしれません (issuer を再起動しましたか)"
        : res.status === 404
          ? " —— submitter の付与がありますか"
          : "";
    throw new Error(
      `POST /api/crawls/${crawl_id}/pages → ${String(res.status)} ${body.slice(0, 300)}${hint}`,
    );
  }

  const outcome = (await res.json()) as LevelOutcome;
  console.log(
    `深さ ${String(depth)}: ${String(results.length)} 件を報告、次は ${String(outcome.next.length)} 件` +
      (outcome.stopReason === null ? "" : ` (${outcome.stopReason} で打ち切り)`),
  );
  return outcome;
}
