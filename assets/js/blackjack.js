/* ===================================================================
   pepe.fail — Blackjack table (interface mockup)

   Exposes window.BLACKJACK_GAME, which game-page.js picks up with:
     if (window.BLACKJACK_GAME) GAMES.blackjack = window.BLACKJACK_GAME;

   This file must be loaded BEFORE game-page.js.
   The round is played with real totals so that every number shown on
   screen always matches the cards on the table.
   =================================================================== */
(function () {
  "use strict";

  /* =========================== CARD MODEL =========================== */

  const SUITS = {
    s: { ch: "♠", tone: "dark", name: "spades" },
    h: { ch: "♥", tone: "red", name: "hearts" },
    d: { ch: "♦", tone: "red", name: "diamonds" },
    c: { ch: "♣", tone: "dark", name: "clubs" },
  };

  const RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
  const RANK_NAMES = { A: "Ace", J: "Jack", Q: "Queen", K: "King" };
  const SUIT_KEYS = ["s", "h", "d", "c"];

  /* Opening deal — single source of truth for the markup and the logic. */
  const OPENING = {
    dealer: [{ r: "A", s: "s" }, { r: "9", s: "d" }],
    player: [{ r: "8", s: "d" }, { r: "8", s: "s" }],
  };

  const DEALER_STANDS_ON = 17;

  function rankValue(rank) {
    if (rank === "A") return 11;
    if (rank === "J" || rank === "Q" || rank === "K" || rank === "10") return 10;
    return parseInt(rank, 10);
  }

  /* Best total under 21 — aces drop from 11 to 1 as needed. */
  function total(cards) {
    let sum = 0;
    let aces = 0;
    cards.forEach(function (c) {
      sum += rankValue(c.r);
      if (c.r === "A") aces++;
    });
    while (sum > 21 && aces > 0) {
      sum -= 10;
      aces--;
    }
    return sum;
  }

  function isSoft(cards) {
    let sum = 0;
    let aces = 0;
    cards.forEach(function (c) {
      sum += rankValue(c.r);
      if (c.r === "A") aces++;
    });
    while (sum > 21 && aces > 0) {
      sum -= 10;
      aces--;
      if (aces === 0) return false;
    }
    return aces > 0 && sum <= 21;
  }

  function isBlackjack(cards) {
    return cards.length === 2 && total(cards) === 21;
  }

  function randomCard() {
    return {
      r: RANKS[Math.floor(Math.random() * RANKS.length)],
      s: SUIT_KEYS[Math.floor(Math.random() * SUIT_KEYS.length)],
    };
  }

  /* Keys of every card currently visible on the table. */
  function onTable() {
    const keys = [];
    const push = function (c) { keys.push(c.r + c.s); };
    if (state.dealer) state.dealer.forEach(push);
    if (state.hands) state.hands.forEach(function (h) { h.cards.forEach(push); });
    return keys;
  }

  /* A shoe holds several decks, but two identical cards side by side on
     the same table read as a glitch — so a card already in play is redrawn. */
  function drawCard() {
    const inPlay = onTable();
    let card = randomCard();
    for (let i = 0; i < 12 && inPlay.indexOf(card.r + card.s) !== -1; i++) {
      card = randomCard();
    }
    return card;
  }

  function cardLabel(card) {
    return (RANK_NAMES[card.r] || card.r) + " of " + SUITS[card.s].name;
  }

  /* =========================== MARKUP =========================== */

  function faceHTML(card) {
    const suit = SUITS[card.s];
    const corner =
      '<b>' + card.r + "</b><i>" + suit.ch + "</i>";
    return (
      '<div class="bj-face bj-face--' + suit.tone + '">' +
      '<span class="bj-face__corner">' + corner + "</span>" +
      '<span class="bj-face__pip">' + suit.ch + "</span>" +
      '<span class="bj-face__corner bj-face__corner--br">' + corner + "</span>" +
      "</div>"
    );
  }

  /* delay = position in the dealing order, used for the 70ms stagger.
     hole  = card dealt face down (it carries a back and can be flipped). */
  function cardHTML(card, delay, hole) {
    return (
      '<div class="bj-card' + (hole ? " bj-card--hole" : "") + '"' +
      ' style="--i:' + (delay || 0) + '"' +
      ' role="img" aria-label="' + (hole ? "Face-down card" : cardLabel(card)) + '">' +
      '<div class="bj-card__inner">' +
      (hole ? '<div class="bj-back" aria-hidden="true"></div>' : "") +
      faceHTML(card) +
      "</div></div>"
    );
  }

  function handHTML(cards, index, active) {
    const cardsHTML = cards
      .map(function (c, i) {
        return cardHTML(c, i * 2);
      })
      .join("");
    return (
      '<div class="bj-hand-wrap' + (active ? " is-active" : "") + '" data-bj-hand="' + index + '">' +
      '<div class="bj-hand">' + cardsHTML + "</div>" +
      '<span class="bj-badge bj-badge--player">' + total(cards) + "</span>" +
      "</div>"
    );
  }

  function actionsHTML() {
    return (
      '<div class="bj-actions">' +
      '<button type="button" class="btn btn--gold" data-bj-act="hit">Hit</button>' +
      '<button type="button" class="btn btn--glass" data-bj-act="stand">Stand</button>' +
      '<button type="button" class="btn btn--glass" data-bj-act="double">Double</button>' +
      '<button type="button" class="btn btn--glass" data-bj-act="split">Split</button>' +
      '<button type="button" class="btn btn--glass" data-bj-act="insurance">Insurance</button>' +
      "</div>"
    );
  }

  function stageBlackjack() {
    const d = OPENING.dealer;
    const p = OPENING.player;
    return (
      '<div class="bj">' +
        '<div class="bj-felt">' +
          '<div class="bj-seat">' +
            '<div class="bj-seat__head">' +
              '<span class="bj-seat__label">Dealer</span>' +
              '<span class="bj-badge" data-bj-dealer-total>' + total([d[0]]) + "<i>+</i></span>" +
            "</div>" +
            '<div class="bj-hand" data-bj-dealer>' +
              cardHTML(d[0], 1) + cardHTML(d[1], 3, true) +
            "</div>" +
          "</div>" +

          '<div class="bj-rule"><span>Blackjack pays 3 to 2 · Dealer stands on all 17</span></div>' +

          '<div class="bj-seat bj-seat--player">' +
            '<div class="bj-hands" data-bj-hands>' + handHTML(p, 0, true) + "</div>" +
            '<div class="bj-seat__head bj-seat__head--player">' +
              '<span class="bj-seat__label">Player</span>' +
              '<span class="bj-seat__bet">$1.00</span>' +
            "</div>" +
          "</div>" +
        "</div>" +

        '<div class="bj-status" data-bj-status>Your move — hit, stand or double.</div>' +
        actionsHTML() +
      "</div>"
    );
  }

  /* =========================== TABLE STATE =========================== */

  const state = {
    dealer: [],
    holeDown: true,
    hands: [],
    active: 0,
    insured: false,
    splitUsed: false,
    over: false,
  };

  let root = null;
  let timers = [];

  function later(fn, ms) {
    timers.push(setTimeout(fn, ms));
  }

  function clearTimers() {
    timers.forEach(clearTimeout);
    timers = [];
  }

  function cloneCards(cards) {
    return cards.map(function (c) {
      return { r: c.r, s: c.s };
    });
  }

  function el(selector) {
    return root ? root.querySelector(selector) : null;
  }

  function dealerHandEl() {
    return el("[data-bj-dealer]");
  }

  function handWrapEl(index) {
    return el('[data-bj-hand="' + index + '"]');
  }

  function setStatus(text) {
    const node = el("[data-bj-status]");
    if (node) node.textContent = text;
  }

  /* Adds a card to a hand element, animated as a fresh deal. */
  function pushCardTo(handEl, card, delay, hole) {
    if (!handEl) return;
    handEl.insertAdjacentHTML("beforeend", cardHTML(card, delay, hole));
  }

  function renderDealerTotal() {
    const node = el("[data-bj-dealer-total]");
    if (!node) return;
    if (state.holeDown) {
      node.innerHTML = total([state.dealer[0]]) + "<i>+</i>";
      node.className = "bj-badge";
      return;
    }
    const t = total(state.dealer);
    node.textContent = isBlackjack(state.dealer) ? "BJ" : String(t);
    node.className = "bj-badge" + (t > 21 ? " bj-badge--bust" : "");
  }

  function renderHandTotal(index) {
    const wrap = handWrapEl(index);
    if (!wrap) return;
    const hand = state.hands[index];
    const badge = wrap.querySelector(".bj-badge");
    const t = total(hand.cards);
    let label = String(t);
    if (isBlackjack(hand.cards) && state.hands.length === 1) label = "BJ";
    else if (isSoft(hand.cards) && t !== 21) label = "Soft " + t;
    badge.textContent = label;
    badge.className =
      "bj-badge bj-badge--player" +
      (t > 21 ? " bj-badge--bust" : label === "BJ" ? " bj-badge--win" : "");
    wrap.classList.toggle("is-bust", t > 21);
  }

  function setActiveHand(index) {
    state.active = index;
    state.hands.forEach(function (h, i) {
      const wrap = handWrapEl(i);
      if (wrap) wrap.classList.toggle("is-active", i === index && !state.over);
    });
  }

  /* =========================== BUTTON STATES =========================== */

  function button(name) {
    return el('[data-bj-act="' + name + '"]');
  }

  function updateActions() {
    const hand = state.hands[state.active];
    const live = !state.over && hand && !hand.done;
    const fresh = live && hand.cards.length === 2;

    const hit = button("hit");
    const stand = button("stand");
    const dbl = button("double");
    const split = button("split");
    const ins = button("insurance");

    if (hit) hit.disabled = !live;
    if (stand) stand.disabled = !live;
    if (dbl) dbl.disabled = !fresh;
    if (split) {
      split.disabled =
        !fresh ||
        state.splitUsed ||
        state.hands.length > 1 ||
        hand.cards[0].r !== hand.cards[1].r;
    }
    if (ins) {
      ins.disabled =
        state.insured ||
        state.over ||
        !state.holeDown ||
        state.hands.length > 1 ||
        !fresh ||
        state.dealer[0].r !== "A";
    }
  }

  /* =========================== ROUND FLOW =========================== */

  function revealHole() {
    if (!state.holeDown) return;
    const hole = el(".bj-card--hole");
    state.holeDown = false;
    if (hole) {
      hole.classList.add("is-flipped");
      hole.setAttribute("aria-label", cardLabel(state.dealer[1]));
    }
    later(renderDealerTotal, 200);
  }

  function settle() {
    state.over = true;
    setActiveHand(-1);
    updateActions();

    const dealerTotal = total(state.dealer);
    const results = state.hands.map(function (hand) {
      const t = total(hand.cards);
      if (t > 21) return "lose";
      if (isBlackjack(hand.cards) && state.hands.length === 1) {
        return isBlackjack(state.dealer) ? "push" : "blackjack";
      }
      if (dealerTotal > 21) return "win";
      if (t > dealerTotal) return "win";
      if (t < dealerTotal) return "lose";
      return "push";
    });

    state.hands.forEach(function (hand, i) {
      const wrap = handWrapEl(i);
      if (!wrap) return;
      wrap.classList.remove("is-win", "is-lose", "is-push");
      const r = results[i];
      wrap.classList.add(r === "lose" ? "is-lose" : r === "push" ? "is-push" : "is-win");
    });

    const dealerText = dealerTotal > 21 ? "Dealer busts" : "Dealer " + dealerTotal;
    let outcome;
    if (results.length > 1) {
      const won = results.filter(function (r) { return r === "win" || r === "blackjack"; }).length;
      outcome = won + " of " + results.length + " hands paid";
    } else if (results[0] === "blackjack") {
      outcome = "Blackjack — paid 3:2";
    } else if (results[0] === "win") {
      outcome = "You win";
    } else if (results[0] === "push") {
      outcome = "Push — bet returned";
    } else {
      outcome = total(state.hands[0].cards) > 21 ? "Bust — bet lost" : "Dealer wins";
    }
    setStatus(dealerText + " · " + outcome + ". Press Deal for a new round.");
  }

  function dealerPlay() {
    revealHole();
    const handEl = dealerHandEl();

    function step(delay) {
      if (total(state.dealer) >= DEALER_STANDS_ON) {
        later(settle, delay);
        return;
      }
      later(function () {
        const card = drawCard();
        state.dealer.push(card);
        pushCardTo(handEl, card, 0);
        renderDealerTotal();
        step(320);
      }, delay);
    }

    /* Every player hand busted — the dealer does not draw. */
    const alive = state.hands.some(function (h) { return total(h.cards) <= 21; });
    if (!alive) {
      later(settle, 320);
      return;
    }
    setStatus("Dealer plays…");
    step(420);
  }

  function nextHand() {
    const next = state.hands.findIndex(function (h) { return !h.done; });
    if (next === -1) {
      dealerPlay();
      return;
    }
    setActiveHand(next);
    setStatus("Hand " + (next + 1) + " — your move.");
    updateActions();
  }

  function hit() {
    const hand = state.hands[state.active];
    if (!hand || hand.done || state.over) return;
    const card = drawCard();
    hand.cards.push(card);
    const wrap = handWrapEl(state.active);
    pushCardTo(wrap.querySelector(".bj-hand"), card, 0);
    renderHandTotal(state.active);

    const t = total(hand.cards);
    if (t > 21) {
      hand.done = true;
      setStatus("Bust with " + t + ".");
      later(nextHand, 320);
    } else if (t === 21) {
      hand.done = true;
      later(nextHand, 320);
    } else {
      updateActions();
    }
  }

  function stand() {
    const hand = state.hands[state.active];
    if (!hand || hand.done || state.over) return;
    hand.done = true;
    updateActions();
    nextHand();
  }

  function double() {
    const hand = state.hands[state.active];
    if (!hand || hand.done || state.over || hand.cards.length !== 2) return;
    hand.bet *= 2;
    hand.doubled = true;
    const card = drawCard();
    hand.cards.push(card);
    const wrap = handWrapEl(state.active);
    pushCardTo(wrap.querySelector(".bj-hand"), card, 0);
    renderHandTotal(state.active);
    hand.done = true;
    setStatus("Doubled to $" + hand.bet.toFixed(2) + " — one card only.");
    updateActions();
    later(nextHand, 320);
  }

  function split() {
    const hand = state.hands[state.active];
    if (!hand || state.splitUsed || state.hands.length > 1) return;
    if (hand.cards.length !== 2 || hand.cards[0].r !== hand.cards[1].r) return;

    state.splitUsed = true;
    const first = hand.cards[0];
    const second = hand.cards[1];
    state.hands = [
      { cards: [first], done: false, doubled: false, bet: hand.bet },
      { cards: [second], done: false, doubled: false, bet: hand.bet },
    ];
    state.hands[0].cards.push(drawCard());
    state.hands[1].cards.push(drawCard());

    const container = el("[data-bj-hands]");
    container.innerHTML =
      handHTML(state.hands[0].cards, 0, true) + handHTML(state.hands[1].cards, 1, false);

    state.hands.forEach(function (h, i) { renderHandTotal(i); });
    setActiveHand(0);
    setStatus("Split — playing hand 1 of 2.");
    updateActions();
  }

  function insurance() {
    if (state.insured || state.over) return;
    state.insured = true;
    const btn = button("insurance");
    if (btn) {
      btn.classList.remove("btn--glass");
      btn.classList.add("btn--glass-gold");
      btn.textContent = "Insured";
    }
    setStatus("Insurance taken — half your bet against dealer blackjack.");
    updateActions();
  }

  /* Fresh round: clears the table and deals two cards to each side. */
  function newRound() {
    if (!root) return;
    clearTimers();

    /* Dealt one card at a time, player first, exactly like a live shoe. */
    state.dealer = [];
    state.hands = [{ cards: [], done: false, doubled: false, bet: 1 }];
    state.hands[0].cards.push(drawCard());
    state.dealer.push(drawCard());
    state.hands[0].cards.push(drawCard());
    state.dealer.push(drawCard());
    state.holeDown = true;
    state.insured = false;
    state.splitUsed = false;
    state.over = false;
    state.active = 0;

    const dealerEl = dealerHandEl();
    dealerEl.innerHTML = cardHTML(state.dealer[0], 1) + cardHTML(state.dealer[1], 3, true);
    el("[data-bj-hands]").innerHTML = handHTML(state.hands[0].cards, 0, true);

    renderDealerTotal();
    renderHandTotal(0);
    setStatus("Your move — hit, stand or double.");

    const ins = button("insurance");
    if (ins) {
      ins.classList.remove("btn--glass-gold");
      ins.classList.add("btn--glass");
      ins.textContent = "Insurance";
    }

    /* Natural blackjack ends the round immediately. */
    if (isBlackjack(state.hands[0].cards)) {
      state.hands[0].done = true;
      later(dealerPlay, 560);
    }
    updateActions();
  }

  /* =========================== BINDING =========================== */

  const ACTIONS = { hit: hit, stand: stand, double: double, split: split, insurance: insurance };

  function bind() {
    root = document.querySelector(".bj");
    if (!root) return;

    state.dealer = cloneCards(OPENING.dealer);
    state.hands = [
      { cards: cloneCards(OPENING.player), done: false, doubled: false, bet: 1 },
    ];
    state.holeDown = true;

    root.addEventListener("click", function (e) {
      const btn = e.target.closest("[data-bj-act]");
      if (!btn || btn.disabled) return;
      const fn = ACTIONS[btn.dataset.bjAct];
      if (fn) fn();
    });

    /* The main bet button ("Deal") starts a new round. */
    const dealBtn = document.querySelector(".bet .btn--lg");
    if (dealBtn) dealBtn.addEventListener("click", newRound);

    updateActions();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bind);
  } else {
    setTimeout(bind, 0);
  }

  /* =========================== GAME ENTRY =========================== */

  window.BLACKJACK_GAME = {
    name: "Blackjack",
    ic: "spade",
    sub: "pepe.fail Originals",
    stats: [["99.5%", "RTP"], ["3:2", "Max Win"]],
    controls: function () {
      const input = window.fieldInput;
      const select = window.fieldSelect;
      if (typeof input !== "function" || typeof select !== "function") return "";
      return (
        input("Bet amount", "1.00", "$1.00", true) +
        select("Number of hands", ["1", "2", "3", "4"], 0) +
        select("Insurance", ["Off", "On"], 0)
      );
    },
    payout: ["Blackjack pays", "3:2"],
    action: "Deal",
    stage: stageBlackjack,
    hint: "Get closer to 21 than the dealer without going over — the dealer stands on all 17.",
  };
})();
