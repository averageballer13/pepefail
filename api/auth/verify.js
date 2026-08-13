/* POST /api/auth/verify { address, nonce, signature } -> { token, expiresAt }
   Second half of the login flow: check the ed25519 signature against the
   stored nonce and mint a stateless session token. All failure paths are
   one generic 401 so a caller cannot probe which check tripped. */

import { ok, bad, readBody, methodGuard } from "../_lib/respond.js";
import { verifySignature } from "../_lib/auth.js";

export default async function handler(req, res) {
  if (!methodGuard(req, res, "POST")) return;
  if (!process.env.SESSION_SECRET) return bad(res, 503, "real mode disabled");

  try {
    const body = await readBody(req);
    const address = typeof body.address === "string" ? body.address.trim() : "";
    const nonce = typeof body.nonce === "string" ? body.nonce : "";
    const signature = typeof body.signature === "string" ? body.signature : "";
    if (!address || !nonce || !signature) return bad(res, 400, "missing fields");

    const token = await verifySignature(address, signature, nonce);
    if (!token) return bad(res, 401, "signature verification failed");

    /* The expiry lives inside the token payload; decode it back rather
       than duplicating TTL knowledge here. */
    let expiresAt = null;
    try {
      const payload = JSON.parse(
        Buffer.from(token.split(".")[0], "base64url").toString("utf8")
      );
      expiresAt = payload.e;
    } catch (e) {
      expiresAt = null;
    }

    ok(res, { token, expiresAt });
  } catch (e) {
    bad(res, 500, "internal error");
  }
}
