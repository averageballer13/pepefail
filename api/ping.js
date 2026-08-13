/* Zero-dependency canary. If this answers, the runtime and the ESM setup
   are fine and any 500 elsewhere comes from imports or environment. */
export default async function handler(req, res) {
  let deps = {};
  for (const name of ["@solana/web3.js", "tweetnacl", "bs58"]) {
    try {
      await import(name);
      deps[name] = "ok";
    } catch (e) {
      deps[name] = String(e && e.message).slice(0, 120);
    }
  }
  let lib = {};
  for (const name of ["respond", "db", "auth", "rpc", "fair", "games"]) {
    try {
      await import("./_lib/" + name + ".js");
      lib[name] = "ok";
    } catch (e) {
      lib[name] = String(e && e.message).slice(0, 160);
    }
  }
  res.status(200).json({ node: process.version, deps, lib });
}
