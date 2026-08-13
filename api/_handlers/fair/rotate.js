/* POST /api/fair/rotate — reveal the current server seed and start a
   fresh pair. Revealing ends the seed's life: every draw made under
   it can now be verified by the player. */

import { ok, bad, methodGuard } from "../../_lib/respond.js";
import { requireAuth } from "../../_lib/auth.js";
import { rotate } from "../../_lib/fair.js";

export default async function handler(req, res) {
  if (!methodGuard(req, res, "POST")) return;

  const addr = await requireAuth(req);
  if (!addr) return bad(res, 401, "unauthorized");

  return ok(res, await rotate(addr));
}
