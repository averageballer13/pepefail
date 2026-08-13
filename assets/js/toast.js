/* ===================================================================
   pepe.fail — toast notifications

   Small pill at the top-middle of the screen. Self-contained: styles
   are injected here so no page needs another stylesheet, and the
   deposit listener lives here so no other module has to know toasts
   exist. The arrival sound comes free: sfx.js already rings the coin
   whenever the balance rises.
   =================================================================== */

(function () {
  "use strict";

  var CSS =
    ".pt-wrap{position:fixed;top:14px;left:50%;transform:translateX(-50%);z-index:9500;" +
    "display:flex;flex-direction:column;align-items:center;gap:8px;pointer-events:none}" +
    ".pt{display:flex;align-items:center;gap:9px;padding:10px 16px;border-radius:12px;" +
    "background:var(--panel,#131724);border:1px solid rgba(255,210,30,.4);" +
    "box-shadow:0 8px 30px rgba(0,0,0,.5),0 0 18px rgba(255,200,40,.15);" +
    "font-family:var(--font,'Space Grotesk',sans-serif);font-size:13.5px;font-weight:700;" +
    "color:var(--text,#eaeeff);opacity:0;transform:translateY(-8px);" +
    "transition:opacity 220ms cubic-bezier(.25,.6,.2,1),transform 220ms cubic-bezier(.25,.6,.2,1)}" +
    ".pt.is-in{opacity:1;transform:none}" +
    ".pt__ico{display:grid;place-items:center;width:18px;height:18px;color:var(--gold,#ffd21e)}" +
    ".pt__ico svg{width:100%;height:100%}" +
    ".pt b{color:var(--gold,#ffd21e)}" +
    "@media (prefers-reduced-motion:reduce){.pt{transition:none}}";

  var wrap = null;

  function ensure() {
    if (wrap) return wrap;
    var style = document.createElement("style");
    style.textContent = CSS;
    document.head.appendChild(style);
    wrap = document.createElement("div");
    wrap.className = "pt-wrap";
    document.body.appendChild(wrap);
    return wrap;
  }

  function show(html, ms) {
    var host = ensure();
    var el = document.createElement("div");
    el.className = "pt";
    var coin = typeof icon === "function" ? icon("coin", 2) : "";
    el.innerHTML = '<span class="pt__ico">' + coin + "</span><span>" + html + "</span>";
    host.appendChild(el);

    /* two frames so the entry transition actually runs */
    requestAnimationFrame(function () {
      requestAnimationFrame(function () { el.classList.add("is-in"); });
    });

    setTimeout(function () {
      el.classList.remove("is-in");
      setTimeout(function () { el.remove(); }, 260);
    }, ms || 5000);
  }

  window.PepeToast = { show: show };

  /* A deposit landing is THE moment this exists for. */
  document.addEventListener("pepe:deposit", function (e) {
    var amount = e.detail && e.detail.amountFloat;
    if (!(amount > 0)) return;
    var pretty = (Math.round(amount * 10000) / 10000).toString();
    show("<b>+" + pretty + " SOL</b>&nbsp;deposited — balance updated", 6000);
  });
})();
