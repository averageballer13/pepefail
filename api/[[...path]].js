/* ===================================================================
   pepe.fail — the single serverless function

   Vercel's Hobby plan allows 12 functions per deployment; this project
   needs more. One catch-all keeps every /api/* URL exactly as
   documented while counting as a single function.

   Route files live in api/_handlers/ (underscore directories are never
   treated as functions) and keep their original (req, res) signature.

   Handlers are imported lazily, per request, through literal dynamic
   imports: the bundler still traces them, but a module that fails to
   load turns into a readable JSON error for that route instead of
   killing the whole function at cold start.
   =================================================================== */

const ROUTES = {
  "ping": () => import("./_handlers/ping.js"),
  "config": () => import("./_handlers/config.js"),
  "auth/challenge": () => import("./_handlers/auth/challenge.js"),
  "auth/verify": () => import("./_handlers/auth/verify.js"),
  "fair/state": () => import("./_handlers/fair/state.js"),
  "fair/client-seed": () => import("./_handlers/fair/client-seed.js"),
  "fair/rotate": () => import("./_handlers/fair/rotate.js"),
  "bet/place": () => import("./_handlers/bet/place.js"),
  "bet/act": () => import("./_handlers/bet/act.js"),
  "bet/state": () => import("./_handlers/bet/state.js"),
  "wallet/balance": () => import("./_handlers/wallet/balance.js"),
  "wallet/deposit": () => import("./_handlers/wallet/deposit.js"),
  "wallet/withdraw": () => import("./_handlers/wallet/withdraw.js"),
};

export default async function handler(req, res) {
  /* /api/foo/bar -> "foo/bar", tolerant of trailing slashes. */
  const url = new URL(req.url || "/", "http://internal");
  const route = url.pathname.replace(/^\/api\/?/, "").replace(/\/+$/, "");

  const load = ROUTES[route];
  if (!load) {
    res.status(404).json({ error: "not found" });
    return;
  }

  let mod;
  try {
    mod = await load();
  } catch (e) {
    /* Surface the real import failure instead of an opaque 500: this is
       what turns "FUNCTION_INVOCATION_FAILED" into a fixable message. */
    res.status(500).json({
      error: "handler failed to load",
      route,
      message: String(e && e.message).slice(0, 300),
    });
    return;
  }

  return mod.default(req, res);
}
