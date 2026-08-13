/* ===================================================================
   pepe.fail — POST /api/bet/act

   Advances an open multi-step round (mines, crash, blackjack). Hidden
   information (mine layout, crash point, hole card) is revealed only
   in the settlement response. Acting on a settled round replays the
   stored result, so a retried request cannot pay twice.

   All amounts are integers (lamports for SOL, raw units for FAIL).
   =================================================================== */

import { ok, bad, readBody, methodGuard } from "../../_lib/respond.js";
import * as db from "../../_lib/db.js";
import { requireAuth } from "../../_lib/auth.js";
import * as games from "../../_lib/games.js";

function envInt(name, def) {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v > 0 ? Math.floor(v) : def;
}

/* Integer money math, see place.js for the rationale. */
function payoutInt(amount, multCents) {
  return Number((BigInt(amount) * BigInt(multCents)) / 100n);
}

async function rateLimited(addr) {
  const key = "rate:" + addr;
  await db.setnx(key, 0, 10);
  const n = await db.incrBy(key, 1);
  return n > 30;
}

/* ---- blackjack scoring, tolerant to the card shape games.js uses ---- */
function rankOf(c) {
  if (typeof c === "string") return c.replace(/[^0-9AJQKajqk]/g, "").toUpperCase();
  return String((c && (c.r || c.rank)) || "");
}

function handScore(hand) {
  if (typeof games.score === "function") return games.score(hand);
  let total = 0;
  let aces = 0;
  for (const c of hand) {
    const r = rankOf(c);
    if (r === "A") { aces++; total += 11; }
    else if (r === "J" || r === "Q" || r === "K" || r === "10") total += 10;
    else total += parseInt(r, 10) || 0;
  }
  while (total > 21 && aces > 0) { total -= 10; aces--; }
  return total;
}

/* Soft if an ace still counts as 11 once busts are resolved. Local on
   purpose: only score() is a guaranteed games.js export. */
function isSoftHand(hand) {
  let total = 0;
  let aces = 0;
  for (const c of hand) {
    const r = rankOf(c);
    if (r === "A") { aces++; total += 11; }
    else if (r === "J" || r === "Q" || r === "K" || r === "10") total += 10;
    else total += parseInt(r, 10) || 0;
  }
  while (total > 21 && aces > 0) { total -= 10; aces--; }
  return aces > 0;
}

/* Credits the return, closes the round and frees the open slot. The
   returned object is the settlement response body. */
async function settleRound(round, payout, result) {
  let balance;
  if (payout > 0) {
    const cr = await db.credit(round.addr, round.asset, payout, round.id + ":win");
    balance = cr && cr.ok ? cr.balance : await db.getBalance(round.addr, round.asset);
  } else {
    balance = await db.getBalance(round.addr, round.asset);
  }
  round.state = "settled";
  round.data.result = { ...result, payout };
  /* Kept a day so late retries still see the settled result. */
  await db.set("round:" + round.id, round, 86400);
  await db.del("open:" + round.addr + ":" + round.game);
  return {
    settled: true,
    roundId: round.id,
    game: round.game,
    phase: "settled",
    ...result,
    payout,
    balance,
    fair: round.data.fair,
  };
}

function bjOpenView(round) {
  const d = round.data;
  return {
    roundId: round.id,
    game: "blackjack",
    phase: "open",
    settled: false,
    player: d.player,
    /* both namings: the client contract reads dealer[] (up card only),
       older callers read dealerUp */
    dealer: [d.dealer[0]],
    dealerUp: d.dealer[0],
    playerScore: handScore(d.player),
    dealerUpScore: handScore([d.dealer[0]]),
    canDouble: !d.doubled && d.player.length === 2,
    fair: { serverSeedHash: d.fair && d.fair.serverSeedHash },
  };
}

/* =========================== MINES =========================== */
async function actMines(res, round, action, payload, maxPayout) {
  const d = round.data;

  if (action === "pick") {
    const index = Number(payload.index);
    if (!Number.isInteger(index) || index < 0 || index > 24) return bad(res, 400, "invalid index");
    if (d.picks.indexOf(index) !== -1) return bad(res, 400, "tile already picked");

    if (d.mines.indexOf(index) !== -1) {
      /* Mine hit: the round is over, the layout can be revealed. The
         client keys on result === "mine". */
      const out = await settleRound(round, 0, {
        result: "mine", won: false, mult: 0, hit: index,
        picks: d.picks, mines: d.mines, mineCount: d.mineCount,
      });
      return ok(res, out);
    }

    d.picks.push(index);
    const mult = games.minesMult(d.picks.length, d.mineCount);

    if (d.picks.length === 25 - d.mineCount) {
      /* Board cleared: auto cashout, same as the client. */
      const payout = Math.min(payoutInt(round.amount, Math.round(mult * 100)), maxPayout);
      const out = await settleRound(round, payout, {
        result: "gem", won: true, mult,
        picks: d.picks, mines: d.mines, mineCount: d.mineCount,
      });
      return ok(res, out);
    }

    await db.set("round:" + round.id, round);
    return ok(res, {
      roundId: round.id, game: "mines", phase: "open", settled: false,
      result: "gem",
      picks: d.picks,
      mult,
      nextMult: games.minesMult(d.picks.length + 1, d.mineCount),
    });
  }

  if (action === "cashout") {
    if (d.picks.length === 0) return bad(res, 400, "nothing to cash out");
    const mult = games.minesMult(d.picks.length, d.mineCount);
    const payout = Math.min(payoutInt(round.amount, Math.round(mult * 100)), maxPayout);
    const out = await settleRound(round, payout, {
      won: true, mult,
      picks: d.picks, mines: d.mines, mineCount: d.mineCount,
    });
    return ok(res, out);
  }

  return bad(res, 400, "unknown action");
}

/* =========================== CRASH =========================== */
async function payCrash(round, mult, maxPayout) {
  const cents = Math.round(mult * 100);
  /* Crash has no finite ceiling at place time, so the payout cap is
     enforced here instead. */
  const payout = Math.min(payoutInt(round.amount, cents), maxPayout);
  return settleRound(round, payout, { won: true, mult: cents / 100, crashAt: round.data.crashAt });
}

async function actCrash(res, round, action, maxPayout) {
  const d = round.data;
  const t = (Date.now() - d.startedAt) / 1000;
  /* Same curve as the client: m(t) = e^(0.11 t (1 + 0.06 t)). */
  const m = Math.max(1, Math.exp(0.11 * t * (1 + 0.06 * t)));
  const autoHit = d.auto && d.auto < d.crashAt && m >= d.auto;

  if (action === "cashout") {
    let out;
    if (autoHit) {
      /* The auto fired before the crash: pay the auto no matter when
         the request lands, so network latency never hurts the player. */
      out = await payCrash(round, d.auto, maxPayout);
    } else if (m < d.crashAt) {
      out = await payCrash(round, Math.floor(m * 100) / 100, maxPayout);
    } else {
      out = await settleRound(round, 0, { won: false, mult: 0, crashAt: d.crashAt });
    }
    return ok(res, out);
  }

  if (action === "resolve") {
    if (autoHit) return ok(res, await payCrash(round, d.auto, maxPayout));
    if (m >= d.crashAt) {
      return ok(res, await settleRound(round, 0, { won: false, mult: 0, crashAt: d.crashAt }));
    }
    /* Still flying and no auto reached: nothing to settle yet. The
       crash point stays hidden. */
    return ok(res, { roundId: round.id, game: "crash", phase: "open", settled: false, startedAt: d.startedAt, auto: d.auto });
  }

  return bad(res, 400, "unknown action");
}

/* ========================== BLACKJACK ========================== */
async function finishBlackjack(round) {
  const d = round.data;
  const p = handScore(d.player);

  if (p <= 21) {
    /* Dealer draws to 17 and stands on every 17 including soft (S17),
       matching the rule printed on the game page. */
    while (handScore(d.dealer) < 17) {
      d.dealer.push(d.shoe[d.idx++]);
    }
  }

  const dl = handScore(d.dealer);
  const stake = d.stake;
  /* Naturals settle at place time, so pBJ/dBJ are defensive only. */
  const pBJ = d.player.length === 2 && p === 21 && !d.doubled;
  const dBJ = d.dealer.length === 2 && dl === 21;

  let payout = 0;
  let won = false;
  let label;
  if (p > 21) { label = "Bust"; }
  else if (pBJ && !dBJ) { payout = stake + Math.floor((stake * 3) / 2); won = true; label = "Blackjack pays 3:2"; }
  else if (dBJ && !pBJ) { label = "Dealer blackjack"; }
  else if (pBJ && dBJ) { payout = stake; label = "Push"; }
  else if (dl > 21) { payout = stake * 2; won = true; label = "Dealer busts"; }
  else if (p > dl) { payout = stake * 2; won = true; label = "You win"; }
  else if (p < dl) { label = "Dealer wins"; }
  else { payout = stake; label = "Push"; }

  return settleRound(round, payout, {
    won, label,
    player: d.player, dealer: d.dealer,
    playerScore: p, dealerScore: dl,
    doubled: d.doubled, stake,
  });
}

async function actBlackjack(res, round, action, addr) {
  const d = round.data;

  if (action === "hit") {
    d.player.push(d.shoe[d.idx++]);
    if (handScore(d.player) > 21) return ok(res, await finishBlackjack(round));
    await db.set("round:" + round.id, round);
    return ok(res, bjOpenView(round));
  }

  if (action === "double") {
    if (d.doubled || d.player.length !== 2) return bad(res, 400, "cannot double now");
    /* Doubling is a second wager: it needs its own idempotent debit. */
    const deb = await db.debitIfEnough(addr, round.asset, round.amount, round.id + ":double");
    if (!deb.ok && deb.code !== "duplicate") return bad(res, 400, "insufficient balance");
    d.doubled = true;
    d.stake = round.amount * 2;
    d.player.push(d.shoe[d.idx++]);
    return ok(res, await finishBlackjack(round));
  }

  if (action === "stand") {
    return ok(res, await finishBlackjack(round));
  }

  return bad(res, 400, "unknown action");
}

/* ============================ HANDLER ============================ */
export default async function handler(req, res) {
  if (!methodGuard(req, res, "POST")) return;

  if (!process.env.SESSION_SECRET || !process.env.HOUSE_WALLET_SECRET) {
    return bad(res, 503, "real mode disabled");
  }

  const addr = await requireAuth(req);
  if (!addr) return bad(res, 401, "unauthorized");
  if (await rateLimited(addr)) return bad(res, 429, "rate limited");

  let body;
  try { body = await readBody(req); } catch (e) { return bad(res, 400, "invalid body"); }
  if (!body || typeof body !== "object") return bad(res, 400, "invalid body");

  const roundId = body.roundId;
  const action = body.action;
  const payload = body.payload && typeof body.payload === "object" ? body.payload : {};
  if (typeof roundId !== "string" || !roundId) return bad(res, 400, "missing roundId");
  if (typeof action !== "string" || !action) return bad(res, 400, "missing action");

  const round = await db.get("round:" + roundId);
  /* Same 404 whether the round is missing or someone else's: do not
     leak the existence of other players' rounds. */
  if (!round || round.addr !== addr) return bad(res, 404, "round not found");

  if (round.state === "settled") {
    const d = round.data || {};
    return ok(res, {
      settled: true, roundId: round.id, game: round.game, phase: "settled",
      ...(d.result || {}),
      fair: d.fair,
    });
  }

  const maxPayout = envInt("MAX_PAYOUT_LAMPORTS", 5000000000);

  try {
    if (round.game === "mines") return await actMines(res, round, action, payload, maxPayout);
    if (round.game === "crash") return await actCrash(res, round, action, maxPayout);
    if (round.game === "blackjack") return await actBlackjack(res, round, action, addr);
    return bad(res, 400, "round is not multi-step");
  } catch (e) {
    /* The round record is untouched on failure; the client can resume
       through GET /api/bet/state. */
    return bad(res, 500, "action failed");
  }
}
