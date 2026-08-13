/* Generates a fresh house wallet key pair for pepe.fail.
   Run once, locally: node tools/gen-wallet.mjs
   The output is printed only, never written to disk, so nothing sensitive
   can accidentally end up in the repository. */

import nacl from "tweetnacl";
import bs58 from "bs58";

const pair = nacl.sign.keyPair();
const address = bs58.encode(pair.publicKey);
const secret = bs58.encode(pair.secretKey);

console.log("");
console.log("pepe.fail house wallet");
console.log("======================");
console.log("");
console.log("Public address (VAULT_ADDRESS, optional):");
console.log("  " + address);
console.log("");
console.log("Secret key, 64 bytes base58 (HOUSE_WALLET_SECRET):");
console.log("  " + secret);
console.log("");
console.log("WARNING: whoever holds the secret key controls the house funds.");
console.log("  - NEVER commit it to git, NEVER paste it into client code.");
console.log("  - Store it only as the HOUSE_WALLET_SECRET environment variable");
console.log("    in the Vercel project settings (and a secure offline backup).");
console.log("  - On devnet, fund the address with: solana airdrop 2 " + address + " -u devnet");
console.log("");
