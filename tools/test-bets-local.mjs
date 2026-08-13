/* ===================================================================
   In-process bet-flow test: no network, no faucet.

   Imports the real handlers, credits play money straight into the
   memory db, then drives the full betting surface through the same
   req/res shim Vercel would provide. Catches contract drift between
   place/act/state and the client expectations without needing devnet
   to cooperate.

   Run: node tools/test-bets-local.mjs   (env from .env.local)
   =================================================================== */

import { readFileSync } from "node:fs";
import { webcrypto as crypto } from "node:crypto";
import nacl from "tweetnacl";
import bs58 from "bs58";

/* --- .env.local, same minimal parse as dev-api --- */
try {
  for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2];
  }
} catch {}

const db = await import("../api/_lib/db.js");
const challenge = (await import("../api/auth/challenge.js")).default;
const verify = (await import("../api/auth/verify.js")).default;
const place = (await import("../api/bet/place.js")).default;
const act = (await import("../api/bet/act.js")).default;
const stateEp = (await import("../api/bet/state.js")).default;
const balanceEp = (await import("../api/wallet/balance.js")).default;

/* --- req/res shim --- */
function call(handler, { method = "POST", body = null, query = {}, token = null } = {}) {
  return new Promise((resolve, reject) => {
    const req = {
      method,
      url: "/x?" + new URLSearchParams(query).toString(),
      query,
      body,
      headers: token ? { authorization: "Bearer " + token } : {},
      on(ev, fn) { if (ev === "data" && body) fn(Buffer.from(JSON.stringify(body))); if (ev === "end") fn(); },
    };
    const res = {
      statusCode: 200,
      setHeader() {},
      status(c) { this.statusCode = c; return this; },
      json(o) { resolve({ status: this.statusCode, body: o }); },
      end(s) { resolve({ status: this.statusCode, body: s ? JSON.parse(s) : null }); },
    };
    Promise.resolve(handler(req, res)).catch(reject);
  });
}

let pass = 0, fail = 0;
const out = [];
function check(name, ok, detail) {
  out.push([ok ? "OK" : "FAIL", name, detail || ""]);
  ok ? pass++ : fail++;
}

/* --- auth --- */
const kp = nacl.sign.keyPair();
const addr = bs58.encode(kp.publicKey);

const ch = await call(challenge, { body: { address: addr } });
check("challenge", ch.status === 200 && !!ch.body.message, "nonce " + String(ch.body.nonce).slice(0, 8));

const sig = bs58.encode(nacl.sign.detached(new TextEncoder().encode(ch.body.message), kp.secretKey));
const ver = await call(verify, { body: { address: addr, nonce: ch.body.nonce, signature: sig } });
check("verify", ver.status === 200 && !!ver.body.token);
const token = ver.body.token;

/* --- stake money straight into the ledger --- */
const START = 1_000_000_000; /* 1 SOL */
await db.credit(addr, "sol", START, "test:seed");
const bal0 = await call(balanceEp, { method: "GET", token });
check("seeded balance", bal0.body.sol === START, bal0.body.sol + " lamports");

const rid = () => crypto.randomUUID().replace(/-/g, "");
let expected = START;

async function balanceNow() {
  return (await call(balanceEp, { method: "GET", token })).body.sol;
}

/* --- dice x20, ledger checked to the lamport --- */
let diceOk = true;
for (let i = 0; i < 20; i++) {
  const amount = 1_000_000 + i * 137;
  const chance = 2 + ((i * 9.3) % 96);
  const r = await call(place, {
    token,
    body: { game: "dice", asset: "sol", amount, params: { chance: Math.round(chance * 100) / 100, dir: i % 2 ? "over" : "under" }, clientRoundId: rid() },
  });
  if (r.status !== 200 || r.body.settled !== true) { diceOk = false; check("dice #" + i, false, JSON.stringify(r.body).slice(0, 120)); break; }
  expected = expected - amount + (r.body.payout || 0);
  if (r.body.balance !== expected) { diceOk = false; check("dice ledger #" + i, false, r.body.balance + " != " + expected); break; }
}
if (diceOk) check("dice x20 ledger", (await balanceNow()) === expected, expected + " lamports");

/* --- mines: place, 3 picks, cashout (or mine) --- */
{
  const amount = 5_000_000;
  const id = rid();
  const r = await call(place, { token, body: { game: "mines", asset: "sol", amount, params: { mines: 3 }, clientRoundId: id } });
  const roundId = r.body.roundId || id;
  check("mines place", r.status === 200 && !!roundId && !r.body.mines, "hidden layout");
  expected -= amount;

  let settled = false, won = false, payout = 0;
  for (const idx of [0, 7, 13, 21]) {
    const a = await call(act, { token, body: { roundId, action: "pick", payload: { index: idx } } });
    if (a.body.settled) { settled = true; payout = a.body.payout || 0; won = payout > 0; break; }
  }
  if (!settled) {
    const c = await call(act, { token, body: { roundId, action: "cashout" } });
    settled = !!c.body.settled; payout = c.body.payout || 0; won = payout > 0;
    check("mines reveals layout at end", Array.isArray(c.body.mines) && c.body.mines.length === 3);
  }
  expected += payout;
  check("mines settles", settled, won ? "cashout +" + payout : "hit a mine (legit)");
  check("mines ledger", (await balanceNow()) === expected, expected + " lamports");
}

/* --- blackjack: deal then stand (or observe a natural settle) --- */
{
  const amount = 2_000_000;
  const id = rid();
  const r = await call(place, { token, body: { game: "blackjack", asset: "sol", amount, params: {}, clientRoundId: id } });
  expected -= amount;
  const st = r.body.state || r.body;
  const roundId = r.body.roundId || id;
  const dealerCards = (st.dealer || []).length;
  check("blackjack deal hides hole card", r.status === 200 && (st.settled ? true : dealerCards === 1), "dealer shows " + dealerCards + " card(s)");

  let payout = st.settled ? (st.payout ?? r.body.payout ?? 0) : null;
  if (payout === null) {
    const s = await call(act, { token, body: { roundId, action: "stand" } });
    const fin = s.body.state || s.body;
    payout = fin.payout ?? s.body.payout ?? 0;
    check("blackjack settles on stand", !!(fin.settled ?? s.body.settled), "payout " + payout);
    check("blackjack dealer revealed", (fin.dealer || []).length >= 2);
  }
  const legal = [0, amount, amount * 2, amount * 2.5];
  check("blackjack legal return", legal.includes(payout), String(payout));
  expected += payout;
  check("blackjack ledger", (await balanceNow()) === expected, expected + " lamports");
}

/* --- crash with auto: place then resolve-poll --- */
{
  const amount = 1_500_000;
  const id = rid();
  const r = await call(place, { token, body: { game: "crash", asset: "sol", amount, params: { auto: 1.5 }, clientRoundId: id } });
  const roundId = r.body.roundId || id;
  check("crash place opens", r.status === 200 && !!roundId && r.body.crashAt === undefined, "crash point hidden");
  expected -= amount;

  let fin = null;
  for (let i = 0; i < 30 && !fin; i++) {
    await new Promise((z) => setTimeout(z, 500));
    const a = await call(act, { token, body: { roundId, action: "resolve" } });
    if (a.body.settled) fin = a.body;
  }
  check("crash resolves", !!fin, fin ? "crashAt " + fin.crashAt : "never settled");
  if (fin) {
    const payout = fin.payout || 0;
    const wonAuto = fin.crashAt > 1.5;
    check("crash auto honoured", wonAuto ? payout > 0 : payout === 0,
      "crashAt " + fin.crashAt + " -> payout " + payout);
    expected += payout;
  }
  check("crash ledger", (await balanceNow()) === expected, expected + " lamports");
}

/* --- state resume + double-place guard --- */
{
  const id = rid();
  const r1 = await call(place, { token, body: { game: "mines", asset: "sol", amount: 1_000_000, params: { mines: 3 }, clientRoundId: id } });
  expected -= 1_000_000;
  const roundId = r1.body.roundId || id;
  const r2 = await call(place, { token, body: { game: "mines", asset: "sol", amount: 1_000_000, params: { mines: 3 }, clientRoundId: rid() } });
  check("second open round refused", r2.status === 409, "status " + r2.status);
  const st = await call(stateEp, { method: "GET", query: { roundId }, token });
  const view = st.body.state || st.body;
  check("state resume hides layout", st.status === 200 && !view.mines, "sanitized");
  const c = await call(act, { token, body: { roundId, action: "cashout" } });
  /* cashout with zero picks: either refused or returns the stake — accept both, ledger decides */
  const back = c.body.payout || 0;
  expected += back;
  check("cleanup ledger", (await balanceNow()) === expected, expected + " lamports");
}

/* --- report --- */
const w = Math.max(...out.map((r) => r[1].length));
for (const [s, n, d] of out) console.log(s.padEnd(5), n.padEnd(w + 2), d);
console.log("\n" + (fail === 0 ? "ALL PASS (" + pass + ")" : "FAILURES: " + fail + "/" + (pass + fail)));
process.exit(fail === 0 ? 0 : 1);
