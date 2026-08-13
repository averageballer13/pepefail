/* ===================================================================
   pepe.fail — pure game maths, server side.

   Every function here is an EXACT mirror of the client code in
   assets/js/game-page.js and assets/js/blackjack.js. The server is
   the authority on outcomes; the client only animates them, so any
   divergence would show the player a result different from what is
   paid. Keep both sides in lockstep when editing.

   No db, no network: floats in, results out. Floats come from
   fair.draw() and are uniform in [0,1).

   Floats consumed per game:
     dice 1, limbo 1, wheel 1, crash 1,
     plinko `rows`, mines 24 (shuffle of 25 tiles),
     blackjack shoe 311 (shuffle of 312 cards).
   =================================================================== */

// Same knob as client engine.js: 1% edge, printed as 99% RTP.
export const HOUSE_EDGE = 0.01;
export const RTP = 1 - HOUSE_EDGE;

// Client rounds every money-facing multiplier to 2 decimals this way.
export function round2(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

export function payoutFor(chance) {
  if (chance <= 0) return 0;
  return RTP / chance;
}

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

/* Client Fisher-Yates (engine.js shuffle) fed with pre-drawn floats
   instead of live rnd() calls. Consumes arr.length - 1 floats. */
function shuffleWithFloats(arr, floats) {
  let k = 0;
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(floats[k++] * (i + 1));
    const t = arr[i];
    arr[i] = arr[j];
    arr[j] = t;
  }
  return arr;
}

/* --------------------------- DICE ---------------------------------
   Client: roll = floor(rnd()*10000)/100, threshold band of `chance`%.
   mult in the result is the TOTAL return multiplier (0 on a loss). */
export function dice(floats, params) {
  // Same bounds the client slider enforces.
  const chance = clamp(Number(params.chance), 2, 98);
  const dir = params.dir === "Over" ? "Over" : "Under";

  const roll = Math.floor(floats[0] * 10000) / 100;
  const t = dir === "Under" ? chance : 100 - chance;
  const won = dir === "Under" ? roll < t : roll > t;
  const mult = payoutFor(chance / 100);

  return { roll, won, mult: won ? mult : 0 };
}

/* --------------------------- LIMBO --------------------------------
   Client: draw = RTP / u so that P(draw >= target) = RTP / target. */
export function limbo(floats, params) {
  const target = clamp(Number(params.target), 1.01, 1000000);

  const u = Math.max(floats[0], 1e-9);
  const draw = Math.max(1, Math.floor((RTP / u) * 100) / 100);
  const won = draw >= target;

  return { draw, target, won, mult: won ? target : 0 };
}

/* --------------------------- WHEEL --------------------------------
   Every table sums to 9.9 over 10 uniform segments, so each risk level
   carries the same 99% RTP the page advertises. The original client
   tables paid 90% on Low and a full 100% on Medium - both wrong. */
export const WHEEL_TABLE = {
  Low: [0, 1.2, 1.2, 1.2, 1.2, 0, 1.2, 1.2, 1.5, 1.2],
  Medium: [1.5, 0, 1.9, 0, 3, 0, 1.5, 0, 2, 0],
  High: [0, 0, 0, 0, 0, 0, 0, 0, 0, 9.9],
};

export function wheel(floats, params) {
  const t = WHEEL_TABLE[params.risk] || WHEEL_TABLE.Medium;
  // Client rndInt(0, N-1) is floor(rnd() * N); min() guards float edge.
  const index = Math.min(t.length - 1, Math.floor(floats[0] * t.length));
  const mult = t[index];
  return { index, mult, won: mult >= 1 };
}

/* --------------------------- PLINKO ------------------------------- */
// Verbatim copy of the client PLINKO_TABLE.
export const PLINKO_TABLE = {
  8: {
    Low: [5.6, 2.1, 1.1, 1, 0.5, 1, 1.1, 2.1, 5.6],
    Medium: [13, 3, 1.3, 0.7, 0.4, 0.7, 1.3, 3, 13],
    High: [29, 4, 1.5, 0.3, 0.2, 0.3, 1.5, 4, 29],
  },
  12: {
    Low: [10, 3, 1.6, 1.4, 1.1, 1, 0.5, 1, 1.1, 1.4, 1.6, 3, 10],
    Medium: [33, 11, 4, 2, 1.1, 0.6, 0.3, 0.6, 1.1, 2, 4, 11, 33],
    High: [170, 24, 8.1, 2, 0.7, 0.2, 0.2, 0.2, 0.7, 2, 8.1, 24, 170],
  },
  16: {
    Low: [16, 9, 2, 1.4, 1.4, 1.2, 1.1, 1, 0.5, 1, 1.1, 1.2, 1.4, 1.4, 2, 9, 16],
    Medium: [110, 41, 10, 5, 3, 1.5, 1, 0.5, 0.3, 0.5, 1, 1.5, 3, 5, 10, 41, 110],
    High: [1000, 130, 26, 9, 4, 2, 0.2, 0.2, 0.2, 0.2, 0.2, 2, 4, 9, 26, 130, 1000],
  },
};

export function plinko(floats, params) {
  const rows = params.rows === 8 || params.rows === 16 ? params.rows : 12;
  const t = PLINKO_TABLE[rows][params.risk] || PLINKO_TABLE[rows].Medium;

  // One fair coin flip per row, exactly like the client.
  const path = [];
  let bucket = 0;
  for (let r = 0; r < rows; r++) {
    const step = floats[r] < 0.5 ? 0 : 1;
    bucket += step;
    path.push(step);
  }

  const mult = t[bucket];
  return { path, bucket, mult, won: mult >= 1 };
}

/* --------------------------- MINES --------------------------------
   Client places mines with shuffle(0..24).slice(0, mineCount).
   Consumes 24 floats regardless of mineCount so the layout for a
   given (seed, nonce) never depends on the player's mine choice. */
export function minesLayout(floats, mineCount) {
  const tiles = shuffleWithFloats(
    Array.from({ length: 25 }, (_, i) => i),
    floats
  );
  return tiles.slice(0, mineCount);
}

// Fair price of the risk already survived, edge included.
export function minesMult(picks, mineCount) {
  if (picks === 0) return 1;
  let p = 1;
  for (let i = 0; i < picks; i++) p *= (25 - mineCount - i) / (25 - i);
  return round2(RTP / p);
}

/* --------------------------- CRASH -------------------------------- */
// 1% of rounds crash instantly at 1.00x: that is the house edge.
export function crashPoint(float) {
  if (float < HOUSE_EDGE) return 1;
  return Math.max(1, Math.floor((RTP / (1 - float)) * 100) / 100);
}

// Same live curve the client animates: m(t), t in seconds.
export function crashMultAt(seconds) {
  return Math.max(1, Math.pow(Math.E, 0.11 * seconds * (1 + seconds * 0.06)));
}

/* --------------------------- BLACKJACK ----------------------------
   Six-deck shoe, dealer stands on soft 17 (S17, matching the rule
   printed on the game page), blackjack pays 3:2. Cards are drawn
   with shoe.pop(), so the END of the array is the top of the shoe. */
export const BJ_RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
export const BJ_SUITS = ["spade", "heart", "diamond", "club"];
export const BJ_DECKS = 6;
// A 312-card shoe needs 311 floats for its Fisher-Yates pass.
export const BJ_SHOE_FLOATS = BJ_DECKS * 52 - 1;

// Same build order as the client: decks, then suits, then ranks.
export function shoeFromFloats(floats) {
  const cards = [];
  for (let d = 0; d < BJ_DECKS; d++) {
    for (let s = 0; s < BJ_SUITS.length; s++) {
      for (let r = 0; r < BJ_RANKS.length; r++) {
        cards.push({ r: BJ_RANKS[r], s: BJ_SUITS[s] });
      }
    }
  }
  return shuffleWithFloats(cards, floats);
}

// Aces count 11 until that would bust, then 1.
export function bjScore(hand) {
  let total = 0;
  let aces = 0;
  for (const c of hand) {
    if (c.r === "A") { aces++; total += 11; }
    else if (c.r === "J" || c.r === "Q" || c.r === "K") total += 10;
    else total += parseInt(c.r, 10);
  }
  while (total > 21 && aces > 0) { total -= 10; aces--; }
  return total;
}

export function bjIsSoft(hand) {
  let total = 0;
  let aces = 0;
  for (const c of hand) {
    if (c.r === "A") { aces++; total += 11; }
    else if (c.r === "J" || c.r === "Q" || c.r === "K") total += 10;
    else total += parseInt(c.r, 10);
  }
  let a = aces;
  while (total > 21 && a > 0) { total -= 10; a--; }
  return a > 0;
}

export function bjIsBlackjack(hand) {
  return hand.length === 2 && bjScore(hand) === 21;
}

/* Dealer plays out in place, popping from the shoe: draw to 17, stand
   on every 17 including soft (S17). */
export function bjDealerPlay(dealer, shoe) {
  while (bjScore(dealer) < 17) {
    dealer.push(shoe.pop());
  }
  return dealer;
}

/* Settlement ladder copied from the client finish(). mult is the
   TOTAL return multiplier on the (possibly doubled) stake. */
export function bjSettle(player, dealer) {
  const p = bjScore(player);
  const d = bjScore(dealer);
  const pBJ = bjIsBlackjack(player);
  const dBJ = bjIsBlackjack(dealer);

  if (p > 21) return { mult: 0, won: false, label: "Bust" };
  if (pBJ && !dBJ) return { mult: 2.5, won: true, label: "Blackjack - 3:2" };
  if (dBJ && !pBJ) return { mult: 0, won: false, label: "Dealer blackjack" };
  if (pBJ && dBJ) return { mult: 1, won: false, label: "Push" };
  if (d > 21) return { mult: 2, won: true, label: "Dealer busts" };
  if (p > d) return { mult: 2, won: true, label: "You win" };
  if (p < d) return { mult: 0, won: false, label: "Dealer wins" };
  return { mult: 1, won: false, label: "Push" };
}

/* Full end-of-round: dealer plays only if the player still stands,
   exactly like the client finish(). Mutates dealer and shoe. */
export function bjResolve(player, dealer, shoe) {
  if (bjScore(player) <= 21) bjDealerPlay(dealer, shoe);
  return bjSettle(player, dealer);
}
