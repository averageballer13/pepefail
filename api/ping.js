/* Zero-dependency canary: no imports at all, so if this answers, the
   Node runtime and the ESM setup are fine and any 500 elsewhere comes
   from a specific module, not the platform. */
export default function handler(req, res) {
  res.status(200).json({
    ok: true,
    node: process.version,
    hasSession: !!process.env.SESSION_SECRET,
    hasHouse: !!process.env.HOUSE_WALLET_SECRET,
    hasUpstash: !!process.env.UPSTASH_REDIS_REST_URL,
  });
}
