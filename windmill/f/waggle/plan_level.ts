/**
 * 1 段ぶんの URL をホストで束ね、robots.txt を見て取ってよいものだけを残す。
 *
 * ## なぜホストで束ねるのか
 *
 * これが礼儀の仕組みそのもの。束ねた単位を flow の for-loop が **並列に**回し、
 * 1 つの束の中は `crawl_host` が **逐次**処理する。結果として
 * 「同時に触るホストは N まで、1 ホストには 1 本ずつ」になる。
 *
 * Windmill の per-key concurrency limit に頼らないのは Community Edition で効かないから
 * (`crawl_host.ts` の冒頭に詳しい)。**ループの形で強制する。**
 *
 * ## robots.txt は 1 ホスト 1 回
 *
 * 段ごとに引き直さない。1 回のクロールの途中で robots が変わることは考えなくてよく、
 * 段ごとに引くと、それ自体が余計なアクセスになる。
 *
 * `Crawl-delay` があれば、設定した間隔と比べて**長いほうを採る**。相手が言っている値を
 * こちらの都合で縮めない。
 */
import robotsParser from "robots-parser";

/** BrowserHive の User-Agent はブラウザのものなので、robots では `*` の規則を見る。 */
const USER_AGENT = "*";

export interface Candidate {
  url: string;
  host: string;
}

export interface HostGroup {
  host: string;
  urls: string[];
  /** このホストに対して実際に使う間隔。robots が長い値を言っていればそれ。 */
  delayMs: number;
}

export interface Skipped {
  url: string;
  reason: string;
}

export interface Plan {
  groups: HostGroup[];
  /** 取らなかったものと理由。waggle に報告して `crawl_pages` に残す。 */
  skipped: Skipped[];
}

/**
 * robots.txt を引く。
 *
 * **読めなければ「制限なし」として扱う。** 404 も接続失敗も同じ ——
 * robots.txt が無いことは、取ってはいけないという意味ではない。
 * ただし取得そのものは 1 ホスト 1 回だけにする。
 */
const fetchRobots = async (host: string, scheme: string) => {
  const url = `${scheme}//${host}/robots.txt`;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) return undefined;
    return robotsParser(url, await res.text());
  } catch {
    return undefined;
  }
};

export async function main(
  candidates: Candidate[],
  per_host_delay_ms: number,
  respect_robots = true,
): Promise<Plan> {
  const byHost = new Map<string, Candidate[]>();
  for (const c of candidates) {
    const list = byHost.get(c.host);
    if (list) list.push(c);
    else byHost.set(c.host, [c]);
  }

  const groups: HostGroup[] = [];
  const skipped: Skipped[] = [];

  for (const [host, list] of byHost) {
    const first = list[0];
    if (first === undefined) continue;
    // scheme は最初の URL から取る。同じホストで混在していれば、そちらは別の
    // origin なので既に範囲の絞り込みで落ちている (waggle 側の `inScope`)。
    const scheme = new URL(first.url).protocol;
    const robots = respect_robots ? await fetchRobots(host, scheme) : undefined;

    const allowed: string[] = [];
    for (const c of list) {
      if (robots !== undefined && robots.isDisallowed(c.url, USER_AGENT) === true) {
        skipped.push({ url: c.url, reason: "robots" });
        continue;
      }
      allowed.push(c.url);
    }

    if (allowed.length === 0) continue;

    // **長いほうを採る。** 相手が言っている値をこちらの都合で縮めない。
    const crawlDelaySec = robots?.getCrawlDelay(USER_AGENT);
    const delayMs =
      typeof crawlDelaySec === "number" && Number.isFinite(crawlDelaySec)
        ? Math.max(per_host_delay_ms, Math.round(crawlDelaySec * 1000))
        : per_host_delay_ms;

    groups.push({ host, urls: allowed, delayMs });
  }

  const total = groups.reduce((n, g) => n + g.urls.length, 0);
  console.log(
    `${String(groups.length)} ホスト / ${String(total)} URL` +
      (skipped.length > 0 ? ` (robots で ${String(skipped.length)} 件を見送り)` : ""),
  );

  return { groups, skipped };
}
