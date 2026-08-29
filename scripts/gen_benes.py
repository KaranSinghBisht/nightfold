#!/usr/bin/env python3
"""Generate a Benes-network shuffle circuit in Compact and measure its cost.

The question this answers: can a trustless shuffle be cheap enough to use, so
Nightfold needs no dealer at all?

The O(N^2) oblivious-match shuffle measured 84.8 MB / ~59s per proof, which is
far too slow. A Benes network routes any permutation through 2k-1 stages of
N/2 conditional swaps for N = 2^k, controlled by private bits -- and validity
becomes STRUCTURAL, so the inverse-permutation witness and every bijectivity
assert disappear with it.

For N=64 (a 52-card deck padded up): 11 stages x 32 switches = 352 switches.

Topology: stage s pairs index i with i XOR (1 << shift[s]), where
    shift = [k-1, k-2, ..., 1, 0, 1, ..., k-2, k-1]
which is the standard butterfly-in / butterfly-out Benes arrangement.
"""

import subprocess, sys, os, time, math

def shifts(k):
    return list(range(k - 1, -1, -1)) + list(range(1, k))

def switch_pairs(n, shift):
    """(low, high) index pairs swapped at this stage."""
    step = 1 << shift
    return [(i, i ^ step) for i in range(n) if not (i & step)]

def gen(n):
    k = int(math.log2(n))
    assert 1 << k == n, "n must be a power of two"
    sh = shifts(k)
    n_switches = len(sh) * (n // 2)

    L = []
    L.append("pragma language_version >= 0.20;")
    L.append("import CompactStandardLibrary;")
    L.append("")
    L.append(f"// Benes shuffle, N={n}: {len(sh)} stages x {n//2} switches = {n_switches} switches.")
    L.append("// Permutation validity is structural -- any setting of the control bits")
    L.append("// yields SOME permutation, so no bijectivity checks are needed.")
    L.append("")
    L.append("export ledger deckRound: Counter;")
    L.append("")
    L.append(f"witness controlBits(): Vector<{n_switches}, Boolean>;")
    L.append(f"witness reencRand(): Vector<{n}, Field>;")
    L.append("")
    L.append("export circuit shuffleDeck(")
    L.append("  pk: JubjubPoint,")
    for name in ("inC1", "inC2", "outC1", "outC2"):
        L.append(f"  {name}: Vector<{n}, JubjubPoint>,")
    L[-1] = L[-1].rstrip(",")
    L.append("): [] {")
    L.append("  const ctl = controlBits();")
    L.append("  const r = reencRand();")
    L.append("")
    L.append("  // Flatten the input deck to coordinates; the network routes fields.")
    for comp, src in (("ax", "inC1"), ("ay", "inC1"), ("bx", "inC2"), ("by", "inC2")):
        acc = "jubjubPointX" if comp.endswith("x") else "jubjubPointY"
        L.append(f"  const {comp}0: Vector<{n}, Field> = [")
        L.append("    " + ", ".join(f"{acc}({src}[{i}])" for i in range(n)))
        L.append("  ];")
    L.append("")

    # each stage produces a fresh const vector per coordinate
    sw = 0
    for s, shift in enumerate(sh):
        pairs = switch_pairs(n, shift)
        # map index -> (partner, control index, is_low)
        route = {}
        for (lo, hi) in pairs:
            route[lo] = (hi, sw, True)
            route[hi] = (lo, sw, False)
            sw += 1
        L.append(f"  // stage {s}: swap across bit {shift}")
        for comp in ("ax", "ay", "bx", "by"):
            prev = f"{comp}{s}"
            cur = f"{comp}{s+1}"
            elems = []
            for i in range(n):
                partner, c, is_low = route[i]
                # control true = swap
                elems.append(f"ctl[{c}] ? {prev}[{partner}] : {prev}[{i}]")
            L.append(f"  const {cur}: Vector<{n}, Field> = [")
            L.append("    " + ",\n    ".join(elems))
            L.append("  ];")
        L.append("")

    last = len(sh)
    L.append("  // Re-encrypt each routed card: C1' = C1 + r*G, C2' = C2 + r*PK.")
    L.append("  // O(N) elliptic-curve work, independent of the routing above.")
    L.append(f"  for (const i of 0..{n}) {{")
    L.append("    const rg = ecMulGenerator(r[i]);")
    L.append("    const rp = ecMul(pk, r[i]);")
    L.append(f"    const c1 = ecAdd(constructJubjubPoint(ax{last}[i], ay{last}[i]), rg);")
    L.append(f"    const c2 = ecAdd(constructJubjubPoint(bx{last}[i], by{last}[i]), rp);")
    L.append("    assert(jubjubPointX(c1) == jubjubPointX(outC1[i]), \"c1 x\");")
    L.append("    assert(jubjubPointY(c1) == jubjubPointY(outC1[i]), \"c1 y\");")
    L.append("    assert(jubjubPointX(c2) == jubjubPointX(outC2[i]), \"c2 x\");")
    L.append("    assert(jubjubPointY(c2) == jubjubPointY(outC2[i]), \"c2 y\");")
    L.append("  }")
    L.append("  deckRound.increment(1);")
    L.append("}")
    return "\n".join(L), n_switches


if __name__ == "__main__":
    out_dir = sys.argv[1] if len(sys.argv) > 1 else "/tmp/benes"
    os.makedirs(out_dir, exist_ok=True)
    print(f"{'N':>4} {'switches':>9} {'compile':>9} {'prover key':>13} {'est prove':>11}")
    for n in (8, 16, 32, 64):
        src, nsw = gen(n)
        path = os.path.join(out_dir, f"benes{n}.compact")
        open(path, "w").write(src)
        t0 = time.time()
        p = subprocess.run(["compact", "compile", path, os.path.join(out_dir, f"out{n}")],
                           capture_output=True, text=True)
        wall = time.time() - t0
        key = os.path.join(out_dir, f"out{n}", "keys", "shuffleDeck.prover")
        if p.returncode != 0 or not os.path.exists(key):
            print(f"{n:>4} {nsw:>9} {wall:>8.0f}s   FAILED")
            print((p.stdout + p.stderr).strip()[:400])
            continue
        mb = os.path.getsize(key) / 1e6
        print(f"{n:>4} {nsw:>9} {wall:>8.0f}s {mb:>10.2f} MB {mb*0.70:>9.1f}s")
