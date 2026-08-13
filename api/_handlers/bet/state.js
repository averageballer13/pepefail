/* ===================================================================
   pepe.fail — GET /api/bet/state?roundId=...

   Read-only view of a round so the client can resume after a refresh.
   Open rounds are sanitized: mine layout, crash point and the dealer
   hole card never appear before settlement. Settled rounds return the
   full stored result.
   =================================================================== */

import { ok, bad, methodGuard } from "../../_lib/respond.js";
import * as db from "../../_lib/db.js";
import { requireAuth } from "../../_lib/auth.js";
import * as games from "../../_lib/games.js";

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

function queryRoundId(req) {
  if (req.query && typeof req.query.roundId === "string") return req.query.roundId;
  try {
    const u = new URL(req.url, "http://local");
    return u.searchParams.get("roundId") || "";
  } catch (e) {
    return "";
  }
}

export default async function handler(req, res) {
  if (!methodGuard(req, res, "GET")) return;

  if (!process.env.SESSION_SECRET || !process.env.HOUSE_WALLET_SECRET) {
    return bad(res, 503, "real mode disabled");
  }

  const addr = await requireAuth(req);
  if (!addr) return bad(res, 401, "unauthorized");
  if (await rateLimited(addr)) return bad(res, 429, "rate limited");

  const roundId = queryRoundId(req);
  if (!roundId) return bad(res, 400, "missing roundId");

  const round = await db.get("round:" + roundId);
  /* Same 404 whether the round is missing or someone else's: do not
     leak the existence of other players' rounds. */
  if (!round || round.addr !== addr) return bad(res, 404, "round not found");

  const d = round.data || {};
  const base = {
    roundId: round.id,
    game: round.game,
    phase: round.state,
    asset: round.asset,
    amount: round.amount,
  };

  if (round.state === "settled") {
    return ok(res, { settled: true, ...base, ...(d.result || {}), fair: d.fair });
  }

  const pub = { serverSeedHash: d.fair && d.fair.serverSeedHash };

  if (round.game === "mines") {
    const picked = d.picks ? d.picks.length : 0;
    return ok(res, {
      ...base,
      mineCount: d.mineCount,
      picks: d.picks || [],
      mult: picked > 0 ? games.minesMult(picked, d.mineCount) : 0,
      nextMult: games.minesMult(picked + 1, d.mineCount),
      fair: pub,
    });
  }

  if (round.game === "crash") {
    return ok(res, {
      ...base,
      startedAt: d.startedAt,
      auto: d.auto,
      fair: pub,
    });
  }

  if (round.game === "blackjack") {
    return ok(res, {
      ...base,
      player: d.player,
      dealerUp: d.dealer && d.dealer[0],
      playerScore: handScore(d.player || []),
      dealerUpScore: d.dealer && d.dealer.length ? handScore([d.dealer[0]]) : 0,
      canDouble: !!(d.player && d.player.length === 2 && !d.doubled),
      doubled: !!d.doubled,
      fair: pub,
    });
  }

  /* One-shot rounds only exist in the settled state handled above. */
  return ok(res, base);
}
