/* ===================================================================
   pepe.fail — end-to-end test against the local dev server (DEVNET)

   Usage:
     node tools/dev-api.mjs        (terminal 1)
     node tools/test-e2e.mjs      (terminal 2)

   Full scenario: fresh player keypair -> devnet airdrop -> auth ->
   real on-chain deposit -> dice x20 -> mines -> blackjack -> crash ->
   withdrawal. The ledger is tracked in integer lamports and compared
   to the server balance with ZERO tolerance at every step: the whole
   point of this test is the accounting, not the odds.

   Exit code 1 on any failure. If the devnet faucet rate-limits us,
   the balance-dependent steps are skipped and reported as such.
   =================================================================== */

import nacl from "tweetnacl";
import bs58 from "bs58";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BASE = process.env.API_BASE || "http://localhost:5178";

const AIRDROP_LAMPORTS = 1_000_000_000; // 1 SOL
const DEPOSIT_LAMPORTS = 200_000_000; // 0.2 SOL
const DICE_BET = 1_000_000; // 0.001 SOL
const MINES_BET = 1_000_000;
const BJ_BET = 2_000_000; // even amount: 3:2 blackjack stays integer
const CRASH_BET = 1_000_000;
const WITHDRAW_LAMPORTS = 50_000_000; // 0.05 SOL

const runId = Date.now().toString(36);
const results = [];
let token = null;
let expected = 0; // our own integer ledger, mirrored against the server

/* --------------------------- helpers ------------------------------ */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sol = (lamports) => (lamports / 1e9).toFixed(4) + " SOL";
const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);

function record(step, status, note) {
  results.push({ step, status, note: note || "" });
  const tag = status === "OK" ? "  OK  " : status === "SKIP" ? " SKIP " : " FAIL ";
  console.log("[" + tag + "] " + step + (note ? " — " + note : ""));
}

/* .env.local is read only to hit the same RPC as the dev server. */
async function loadEnvLocal() {
  let raw;
  try {
    raw = await readFile(path.join(ROOT, ".env.local"), "utf8");
  } catch {
    return;
  }
  for (const line of raw.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq <= 0) continue;
    const key = t.slice(0, eq).trim();
    let val = t.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = val;
  }
}

/* Small API client: JSON in/out, bearer token, one polite retry on
   the rate limiter (bet/* allows 30 req / 10 s per address). */
async function api(method, route, body) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(BASE + route, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: "Bearer " + token } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (res.status === 429 && attempt < 3) {
      await sleep(4000);
      continue;
    }
    let data = null;
    try {
      data = await res.json();
    } catch {
      /* non-JSON error body */
    }
    if (!res.ok) {
      const err = new Error(
        method + " " + route + " -> " + res.status + " " + JSON.stringify(data)
      );
      err.status = res.status;
      err.data = data;
      throw err;
    }
    return data;
  }
}

async function serverSol() {
  const b = await api("GET", "/api/wallet/balance");
  const v = num(b && b.sol);
  if (v === null) throw new Error("wallet/balance: sol is not an integer: " + JSON.stringify(b));
  return v;
}

/* Zero tolerance: the server balance must equal our ledger exactly. */
async function checkBalance(label) {
  const got = await serverSol();
  if (got !== expected) {
    throw new Error(label + ": server balance " + got + " != expected " + expected);
  }
}

/* Multi-step responses are written by other agents; accept the few
   reasonable shapes for "this round is finished" and "the payout". */
function settledOf(r) {
  if (!r || typeof r !== "object") return false;
  if (r.settled === true) return true;
  if (r.state === "settled") return true;
  if (typeof r.state === "object" && r.state && r.state.state === "settled") return true;
  if (r.round && r.round.state === "settled") return true;
  return false;
}

function payoutOf(r) {
  if (!r || typeof r !== "object") return null;
  if (num(r.payout) !== null) return r.payout;
  if (typeof r.state === "object" && r.state && num(r.state.payout) !== null) return r.state.payout;
  if (r.round && num(r.round.payout) !== null) return r.round.payout;
  return null;
}

/* After a multi-step round settles: reconcile against the server.
   If the response carried a payout we assert it exactly; otherwise the
   payout is derived from the balance and only sanity-checked. */
async function settleLedger(label, claimedPayout) {
  const got = await serverSol();
  const diff = got - expected;
  if (claimedPayout !== null && claimedPayout !== undefined) {
    if (diff !== claimedPayout) {
      throw new Error(
        label + ": payout announced " + claimedPayout + " but balance moved by " + diff
      );
    }
  }
  if (diff < 0) throw new Error(label + ": balance dropped after settle (" + diff + ")");
  expected = got;
  return diff;
}

/* Direct JSON-RPC (airdrop + confirmations), no Connection needed. */
async function rpcCall(rpcUrl, method, params) {
  const res = await fetch(rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const data = await res.json();
  if (data.error) {
    const err = new Error(method + ": " + JSON.stringify(data.error));
    err.rpc = data.error;
    throw err;
  }
  return data.result;
}

async function waitForSignature(rpcUrl, signature, timeoutMs) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    const r = await rpcCall(rpcUrl, "getSignatureStatuses", [[signature]]);
    const st = r && r.value && r.value[0];
    if (st && !st.err && (st.confirmationStatus === "confirmed" || st.confirmationStatus === "finalized")) {
      return true;
    }
    if (st && st.err) throw new Error("tx failed on-chain: " + JSON.stringify(st.err));
    await sleep(2000);
  }
  return false;
}

/* Score a blackjack hand from whatever card shape the server exposes.
   Returns null when the shape is not understood; the strategy then
   simply stands, which still finishes the round. */
function bjScore(cards) {
  if (!Array.isArray(cards) || cards.length === 0) return null;
  let total = 0;
  let aces = 0;
  for (const c of cards) {
    let rank = null;
    if (typeof c === "string") rank = c.replace(/[^A2-9JQK10]/gi, "").toUpperCase();
    else if (c && typeof c === "object") rank = String(c.r ?? c.rank ?? "").toUpperCase();
    if (!rank) return null;
    if (rank.startsWith("A")) { aces++; total += 11; }
    else if (rank.startsWith("K") || rank.startsWith("Q") || rank.startsWith("J") || rank.startsWith("10") || rank.startsWith("T")) total += 10;
    else {
      const n = parseInt(rank, 10);
      if (!Number.isFinite(n)) return null;
      total += n;
    }
  }
  while (total > 21 && aces > 0) { total -= 10; aces--; }
  return total;
}

function bjPlayerScore(state) {
  if (!state || typeof state !== "object") return null;
  const s = typeof state.state === "object" && state.state ? state.state : state;
  for (const k of ["playerScore", "pScore", "playerTotal"]) {
    if (num(s[k]) !== null) return s[k];
  }
  const hand = s.player || s.playerHand || (s.hands && s.hands.player);
  return bjScore(Array.isArray(hand) ? hand : (hand && hand.cards));
}

/* --------------------------- scenario ----------------------------- */

async function main() {
  await loadEnvLocal();
  const RPC = process.env.RPC_URL || "https://api.devnet.solana.com";

  console.log("");
  console.log("pepe.fail e2e — cible " + BASE + " — rpc " + RPC);
  console.log("");

  /* 0) config: refuse to run against anything but devnet. */
  let config;
  try {
    config = await api("GET", "/api/config");
    if (!config.enabled) throw new Error("mode reel inactif (SESSION_SECRET / HOUSE_WALLET_SECRET manquants)");
    if (config.network !== "devnet") throw new Error("network=" + config.network + " — ce test ne tourne que sur devnet");
    if (!config.vault) throw new Error("pas de vault dans /api/config");
    record("config", "OK", "network=devnet, vault=" + config.vault);
  } catch (e) {
    record("config", "FAIL", e.message);
    return finish();
  }

  /* 1) fresh player keypair */
  const kp = nacl.sign.keyPair();
  const addr = bs58.encode(kp.publicKey);
  record("joueur", "OK", addr);

  /* 2) devnet airdrop — the faucet rate-limits hard; not fatal. */
  let funded = false;
  try {
    const sig = await rpcCall(RPC, "requestAirdrop", [addr, AIRDROP_LAMPORTS]);
    const ok = await waitForSignature(RPC, sig, 90_000);
    if (!ok) throw new Error("airdrop non confirme en 90s");
    funded = true;
    record("airdrop 1 SOL", "OK");
  } catch (e) {
    record("airdrop 1 SOL", "SKIP", "faucet indisponible (" + (e.rpc ? "rate limit" : e.message) + ") — les etapes on-chain seront sautees");
  }

  /* 3) challenge + verify: sign the exact message returned. */
  try {
    const ch = await api("POST", "/api/auth/challenge", { address: addr });
    if (!ch.message || !ch.nonce) throw new Error("challenge incomplet: " + JSON.stringify(ch));
    const sig = nacl.sign.detached(new TextEncoder().encode(ch.message), kp.secretKey);
    const v = await api("POST", "/api/auth/verify", {
      address: addr,
      nonce: ch.nonce,
      signature: bs58.encode(sig),
    });
    if (!v.token) throw new Error("verify sans token: " + JSON.stringify(v));
    token = v.token;
    record("auth challenge+verify", "OK");
  } catch (e) {
    record("auth challenge+verify", "FAIL", e.message);
    return finish();
  }

  /* 3b) fair state must exist and expose a 64-hex seed hash. */
  try {
    const f = await api("GET", "/api/fair/state");
    if (!/^[0-9a-f]{64}$/i.test(String(f.serverSeedHash || ""))) {
      throw new Error("serverSeedHash invalide: " + JSON.stringify(f));
    }
    record("fair/state", "OK", "hash " + String(f.serverSeedHash).slice(0, 12) + "...");
  } catch (e) {
    record("fair/state", "FAIL", e.message);
  }

  /* balance starts at zero for a fresh address */
  try {
    expected = 0;
    await checkBalance("solde initial");
    record("solde initial = 0", "OK");
  } catch (e) {
    record("solde initial = 0", "FAIL", e.message);
    return finish();
  }

  if (!funded) {
    record("depot 0.2 SOL", "SKIP", "pas de fonds devnet");
    record("dice x20", "SKIP", "pas de solde");
    record("mines", "SKIP", "pas de solde");
    record("blackjack", "SKIP", "pas de solde");
    record("crash", "SKIP", "pas de solde");
    record("retrait 0.05 SOL", "SKIP", "pas de solde");
    return finish();
  }

  /* 4) real deposit: sign a transfer to the vault on devnet, then let
     the server verify it on-chain and credit the ledger. */
  let depositSig = null;
  try {
    const conn = new Connection(RPC, "confirmed");
    const signer = Keypair.fromSecretKey(kp.secretKey);
    const tx = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: signer.publicKey,
        toPubkey: new PublicKey(config.vault),
        lamports: DEPOSIT_LAMPORTS,
      })
    );
    depositSig = await sendAndConfirmTransaction(conn, tx, [signer], { commitment: "confirmed" });

    // the server RPC may lag behind ours by a slot or two: retry
    let dep = null;
    let lastErr = null;
    for (let i = 0; i < 6; i++) {
      try {
        dep = await api("POST", "/api/wallet/deposit", { signature: depositSig });
        break;
      } catch (e) {
        lastErr = e;
        await sleep(2500);
      }
    }
    if (!dep) throw lastErr || new Error("depot refuse");
    if (dep.credited !== DEPOSIT_LAMPORTS) {
      throw new Error("credite " + dep.credited + " != " + DEPOSIT_LAMPORTS);
    }
    expected += DEPOSIT_LAMPORTS;
    if (num(dep.balance) !== null && dep.balance !== expected) {
      throw new Error("balance depot " + dep.balance + " != " + expected);
    }
    await checkBalance("apres depot");
    record("depot 0.2 SOL", "OK", "tx " + depositSig.slice(0, 12) + "...");
  } catch (e) {
    record("depot 0.2 SOL", "FAIL", e.message);
    return finish();
  }

  /* 4b) same signature again must NOT credit twice. */
  try {
    try {
      await api("POST", "/api/wallet/deposit", { signature: depositSig });
    } catch {
      /* a rejection is an acceptable way to refuse the duplicate */
    }
    await checkBalance("depot rejoue");
    record("depot idempotent", "OK", "aucun double credit");
  } catch (e) {
    record("depot idempotent", "FAIL", e.message);
  }

  /* 5) 20 varied dice bets, ledger checked on every single one. */
  try {
    const chances = [2, 10, 25, 33, 50, 66, 75, 90, 98];
    let wins = 0;
    for (let i = 0; i < 20; i++) {
      const chance = chances[i % chances.length];
      const dir = i % 2 === 0 ? "Under" : "Over";
      const r = await api("POST", "/api/bet/place", {
        game: "dice",
        asset: "sol",
        amount: DICE_BET,
        params: { chance, dir },
        clientRoundId: "e2e-" + runId + "-dice-" + i,
      });
      if (r.settled !== true) throw new Error("dice " + i + ": pas settled: " + JSON.stringify(r));
      const payout = num(r.payout);
      if (payout === null || payout < 0) throw new Error("dice " + i + ": payout invalide");
      expected = expected - DICE_BET + payout;
      if (num(r.balance) !== expected) {
        throw new Error("dice " + i + ": balance " + r.balance + " != " + expected);
      }
      if (payout > 0) wins++;
      await sleep(150); // stay well under the 30 req / 10 s limiter
    }
    await checkBalance("apres dice");
    record("dice x20", "OK", wins + " gagnes / 20, solde " + sol(expected));
  } catch (e) {
    record("dice x20", "FAIL", e.message);
    return finish();
  }

  /* 6) mines: place, resume via bet/state, pick up to 3, cash out. */
  try {
    const placed = await api("POST", "/api/bet/place", {
      game: "mines",
      asset: "sol",
      amount: MINES_BET,
      params: { mines: 3 },
      clientRoundId: "e2e-" + runId + "-mines",
    });
    if (!placed.roundId) throw new Error("pas de roundId: " + JSON.stringify(placed));
    expected -= MINES_BET;
    await checkBalance("mines place");

    // resume-after-refresh contract: the open round must be readable
    const st = await api("GET", "/api/bet/state?roundId=" + encodeURIComponent(placed.roundId));
    if (settledOf(st)) throw new Error("round deja settled avant le premier pick");

    let settled = false;
    let claimed = null;
    let safePicks = 0;
    const indices = [3, 7, 11, 16, 21]; // arbitrary distinct tiles
    for (const index of indices) {
      if (safePicks >= 3 || settled) break;
      const r = await api("POST", "/api/bet/act", {
        roundId: placed.roundId,
        action: "pick",
        payload: { index },
      });
      if (settledOf(r)) {
        settled = true; // hit a mine: stake already lost
        claimed = payoutOf(r) ?? 0;
      } else {
        safePicks++;
      }
      await sleep(150);
    }
    if (!settled) {
      const r = await api("POST", "/api/bet/act", { roundId: placed.roundId, action: "cashout" });
      claimed = payoutOf(r);
    }
    const got = await settleLedger("mines", claimed);
    record("mines", "OK", settled ? "mine touchee, perte " + sol(MINES_BET) : safePicks + " picks, retour " + sol(got));
  } catch (e) {
    record("mines", "FAIL", e.message);
    return finish();
  }

  /* 7) blackjack: hit below 17 when the state is readable, else stand. */
  try {
    let state = await api("POST", "/api/bet/place", {
      game: "blackjack",
      asset: "sol",
      amount: BJ_BET,
      params: {},
      clientRoundId: "e2e-" + runId + "-bj",
    });
    if (!state.roundId && !settledOf(state)) throw new Error("pas de roundId: " + JSON.stringify(state));
    const roundId = state.roundId;
    expected -= BJ_BET;
    await checkBalance("blackjack place");

    let actions = 0;
    while (!settledOf(state) && actions < 12) {
      const score = bjPlayerScore(state);
      const action = score !== null && score < 17 ? "hit" : "stand";
      state = await api("POST", "/api/bet/act", { roundId, action, payload: {} });
      actions++;
      await sleep(150);
    }
    if (!settledOf(state)) throw new Error("round toujours ouvert apres " + actions + " actions");

    const got = await settleLedger("blackjack", payoutOf(state));
    // with an even stake the only legal returns are integers
    const legal = [0, BJ_BET, BJ_BET * 2, (BJ_BET * 5) / 2];
    if (!legal.includes(got)) {
      throw new Error("retour blackjack " + got + " hors de " + JSON.stringify(legal));
    }
    const label = got === 0 ? "perdu" : got === BJ_BET ? "push" : got === BJ_BET * 2 ? "gagne" : "blackjack 3:2";
    record("blackjack", "OK", label + ", retour " + sol(got));
  } catch (e) {
    record("blackjack", "FAIL", e.message);
    return finish();
  }

  /* 8) crash: cash out after ~0.7s (about 1.08x); a round that has
     already crashed by then is a legitimate loss, not a test failure. */
  try {
    const placed = await api("POST", "/api/bet/place", {
      game: "crash",
      asset: "sol",
      amount: CRASH_BET,
      params: {},
      clientRoundId: "e2e-" + runId + "-crash",
    });
    if (!placed.roundId) throw new Error("pas de roundId: " + JSON.stringify(placed));
    expected -= CRASH_BET;
    await checkBalance("crash place");

    await sleep(700);
    let last = null;
    try {
      last = await api("POST", "/api/bet/act", { roundId: placed.roundId, action: "cashout", payload: {} });
    } catch {
      /* already crashed: fall through to resolve */
    }
    if (!last || !settledOf(last)) {
      last = await api("POST", "/api/bet/act", { roundId: placed.roundId, action: "resolve", payload: {} });
    }
    if (!settledOf(last)) throw new Error("round crash non regle: " + JSON.stringify(last));

    const got = await settleLedger("crash", payoutOf(last));
    if (got !== 0 && got < CRASH_BET) {
      // a cashout multiplier is always >= 1.00x, so a win returns >= stake
      throw new Error("retour crash " + got + " incoherent (mise " + CRASH_BET + ")");
    }
    record("crash", "OK", got > 0 ? "cashout, retour " + sol(got) : "crashe avant le cashout");
  } catch (e) {
    record("crash", "FAIL", e.message);
    return finish();
  }

  /* 9) withdrawal: ledger debit + a real signed transfer back to us. */
  try {
    const r = await api("POST", "/api/wallet/withdraw", {
      asset: "sol",
      amount: WITHDRAW_LAMPORTS,
      requestId: "e2e-" + runId + "-wd",
    });
    if (!r.signature) throw new Error("pas de signature: " + JSON.stringify(r));
    expected -= WITHDRAW_LAMPORTS;
    if (num(r.balance) !== null && r.balance !== expected) {
      throw new Error("balance retrait " + r.balance + " != " + expected);
    }
    await checkBalance("apres retrait");
    const confirmed = await waitForSignature(RPC, r.signature, 60_000);
    if (!confirmed) throw new Error("tx retrait non confirmee en 60s: " + r.signature);
    record("retrait 0.05 SOL", "OK", "tx " + r.signature.slice(0, 12) + "...");
  } catch (e) {
    record("retrait 0.05 SOL", "FAIL", e.message);
  }

  /* 10) final coherence */
  try {
    await checkBalance("solde final");
    record("coherence finale", "OK", "solde " + expected + " lamports (" + sol(expected) + ")");
  } catch (e) {
    record("coherence finale", "FAIL", e.message);
  }

  return finish();
}

/* --------------------------- recap table -------------------------- */

function finish() {
  const rows = [["#", "Etape", "Statut", "Detail"]];
  results.forEach((r, i) => rows.push([String(i + 1), r.step, r.status, r.note]));
  const widths = rows[0].map((_, c) => Math.max(...rows.map((row) => String(row[c]).length)));
  const line = (row) => row.map((cell, c) => String(cell).padEnd(widths[c])).join("  ");

  console.log("");
  console.log(line(rows[0]));
  console.log(widths.map((w) => "-".repeat(w)).join("  "));
  for (const row of rows.slice(1)) console.log(line(row));

  const fails = results.filter((r) => r.status === "FAIL").length;
  const skips = results.filter((r) => r.status === "SKIP").length;
  console.log("");
  console.log(
    fails === 0
      ? "RESULTAT : succes (" + results.length + " etapes, " + skips + " sautees)"
      : "RESULTAT : ECHEC — " + fails + " etape(s) en erreur"
  );
  process.exitCode = fails === 0 ? 0 : 1;
}

main().catch((err) => {
  console.error(err);
  record("erreur fatale", "FAIL", String(err && err.message));
  finish();
});
