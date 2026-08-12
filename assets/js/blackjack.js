/* ===================================================================
   pepe.fail — Blackjack

   Real rules, real cards: a six-deck shoe shuffled with the same
   crypto RNG as the rest of the site, dealer stands on soft 17,
   blackjack pays 3:2.

   Registers itself as window.BLACKJACK_GAME; game-page.js picks it up.
   =================================================================== */

(function () {
  "use strict";

  const E = window.PepeEngine;
  const { rnd, shuffle, fmt, round2 } = E;

  const SUITS = [
    { s: "spade", ch: "♠", red: false },
    { s: "heart", ch: "♥", red: true },
    { s: "diamond", ch: "♦", red: true },
    { s: "club", ch: "♣", red: false },
  ];
  const RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];

  const DECKS = 6;
  const RESHUFFLE_AT = 52; /* cut card: reshuffle when the shoe runs low */

  let shoe = [];

  function newShoe() {
    const cards = [];
    for (let d = 0; d < DECKS; d++) {
      for (let s = 0; s < SUITS.length; s++) {
        for (let r = 0; r < RANKS.length; r++) cards.push({ r: RANKS[r], su: SUITS[s] });
      }
    }
    return shuffle(cards);
  }

  function draw() {
    if (shoe.length < RESHUFFLE_AT) shoe = newShoe();
    return shoe.pop();
  }

  /* Aces count 11 until that would bust, then 1. */
  function score(hand) {
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

  function isSoft(hand) {
    let total = 0, aces = 0;
    for (const c of hand) {
      if (c.r === "A") { aces++; total += 11; }
      else if (c.r === "J" || c.r === "Q" || c.r === "K") total += 10;
      else total += parseInt(c.r, 10);
    }
    let a = aces;
    while (total > 21 && a > 0) { total -= 10; a--; }
    return a > 0;
  }

  const isBlackjack = (h) => h.length === 2 && score(h) === 21;

  function cardHTML(c, i, hidden) {
    if (hidden) {
      return `<div class="bj-card bj-card--back" style="--i:${i}"></div>`;
    }
    const red = c.su.red ? " bj-card--red" : "";
    return `
      <div class="bj-card${red}" style="--i:${i}">
        <span class="bj-card__c bj-card__c--tl">${c.r}<i>${c.su.ch}</i></span>
        <span class="bj-card__mid">${c.su.ch}</span>
        <span class="bj-card__c bj-card__c--br">${c.r}<i>${c.su.ch}</i></span>
      </div>`;
  }

  window.BLACKJACK_GAME = {
    name: "Blackjack",
    ic: "spade",
    sub: "pepe.fail Originals",
    ac: "gold",
    stats: [["99.5%", "RTP"], ["3:2", "Blackjack"]],
    action: "Deal",
    hint: "Dealer stands on soft 17. Blackjack pays 3:2.",

    controls: () => `
      <div class="field">
        <div class="field__label">Bet Amount<b data-balance>0.00</b></div>
        <div class="input-wrap">
          <span class="cur">${icon("coin")}</span>
          <input type="text" inputmode="decimal" data-input="bet" value="1.00" />
          <button class="mini glass" data-bet="half">½</button>
          <button class="mini glass" data-bet="double">2×</button>
          <button class="mini glass" data-bet="max">Max</button>
        </div>
      </div>`,

    stage: () => `
      <div class="bj-table">
        <div class="bj-side">
          <div class="bj-label">Dealer <b id="bjDealerScore">—</b></div>
          <div class="bj-hand" id="bjDealer"></div>
        </div>
        <div class="bj-side">
          <div class="bj-label">You <b id="bjPlayerScore">—</b></div>
          <div class="bj-hand" id="bjPlayer"></div>
        </div>
        <div class="bj-actions" id="bjActions" hidden>
          <button class="btn btn--gold" data-act="hit">Hit</button>
          <button class="btn btn--glass" data-act="stand">Stand</button>
          <button class="btn btn--glass" data-act="double">Double</button>
        </div>
        <div class="bj-msg" id="bjMsg"></div>
      </div>`,

    init(ui) {
      const dealerEl = document.getElementById("bjDealer");
      const playerEl = document.getElementById("bjPlayer");
      const dScore = document.getElementById("bjDealerScore");
      const pScore = document.getElementById("bjPlayerScore");
      const actions = document.getElementById("bjActions");
      const msg = document.getElementById("bjMsg");

      let dealer = [];
      let player = [];
      let stake = 0;
      let hole = true;      /* dealer's second card still face down */
      let over = true;

      function paint() {
        dealerEl.innerHTML = dealer.map((c, i) => cardHTML(c, i, hole && i === 1)).join("");
        playerEl.innerHTML = player.map((c, i) => cardHTML(c, i, false)).join("");
        dScore.textContent = hole ? (dealer.length ? score([dealer[0]]) : "—") : score(dealer);
        pScore.textContent = player.length ? score(player) : "—";
      }

      function setActions(on, canDouble) {
        actions.hidden = !on;
        if (!on) return;
        actions.querySelector('[data-act="double"]').disabled = !canDouble;
      }

      function say(text, kind) {
        msg.textContent = text || "";
        msg.className = "bj-msg" + (kind ? " is-" + kind : "");
      }

      /* Dealer plays out, then the round is scored and settled. */
      function finish() {
        hole = false;
        paint();

        const p = score(player);
        if (p <= 21) {
          while (score(dealer) < 17 || (score(dealer) === 17 && isSoft(dealer))) {
            dealer.push(draw());
          }
          paint();
        }

        const d = score(dealer);
        const pBJ = isBlackjack(player);
        const dBJ = isBlackjack(dealer);
        let ret = 0, won = false, label = "";

        if (p > 21) { label = "Bust"; }
        else if (pBJ && !dBJ) { ret = stake * 2.5; won = true; label = "Blackjack — 3:2"; }
        else if (dBJ && !pBJ) { label = "Dealer blackjack"; }
        else if (pBJ && dBJ) { ret = stake; label = "Push"; }
        else if (d > 21) { ret = stake * 2; won = true; label = "Dealer busts"; }
        else if (p > d) { ret = stake * 2; won = true; label = "You win"; }
        else if (p < d) { label = "Dealer wins"; }
        else { ret = stake; label = "Push"; }

        say(label, ret > stake ? "win" : ret === stake && ret > 0 ? "push" : "lose");
        setActions(false);
        over = true;
        ui.settle(ret, won, null);
      }

      function playerBust() {
        if (score(player) > 21) { finish(); return true; }
        return false;
      }

      actions.querySelectorAll("[data-act]").forEach((b) => {
        b.addEventListener("click", () => {
          if (over) return;
          const act = b.dataset.act;

          if (act === "hit") {
            player.push(draw());
            paint();
            setActions(true, false);
            playerBust();
          } else if (act === "stand") {
            finish();
          } else if (act === "double") {
            if (!E.Bank.canBet(stake)) { say("Not enough balance to double", "lose"); return; }
            E.Bank.sub(stake);
            E.Rank.wager(stake);   /* doubling is a second wager, so it earns XP too */
            stake = round2(stake * 2);
            player.push(draw());
            paint();
            setActions(false);
            if (!playerBust()) finish();
          }
        });
      });

      ui.setPayout("Blackjack pays", "3:2");

      ui.onPlay((amount) => {
        stake = amount;
        dealer = [];
        player = [];
        hole = true;
        over = false;
        say("", null);

        player.push(draw());
        dealer.push(draw());
        player.push(draw());
        dealer.push(draw());
        paint();

        ui.hold();

        /* a natural on either side ends it immediately */
        if (isBlackjack(player) || isBlackjack(dealer)) { finish(); return; }

        setActions(true, E.Bank.canBet(stake));
      });
    },
  };
})();
