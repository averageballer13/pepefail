/* ===================================================================
   pepe.fail — POST /api/bet/place

   Debits the stake, draws provably-fair floats and either settles the
   round immediately (dice, limbo, wheel, plinko) or opens a multi-step
   round (mines, crash, blackjack) whose hidden information never
   leaves the server before settlement.

   All amounts are integers (lamports for SOL, raw units for FAIL).
   =================================================================== */

import { ok, bad, readBody, methodGuard } from "../../_lib/respond.js";
import * as db from "../../_lib/db.js";
import { requireAuth } from "../../_lib/auth.js";
import * as fair from "../../_lib/fair.js";
import * as games from "../../_lib/games.js";

/* Must match the client HOUSE_EDGE = 0.01 in assets/js/engine.js. */
const RTP = 0.99;

/* One source of truth for the wheel: the table lives in games.js, so
   validation here can never drift from the outcome math. */
const WHEEL_TABLE = games.WHEEL_TABLE;
const PLINKO_MAX = {
  8: { Low: 5.6, Medium: 13, High: 29 },
  12: { Low: 10, Medium: 33, High: 170 },
  16: { Low: 16, Medium: 110, High: 1000 },
};
const MINES_ALLOWED = [1, 3, 5, 10, 24];
const ROWS_ALLOWED = [8, 12, 16];
const GAME_KEYS = ["dice", "limbo", "wheel", "plinko", "mines", "crash", "blackjack"];
const MULTI_STEP = { mines: true, crash: true, blackjack: true };

/* Floats needed per game: enough for the whole hidden layout so the
   fair nonce is consumed exactly once per round. */
const FLOAT_COUNT = { dice: 1, limbo: 1, wheel: 1, crash: 1, plinko: 0, mines: 25, blackjack: 312 };

function envInt(name, def) {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v > 0 ? Math.floor(v) : def;
}

/* Integer money math: amount (int) times a multiplier in cents (int).
   BigInt so an extreme multiplier can never lose precision. */
function payoutInt(amount, multCents) {
  return Number((BigInt(amount) * BigInt(multCents)) / 100n);
}

/* 30 requests / 10s per address across bet endpoints. setnx re-arms
   the TTL when the key has expired, so the window cannot get stuck. */
async function rateLimited(addr) {
  const key = "rate:" + addr;
  await db.setnx(key, 0, 10);
  const n = await db.incrBy(key, 1);
  return n > 30;
}

/* respond.bad only carries a message; the 409 needs to carry the open
   roundId so the client can resume it, hence a direct JSON write. */
function json(res, status, data) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(data));
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

function isBlackjackHand(hand) {
  return hand.length === 2 && handScore(hand) === 21;
}

/* View of an existing round, used when the same clientRoundId is
   retried after a network drop: the retry gets the same answer. */
function roundView(round) {
  const d = round.data || {};
  const base = { roundId: round.id, game: round.game, phase: round.state };
  if (round.state === "settled") {
    return { settled: true, ...base, ...(d.result || {}), fair: d.fair };
  }
  const pub = { serverSeedHash: d.fair && d.fair.serverSeedHash };
  if (round.game === "mines") {
    return { ...base, settled: false, mineCount: d.mineCount, picks: d.picks, fair: pub };
  }
  if (round.game === "crash") {
    return { ...base, settled: false, startedAt: d.startedAt, auto: d.auto, fair: pub };
  }
  return {
    ...base,
    settled: false,
    player: d.player,
    dealer: d.dealer ? [d.dealer[0]] : [],
    dealerUp: d.dealer && d.dealer[0],
    playerScore: handScore(d.player || []),
    dealerUpScore: d.dealer ? handScore([d.dealer[0]]) : 0,
    canDouble: !!(d.player && d.player.length === 2 && !d.doubled),
    fair: pub,
  };
}

export default async function handler(req, res) {
  if (!methodGuard(req, res, "POST")) return;

  /* Real mode is off until the secrets exist; the site stays demo-only. */
  if (!process.env.SESSION_SECRET || !process.env.HOUSE_WALLET_SECRET) {
    return bad(res, 503, "real mode disabled");
  }

  const addr = await requireAuth(req);
  if (!addr) return bad(res, 401, "unauthorized");
  if (await rateLimited(addr)) return bad(res, 429, "rate limited");

  let body;
  try { body = await readBody(req); } catch (e) { return bad(res, 400, "invalid body"); }
  if (!body || typeof body !== "object") return bad(res, 400, "invalid body");

  const game = body.game;
  const asset = body.asset || "sol";
  const amount = body.amount;
  const params = body.params && typeof body.params === "object" ? body.params : {};
  const roundId = body.clientRoundId;

  if (GAME_KEYS.indexOf(game) === -1) return bad(res, 400, "unknown game");
  if (asset !== "sol" && !(asset === "fail" && process.env.FAIL_MINT)) {
    return bad(res, 400, "unknown asset");
  }
  /* The client id doubles as the idempotency key, so its shape matters. */
  if (typeof roundId !== "string" || !/^[A-Za-z0-9_-]{8,64}$/.test(roundId)) {
    return bad(res, 400, "invalid clientRoundId");
  }

  const maxBet = envInt("MAX_BET_LAMPORTS", 500000000);
  const maxPayout = envInt("MAX_PAYOUT_LAMPORTS", 5000000000);
  if (!Number.isSafeInteger(amount) || amount <= 0 || amount > maxBet) {
    return bad(res, 400, "invalid amount");
  }

  /* ---- per-game params + the highest multiplier the round can pay.
     maxMultCents === null means the game has no finite ceiling (crash
     without auto); its payout is capped at settlement instead. ---- */
  let p = {};
  let maxMultCents = null;

  if (game === "dice") {
    const chance = Number(params.chance);
    /* The client sends lowercase ("under"/"over"); accept any casing. */
    const dirRaw = String(params.dir || "").toLowerCase();
    if (!Number.isFinite(chance) || chance < 2 || chance > 98) return bad(res, 400, "chance out of range");
    if (dirRaw !== "under" && dirRaw !== "over") return bad(res, 400, "invalid dir");
    const dir = dirRaw === "under" ? "Under" : "Over";
    p = { chance, dir };
    maxMultCents = Math.round((RTP / (chance / 100)) * 100);
  } else if (game === "limbo") {
    const target = Number(params.target);
    if (!Number.isFinite(target) || target < 1.01 || target > 1000000) return bad(res, 400, "target out of range");
    p = { target };
    maxMultCents = Math.round(target * 100);
  } else if (game === "wheel") {
    if (!WHEEL_TABLE[params.risk]) return bad(res, 400, "invalid risk");
    p = { risk: params.risk };
    maxMultCents = Math.round(Math.max.apply(null, WHEEL_TABLE[p.risk]) * 100);
  } else if (game === "plinko") {
    const rows = Number(params.rows);
    if (ROWS_ALLOWED.indexOf(rows) === -1) return bad(res, 400, "invalid rows");
    if (!PLINKO_MAX[rows][params.risk]) return bad(res, 400, "invalid risk");
    p = { risk: params.risk, rows };
    maxMultCents = Math.round(PLINKO_MAX[rows][p.risk] * 100);
  } else if (game === "mines") {
    const mines = Number(params.mines);
    if (MINES_ALLOWED.indexOf(mines) === -1) return bad(res, 400, "invalid mines");
    p = { mines };
    /* No place-time ceiling: the full-clear multiplier is theoretical
       (2277x at 3 mines) and would reject any normal stake. Like crash,
       the payout is clamped to MAX_PAYOUT at settlement in act.js. */
    maxMultCents = null;
  } else if (game === "crash") {
    let auto = null;
    if (params.auto !== undefined && params.auto !== null && params.auto !== "") {
      auto = Number(params.auto);
      if (!Number.isFinite(auto) || auto < 1.01 || auto > 1000000) return bad(res, 400, "auto out of range");
    }
    p = { auto };
    maxMultCents = auto ? Math.round(auto * 100) : null;
  } else if (game === "blackjack") {
    /* Worst case return: winning after a double pays 4x the initial bet. */
    maxMultCents = 400;
  }

  if (maxMultCents !== null && payoutInt(amount, maxMultCents) > maxPayout) {
    return bad(res, 400, "potential payout exceeds max");
  }

  /* ---- one open round per (addr, game) for multi-step games ---- */
  const openKey = "open:" + addr + ":" + game;
  if (MULTI_STEP[game]) {
    const existing = await db.get(openKey);
    if (existing && existing !== roundId) {
      return json(res, 409, { error: "round_open", roundId: existing });
    }
    if (!existing) {
      const claimed = await db.setnx(openKey, roundId);
      if (!claimed) {
        const other = await db.get(openKey);
        return json(res, 409, { error: "round_open", roundId: other });
      }
    }
  }

  /* ---- debit the stake, idempotent on clientRoundId ---- */
  const deb = await db.debitIfEnough(addr, asset, amount, roundId);
  if (!deb.ok) {
    if (deb.code === "duplicate") {
      const prev = await db.get("round:" + roundId);
      if (prev && prev.addr === addr) return ok(res, roundView(prev));
      return bad(res, 409, "duplicate clientRoundId");
    }
    if (MULTI_STEP[game]) { try { await db.del(openKey); } catch (e) {} }
    return bad(res, 400, "insufficient balance");
  }

  /* From here on the stake is held: any unexpected failure refunds it. */
  try {
    const fs = await fair.state(addr);
    const need = game === "plinko" ? p.rows : FLOAT_COUNT[game];
    const drawn = await fair.draw(addr, need);
    const floats = drawn.floats;
    const fairInfo = { serverSeedHash: fs.serverSeedHash, nonce: drawn.nonce };
    const createdAt = Date.now();

    /* =============== one-shot games: settle right now =============== */
    if (!MULTI_STEP[game]) {
      let outcome;
      let won;
      let multCents = 0;

      if (game === "dice") {
        const r = games.dice(floats, p) || {};
        const roll = Number.isFinite(r.roll) ? r.roll : Math.floor(floats[0] * 10000) / 100;
        const t = p.dir === "Under" ? p.chance : 100 - p.chance;
        won = typeof r.won === "boolean" ? r.won : (p.dir === "Under" ? roll < t : roll > t);
        if (won) multCents = Math.round((RTP / (p.chance / 100)) * 100);
        outcome = { roll, threshold: t, dir: p.dir, mult: multCents / 100 };
      } else if (game === "limbo") {
        const r = games.limbo(floats, p) || {};
        let drawv = Number.isFinite(r.draw) ? r.draw : r.result;
        if (!Number.isFinite(drawv)) {
          drawv = Math.max(1, Math.floor((RTP / Math.max(floats[0], 1e-9)) * 100) / 100);
        }
        won = typeof r.won === "boolean" ? r.won : drawv >= p.target;
        if (won) multCents = Math.round(p.target * 100);
        outcome = { draw: drawv, target: p.target, mult: multCents / 100 };
      } else if (game === "wheel") {
        const r = games.wheel(floats, p) || {};
        const table = WHEEL_TABLE[p.risk];
        let idx = Number.isInteger(r.idx) ? r.idx : r.index;
        if (!Number.isInteger(idx)) idx = Math.floor(floats[0] * table.length);
        const mult = Number.isFinite(r.mult) ? r.mult : table[idx];
        won = mult >= 1;
        multCents = Math.round(mult * 100);
        outcome = { idx, mult };
      } else {
        /* plinko: games.js contract guarantees {path, bucket, mult} */
        const r = games.plinko(floats, p);
        const mult = Number(r.mult) || 0;
        won = mult >= 1;
        multCents = Math.round(mult * 100);
        outcome = { path: r.path, bucket: r.bucket, mult };
      }

      /* Wheel and plinko can return a fraction of the stake (mult < 1),
         which is still a credit even though the round counts as lost. */
      const payout = multCents > 0 ? payoutInt(amount, multCents) : 0;
      let balance;
      if (payout > 0) {
        const cr = await db.credit(addr, asset, payout, roundId + ":win");
        balance = cr && cr.ok ? cr.balance : await db.getBalance(addr, asset);
      } else {
        balance = await db.getBalance(addr, asset);
      }

      const round = {
        id: roundId, addr, game, asset, amount,
        state: "settled",
        data: { params: p, fair: fairInfo, result: { won, payout, outcome } },
        createdAt,
      };
      /* Kept a day so a retried clientRoundId gets the same answer. */
      await db.set("round:" + roundId, round, 86400);

      return ok(res, { settled: true, roundId, game, outcome, won, payout, balance, fair: fairInfo });
    }

    /* =============== multi-step games: open a round ===============
       The hidden information (mine layout, crash point, hole card)
       stays inside round.data and never appears in the response. */
    let data;
    let view;

    if (game === "mines") {
      const layout = games.minesLayout(floats, p.mines);
      data = { mineCount: p.mines, mines: layout, picks: [], fair: fairInfo };
      view = {
        roundId, game, phase: "open", settled: false,
        mineCount: p.mines, picks: [],
        fair: { serverSeedHash: fairInfo.serverSeedHash },
      };
    } else if (game === "crash") {
      const crashAt = games.crashPoint(floats[0]);
      data = { crashAt, startedAt: createdAt, auto: p.auto, fair: fairInfo };
      view = {
        roundId, game, phase: "open", settled: false,
        startedAt: createdAt, auto: p.auto,
        fair: { serverSeedHash: fairInfo.serverSeedHash },
      };
    } else {
      /* blackjack: deal order mirrors the client (P, D, P, D). */
      const shoe = games.shoeFromFloats(floats);
      let idx = 0;
      const player = [];
      const dealer = [];
      player.push(shoe[idx++]); dealer.push(shoe[idx++]);
      player.push(shoe[idx++]); dealer.push(shoe[idx++]);
      data = { shoe, idx, player, dealer, stake: amount, doubled: false, fair: fairInfo };

      const pBJ = isBlackjackHand(player);
      const dBJ = isBlackjackHand(dealer);
      if (pBJ || dBJ) {
        /* A natural on either side ends the round immediately, like the
           client does; blackjack pays 3:2 on the stake. */
        let payout = 0;
        let won = false;
        let label;
        if (pBJ && dBJ) { payout = amount; label = "Push"; }
        else if (pBJ) { payout = amount + Math.floor((amount * 3) / 2); won = true; label = "Blackjack pays 3:2"; }
        else { label = "Dealer blackjack"; }

        let balance;
        if (payout > 0) {
          const cr = await db.credit(addr, asset, payout, roundId + ":win");
          balance = cr && cr.ok ? cr.balance : await db.getBalance(addr, asset);
        } else {
          balance = await db.getBalance(addr, asset);
        }

        const result = {
          won, payout, label, player, dealer,
          playerScore: handScore(player), dealerScore: handScore(dealer),
          doubled: false, stake: amount,
        };
        const round = {
          id: roundId, addr, game, asset, amount,
          state: "settled",
          data: { ...data, result },
          createdAt,
        };
        await db.set("round:" + roundId, round, 86400);
        await db.del(openKey);
        return ok(res, { settled: true, roundId, game, phase: "settled", ...result, balance, fair: fairInfo });
      }

      view = {
        roundId, game, phase: "open", settled: false,
        player,
        /* both namings: the client contract reads dealer[] (up card
           only), older callers read dealerUp */
        dealer: [dealer[0]],
        dealerUp: dealer[0],
        playerScore: handScore(player),
        dealerUpScore: handScore([dealer[0]]),
        canDouble: true,
        fair: { serverSeedHash: fairInfo.serverSeedHash },
      };
    }

    const round = { id: roundId, addr, game, asset, amount, state: "open", data, createdAt };
    await db.set("round:" + roundId, round);
    return ok(res, view);
  } catch (e) {
    /* Never keep the stake on an internal failure. */
    try { await db.credit(addr, asset, amount, roundId + ":refund"); } catch (e2) {}
    try { if (MULTI_STEP[game]) await db.del(openKey); } catch (e3) {}
    return bad(res, 500, "bet failed");
  }
}
