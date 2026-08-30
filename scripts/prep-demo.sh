#!/usr/bin/env bash
# Get this machine ready to record, and prove each shot works before the camera
# is on rather than during it.
#
# Starts what the demo needs, then actually RUNS every shot once and reports
# GO / NO-GO per shot. A green line here means that command worked on this
# machine seconds ago — not that it worked yesterday.
#
#   ./scripts/prep-demo.sh          full preflight (~4 min, resets the devnet)
#   ./scripts/prep-demo.sh fast     skip the devnet + real-proof shot (~30s)

set -uo pipefail
cd "$(dirname "$0")/.."

MODE="${1:-full}"
LOG=".demo-prep"
mkdir -p "$LOG"
PASS=0; FAIL=0
ok()   { printf '  \033[32mGO    \033[0m %-34s %s\n' "$1" "${2:-}"; PASS=$((PASS+1)); }
bad()  { printf '  \033[31mNO-GO \033[0m %-34s %s\n' "$1" "${2:-}"; FAIL=$((FAIL+1)); }
head_() { printf '\n\033[1m%s\033[0m\n' "$1"; }

# ---- anvil -----------------------------------------------------------------
head_ "chains"
pkill -f 'anvil' >/dev/null 2>&1
sleep 1
nohup anvil --silent > "$LOG/anvil.log" 2>&1 &
for _ in $(seq 1 40); do
  curl -s -X POST -H 'Content-Type: application/json' \
    --data '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}' \
    http://127.0.0.1:8545 >/dev/null 2>&1 && break
  sleep 0.25
done
if curl -s -X POST -H 'Content-Type: application/json' \
     --data '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}' \
     http://127.0.0.1:8545 >/dev/null 2>&1; then
  ok "anvil" "fresh chain on :8545 (block count matters — an old chain makes the loop crawl)"
else
  bad "anvil" "not answering on :8545"
fi

# ---- shots that need only anvil --------------------------------------------
head_ "shot B — npm run demo"
S=$(date +%s)
if npm run demo > "$LOG/demo.log" 2>&1; then
  ok "npm run demo" "$(($(date +%s)-S))s · $(grep -c '  ok' "$LOG/demo.log") assertions on screen"
else
  bad "npm run demo" "see $LOG/demo.log"
fi

head_ "shot D — the whole suite"
S=$(date +%s)
if npm run check > "$LOG/check.log" 2>&1; then
  ok "npm run check" "$(($(date +%s)-S))s · $(grep -cE '^\s*ok\s' "$LOG/check.log") assertions, 0 failures"
else
  bad "npm run check" "$(grep -cE '^\s*FAIL' "$LOG/check.log") failing — see $LOG/check.log"
fi

# ---- the site --------------------------------------------------------------
head_ "shot A — the table"
if [ -d ui/node_modules ]; then
  ok "ui deps" "installed"
else
  bad "ui deps" "run: npm --prefix ui install"
fi

# A vite server left running from an earlier session serves the code it was
# started with. One was found 14 hours stale on :5173 while preparing this,
# which would have recorded a build from before the day's work. Start a fresh
# one and make sure it is the one answering.
pkill -f 'node .*vite' >/dev/null 2>&1
sleep 2
nohup npm --prefix ui run dev > "$LOG/dev.log" 2>&1 &
for _ in $(seq 1 60); do
  grep -qE 'Local:' "$LOG/dev.log" 2>/dev/null && break
  sleep 0.5
done
PORT=$(grep -oE 'localhost:[0-9]+' "$LOG/dev.log" | head -1 | cut -d: -f2)
if [ "${PORT:-}" = "5173" ]; then
  ok "dev server" "http://localhost:5173 — freshly started from this working tree"
elif [ -n "${PORT:-}" ]; then
  bad "dev server" "came up on :$PORT, not :5173 — something else holds the port"
else
  bad "dev server" "did not start — see $LOG/dev.log"
fi
if curl -sS -o /dev/null -w '%{http_code}' https://nightfold-midnight.vercel.app 2>/dev/null | grep -q 200; then
  ok "deployed site" "https://nightfold-midnight.vercel.app"
else
  bad "deployed site" "not answering"
fi

# ---- real proofs -----------------------------------------------------------
if [ "$MODE" = "fast" ]; then
  printf '\n  (skipping the devnet and real-proof shot — pass no argument for the full check)\n'
else
  head_ "shot C — real ZK proofs"
  ./scripts/devnet.sh reset > "$LOG/devnet.log" 2>&1
  if docker ps --format '{{.Names}}' | grep -q midnight-indexer-1; then
    ok "devnet" "node + indexer + proof server, freshly reset"
  else
    bad "devnet" "see $LOG/devnet.log"
  fi
  rm -rf .nightfold-state
  S=$(date +%s)
  if npm run proof:real > "$LOG/proof.log" 2>&1; then
    ok "npm run proof:real" "$(($(date +%s)-S))s · $(grep -o 'ledger: .*' "$LOG/proof.log" | tail -1)"
  else
    bad "npm run proof:real" "see $LOG/proof.log"
  fi
fi

# ---- verdict ---------------------------------------------------------------
printf '\n%s\n' "────────────────────────────────────────────────────────────────"
if [ "$FAIL" -eq 0 ]; then
  printf '  \033[32mready to record\033[0m — %d checks passed\n' "$PASS"
else
  printf '  \033[31m%d NOT ready\033[0m (%d passed) — fix before recording\n' "$FAIL" "$PASS"
fi
cat <<'EOF'

  shot A   the table        ALREADY RUNNING -> http://localhost:5173
                            play a hand, muck, devtools on the mucked card
  shot B   the terminal     npm run demo           ~14s, runs live
  shot C   real ZK proofs   npm run proof:real     ~170s (30s wallet sync +
                            22s deploy + 113s proving) — record it, cut to ~10s
  shot D   the suite        npm run check          ~46s, show the last line

  cue card with timings and what to say:  .demo-prep/CUE-CARD.md
  transcripts of every shot:              .demo-prep/*.log
EOF

cat > "$LOG/CUE-CARD.md" <<'CARD'
# Nightfold — 2:00 hard cap

Rules: say the hackathon name in the first seconds, video made during the
event, repo and video public and staying public.

---

## 0:00–0:15 · name it and name the problem

> "This is Nightfold, built for the MLH Midnight Hackathon, August 2026.
> In a real card room, when you lose you muck — you slide your cards face
> down and nobody ever learns what you had. On-chain poker takes that away.
> Showdown means publishing your hole cards to a ledger that is indexed,
> free, and permanent. Your opponents don't need tracking software.
> The chain IS the tracking software."

Show: the landing page.

## 0:15–1:00 · play a hand  (shot A, localhost:5173)

Deal in as a guest. Play to showdown. Muck.

> "I just mucked — conceded at showdown without showing. Watch what the
> chain learns about the hand I was holding."

Open devtools on the mucked card. Nothing there — opponent cards are kept
out of React state on purpose, so a mucked hand is never in the DOM.

(Say muck, not fold. A fold happens during the betting; a muck is at
showdown, and it is the whole point of the project.)

## 1:00–1:35 · the terminal  (shot B, `npm run demo`)

Runs live in about 14 seconds. Two things land:

1. `published rank 2169397 decodes to: two pair, AAKK9`
   > "Most on-chain poker publishes a rank and calls it private. A rank is
   > the hand. Here it is, decoded back."

2. The loop: ETH on Base and SOL on Solana buy in at one price, betting is
   on chain, the showdown proves on Midnight, and the winner cashes out on
   a chain they never deposited to.

## 1:35–1:50 · real proofs  (shot C, pre-recorded, cut to ~10s)

> "This is not a simulator. A whole hand, proved on a local Midnight devnet."

Show the timing table and the last line:
`ledger: 1 hand, 1 rank, 1 muck, 1 settled` — one rank public, one hand
hidden, forever.

## 1:50–2:00 · close

> "Four security passes, every executed exploit is a regression test, and
> the losing hand is never revealed. Nightfold."

---

## If a shot has to be cut, cut in this order

1. shot D (the suite) — a number, not a story
2. the second half of shot B (the loop) — keep the rank decode
3. shot C — keep it if at all possible, it is the only proof it is real

## Before you hit record

- `./scripts/prep-demo.sh` and confirm every line says GO
- close other terminal tabs; the demo prints wide, use a big font
- `gh repo edit --visibility public` — judges cannot open the repo otherwise
CARD
exit $([ "$FAIL" -eq 0 ] && echo 0 || echo 1)
