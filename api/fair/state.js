/* GET /api/fair/state — current provably-fair state for the caller.
   Never exposes the raw server seed, only its hash. */

import { ok, bad, methodGuard } from "../_lib/respond.js";
import { requireAuth } from "../_lib/auth.js";
import { state } from "../_lib/fair.js";

export default async function handler(req, res) {
  if (!methodGuard(req, res, "GET")) return;

  const addr = await requireAuth(req);
  if (!addr) return bad(res, 401, "unauthorized");

  return ok(res, await state(addr));
}
