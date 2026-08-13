/* ===================================================================
   pepe.fail — the single serverless function

   Vercel's Hobby plan allows 12 functions per deployment; this project
   needs 13 routes and will grow. One catch-all keeps every /api/* URL
   exactly as documented while counting as a single function, and cold
   starts get cheaper as a bonus: one bundle instead of thirteen.

   Route files live in api/_handlers/ (underscore directories are never
   treated as functions) and keep their original (req, res) signature,
   so nothing else in the codebase knows this router exists.
   =================================================================== */

import ping from "./_handlers/ping.js";
import config from "./_handlers/config.js";
import authChallenge from "./_handlers/auth/challenge.js";
import authVerify from "./_handlers/auth/verify.js";
import fairState from "./_handlers/fair/state.js";
import fairClientSeed from "./_handlers/fair/client-seed.js";
import fairRotate from "./_handlers/fair/rotate.js";
import betPlace from "./_handlers/bet/place.js";
import betAct from "./_handlers/bet/act.js";
import betState from "./_handlers/bet/state.js";
import walletBalance from "./_handlers/wallet/balance.js";
import walletDeposit from "./_handlers/wallet/deposit.js";
import walletWithdraw from "./_handlers/wallet/withdraw.js";

const ROUTES = {
  "ping": ping,
  "config": config,
  "auth/challenge": authChallenge,
  "auth/verify": authVerify,
  "fair/state": fairState,
  "fair/client-seed": fairClientSeed,
  "fair/rotate": fairRotate,
  "bet/place": betPlace,
  "bet/act": betAct,
  "bet/state": betState,
  "wallet/balance": walletBalance,
  "wallet/deposit": walletDeposit,
  "wallet/withdraw": walletWithdraw,
};

export default async function handler(req, res) {
  /* /api/foo/bar -> "foo/bar", tolerant of trailing slashes. */
  const url = new URL(req.url || "/", "http://internal");
  const route = url.pathname.replace(/^\/api\/?/, "").replace(/\/+$/, "");

  const h = ROUTES[route];
  if (!h) {
    res.status(404).json({ error: "not found" });
    return;
  }
  return h(req, res);
}
