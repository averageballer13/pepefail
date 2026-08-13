// GET /api/wallet/balance
// Returns the player's off-chain balances. "fail" is always present in the
// payload (0 when the FAIL asset is not enabled) so the client never has to
// branch on a missing key.
import { ok, bad, methodGuard } from "../_lib/respond.js";
import { requireAuth } from "../_lib/auth.js";
import { getBalance } from "../_lib/db.js";

function realModeEnabled() {
  // Real mode stays off until both secrets are configured; demo mode is
  // untouched because the client only calls this endpoint in real mode.
  return Boolean(process.env.SESSION_SECRET && process.env.HOUSE_WALLET_SECRET);
}

export default async function handler(req, res) {
  if (!methodGuard(req, res, "GET")) return;
  if (!realModeEnabled()) return bad(res, 503, "disabled");

  const addr = await requireAuth(req);
  if (!addr) return bad(res, 401, "unauthorized");

  const sol = await getBalance(addr, "sol");
  // Only query the fail balance when the asset is active to avoid creating
  // useless keys for a disabled asset.
  const fail = process.env.FAIL_MINT ? await getBalance(addr, "fail") : 0;

  return ok(res, { sol, fail });
}
