/* POST /api/fair/client-seed — let the player pick their half of the
   randomness. Bounded to 64 chars because the seed is hashed into
   every draw and stored verbatim. */

import { ok, bad, readBody, methodGuard } from "../_lib/respond.js";
import { requireAuth } from "../_lib/auth.js";
import { setClientSeed } from "../_lib/fair.js";

export default async function handler(req, res) {
  if (!methodGuard(req, res, "POST")) return;

  const addr = await requireAuth(req);
  if (!addr) return bad(res, 401, "unauthorized");

  const body = await readBody(req);
  const seed = body && typeof body.seed === "string" ? body.seed.trim() : "";
  if (seed.length < 1 || seed.length > 64) {
    return bad(res, 400, "seed must be 1-64 characters");
  }

  const out = await setClientSeed(addr, seed);
  if (!out) return bad(res, 400, "invalid seed");

  return ok(res, out);
}
