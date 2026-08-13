/* POST /api/auth/challenge { address } -> { message, nonce }
   First half of the login flow: hand out a single-use message for the
   wallet to sign. The address is validated as a real 32-byte ed25519
   public key so garbage input never reaches the database. */

import bs58 from "bs58";
import { ok, bad, readBody, methodGuard } from "../../_lib/respond.js";
import { makeChallenge } from "../../_lib/auth.js";

export default async function handler(req, res) {
  if (!methodGuard(req, res, "POST")) return;

  /* Without SESSION_SECRET no token can ever be issued, so refuse early
     instead of letting the client sign a message for nothing. */
  if (!process.env.SESSION_SECRET) return bad(res, 503, "real mode disabled");

  try {
    const body = await readBody(req);
    const address = typeof body.address === "string" ? body.address.trim() : "";

    let pubkey = null;
    try {
      pubkey = bs58.decode(address);
    } catch (e) {
      pubkey = null;
    }
    if (!pubkey || pubkey.length !== 32) return bad(res, 400, "invalid address");

    ok(res, await makeChallenge(address));
  } catch (e) {
    bad(res, 500, "internal error");
  }
}
