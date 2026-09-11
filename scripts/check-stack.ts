/**
 * e2e の前に、要るものが待ち受けているかを確かめる。
 *
 * **vitest の中ではなくここに置く。** globalSetup が throw すると vitest は必ず
 * 「No test files found, exiting with code 1」を先に出す (browserhive で実測して
 * ある)。メッセージがどれだけ良くても、読む人はまずファイルのフィルタを疑う。
 * その 1 行を直せるのは vitest の外だけなので、`pretest:e2e` から呼ぶ。
 *
 * **足りなければ全部まとめて名指しする。** 1 件目で諦めると、1 回の間違いで
 * 2 往復させることになる。
 *
 * 待たない。profile を間違えて立てたものは待っても来ない。
 */
import { connect } from "node:net";

/** HTTP の答えが返ること自体が待ち受けの証拠。405 でも 401 でもよい。 */
const answers = (url: string): Promise<boolean> =>
  fetch(url, { signal: AbortSignal.timeout(3000) }).then(
    () => true,
    () => false,
  );

const portOpen = (host: string, port: number): Promise<boolean> =>
  new Promise<boolean>((resolve) => {
    const socket = connect({ host, port });
    const done = (ok: boolean): void => {
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(3000);
    socket.on("connect", () => done(true));
    socket.on("error", () => done(false));
    socket.on("timeout", () => done(false));
  });

const CHECKS = [
  {
    name: "windmill",
    where: "127.0.0.1:8000",
    need: "capture-scheduler: container-compose up -d -b",
    probe: () => answers("http://127.0.0.1:8000/api/version"),
  },
  {
    name: "capture-ledger api",
    where: "127.0.0.1:7070",
    need: "capture-ledger: pnpm run api",
    probe: () => answers("http://127.0.0.1:7070/healthz"),
  },
  {
    name: "oidc issuer",
    where: "127.0.0.1:9099",
    need: "capture-ledger: pnpm run oidc:issuer （トークンの発行元。再起動すると鍵が変わる）",
    probe: () => answers("http://127.0.0.1:9099/.well-known/openid-configuration"),
  },
  {
    name: "capture-fixtures",
    where: "capture-fixtures.capture-ledger:8080",
    need: "capture-ledger: container-compose --profile capture-fixtures up -d -b",
    probe: () => portOpen("capture-fixtures.capture-ledger", 8080),
  },
];

const results = await Promise.all(
  CHECKS.map(async (check) => ({ ...check, ok: await check.probe() })),
);

for (const r of results) {
  console.log(`  ${r.ok ? "✓" : "✗"} ${r.name.padEnd(12)} ${r.where}`);
}

const missing = results.filter((r) => !r.ok);
if (missing.length > 0) {
  console.error("\ne2e にはこれらが要ります:");
  for (const r of missing) console.error(`  ${r.name} —— ${r.need}`);
  process.exit(1);
}
