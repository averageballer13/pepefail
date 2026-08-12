/* ===================================================================
   pepe.fail — entry loader

   The bar tracks real loading: images and fonts actually arriving,
   not a scripted countdown. It is held at 90% until the window load
   event so it never sits full while the page is still blank.

   Whether the loader shows at all is decided by the inline snippet in
   the page head, before first paint.
   =================================================================== */

(function () {
  "use strict";

  var el = document.getElementById("loader");
  if (!el || !el.classList.contains("is-on")) return;

  var fill = el.querySelector(".loader__fill");
  var pct = el.querySelector(".loader__pct");

  var MIN_MS = 900;      /* below this it reads as a glitch, not a load */
  var started = Date.now();
  var shown = 0;
  var done = false;

  function paint(v) {
    shown = Math.max(shown, Math.min(100, v));
    fill.style.width = shown + "%";
    if (pct) pct.textContent = Math.round(shown) + "%";
  }

  /* --- Real progress: how many images have arrived --- */
  function assetProgress() {
    var imgs = Array.prototype.slice.call(document.images);
    if (!imgs.length) return document.readyState === "complete" ? 1 : 0.5;
    var ready = 0;
    for (var i = 0; i < imgs.length; i++) if (imgs[i].complete) ready++;
    return ready / imgs.length;
  }

  /* Creep toward 90% so the bar keeps moving on a slow connection,
     but never claims to be finished before the page actually is. */
  var timer = window.setInterval(function () {
    if (done) return;
    var real = assetProgress() * 90;
    var crept = shown + (90 - shown) * 0.06;
    paint(Math.max(real, crept));
  }, 90);

  function finish() {
    if (done) return;
    done = true;
    window.clearInterval(timer);
    paint(100);

    var waited = Date.now() - started;
    var rest = Math.max(0, MIN_MS - waited);

    window.setTimeout(function () {
      el.classList.add("is-done");
      /* stop it intercepting anything once it is invisible */
      window.setTimeout(function () { el.remove(); }, 420);
    }, rest + 180);
  }

  if (document.readyState === "complete") finish();
  else window.addEventListener("load", finish);

  /* Never trap the visitor behind the loader if something stalls. */
  window.setTimeout(finish, 6000);
})();
