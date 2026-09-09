#!/usr/bin/env bash
#
# setup.sh —— forage のローカル開発環境を用意する。
#
# ここでやること:
#   1. Apple Container の道具が入っているかを見る。
#   2. `forage` の DNS ドメインが登録されていなければ、続けずに止まる。
#   3. .env.example を写して .env を作る。
#
# 行の範囲は下の sed に直書きなので、ヘッダを増減させたらここも直すこと。
set -e
cd "$(dirname "$0")"

if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
  sed -n '3,9p' "$0" | sed 's/^# \{0,1\}//'
  exit 0
fi

if [ $# -gt 0 ]; then
  echo "unknown argument: $1 (try --help)" >&2
  exit 1
fi

for cmd in container container-compose; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "missing: $cmd" >&2
    echo "  Install Apple Container and container-compose (Homebrew), then re-run." >&2
    exit 1
  fi
done

# DNS ドメインが無いと container-compose は real-DNS モードに入らず、各コンテナの
# 中の /etc/hosts を書き換える方式に落ちる。それは静かに失敗しうるので、ここで止める。
if ! container system dns ls 2>/dev/null | grep -qx "forage"; then
  cat >&2 <<'MSG'
DNS ドメイン "forage" が登録されていません。1 度だけ、手で作ってください:

  sudo container system dns create forage

(sudo が要るのでこのスクリプトからは実行しません。)
MSG
  exit 1
fi

if [ -f .env ]; then
  echo ".env は既にあります。触りません。"
else
  # 一覧はここに持たない。.env.example を写すだけ —— 独自の一覧を持てば必ずずれる。
  cp .env.example .env
  echo ".env を作りました (.env.example の写し)。"
fi

cat <<'MSG'

次にやること:

  container-compose up -d          # windmill と windmill-db が立つ
  pnpm install
  pnpm run windmill:bootstrap      # workspace と token を作り、貼れる形で出力する
                                   # → WINDMILL_TOKEN= を .env に貼る
  pnpm run windmill:push           # スクリプトと schedule を投入する

waggle 側 (別のターミナル):

  cd ../waggle
  # .env に WAGGLE_API_HOST=0.0.0.0 と WAGGLE_OIDC_ISSUER=http://127.0.0.1:9099
  pnpm run oidc:issuer             # 127.0.0.1:9099 のまま。**外に出さないこと**
  pnpm run api
  pnpm run fga:grant submitter windmill acme

戻ってきて、鍵を渡す:

  pnpm run windmill:waggle-token

MSG
