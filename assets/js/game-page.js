/* ===================================================================
   pepe.fail — game engine

   Every game here is really played: the outcome comes from
   crypto.getRandomValues, the stake leaves your balance before the
   round and the payout is credited after it. Nothing is scripted to
   win or lose.

   Two paths share the same presentation:
   - demo (default): outcomes are drawn locally, balance in localStorage.
   - real: when PepeReal.on(), the server draws the outcome, debits and
     credits; the client only animates what the server decided.

   Each page sets window.GAME = "<key>" before loading this script.
   =================================================================== */

const E = window.PepeEngine;
const { Bank, History, rnd, rndInt, round2, fmt, fmtMult, clamp, payoutFor, RTP } = E;

/* ===================================================================
   SHARED CONTROLS
   =================================================================== */

function fieldSelect(label, name, options, activeIdx) {
  const sel = activeIdx || 0;
  return `
  <div class="field">
    <div class="field__label">${label}</div>
    <div class="chips" data-chipgroup="${name}">
      ${options
        .map((o, i) => `<button class="glass${i === sel ? " active" : ""}" data-v="${o}">${o}</button>`)
        .join("")}
    </div>
  </div>`;
}

function fieldNumber(label, name, value, right) {
  return `
  <div class="field">
    <div class="field__label">${label}${right ? `<b data-right="${name}">${right}</b>` : ""}</div>
    <div class="input-wrap">
      <span class="cur">${icon("coin")}</span>
      <input type="text" inputmode="decimal" data-input="${name}" value="${value}" />
    </div>
  </div>`;
}

function fieldBet() {
  return `
  <div class="field">
    <div class="field__label">Bet Amount<b data-balance>0.00</b></div>
    <div class="input-wrap">
      <span class="cur">${icon("coin")}</span>
      <input type="text" inputmode="decimal" data-input="bet" value="1.00" />
      <button class="mini glass" data-bet="half">½</button>
      <button class="mini glass" data-bet="double">2×</button>
      <button class="mini glass" data-bet="max">Max</button>
    </div>
  </div>`;
}

/* Small helpers shared by the real paths: server responses are read
   defensively so a field rename server-side degrades into a fallback
   instead of a crash. */
function srvOutcome(r) {
  return (r && (r.outcome || r.state || r.data)) || r || {};
}

function srvWon(r, o) {
  if (o && o.win !== undefined) return !!o.win;
  if (o && o.won !== undefined) return !!o.won;
  return !!(r && r.payout > 0);
}

/* ===================================================================
   GAMES
   Each entry exposes: meta, controls() and init(ui).
   `ui` gives the games one job each — decide an outcome and animate it.
   =================================================================== */
const GAMES = {};

/* --------------------------- DICE --------------------------------
   Roll 0.00-99.99. Under/over a threshold you choose. Win chance is
   literally the size of the band you picked. */
GAMES.dice = {
  name: "Dice", ic: "dice", sub: "pepe.fail Originals", ac: "gold",
  stats: [["99%", "RTP"], ["49.5×", "Max Win"]],
  action: "Roll Dice",
  hint: "Drag the slider to set your threshold — the narrower the band, the bigger the payout.",
  controls: () =>
    fieldBet() +
    fieldNumber("Win Chance", "chance", "50.00", "%") +
    fieldSelect("Roll", "dir", ["Under", "Over"], 0),
  stage: () => `
    <div class="dice-area">
      <div class="dice-result" id="diceVal">—</div>
      <div>
        <div class="slider" id="diceSlider"><div class="slider__fill" id="diceFill"></div><div class="slider__knob" id="diceKnob"></div></div>
        <div class="scale"><span>0</span><span>25</span><span>50</span><span>75</span><span>100</span></div>
      </div>
      <div class="history" id="diceHist"></div>
    </div>`,

  init(ui) {
    let chance = 50;
    let dir = "Under";

    const slider = document.getElementById("diceSlider");
    const knob = document.getElementById("diceKnob");
    const fill = document.getElementById("diceFill");
    const val = document.getElementById("diceVal");
    const hist = document.getElementById("diceHist");

    /* The threshold is the number the roll is compared against. */
    function threshold() { return dir === "Under" ? chance : 100 - chance; }

    function paint() {
      const t = threshold();
      knob.style.left = t + "%";
      fill.style.left = dir === "Under" ? "0%" : t + "%";
      fill.style.width = (dir === "Under" ? t : 100 - t) + "%";
      ui.setInput("chance", chance.toFixed(2));
      ui.setPayout("Multiplier", fmtMult(payoutFor(chance / 100)));
    }

    function setChance(c) {
      chance = clamp(c, 2, 98);
      paint();
    }

    /* drag + click on the track */
    let dragging = false;
    function fromEvent(e) {
      const r = slider.getBoundingClientRect();
      const x = ((e.touches ? e.touches[0].clientX : e.clientX) - r.left) / r.width;
      const t = clamp(x * 100, 2, 98);
      setChance(dir === "Under" ? t : 100 - t);
    }
    slider.addEventListener("pointerdown", (e) => { dragging = true; slider.setPointerCapture(e.pointerId); fromEvent(e); });
    slider.addEventListener("pointermove", (e) => { if (dragging) fromEvent(e); });
    slider.addEventListener("pointerup", () => { dragging = false; });

    ui.onInput("chance", (v) => { const n = parseFloat(v); if (isFinite(n)) setChance(n); });
    ui.onChip("dir", (v) => { dir = v; paint(); });

    paint();

    function show(roll, won, mult, ret) {
      val.textContent = roll.toFixed(2);
      val.className = "dice-result " + (won ? "is-win" : "is-lose");

      const b = document.createElement("b");
      b.textContent = roll.toFixed(2);
      b.className = won ? "win" : "";
      hist.prepend(b);
      while (hist.children.length > 8) hist.lastChild.remove();

      ui.settle(ret, won, won ? fmtMult(mult) : null);
    }

    ui.onPlay(async (bet) => {
      const mult = payoutFor(chance / 100);

      if (ui.real()) {
        ui.lock(true);
        let r;
        try {
          r = await ui.place({ chance: round2(chance), dir: dir.toLowerCase() });
        } catch (e) { ui.lock(false); ui.fail(e); return; }
        ui.lock(false);
        const o = srvOutcome(r);
        const roll = Number(o.roll !== undefined ? o.roll : o.result);
        show(isFinite(roll) ? roll : 0, srvWon(r, o), mult, r.payoutFloat || 0);
        return;
      }

      const roll = Math.floor(rnd() * 10000) / 100;
      const t = threshold();
      const won = dir === "Under" ? roll < t : roll > t;
      show(roll, won, mult, won ? bet * mult : 0);
    });
  },
};

/* --------------------------- LIMBO -------------------------------
   A multiplier is drawn from a 1/x curve. Beat your target and you win
   that target. */
GAMES.limbo = {
  name: "Limbo", ic: "chart", sub: "pepe.fail Originals", ac: "gold",
  stats: [["99%", "RTP"], ["1,000,000×", "Max Win"]],
  action: "Bet",
  hint: "Pick a target. The draw has to land above it.",
  controls: () => fieldBet() + fieldNumber("Target Multiplier", "target", "2.00", "×"),
  stage: () => `
    <div class="limbo-area">
      <div class="limbo-val" id="limboVal">—</div>
      <div class="limbo-sub" id="limboSub">Set a target and roll</div>
      <div class="history" id="limboHist"></div>
    </div>`,

  init(ui) {
    let target = 2;
    const val = document.getElementById("limboVal");
    const sub = document.getElementById("limboSub");
    const hist = document.getElementById("limboHist");

    function paint() {
      const chance = RTP / target;
      ui.setPayout("Win Chance", (chance * 100).toFixed(2) + "%");
      sub.textContent = "Target " + fmtMult(target);
    }

    ui.onInput("target", (v) => {
      const n = parseFloat(v);
      if (isFinite(n)) { target = clamp(n, 1.01, 1000000); paint(); }
    });
    paint();

    function show(draw, won, ret) {
      val.textContent = fmtMult(draw);
      val.className = "limbo-val " + (won ? "is-win" : "is-lose");

      const b = document.createElement("b");
      b.textContent = fmtMult(draw);
      b.className = won ? "win" : "";
      hist.prepend(b);
      while (hist.children.length > 8) hist.lastChild.remove();

      ui.settle(ret, won, won ? fmtMult(target) : null);
    }

    ui.onPlay(async (bet) => {
      if (ui.real()) {
        ui.lock(true);
        let r;
        try {
          r = await ui.place({ target: target });
        } catch (e) { ui.lock(false); ui.fail(e); return; }
        ui.lock(false);
        const o = srvOutcome(r);
        const draw = Number(o.result !== undefined ? o.result : o.draw);
        show(isFinite(draw) ? draw : 1, srvWon(r, o), r.payoutFloat || 0);
        return;
      }

      /* draw = RTP / u  →  P(draw >= target) = RTP / target */
      const u = Math.max(rnd(), 1e-9);
      const draw = Math.max(1, Math.floor((RTP / u) * 100) / 100);
      const won = draw >= target;
      show(draw, won, won ? bet * target : 0);
    });
  },
};

/* --------------------------- PLINKO ------------------------------
   The ball takes a real random path: each row is a fair left/right
   coin flip, which is what produces the bell curve over the buckets. */
const PLINKO_TABLE = {
  8:  { Low: [5.6,2.1,1.1,1,0.5,1,1.1,2.1,5.6], Medium: [13,3,1.3,0.7,0.4,0.7,1.3,3,13], High: [29,4,1.5,0.3,0.2,0.3,1.5,4,29] },
  12: { Low: [10,3,1.6,1.4,1.1,1,0.5,1,1.1,1.4,1.6,3,10], Medium: [33,11,4,2,1.1,0.6,0.3,0.6,1.1,2,4,11,33], High: [170,24,8.1,2,0.7,0.2,0.2,0.2,0.7,2,8.1,24,170] },
  16: { Low: [16,9,2,1.4,1.4,1.2,1.1,1,0.5,1,1.1,1.2,1.4,1.4,2,9,16], Medium: [110,41,10,5,3,1.5,1,0.5,0.3,0.5,1,1.5,3,5,10,41,110], High: [1000,130,26,9,4,2,0.2,0.2,0.2,0.2,0.2,2,4,9,26,130,1000] },
};

GAMES.plinko = {
  name: "Plinko", ic: "plinko", sub: "pepe.fail Originals", ac: "gold",
  stats: [["99%", "RTP"], ["1000×", "Max Win"]],
  action: "Drop Ball",
  hint: "Drop a ball and let it bounce — the closer it lands to the edges, the bigger the multiplier.",
  controls: () =>
    fieldBet() +
    fieldSelect("Risk", "risk", ["Low", "Medium", "High"], 1) +
    fieldSelect("Rows", "rows", ["8", "12", "16"], 1),
  stage: () => `<div class="plinko"><div class="pegs" id="pegs"></div><div class="mults" id="mults"></div><div class="ball" id="ball"></div></div>`,

  init(ui) {
    let risk = "Medium";
    let rows = 12;

    const pegs = document.getElementById("pegs");
    const mults = document.getElementById("mults");
    const ball = document.getElementById("ball");

    function table() { return PLINKO_TABLE[rows][risk]; }

    function build() {
      let html = "";
      for (let r = 0; r < rows; r++) {
        html += '<div class="peg-row">' + '<div class="peg"></div>'.repeat(r + 3) + "</div>";
      }
      pegs.innerHTML = html;

      const t = table();
      mults.innerHTML = t
        .map((m, i) => {
          const edge = Math.min(i, t.length - 1 - i);
          const cls = edge <= 1 ? "m-hi" : edge >= Math.floor(t.length / 3) ? "m-lo" : "";
          return `<div class="mult ${cls}" data-i="${i}">${m}×</div>`;
        })
        .join("");
      ui.setPayout("Max Win", fmtMult(Math.max.apply(null, t)));
    }

    ui.onChip("risk", (v) => { risk = v; build(); });
    ui.onChip("rows", (v) => { rows = parseInt(v, 10); build(); });
    build();

    /* Animates a full drop down `path` and settles with `ret`. The
       path is either drawn locally (demo) or dictated by the server. */
    function drop(path, bucket, mult, ret) {
      const won = mult >= 1;
      ui.lock(true);
      const board = pegs.getBoundingClientRect();
      const stage = pegs.parentElement.getBoundingClientRect();
      const rowH = board.height / rows;
      let x = board.width / 2;
      let step = 0;

      ball.style.opacity = "1";
      ball.style.transform = `translate(${x + (board.left - stage.left)}px, ${board.top - stage.top}px)`;

      const timer = window.setInterval(() => {
        x += path[step] ? rowH * 0.42 : -rowH * 0.42;
        step++;
        ball.style.transform =
          `translate(${x + (board.left - stage.left)}px, ${board.top - stage.top + step * rowH}px)`;

        if (step >= rows) {
          window.clearInterval(timer);
          const cell = mults.querySelector('[data-i="' + bucket + '"]');
          if (cell) {
            cell.classList.add("is-hit");
            window.setTimeout(() => cell.classList.remove("is-hit"), 700);
          }
          ball.style.opacity = "0";
          ui.lock(false);
          ui.settle(ret, won, fmtMult(mult));
        }
      }, 95);
    }

    ui.onPlay(async (bet) => {
      if (ui.real()) {
        ui.lock(true);
        let r;
        try {
          r = await ui.place({ risk: risk, rows: rows });
        } catch (e) { ui.lock(false); ui.fail(e); return; }
        const o = srvOutcome(r);
        const path = Array.isArray(o.path) ? o.path : [];
        const bucket = o.bucket !== undefined ? o.bucket : path.reduce((a, s) => a + (s ? 1 : 0), 0);
        const mult = o.mult !== undefined ? o.mult : table()[bucket];
        if (path.length !== rows) {
          /* Server disagreed on geometry: settle without an animation
             rather than animating a lie. */
          ui.lock(false);
          ui.settle(r.payoutFloat || 0, srvWon(r, o), fmtMult(mult || 0));
          return;
        }
        drop(path, bucket, mult, r.payoutFloat || 0);
        return;
      }

      /* one fair coin flip per row: this is the whole game */
      let right = 0;
      const path = [];
      for (let r = 0; r < rows; r++) {
        const step = rnd() < 0.5 ? 0 : 1;
        right += step;
        path.push(step);
      }

      const t = table();
      const mult = t[right];
      drop(path, right, mult, bet * mult);
    });
  },
};

/* --------------------------- MINES -------------------------------
   Mines are placed before the first click and never moved. The
   multiplier is the fair price of the risk already survived. In real
   mode the layout lives on the server and each pick is a request — the
   client never knows where the mines are until the round ends. */
GAMES.mines = {
  name: "Mines", ic: "bomb", sub: "pepe.fail Originals", ac: "orange",
  stats: [["99%", "RTP"], ["3.2M×", "Max Win"]],
  action: "Bet",
  hint: "Reveal tiles without hitting a mine, then cash out whenever you want.",
  controls: () => fieldBet() + fieldSelect("Mines", "mines", ["1", "3", "5", "10", "24"], 1),
  stage: () => `<div class="mines-grid" id="minesGrid"></div>`,

  init(ui) {
    const SIZE = 25;
    let mineCount = 3;
    let field = [];
    let picked = 0;
    let running = false;
    let realId = null;   /* server roundId when playing for real */
    let busy = false;    /* one pick request at a time */

    const grid = document.getElementById("minesGrid");

    /* Fair multiplier after `picks` safe tiles: the inverse of the
       probability of having survived them, with the edge applied. */
    function multFor(picks) {
      if (picks === 0) return 1;
      let p = 1;
      for (let i = 0; i < picks; i++) p *= (SIZE - mineCount - i) / (SIZE - i);
      return round2(RTP / p);
    }

    function build() {
      grid.innerHTML = "";
      for (let i = 0; i < SIZE; i++) {
        const t = document.createElement("div");
        t.className = "tile";
        t.dataset.i = i;
        t.addEventListener("click", () => pick(i));
        grid.appendChild(t);
      }
      ui.setPayout("Next Payout", fmtMult(multFor(1)));
    }

    function reveal(i, kind) {
      const t = grid.children[i];
      t.classList.add(kind);
      t.innerHTML = kind === "mine" ? icon("bomb") : icon("diamond");
    }

    /* mines: indices to dim-reveal at the end of the round. Demo mode
       reads them from the local field, real mode from the server. */
    function endRound(hitMine, mines) {
      running = false;
      realId = null;
      ui.setCashout(null);
      const list = mines || [];
      for (let i = 0; i < SIZE; i++) {
        const isMine = mines ? list.indexOf(i) !== -1 : field[i];
        if (isMine && !grid.children[i].classList.contains("mine")) {
          grid.children[i].classList.add("mine", "is-dim");
          grid.children[i].innerHTML = icon("bomb");
        }
      }
      if (hitMine) ui.settle(0, false, null);
    }

    function srvMines(r, o) {
      if (Array.isArray(o.mines)) return o.mines;
      if (Array.isArray(r.mines)) return r.mines;
      if (r.data && Array.isArray(r.data.mines)) return r.data.mines;
      return [];
    }

    async function pick(i) {
      if (!running || busy) return;
      const t = grid.children[i];
      if (t.classList.contains("gem") || t.classList.contains("mine")) return;

      if (realId) {
        busy = true;
        let r;
        try {
          r = await ui.act(realId, "pick", { index: i });
        } catch (e) { busy = false; return; }
        busy = false;
        if (!running) return;
        const o = srvOutcome(r);
        const isMine = o.result === "mine" || o.mine === true || (o.gem === false && o.result === undefined);

        if (isMine) {
          reveal(i, "mine");
          endRound(true, srvMines(r, o));
          return;
        }

        reveal(i, "gem");
        picked++;
        const m = o.mult !== undefined ? o.mult : multFor(picked);
        ui.setPayout("Next Payout", fmtMult(multFor(picked + 1)));
        ui.setCashout(m);

        /* Server auto-settles once every safe tile is open. */
        if (r.settled || o.settled || picked === SIZE - mineCount) {
          if (r.payout !== undefined) {
            endRound(false, srvMines(r, o));
            ui.settle(r.payoutFloat || 0, true, fmtMult(m));
          } else {
            cashout();
          }
        }
        return;
      }

      if (field[i]) {
        reveal(i, "mine");
        endRound(true);
        return;
      }

      reveal(i, "gem");
      picked++;
      const m = multFor(picked);
      ui.setPayout("Next Payout", fmtMult(multFor(picked + 1)));
      ui.setCashout(m);

      if (picked === SIZE - mineCount) cashout();
    }

    async function cashout() {
      if (!running || picked === 0 || busy) return;

      if (realId) {
        busy = true;
        let r;
        try {
          r = await ui.act(realId, "cashout");
        } catch (e) { busy = false; return; }
        busy = false;
        const o = srvOutcome(r);
        const m = o.mult !== undefined ? o.mult : multFor(picked);
        endRound(false, srvMines(r, o));
        ui.settle(r.payoutFloat || 0, true, fmtMult(m));
        return;
      }

      const m = multFor(picked);
      const stake = ui.stake();
      endRound(false);
      ui.settle(stake * m, true, fmtMult(m));
    }

    ui.onChip("mines", (v) => {
      mineCount = parseInt(v, 10);
      if (!running) ui.setPayout("Next Payout", fmtMult(multFor(1)));
    });
    ui.onCashout(cashout);
    build();

    ui.onPlay(async () => {
      if (ui.real()) {
        let r;
        try {
          r = await ui.place({ mines: mineCount });
        } catch (e) { ui.fail(e); return; }
        realId = r.roundId;
        field = [];
        picked = 0;
        running = true;
        busy = false;
        build();
        ui.setCashout(0);
        ui.hold();
        return;
      }

      /* place the mines up front, then never touch them again */
      field = new Array(SIZE).fill(false);
      const spots = E.shuffle(Array.from({ length: SIZE }, (_, i) => i)).slice(0, mineCount);
      spots.forEach((s) => (field[s] = true));

      realId = null;
      picked = 0;
      running = true;
      build();
      ui.setCashout(0);
      ui.hold();
    });
  },
};

/* --------------------------- CRASH -------------------------------
   The crash point is drawn before the round starts. Cashing out is a
   race against a number that is already fixed. In real mode the point
   lives on the server; the client animates the same curve and learns
   the truth from the cashout response or a resolve poll. */
GAMES.crash = {
  name: "Crash", ic: "rocket", sub: "pepe.fail Originals", ac: "orange",
  stats: [["99%", "RTP"], ["1,000,000×", "Max Win"]],
  action: "Bet",
  hint: "Cash out before the rocket crashes — otherwise the stake is lost.",
  controls: () => fieldBet() + fieldNumber("Auto Cashout", "auto", "2.00", "×"),
  stage: () => `
    <div class="crash-area">
      <div class="crash-mult" id="crashMult">1.00×</div>
      <div class="crash-chart">
        <svg viewBox="0 0 600 300" preserveAspectRatio="none">
          <defs>
            <linearGradient id="cg" x1="0" y1="1" x2="1" y2="0">
              <stop offset="0%" stop-color="#ffb020"/><stop offset="100%" stop-color="#ff5c00"/>
            </linearGradient>
            <linearGradient id="cf" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stop-color="rgba(255,122,0,.28)"/><stop offset="100%" stop-color="rgba(255,122,0,0)"/>
            </linearGradient>
          </defs>
          <g stroke="rgba(255,255,255,.05)" stroke-width="1">
            <line x1="0" y1="75" x2="600" y2="75"/><line x1="0" y1="150" x2="600" y2="150"/>
            <line x1="0" y1="225" x2="600" y2="225"/>
          </g>
          <path id="crashFill" d="" fill="url(#cf)"/>
          <path id="crashLine" d="" fill="none" stroke="url(#cg)" stroke-width="3.5" stroke-linecap="round"/>
        </svg>
      </div>
      <div class="history" id="crashHist"></div>
    </div>`,

  init(ui) {
    let auto = 2;
    let clock = 0;
    let running = false;
    let crashAt = 0;
    let started = 0;
    let stake = 0;
    let realId = null;
    let pollClock = 0;
    let polling = false;

    const out = document.getElementById("crashMult");
    const line = document.getElementById("crashLine");
    const fillP = document.getElementById("crashFill");
    const hist = document.getElementById("crashHist");

    ui.onInput("auto", (v) => { const n = parseFloat(v); if (isFinite(n)) auto = clamp(n, 1.01, 1000000); });

    function drawCurve(m) {
      const span = Math.max(2, m);
      const pts = [];
      for (let i = 0; i <= 40; i++) {
        const f = i / 40;
        const cur = 1 + (m - 1) * f;
        pts.push([f * 590, 290 - ((cur - 1) / (span - 1)) * 260]);
      }
      const d = pts.map((p, i) => (i ? "L" : "M") + p[0].toFixed(1) + " " + p[1].toFixed(1)).join(" ");
      line.setAttribute("d", d);
      fillP.setAttribute("d", d + " L590 290 L0 290 Z");
    }

    /* cashedAt: 0 means the round crashed. payoutOverride: in real mode
       the exact credited amount comes from the server, not stake*mult. */
    function stop(cashedAt, payoutOverride) {
      running = false;
      realId = null;
      window.clearInterval(clock);
      window.clearInterval(pollClock);
      ui.setCashout(null);
      ui.lock(false);

      const b = document.createElement("b");
      b.textContent = fmtMult(crashAt);
      b.className = crashAt >= 2 ? "win" : "";
      hist.prepend(b);
      while (hist.children.length > 8) hist.lastChild.remove();

      if (cashedAt) {
        out.className = "crash-mult is-win";
        ui.settle(payoutOverride !== undefined ? payoutOverride : stake * cashedAt, true, fmtMult(cashedAt));
      } else {
        out.textContent = fmtMult(crashAt);
        out.className = "crash-mult is-lose";
        ui.settle(0, false, null);
      }
    }

    /* A timer, not requestAnimationFrame: rAF is suspended whenever the
       tab is not being painted, and a suspended round would sit there
       with the stake already taken. A timer always comes back. */
    function curveAt(t) {
      return Math.max(1, Math.pow(Math.E, 0.11 * t * (1 + t * 0.06)));
    }

    function tick() {
      if (!running) return;
      const m = curveAt((Date.now() - started) / 1000);

      if (realId) {
        /* No local crash point: display the curve (held at the auto
           target if reached) and let the server end the round. */
        const shown = auto && m >= auto ? auto : m;
        out.textContent = fmtMult(shown);
        drawCurve(shown);
        return;
      }

      /* The curve is monotonic, so an auto target below the crash point
         is always reached first in game time — even when one coarse tick
         jumps past both thresholds at once. Checking the crash first
         used to eat those wins. */
      if (m >= crashAt) {
        drawCurve(crashAt);
        if (auto && auto < crashAt) stop(auto);
        else stop(0);
        return;
      }

      out.textContent = fmtMult(m);
      drawCurve(m);

      if (auto && m >= auto) { drawCurve(auto); stop(auto); return; }
    }

    function finishReal(r) {
      const o = srvOutcome(r);
      if (r.payout > 0) {
        /* auto cashout reached server-side */
        const m = o.mult !== undefined ? o.mult : (ui.stake() > 0 ? (r.payoutFloat || 0) / ui.stake() : auto);
        crashAt = o.crashAt !== undefined ? o.crashAt : m;
        drawCurve(m);
        stop(m, r.payoutFloat);
      } else {
        crashAt = Number(o.crashAt !== undefined ? o.crashAt : o.crashedAt) || 1;
        drawCurve(crashAt);
        stop(0);
      }
    }

    async function poll() {
      if (!running || !realId || polling) return;
      polling = true;
      let r;
      try {
        r = await ui.act(realId, "resolve");
      } catch (e) { polling = false; return; }
      polling = false;
      if (!running || !realId) return;
      if (r && (r.settled || (r.state && r.state === "settled") || srvOutcome(r).settled)) finishReal(r);
    }

    ui.onCashout(async () => {
      if (!running) return;

      if (realId) {
        const id = realId;
        let r;
        try {
          r = await ui.act(id, "cashout");
        } catch (e) { return; /* too late: the resolve poll will close it */ }
        if (!running) return;
        const o = srvOutcome(r);
        if (r.payout > 0) {
          const m = o.mult !== undefined ? o.mult : (ui.stake() > 0 ? (r.payoutFloat || 0) / ui.stake() : 1);
          crashAt = o.crashAt !== undefined ? o.crashAt : m;
          drawCurve(m);
          stop(m, r.payoutFloat);
        } else {
          finishReal(r);
        }
        return;
      }

      const m = curveAt((Date.now() - started) / 1000);
      stop(Math.min(m, crashAt));
    });

    ui.onPlay(async (bet) => {
      stake = bet;

      if (ui.real()) {
        let r;
        try {
          r = await ui.place({ auto: auto || 0 });
        } catch (e) { ui.fail(e); return; }
        realId = r.roundId;
        crashAt = 0;
        running = true;
        started = Date.now();
        out.className = "crash-mult";
        ui.lock(true);
        ui.setCashout(1);
        ui.hold();
        window.clearInterval(clock);
        window.clearInterval(pollClock);
        clock = window.setInterval(tick, 45);
        pollClock = window.setInterval(poll, 1000);
        return;
      }

      /* 1% of rounds crash instantly at 1.00×: that is the house edge */
      const u = rnd();
      crashAt = u < E.HOUSE_EDGE ? 1 : Math.max(1, Math.floor((RTP / (1 - u)) * 100) / 100);

      realId = null;
      running = true;
      started = Date.now();
      out.className = "crash-mult";
      ui.lock(true);
      ui.setCashout(1);
      ui.hold();
      window.clearInterval(clock);
      clock = window.setInterval(tick, 45);
    });
  },
};

/* --------------------------- WHEEL -------------------------------- */
/* Every table sums to 9.9 over 10 uniform segments: 99% RTP on all
   three risk levels, matching the figure printed on the page. Must stay
   identical to api/_lib/games.js. */
const WHEEL_TABLE = {
  Low:    [0, 1.2, 1.2, 1.2, 1.2, 0, 1.2, 1.2, 1.5, 1.2],
  Medium: [1.5, 0, 1.9, 0, 3, 0, 1.5, 0, 2, 0],
  High:   [0, 0, 0, 0, 0, 0, 0, 0, 0, 9.9],
};

GAMES.wheel = {
  name: "Wheel", ic: "wheel", sub: "pepe.fail Originals", ac: "orange",
  stats: [["99%", "RTP"], ["9.9×", "Max Win"]],
  action: "Spin",
  hint: "Spin the wheel and land on a paying segment.",
  controls: () => fieldBet() + fieldSelect("Risk", "risk", ["Low", "Medium", "High"], 1),
  stage: () => `
    <div class="wheel-area">
      <svg class="wheel-svg" viewBox="0 0 200 200">
        <g id="wheelSegs"></g>
        <circle cx="100" cy="100" r="54" fill="#0b0e15" stroke="rgba(255,210,30,.25)" stroke-width="1.5"/>
        <text id="wheelOut" x="100" y="96" text-anchor="middle" fill="#ffd21e"
          font-family="Bricolage Grotesque, sans-serif" font-size="24" font-weight="800">—</text>
        <text x="100" y="115" text-anchor="middle" fill="#6b74a6"
          font-family="Space Grotesk, sans-serif" font-size="9" font-weight="700" letter-spacing="1">MULTIPLIER</text>
      </svg>
      <polygon class="wheel-ptr" points="100,2 93,18 107,18" fill="#ffd21e"/>
    </div>`,

  init(ui) {
    let risk = "Medium";
    let angle = 0;

    const segs = document.getElementById("wheelSegs");
    const out = document.getElementById("wheelOut");
    const svg = segs.ownerSVGElement;

    function build() {
      const t = WHEEL_TABLE[risk];
      const N = t.length;
      const cx = 100, cy = 100, rOut = 92, rIn = 58;
      let html = "";
      for (let i = 0; i < N; i++) {
        const a0 = (i / N) * 2 * Math.PI - Math.PI / 2;
        const a1 = ((i + 1) / N) * 2 * Math.PI - Math.PI / 2;
        const p = (r, a) => `${(cx + r * Math.cos(a)).toFixed(2)} ${(cy + r * Math.sin(a)).toFixed(2)}`;
        const col = t[i] === 0 ? "#242c40" : t[i] >= 3 ? "#ff7a00" : "#ffd21e";
        html += `<path d="M ${p(rOut, a0)} A ${rOut} ${rOut} 0 0 1 ${p(rOut, a1)} L ${p(rIn, a1)} A ${rIn} ${rIn} 0 0 0 ${p(rIn, a0)} Z"
          fill="${col}" stroke="#0d1017" stroke-width="1.5"/>`;
      }
      segs.innerHTML = html;
      ui.setPayout("Max Win", fmtMult(Math.max.apply(null, t)));
    }

    ui.onChip("risk", (v) => { risk = v; build(); });
    build();

    function spinTo(idx, mult, ret) {
      const t = WHEEL_TABLE[risk];
      const N = t.length;

      /* land the pointer in the middle of the drawn segment */
      const segAngle = 360 / N;
      const target = 360 * 5 - (idx * segAngle + segAngle / 2);
      angle += target - (angle % 360);

      ui.lock(true);
      svg.style.transition = "transform 3s cubic-bezier(.15,.8,.2,1)";
      svg.style.transform = `rotate(${angle}deg)`;

      window.setTimeout(() => {
        out.textContent = fmtMult(mult);
        ui.lock(false);
        ui.settle(ret, mult >= 1, mult ? fmtMult(mult) : null);
      }, 3050);
    }

    ui.onPlay(async (bet) => {
      const t = WHEEL_TABLE[risk];

      if (ui.real()) {
        ui.lock(true);
        let r;
        try {
          r = await ui.place({ risk: risk });
        } catch (e) { ui.lock(false); ui.fail(e); return; }
        const o = srvOutcome(r);
        const idx = clamp(Number(o.index !== undefined ? o.index : o.idx) || 0, 0, t.length - 1);
        const mult = o.mult !== undefined ? o.mult : t[idx];
        spinTo(idx, mult, r.payoutFloat || 0);
        return;
      }

      const idx = rndInt(0, t.length - 1);
      const mult = t[idx];
      spinTo(idx, mult, bet * mult);
    });
  },
};

/* Blackjack ships in its own file and registers here. */
if (window.BLACKJACK_GAME) GAMES.blackjack = window.BLACKJACK_GAME;

/* ===================================================================
   PAGE MOUNT — builds the shell and hands each game a small API
   =================================================================== */
(function mountGamePage() {
  const g = GAMES[window.GAME];
  if (!g) return;

  document.getElementById("gameHead").innerHTML = `
    <div class="gh__ico">${icon(g.ic)}</div>
    <div>
      <h1 class="gh__title">${g.name}</h1>
      <div class="gh__sub">${g.sub}</div>
    </div>
    <div class="gh__stats">
      ${g.stats.map(([v, k]) => `<div class="gh__stat"><b>${v}</b><span>${k}</span></div>`).join("")}
    </div>`;

  document.getElementById("bet").innerHTML = `
    ${g.controls()}
    <div class="payout"><span data-payout-label>Multiplier</span><b data-payout-value>—</b></div>
    <div class="bet__result" data-result></div>
    <button class="btn btn--${g.ac || "orange"} btn--lg btn--block" data-play>${g.action}</button>
    <button class="btn btn--gold btn--lg btn--block" data-cashout hidden>Cash Out</button>`;

  document.getElementById("stage").innerHTML =
    g.stage() + `<div class="stage__hint">${g.hint}</div>`;

  document.title = `${g.name} — pepe.fail`;

  /* --- element handles --- */
  const bet = document.getElementById("bet");
  const playBtn = bet.querySelector("[data-play]");
  const cashBtn = bet.querySelector("[data-cashout]");
  const resultEl = bet.querySelector("[data-result]");
  const payLabel = bet.querySelector("[data-payout-label]");
  const payValue = bet.querySelector("[data-payout-value]");
  const betInput = bet.querySelector('[data-input="bet"]');
  const balOut = bet.querySelector("[data-balance]");

  let locked = false;
  let holding = false;      /* round in progress, play button stands down */
  let stake = 0;
  let playFn = null;
  let cashFn = null;
  let counted = false;      /* history is recorded once per page visit */
  let roundReal = false;    /* this round is settled by the server */

  function realNow() {
    return !!(window.PepeReal && window.PepeReal.on());
  }

  /* Real deployment with no session: the games are cut too, not just
     the topbar — otherwise a signed-out player quietly bets play money. */
  function sessionCut() {
    const R = window.PepeReal;
    return !!(R && R.enabled && R.enabled() && !R.on());
  }

  function paintBalance() {
    if (balOut) balOut.textContent = sessionCut() ? "—" : fmt(Bank.get());
  }

  Bank.onChange(paintBalance);
  document.addEventListener("pepe:real", paintBalance);
  paintBalance();

  function readBet() {
    const v = parseFloat(String(betInput.value).replace(",", "."));
    return isFinite(v) && v > 0 ? round2(v) : 0;
  }

  function setBet(v) {
    betInput.value = fmt(clamp(round2(v), 0, Bank.get()));
  }

  function flash(msg, kind) {
    resultEl.textContent = msg;
    resultEl.className = "bet__result" + (kind ? " is-" + kind : "");
  }

  /* --- the API each game is given --- */
  const ui = {
    stake: () => stake,

    onPlay(fn) { playFn = fn; },
    onCashout(fn) { cashFn = fn; },

    /* keeps the round open: the play button waits until settle() */
    hold() { holding = true; playBtn.hidden = true; },

    lock(v) { locked = v; playBtn.disabled = v || locked; },

    setPayout(label, value) {
      payLabel.textContent = label;
      payValue.textContent = value;
    },

    setCashout(mult) {
      if (mult === null) { cashBtn.hidden = true; return; }
      cashBtn.hidden = false;
      cashBtn.disabled = mult === 0;
      cashBtn.textContent = mult ? "Cash Out " + fmt(stake * mult) : "Cash Out";
    },

    setInput(name, value) {
      const el = bet.querySelector('[data-input="' + name + '"]');
      if (el && document.activeElement !== el) el.value = value;
    },

    onInput(name, fn) {
      const el = bet.querySelector('[data-input="' + name + '"]');
      if (el) el.addEventListener("input", () => fn(el.value));
    },

    onChip(name, fn) {
      const grp = bet.querySelector('[data-chipgroup="' + name + '"]');
      if (!grp) return;
      const buttons = Array.from(grp.querySelectorAll("button"));
      buttons.forEach((b) =>
        b.addEventListener("click", () => {
          if (holding) return;
          buttons.forEach((x) => {
            x.classList.toggle("active", x === b);
            x.classList.toggle("glass", x !== b);
          });
          fn(b.dataset.v);
        })
      );
    },

    /* --- real-mode bridge, used by the games --- */

    /* true while the current round is server-settled */
    real: () => roundReal,

    place(params) {
      return window.PepeReal.place(window.GAME, params, stake);
    },

    act(roundId, action, payload) {
      return window.PepeReal.act(roundId, action, payload);
    },

    /* Aborts a round that could not start (usually a rejected place):
       nothing was debited locally, so only the UI needs resetting. */
    fail(err) {
      holding = false;
      roundReal = false;
      playBtn.hidden = false;
      playBtn.disabled = false;
      locked = false;
      cashBtn.hidden = true;
      flash((err && err.message) || "Something went wrong", "lose");
    },

    /* Credits the return and closes the round. `amount` is the total
       returned, stake included — 0 means the stake is lost. In real
       mode the server already moved the money; the mirror repaints on
       its own, so no local credit happens. */
    settle(amount, won, multText) {
      holding = false;
      playBtn.hidden = false;
      playBtn.disabled = false;
      cashBtn.hidden = true;

      if (amount > 0 && !roundReal) Bank.add(amount);

      const net = round2(amount - stake);
      if (won) flash("+" + fmt(net) + (multText ? "  ·  " + multText : ""), "win");
      else flash("−" + fmt(stake), "lose");
      roundReal = false;
    },
  };

  /* --- bet amount shortcuts --- */
  bet.querySelectorAll("[data-bet]").forEach((b) => {
    b.addEventListener("click", () => {
      const cur = readBet();
      if (b.dataset.bet === "half") setBet(cur / 2);
      else if (b.dataset.bet === "double") setBet(cur * 2);
      else setBet(Bank.get());
    });
  });

  playBtn.addEventListener("click", () => {
    if (locked || holding || !playFn) return;

    if (sessionCut()) {
      flash("Sign in to play", "lose");
      if (window.PepeWalletPanel && window.PepeWalletPanel.account) window.PepeWalletPanel.account();
      return;
    }

    const amount = readBet();
    if (amount <= 0) { flash("Enter a bet amount", "lose"); return; }
    if (!Bank.canBet(amount)) { flash("Not enough balance", "lose"); return; }

    roundReal = realNow();
    stake = amount;
    /* Real mode: the server debits at place(); a local debit on top
       would double-count against the mirror. */
    if (!roundReal) Bank.sub(amount);
    E.Rank.wager(amount);
    flash("", null);

    if (!counted) { History.played(window.GAME); counted = true; }
    playFn(amount);
  });

  cashBtn.addEventListener("click", () => { if (cashFn) cashFn(); });

  g.init(ui);
})();
