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

# ---- the cage, deployed and staffed ----------------------------------------
head_ "the cage"
if node scripts/demo-deploy.mjs > "$LOG/deploy.log" 2>&1; then
  ok "cages deployed" "$(grep -oE '0x[0-9a-f]{40}' "$LOG/deploy.log" | head -1) (base) + one for the payout side"
else
  bad "cages deployed" "see $LOG/deploy.log"
fi

pkill -f 'demo-relayer' >/dev/null 2>&1
sleep 1
nohup node scripts/demo-relayer.mjs > "$LOG/relayer.log" 2>&1 &
for _ in $(seq 1 40); do grep -q 'watching  sol' "$LOG/relayer.log" 2>/dev/null && break; sleep 0.5; done
if grep -q 'watching  sol' "$LOG/relayer.log" 2>/dev/null; then
  ok "relayer" "$(grep -oE 'devnet cage balance: [0-9.]+ SOL' "$LOG/relayer.log" | head -1) to pay wins with"
else
  bad "relayer" "see $LOG/relayer.log"
fi

# A deposit credited here means the browser's deposit will be credited too.
# The Solana payout leg is NOT exercised — it spends real devnet SOL, and the
# recording should be the first one of the session.
if node scripts/demo-credit-check.mjs > "$LOG/credit.log" 2>&1; then
  ok "deposit -> chips" "$(tail -1 "$LOG/credit.log")"
else
  bad "deposit -> chips" "see $LOG/credit.log"
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

  ONE-TIME, BEFORE THE FIRST TAKE
    Import an anvil account into MetaMask so it has ETH to deposit with:
      private key  0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d
    The site adds and switches to the local network for you on first deposit.

  THE TAKE                                    http://localhost:5173
    0:00  landing page
    0:20  #play — mention the guest table, take the CASH lane
    0:30  CONNECT WALLET, then BUY CHIPS on Base — a real signed deposit
    0:50  the relayer credits; play the hand, muck it
    1:30  CASH OUT — ANOTHER CHAIN -> burn on Base, paid in SOL on devnet
    1:45  open the explorer link. that is the loop.

  cue card with what to say:  .demo-prep/CUE-CARD.md
  logs from every check:      .demo-prep/*.log
EOF

cat > "$LOG/CUE-CARD.md" <<'CARD'
# Nightfold — 2:00 hard cap · Cross-Chain track

Say the hackathon name in the first seconds. Video made during the event.
Repo and video public, and staying public.

**One-time setup:** import this anvil key into MetaMask so the wallet has ETH.
`0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d`
The site adds and switches to the local network itself on the first deposit.

---

## 0:00–0:20 · the problem, on the landing page

> "Nightfold, built for the MLH Midnight Hackathon, August 2026. Poker is a
> game of hidden information, and every on-chain poker game throws that away
> at showdown — you publish your cards to a ledger that is indexed, free and
> permanent. We fixed that with Midnight, and we made the money work across
> chains while we were at it."

Scroll the landing page. Do not explain the muck yet — it lands harder once
they have seen a hand.

## 0:20–0:30 · two ways in

Go to `#play`.

> "There's a guest table if you just want to play. I'm taking the cash lane,
> because that's where the cross-chain part lives."

## 0:30–0:50 · connect and deposit on Base  ← THE CROSS-CHAIN CLAIM STARTS

CONNECT WALLET → BUY CHIPS → Base → DEPOSIT & BUY CHIPS. MetaMask opens.

> "This is a real payable call into NightfoldCage — the same contract the test
> suite exercises. The cage takes custody and credits nothing. A relayer
> holding a different key credits the chips after it has seen the deposit.
> That split is why a compromised relayer can't mint itself a stack."

Let the button sit on CREDITING… for a second. It is reading the cage's own
number, not one the page made up.

## 0:50–1:30 · play the hand, and the Midnight part

Play to showdown. Muck.

> "Cards are commitments on Midnight. At showdown I have four options, and
> only one of them publishes anything: show my rank, prove I beat what you
> showed, prove my hand clears a floor, or muck and say nothing at all.
> I mucked. The chain has no idea what I was holding — and it never will,
> because nothing was published to go back and read."

If there is room: devtools on the mucked card. It was never in the DOM.

## 1:30–1:50 · leave on a chain you never arrived on  ← THE PAYOFF

CASH OUT — ANOTHER CHAIN → BURN & PAY OUT ON SOLANA.

> "I came in on Base. I'm leaving on Solana, which I never deposited to. The
> chips burn on Base first — that ordering is what stops one stack being spent
> on two chains — and then the payout lands on Solana devnet."

Open the explorer link.

> "That's a real devnet transaction. Anyone can check it."

## 1:50–2:00 · close

> "Chips from any chain, betting and settlement on chain, the showdown proved
> on Midnight, and the losing hand never revealed. Nightfold."

---

## If it runs long, cut in this order

1. the devtools aside at 1:20
2. landing-page scrolling — 20s becomes 10s
3. narration during CREDITING… — let it play silent

## Do NOT cut

The deposit, the muck, and the Solana explorer link. Those three ARE the
submission: money in on one chain, hidden showdown, money out on another.

## If something breaks mid-take

- MetaMask on the wrong network -> the site offers the switch; accept it
- CREDITING… hangs -> the relayer died. `.demo-prep/relayer.log` has why
- payout never appears -> devnet cage is out of SOL. `npm run solana:fund 1`
- worst case, the terminal proof still exists: `npm run demo` (14s, runs live)
CARD
exit $([ "$FAIL" -eq 0 ] && echo 0 || echo 1)
