#!/usr/bin/env bash
# Bring up a local Midnight devnet in an order that actually works.
#
# The standalone indexer panics with
#     Cannot construct OnlineClientAtBlock: block number 1 not found
# if it attaches before the node has produced a few blocks. `docker compose up`
# starts everything at once and hits this every time, so the node goes first and
# the indexer waits for real blocks.
#
# Usage:  ./scripts/devnet.sh          start
#         ./scripts/devnet.sh down     stop and wipe
#         ./scripts/devnet.sh reset    down + up (use when sync stalls)

set -euo pipefail
cd "$(dirname "$0")/.."

NODE_RPC=http://127.0.0.1:9944
MIN_BLOCKS=3

node_height() {
  curl -s -H 'Content-Type: application/json' \
    -d '{"jsonrpc":"2.0","id":1,"method":"system_syncState","params":[]}' \
    "$NODE_RPC" 2>/dev/null \
    | python3 -c 'import sys,json; print(json.load(sys.stdin)["result"]["currentBlock"])' 2>/dev/null || echo 0
}

case "${1:-up}" in
  down)
    docker compose down -v
    exit 0
    ;;
  reset)
    docker compose down -v
    ;;
esac

echo "starting node + proof server..."
docker compose up -d --wait node proof-server

echo -n "waiting for the node to reach block $MIN_BLOCKS "
for _ in $(seq 1 60); do
  h=$(node_height)
  [ "$h" -ge "$MIN_BLOCKS" ] && break
  echo -n "."
  sleep 2
done
echo " at block $(node_height)"

echo "starting indexer..."
docker compose up -d --wait indexer

docker compose ps --format '  {{.Name}}  {{.Status}}'
cat <<EOF

  node          $NODE_RPC
  indexer       http://127.0.0.1:8088
  proof server  http://127.0.0.1:6300

A local devnet degrades after roughly 600 blocks and wallet sync then stalls
silently. If proofs stop landing, run: ./scripts/devnet.sh reset
EOF
