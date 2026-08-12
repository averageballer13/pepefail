/* ===================================================================
   pepe.fail — game page engine (UI only)
   Every page sets window.GAME = "<key>" before loading this script.
   =================================================================== */

/* --- Reusable control blocks --- */
/* Preset chips: secondary controls, so every button is glass and the
   selected one carries .active on top. */
function fieldSelect(label, options, activeIdx) {
  const sel = activeIdx || 0;
  return `
  <div class="field">
    <div class="field__label">${label}</div>
    <div class="chips" data-chipgroup>
      ${options
        .map((o, i) => `<button class="glass${i === sel ? " active" : ""}">${o}</button>`)
        .join("")}
    </div>
  </div>`;
}

function fieldInput(label, value, right, mini) {
  return `
  <div class="field">
    <div class="field__label">${label}${right ? `<b>${right}</b>` : ""}</div>
    <div class="input-wrap">
      <span class="cur">${icon("coin")}</span>
      <input type="text" value="${value}" />
      ${mini ? `<button class="mini glass">½</button><button class="mini glass">2×</button>` : ""}
    </div>
  </div>`;
}

/* ===================================================================
   GAME CONFIGURATION
   ac = accent of the primary action button: "gold" or "orange"
   =================================================================== */
const GAMES = {
  plinko: {
    name: "Plinko",
    ic: "plinko",
    sub: "pepe.fail Originals",
    ac: "gold",
    stats: [["99%", "RTP"], ["1000×", "Max Win"]],
    controls: () =>
      fieldInput("Bet Amount", "1.00", "$1.00", true) +
      fieldSelect("Risk", ["Low", "Medium", "High"], 1) +
      fieldSelect("Rows", ["8", "10", "12", "16"], 3),
    payout: ["Potential Win", "1000.00×"],
    action: "Drop Ball",
    stage: stagePlinko,
    hint: "Drop a ball and let it bounce — the closer it lands to the edges, the higher the multiplier.",
  },

  mines: {
    name: "Mines",
    ic: "bomb",
    sub: "pepe.fail Originals",
    ac: "orange",
    stats: [["99%", "RTP"], ["24,610×", "Max Win"]],
    controls: () =>
      fieldInput("Bet Amount", "1.00", "$1.00", true) +
      fieldSelect("Mines", ["1", "3", "5", "10"], 1) +
      fieldInput("Profit", "0.00", "0.00×", false),
    payout: ["Next Payout", "1.08×"],
    action: "Bet",
    stage: stageMines,
    hint: "Reveal tiles without hitting a mine, then cash out whenever you want.",
  },

  dice: {
    name: "Dice",
    ic: "dice",
    sub: "pepe.fail Originals",
    ac: "gold",
    stats: [["99%", "RTP"], ["9900×", "Max Win"]],
    controls: () =>
      fieldInput("Bet Amount", "1.00", "$1.00", true) +
      fieldInput("Profit on Win", "1.98", "1.98×", false) +
      fieldSelect("Roll", ["Under", "Over"], 1),
    payout: ["Win Chance", "49.50%"],
    action: "Roll Dice",
    stage: stageDice,
    hint: "Drag the slider to set your threshold — the more risk you take, the bigger the payout.",
  },

  crash: {
    name: "Crash",
    ic: "rocket",
    sub: "pepe.fail Originals",
    ac: "orange",
    stats: [["99%", "RTP"], ["1,000,000×", "Max Win"]],
    controls: () =>
      fieldInput("Bet Amount", "1.00", "$1.00", true) +
      fieldInput("Auto Cashout", "2.00", "2.00×", false) +
      fieldSelect("Mode", ["Manual", "Auto"], 0),
    payout: ["Potential Win", "2.00×"],
    action: "Bet",
    stage: stageCrash,
    hint: "Cash out before the rocket crashes — otherwise the bet is lost.",
  },

  limbo: {
    name: "Limbo",
    ic: "chart",
    sub: "pepe.fail Originals",
    ac: "gold",
    stats: [["99%", "RTP"], ["1,000,000×", "Max Win"]],
    controls: () =>
      fieldInput("Bet Amount", "1.00", "$1.00", true) +
      fieldInput("Target Multiplier", "2.00", "2.00×", false),
    payout: ["Win Chance", "49.50%"],
    action: "Bet",
    stage: stageLimbo,
    hint: "Pick a target multiplier — the draw has to beat it for the bet to win.",
  },

  wheel: {
    name: "Wheel",
    ic: "wheel",
    sub: "pepe.fail Originals",
    ac: "orange",
    stats: [["99%", "RTP"], ["50×", "Max Win"]],
    controls: () =>
      fieldInput("Bet Amount", "1.00", "$1.00", true) +
      fieldSelect("Risk", ["Low", "Medium", "High"], 1) +
      fieldSelect("Segments", ["10", "20", "30", "50"], 1),
    payout: ["Potential Win", "9.90×"],
    action: "Spin",
    stage: stageWheel,
    hint: "Spin the wheel and land on a paying segment.",
  },
};

/* ===================================================================
   STAGE RENDERERS
   =================================================================== */

/* --- PLINKO: peg pyramid + multiplier row --- */
function stagePlinko() {
  let rows = "";
  for (let r = 3; r <= 13; r++) {
    rows += `<div class="peg-row">${'<div class="peg"></div>'.repeat(r)}</div>`;
  }
  const mults = ["110×", "41×", "10×", "5×", "3×", "1.5×", "1×", "0.5×", "1×", "1.5×", "3×", "5×", "10×", "41×", "110×"];
  const cells = mults
    .map((m, i) => {
      const edge = Math.min(i, mults.length - 1 - i);
      const cls = edge <= 1 ? "m-hi" : edge >= 5 ? "m-lo" : "";
      return `<div class="mult ${cls}">${m}</div>`;
    })
    .join("");
  return `<div class="plinko"><div class="pegs">${rows}</div><div class="mults">${cells}</div></div>`;
}

/* --- MINES: 5×5 grid --- */
function stageMines() {
  const revealed = { 6: "gem", 8: "gem", 12: "gem", 17: "mine", 21: "gem" };
  let tiles = "";
  for (let i = 0; i < 25; i++) {
    const st = revealed[i] || "";
    const ic = st === "mine" ? icon("bomb") : icon("diamond");
    tiles += `<div class="tile ${st}" data-i="${i}">${ic}</div>`;
  }
  return `<div class="mines-grid">${tiles}</div>`;
}

/* --- DICE: result readout + slider --- */
function stageDice() {
  return `
  <div class="dice-area">
    <div class="dice-result" id="diceVal">50.50</div>
    <div>
      <div class="slider"><div class="slider__knob"></div></div>
      <div class="scale"><span>0</span><span>25</span><span>50</span><span>75</span><span>100</span></div>
    </div>
    <div class="history">
      <b class="win">72.4</b><b>18.9</b><b class="win">55.1</b><b>7.3</b>
      <b class="big">98.7</b><b class="win">61.0</b><b>31.2</b><b class="win">88.4</b>
    </div>
  </div>`;
}

/* --- CRASH: rising curve --- */
function stageCrash() {
  return `
  <div class="crash-area">
    <div class="crash-mult">2.47×</div>
    <div class="crash-chart">
      <svg viewBox="0 0 600 300" preserveAspectRatio="none">
        <defs>
          <linearGradient id="cg" x1="0" y1="1" x2="1" y2="0">
            <stop offset="0%" stop-color="#ffb020"/>
            <stop offset="100%" stop-color="#ff5c00"/>
          </linearGradient>
          <linearGradient id="cf" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="rgba(255,122,0,.28)"/>
            <stop offset="100%" stop-color="rgba(255,122,0,0)"/>
          </linearGradient>
        </defs>
        <g stroke="rgba(255,255,255,.05)" stroke-width="1">
          <line x1="0" y1="75" x2="600" y2="75"/><line x1="0" y1="150" x2="600" y2="150"/>
          <line x1="0" y1="225" x2="600" y2="225"/>
          <line x1="150" y1="0" x2="150" y2="300"/><line x1="300" y1="0" x2="300" y2="300"/>
          <line x1="450" y1="0" x2="450" y2="300"/>
        </g>
        <path d="M0 300 Q 250 290 400 150 T 560 40 L 560 300 Z" fill="url(#cf)"/>
        <path d="M0 300 Q 250 290 400 150 T 560 40" fill="none" stroke="url(#cg)" stroke-width="4.5" stroke-linecap="round"/>
        <circle cx="560" cy="40" r="8" fill="#ffb020"/>
        <circle cx="560" cy="40" r="14" fill="none" stroke="rgba(255,176,32,.35)" stroke-width="3"/>
      </svg>
    </div>
    <div class="history">
      <b class="big">14.82×</b><b>1.09×</b><b class="win">3.44×</b><b>1.51×</b>
      <b class="win">2.07×</b><b>1.02×</b><b class="big">27.60×</b><b class="win">4.13×</b>
    </div>
  </div>`;
}

/* --- LIMBO: oversized multiplier --- */
function stageLimbo() {
  return `
  <div class="dice-area">
    <div class="crash-mult" style="font-size:88px">3.72×</div>
    <div class="history">
      <b class="win">2.14×</b><b>1.02×</b><b class="big">18.90×</b><b>1.31×</b>
      <b class="win">5.77×</b><b>1.00×</b><b class="win">2.45×</b><b class="big">44.10×</b>
    </div>
  </div>`;
}

/* --- WHEEL: segmented SVG wheel --- */
function stageWheel() {
  const N = 20;
  const COLORS = ["#ffd21e", "#ff7a00", "#242c40", "#ffb020", "#171c2a"];
  const cx = 100, cy = 100, rOut = 92, rIn = 62;
  let segs = "";
  for (let i = 0; i < N; i++) {
    const a0 = (i / N) * 2 * Math.PI - Math.PI / 2;
    const a1 = ((i + 1) / N) * 2 * Math.PI - Math.PI / 2;
    const p = (r, a) => `${(cx + r * Math.cos(a)).toFixed(2)} ${(cy + r * Math.sin(a)).toFixed(2)}`;
    segs += `<path d="M ${p(rOut, a0)} A ${rOut} ${rOut} 0 0 1 ${p(rOut, a1)} L ${p(rIn, a1)} A ${rIn} ${rIn} 0 0 0 ${p(rIn, a0)} Z"
      fill="${COLORS[i % COLORS.length]}" stroke="#0d1017" stroke-width="1.5"/>`;
  }
  return `
  <div class="wheel-area">
    <svg class="wheel-svg" viewBox="0 0 200 200">
      ${segs}
      <circle cx="100" cy="100" r="54" fill="#0b0e15" stroke="rgba(255,210,30,.25)" stroke-width="1.5"/>
      <text x="100" y="96" text-anchor="middle" fill="#ffd21e"
        font-family="Bricolage Grotesque, sans-serif" font-size="26" font-weight="800">1.50×</text>
      <text x="100" y="115" text-anchor="middle" fill="#6b74a6"
        font-family="Space Grotesk, sans-serif" font-size="9" font-weight="700" letter-spacing="1">SEGMENT</text>
      <polygon points="100,4 94,18 106,18" fill="#ffd21e"/>
    </svg>
  </div>`;
}

/* Blackjack ships in its own file and registers here. */
if (window.BLACKJACK_GAME) GAMES.blackjack = window.BLACKJACK_GAME;

/* ===================================================================
   PAGE MOUNT
   =================================================================== */
(function mountGamePage() {
  const g = GAMES[window.GAME];
  if (!g) return;

  /* Header */
  document.getElementById("gameHead").innerHTML = `
    <div class="gh__ico">${icon(g.ic)}</div>
    <div>
      <h1 class="gh__title">${g.name}</h1>
      <div class="gh__sub">${g.sub}</div>
    </div>
    <div class="gh__stats">
      ${g.stats.map(([v, k]) => `<div class="gh__stat"><b>${v}</b><span>${k}</span></div>`).join("")}
    </div>`;

  /* Bet panel — inactive tabs are glass, the action button keeps its accent */
  document.getElementById("bet").innerHTML = `
    <div class="bet__tabs">
      <button class="active">Manual</button>
      <button class="glass">Auto</button>
    </div>
    ${g.controls()}
    <div class="payout"><span>${g.payout[0]}</span><b>${g.payout[1]}</b></div>
    <button class="btn btn--${g.ac || "orange"} btn--lg btn--block">${g.action}</button>`;

  /* Stage */
  document.getElementById("stage").innerHTML =
    g.stage() + `<div class="stage__hint">${g.hint}</div>`;

  document.title = `${g.name} — pepe.fail`;

  /* Moves .active to the clicked button and keeps the others glass. */
  function selectOne(buttons, picked) {
    buttons.forEach((b) => {
      b.classList.toggle("active", b === picked);
      b.classList.toggle("glass", b !== picked);
    });
  }

  /* --- Light UI-only interactions --- */
  document.querySelectorAll("[data-chipgroup]").forEach((grp) => {
    const buttons = Array.from(grp.querySelectorAll("button"));
    buttons.forEach((b) => b.addEventListener("click", () => selectOne(buttons, b)));
  });

  const tabs = Array.from(document.querySelectorAll(".bet__tabs button"));
  tabs.forEach((b) => b.addEventListener("click", () => selectOne(tabs, b)));

  /* Mines: toggle a tile on click */
  document.querySelectorAll(".tile").forEach((t) => {
    t.addEventListener("click", () => {
      if (t.classList.contains("gem") || t.classList.contains("mine")) {
        t.classList.remove("gem", "mine");
      } else {
        t.classList.add("gem");
      }
    });
  });
})();
