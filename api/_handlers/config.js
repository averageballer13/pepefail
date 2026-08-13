/* GET /api/config
   Tells the client whether real mode is available and under which limits.
   This endpoint must NEVER 500: the client probes it on every page load
   and silently falls back to demo mode, so a misconfigured deployment has
   to answer { enabled: false } instead of erroring. */

import { ok, methodGuard } from "../_lib/respond.js";
import { network, vaultAddress } from "../_lib/rpc.js";

const FALLBACK = {
  enabled: false,
  network: "devnet",
  vault: null,
  assets: [{ k: "sol", decimals: 9 }],
  maxBet: 500000000,
  maxPayout: 5000000000,
  minWithdraw: 10000000,
};

function intEnv(name, fallback) {
  const n = Number.parseInt(process.env[name] || "", 10);
  return Number.isSafeInteger(n) && n > 0 ? n : fallback;
}

export default async function handler(req, res) {
  if (!methodGuard(req, res, "GET")) return;
  try {
    let vault = null;
    try {
      vault = vaultAddress();
    } catch (e) {
      vault = null;
    }

    /* Both secrets present AND a usable vault address: a present but
       malformed HOUSE_WALLET_SECRET means withdrawals would fail, so we
       report disabled rather than trap users with stuck funds. */
    const enabled = !!(process.env.SESSION_SECRET && process.env.HOUSE_WALLET_SECRET && vault);

    const assets = [{ k: "sol", decimals: 9 }];
    if (process.env.FAIL_MINT) {
      assets.push({ k: "fail", decimals: 6, mint: process.env.FAIL_MINT });
    }

    ok(res, {
      enabled,
      network: network(),
      vault,
      assets,
      /* Browser-side RPC (balance reads, one-click deposit sends). Set
         PUBLIC_RPC_URL to a domain-restricted key — NEVER the server's
         RPC_URL, which must stay secret. Unset, the client falls back
         to the public cluster endpoint. */
      rpcUrl: process.env.PUBLIC_RPC_URL || null,
      maxBet: intEnv("MAX_BET_LAMPORTS", FALLBACK.maxBet),
      maxPayout: intEnv("MAX_PAYOUT_LAMPORTS", FALLBACK.maxPayout),
      minWithdraw: intEnv("MIN_WITHDRAW_LAMPORTS", FALLBACK.minWithdraw),
    });
  } catch (e) {
    ok(res, FALLBACK);
  }
}
