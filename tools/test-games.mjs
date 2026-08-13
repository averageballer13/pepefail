/* ===================================================================
   pepe.fail — offline sanity tests for api/_lib/games.js.

   Run: node tools/test-games.mjs
   No network, no db. Exits 1 if any check fails.

   Each one-shot game is simulated 200000 times and the empirical RTP
   must land in [98.5%, 99.5%]. A SEEDED prng makes the run
   deterministic: the same numbers come out every time, so a pass is
   a pass forever, not a coin flip on sampling noise.
   =================================================================== */

import {
  dice, limbo, wheel, plinko,
  minesLayout, minesMult, crashPoint,
  shoeFromFloats, bjScore, bjIsSoft, bjResolve, bjSettle,
  WHEEL_TABLE, BJ_SHOE_FLOATS,
} from "../api/_lib/games.js";

const ROUNDS = 200000;
const RTP_LO = 0.985;
const RTP_HI = 0.995;

/* Deterministic 32-bit prng (mulberry32). Quality is plenty for RTP
   estimation and the fixed seed keeps this test reproducible. */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const results = [];
let failed = false;

function record(name, detail, value, pass) {
  results.push({ name, detail, value, pass });
  if (!pass) failed = true;
}

function takes(rng, n) {
  const out = new Array(n);
  for (let i = 0; i < n; i++) out[i] = rng();
  return out;
}

/* ------------------------- one-shot RTP --------------------------- */

function simulate(name, detail, playFn) {
  let returned = 0;
  for (let i = 0; i < ROUNDS; i++) returned += playFn();
  const rtp = returned / ROUNDS; // stake is 1 per round
  record(name, detail, (rtp * 100).toFixed(3) + "%", rtp >= RTP_LO && rtp <= RTP_HI);
}

{
  const rng = mulberry32(1337);
  simulate("dice", "chance 50 Under", () => dice([rng()], { chance: 50, dir: "Under" }).mult);
}
{
  const rng = mulberry32(2024);
  simulate("dice", "chance 90 Over", () => dice([rng()], { chance: 90, dir: "Over" }).mult);
}
{
  const rng = mulberry32(42);
  simulate("limbo", "target 1.50x", () => limbo([rng()], { target: 1.5 }).mult);
}
{
  const rng = mulberry32(7);
  simulate("plinko", "8 rows Low", () => plinko(takes(rng, 8), { risk: "Low", rows: 8 }).mult);
}
{
  const rng = mulberry32(99);
  simulate("plinko", "12 rows Medium", () => plinko(takes(rng, 12), { risk: "Medium", rows: 12 }).mult);
}
{
  /* Crash is decided by one float; a player always cashing out at
     2.00x realizes the full RTP of the curve. */
  const rng = mulberry32(555);
  simulate("crash", "auto cashout 2.00x", () => (crashPoint(rng()) >= 2 ? 2 : 0));
}
{
  /* Mines, one pick then cash out: survive 22/25 and get paid the
     1-pick multiplier. */
  const rng = mulberry32(31415);
  simulate("mines", "3 mines, 1 pick", () => {
    const mines = minesLayout(takes(rng, 24), 3);
    return mines.includes(12) ? 0 : minesMult(1, 3);
  });
}

/* Wheel pays a fixed table over a uniform index, so the empirical
   part worth testing is the uniformity of the index; the RTP itself
   is the exact table average (variance on the 9.9x High table would
   make a 200k-spin empirical RTP check flaky by design). */
{
  const rng = mulberry32(2718);
  const N = WHEEL_TABLE.High.length;
  const counts = new Array(N).fill(0);
  for (let i = 0; i < ROUNDS; i++) counts[wheel([rng()], { risk: "High" }).index]++;
  const uniform = counts.every((c) => Math.abs(c / ROUNDS - 1 / N) < 0.005);
  record("wheel", "index uniformity (High)", uniform ? "uniform" : JSON.stringify(counts), uniform);

  /* Every risk table must carry the same printed 99% RTP — the original
     client tables paid 90% on Low and 100% on Medium. */
  for (const risk of ["Low", "Medium", "High"]) {
    const t = WHEEL_TABLE[risk];
    const ev = t.reduce((a, b) => a + b, 0) / t.length;
    record("wheel", "table EV (" + risk + ")", (ev * 100).toFixed(3) + "%", Math.abs(ev - 0.99) < 1e-9);
  }
}

/* ------------------------- mines maths ---------------------------- */

record(
  "mines", "minesMult(1,3) ~ 1.125",
  String(minesMult(1, 3)),
  Math.abs(minesMult(1, 3) - 1.125) <= 0.005
);
record("mines", "minesMult(0,3) = 1", String(minesMult(0, 3)), minesMult(0, 3) === 1);

/* ------------------------- blackjack ------------------------------ */

// Cards are popped from the END of the shoe array.
const c = (r) => ({ r, s: "spade" });

function deal(shoe) {
  const player = [];
  const dealer = [];
  player.push(shoe.pop());
  dealer.push(shoe.pop());
  player.push(shoe.pop());
  dealer.push(shoe.pop());
  return { player, dealer };
}

{
  // Player natural vs dealer 19: pays 3:2, total return 2.5x.
  const shoe = [c("9"), c("K"), c("10"), c("A")];
  const { player, dealer } = deal(shoe);
  const out = bjResolve(player, dealer, shoe);
  record("blackjack", "natural pays 2.5x", out.mult + "x " + out.label, out.mult === 2.5);
}
{
  // Player stands on 20; dealer 16 must draw and busts: return 2x.
  const shoe = [c("K"), c("6"), c("10"), c("10"), c("10")];
  const { player, dealer } = deal(shoe);
  const out = bjResolve(player, dealer, shoe);
  record(
    "blackjack", "dealer 16 draws and busts",
    out.mult + "x " + out.label,
    out.mult === 2 && bjScore(dealer) > 21 && dealer.length === 3
  );
}
{
  // 18 vs 18 is a push: stake back, 1x.
  const shoe = [c("8"), c("8"), c("10"), c("10")];
  const { player, dealer } = deal(shoe);
  const out = bjResolve(player, dealer, shoe);
  record("blackjack", "18 vs 18 pushes", out.mult + "x " + out.label, out.mult === 1);
}
{
  // Dealer A-6 (soft 17) must STAND — S17, the rule printed on the
  // page — so the player's 18 wins.
  const shoe = [c("2"), c("6"), c("8"), c("A"), c("10")];
  const { player, dealer } = deal(shoe);
  const soft17 = bjScore(dealer) === 17 && bjIsSoft(dealer);
  const out = bjResolve(player, dealer, shoe);
  record(
    "blackjack", "dealer stands on soft 17",
    out.mult + "x dealer " + bjScore(dealer),
    soft17 && dealer.length === 2 && bjScore(dealer) === 17 && out.mult === 2
  );
}
{
  // Player busts: nothing back, no matter what the dealer holds.
  const out = bjSettle([c("10"), c("9"), c("5")], [c("10"), c("6")]);
  record("blackjack", "player bust loses", out.mult + "x " + out.label, out.mult === 0);
}
{
  // A shoe built from floats must hold exactly 6 decks: 24 of each
  // rank, 78 of each suit.
  const rng = mulberry32(8080);
  const shoe = shoeFromFloats(takes(rng, BJ_SHOE_FLOATS));
  const ranks = {};
  const suits = {};
  for (const card of shoe) {
    ranks[card.r] = (ranks[card.r] || 0) + 1;
    suits[card.s] = (suits[card.s] || 0) + 1;
  }
  const okComp =
    shoe.length === 312 &&
    Object.values(ranks).every((n) => n === 24) &&
    Object.values(suits).every((n) => n === 78);
  record("blackjack", "shoe composition 6 decks", shoe.length + " cards", okComp);
}

/* ------------------------- report --------------------------------- */

const w1 = Math.max(...results.map((r) => r.name.length)) + 2;
const w2 = Math.max(...results.map((r) => r.detail.length)) + 2;
const w3 = Math.max(...results.map((r) => String(r.value).length)) + 2;

console.log("");
console.log("game".padEnd(w1) + "check".padEnd(w2) + "value".padEnd(w3) + "result");
console.log("-".repeat(w1 + w2 + w3 + 6));
for (const r of results) {
  console.log(
    r.name.padEnd(w1) + r.detail.padEnd(w2) + String(r.value).padEnd(w3) + (r.pass ? "PASS" : "FAIL")
  );
}
console.log("");
console.log(failed ? "FAILED" : "All checks passed (" + results.length + ")");

process.exit(failed ? 1 : 0);
