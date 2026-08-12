/* ===================================================================
   pepe.fail — in-house modal system
   No native alert/confirm/prompt anywhere on the site.

   window.PepeModal = {
     open(opts) -> handle,
     close(),                       closes the topmost modal
     confirm(opts) -> Promise<bool>,
     icon(key, strokeWidth)         small icon helper shared with wallet.js
   }

   opts = {
     title, subtitle,
     body,              HTML string
     actions: [{ label, variant: 'gold'|'orange'|'glass', onClick, keepOpen, name, disabled }],
     size: 'sm'|'md'|'lg',
     trust: true,       adds the reassurance band
     closable: true,    close button + overlay click + Escape
     onMount(handle), onClose()
   }

   Action handlers receive the handle. The modal closes after the handler
   unless the action sets keepOpen, or the handler returns false. A handler
   returning a promise puts its button in a busy state until it settles.
   =================================================================== */
(function () {
  "use strict";

  var MAX_STACK = 2;
  var FOCUSABLE =
    'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]),' +
    ' textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

  var stack = [];
  var seq = 0;
  var listening = false;
  var savedPadding = "";

  /* --- Local icons: the shared library has no lock or crossed-out eye --- */
  var LOCAL_ICONS = {
    lock:
      '<rect x="4.5" y="10.3" width="15" height="9.7" rx="2.2"/>' +
      '<path d="M7.8 10.3V7.7a4.2 4.2 0 0 1 8.4 0v2.6"/>' +
      '<circle cx="12" cy="15.1" r="1.15" fill="currentColor" stroke="none"/>',
    noEye:
      '<path d="M10.7 6.4A9.9 9.9 0 0 1 12 6.3c6 0 9.5 5.7 9.5 5.7a17.6 17.6 0 0 1-3.3 3.9"/>' +
      '<path d="M6.7 8.1A17.5 17.5 0 0 0 2.5 12S6 17.7 12 17.7c1.4 0 2.7-.3 3.9-.8"/>' +
      '<path d="M10.1 10.1a2.7 2.7 0 0 0 3.8 3.8"/><path d="M3.6 3.6l16.8 16.8"/>',
    close: '<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>',
    check: '<path d="m5.5 12.5 4.2 4.2L18.5 7.8"/>',
    copy:
      '<rect x="9" y="9" width="11" height="11" rx="2.2"/>' +
      '<path d="M15 6.6V5.5A1.5 1.5 0 0 0 13.5 4h-8A1.5 1.5 0 0 0 4 5.5v8A1.5 1.5 0 0 0 5.5 15h1.1"/>',
    alert:
      '<path d="M12 4.6 21 19.4H3L12 4.6Z"/><path d="M12 10v4"/>' +
      '<circle cx="12" cy="16.7" r=".95" fill="currentColor" stroke="none"/>',
    shield: '<path d="M12 2 4 6v6c0 5 3.4 8.5 8 10 4.6-1.5 8-5 8-10V6z"/>',
  };

  function rawSvg(path, sw) {
    return (
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="' +
      (sw || 1.7) +
      '" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      path +
      "</svg>"
    );
  }

  /* Prefer the shared icon library when it carries the key, else fall back. */
  function pmIcon(key, sw) {
    try {
      if (typeof icon === "function" && typeof ICONS === "object" && ICONS && ICONS[key]) {
        return icon(key, sw);
      }
    } catch (e) {
      /* icons.js not loaded on this page */
    }
    return rawSvg(LOCAL_ICONS[key] || LOCAL_ICONS.lock, sw);
  }

  function esc(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function basePath() {
    return (window.PAGE && window.PAGE.base) || "";
  }

  function reducedMotion() {
    return (
      window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches
    );
  }

  /* =========================== SCROLL LOCK =========================== */
  function lockScroll() {
    if (stack.length > 1) return;
    var gap = window.innerWidth - document.documentElement.clientWidth;
    savedPadding = document.body.style.paddingRight;
    if (gap > 0) document.body.style.paddingRight = gap + "px";
    document.documentElement.classList.add("pm-lock");
    document.body.classList.add("pm-lock");
  }

  function unlockScroll() {
    if (stack.length) return;
    document.documentElement.classList.remove("pm-lock");
    document.body.classList.remove("pm-lock");
    document.body.style.paddingRight = savedPadding;
  }

  /* =========================== FOCUS =========================== */
  function visibleFocusables(panel) {
    return Array.prototype.filter.call(panel.querySelectorAll(FOCUSABLE), function (el) {
      return el.offsetWidth > 0 || el.offsetHeight > 0 || el === document.activeElement;
    });
  }

  function onKeydown(e) {
    var top = stack[stack.length - 1];
    if (!top) return;

    if (e.key === "Escape") {
      if (top.closable) {
        e.preventDefault();
        top.close();
      }
      return;
    }
    if (e.key !== "Tab") return;

    var items = visibleFocusables(top.panel);
    if (!items.length) {
      e.preventDefault();
      top.panel.focus();
      return;
    }
    var first = items[0];
    var last = items[items.length - 1];
    var active = document.activeElement;
    var inside = top.panel.contains(active);

    if (e.shiftKey && (active === first || !inside)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && (active === last || !inside)) {
      e.preventDefault();
      first.focus();
    }
  }

  function onFocusIn(e) {
    var top = stack[stack.length - 1];
    if (top && !top.overlay.contains(e.target)) top.panel.focus();
  }

  function startListening() {
    if (listening) return;
    listening = true;
    document.addEventListener("keydown", onKeydown, true);
    document.addEventListener("focusin", onFocusIn, true);
  }

  function stopListening() {
    if (!listening || stack.length) return;
    listening = false;
    document.removeEventListener("keydown", onKeydown, true);
    document.removeEventListener("focusin", onFocusIn, true);
  }

  /* =========================== FRAGMENTS =========================== */
  function trustBand() {
    var rows = [
      ["lock", "Encrypted in your browser"],
      ["shield", "Your key never leaves this device"],
      ["noEye", "We store nothing on our servers"],
    ];
    return (
      '<div class="pm-trust">' +
      rows
        .map(function (r) {
          return '<div class="pm-trust__row">' + pmIcon(r[0]) + "<span>" + r[1] + "</span></div>";
        })
        .join("") +
      "</div>"
    );
  }

  function brandBlock() {
    return (
      '<div class="pm-brand"><img src="' +
      basePath() +
      'assets/img/logo.png" alt="" width="20" height="20" /><span>pepe.fail</span></div>'
    );
  }

  /* =========================== OPEN =========================== */
  function open(opts) {
    opts = opts || {};

    /* Two layers maximum: a third request replaces the topmost one. */
    while (stack.length >= MAX_STACK) stack[stack.length - 1].close(true);

    var id = ++seq;
    var closable = opts.closable !== false;
    var returnFocus = document.activeElement;
    var closed = false;

    var overlay = document.createElement("div");
    overlay.className = "pm-overlay";
    overlay.style.zIndex = String(900 + stack.length * 10);

    var panel = document.createElement("div");
    panel.className = "pm-panel pm-panel--" + (opts.size || "md");
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-modal", "true");
    panel.tabIndex = -1;
    if (opts.title) panel.setAttribute("aria-labelledby", "pm-t-" + id);
    if (opts.subtitle) panel.setAttribute("aria-describedby", "pm-s-" + id);

    var html = "";
    if (closable) {
      html +=
        '<button class="pm-close" type="button" data-pm-close aria-label="Close">' +
        pmIcon("close", 2) +
        "</button>";
    }
    if (opts.title || opts.subtitle) {
      html += '<header class="pm-head">';
      if (opts.title) html += '<h2 class="pm-title" id="pm-t-' + id + '">' + esc(opts.title) + "</h2>";
      if (opts.subtitle) html += '<p class="pm-sub" id="pm-s-' + id + '">' + esc(opts.subtitle) + "</p>";
      html += "</header>";
    }
    html += '<div class="pm-body" data-pm-body>' + (opts.body || "") + "</div>";
    if (opts.trust) html += trustBand();
    html += '<div class="pm-actions" data-pm-actions hidden></div>';
    html += brandBlock();

    panel.innerHTML = html;
    overlay.appendChild(panel);

    /* --- handle --- */
    var handle = {
      id: id,
      overlay: overlay,
      panel: panel,
      body: panel.querySelector("[data-pm-body]"),
      closable: closable,
      close: close,
      setTitle: setTitle,
      setSubtitle: setSubtitle,
      setBody: setBody,
      setActions: setActions,
      find: function (selector) {
        return panel.querySelector(selector);
      },
      findAll: function (selector) {
        return Array.prototype.slice.call(panel.querySelectorAll(selector));
      },
      action: function (name) {
        return panel.querySelector('[data-pm-name="' + name + '"]');
      },
    };

    function setTitle(text) {
      var el = panel.querySelector(".pm-title");
      if (el) el.textContent = text;
    }

    function setSubtitle(text) {
      var el = panel.querySelector(".pm-sub");
      if (el) el.textContent = text;
    }

    function setBody(markup) {
      handle.body.innerHTML = markup || "";
      handle.body.scrollTop = 0;
    }

    function setActions(actions) {
      var host = panel.querySelector("[data-pm-actions]");
      host.innerHTML = "";
      actions = actions || [];
      host.hidden = actions.length === 0;

      actions.forEach(function (a, index) {
        if (!a) return;
        var btn = document.createElement("button");
        btn.type = "button";
        btn.className = "pm-btn pm-btn--" + (a.variant || "glass");
        btn.dataset.pmAction = String(index);
        if (a.name) btn.dataset.pmName = a.name;
        if (a.disabled) btn.disabled = true;
        btn.innerHTML = '<span class="pm-btn__label">' + esc(a.label || "OK") + "</span>";

        btn.addEventListener("click", function () {
          if (btn.disabled || btn.classList.contains("is-busy")) return;
          var result;
          try {
            result = a.onClick ? a.onClick(handle) : undefined;
          } catch (err) {
            console.error(err);
            return;
          }
          if (result && typeof result.then === "function") {
            setBusy(btn, true);
            result.then(
              function (value) {
                setBusy(btn, false);
                if (!a.keepOpen && value !== false) close();
              },
              function (err) {
                setBusy(btn, false);
                console.error(err);
              }
            );
          } else if (!a.keepOpen && result !== false) {
            close();
          }
        });

        host.appendChild(btn);
      });
    }

    function setBusy(btn, busy) {
      if (busy) {
        btn.classList.add("is-busy");
        btn.setAttribute("aria-busy", "true");
        if (!btn.querySelector(".pm-spin")) {
          var s = document.createElement("span");
          s.className = "pm-spin";
          btn.insertBefore(s, btn.firstChild);
        }
      } else {
        btn.classList.remove("is-busy");
        btn.removeAttribute("aria-busy");
        var spin = btn.querySelector(".pm-spin");
        if (spin) spin.remove();
      }
    }

    function close(immediate) {
      if (closed) return;
      closed = true;

      var index = stack.indexOf(handle);
      if (index >= 0) stack.splice(index, 1);

      overlay.classList.remove("is-open");

      var finish = function () {
        if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
        unlockScroll();
        stopListening();
        if (returnFocus && document.contains(returnFocus) && typeof returnFocus.focus === "function") {
          returnFocus.focus();
        }
        if (typeof opts.onClose === "function") opts.onClose();
      };

      if (immediate === true || reducedMotion()) finish();
      else setTimeout(finish, 180);
    }

    setActions(opts.actions);

    /* --- close affordances --- */
    if (closable) {
      var closeBtn = panel.querySelector("[data-pm-close]");
      if (closeBtn) closeBtn.addEventListener("click", function () { close(); });

      var downOnOverlay = false;
      overlay.addEventListener("mousedown", function (e) {
        downOnOverlay = e.target === overlay;
      });
      overlay.addEventListener("click", function (e) {
        if (e.target === overlay && downOnOverlay) close();
        downOnOverlay = false;
      });
    }

    /* --- mount --- */
    document.body.appendChild(overlay);
    stack.push(handle);
    lockScroll();
    startListening();

    /* Force a frame so the entrance transition actually runs. */
    void overlay.offsetHeight;
    overlay.classList.add("is-open");

    if (typeof opts.onMount === "function") opts.onMount(handle);

    var target =
      panel.querySelector("[autofocus]") ||
      panel.querySelector(".pm-body input, .pm-body select, .pm-body textarea") ||
      panel.querySelector('[data-pm-actions] .pm-btn:not([disabled])') ||
      panel;
    try {
      target.focus({ preventScroll: true });
    } catch (e) {
      target.focus();
    }

    return handle;
  }

  /* =========================== CLOSE TOPMOST =========================== */
  function closeTop() {
    var top = stack[stack.length - 1];
    if (top) top.close();
  }

  /* =========================== CONFIRM =========================== */
  function confirmModal(opts) {
    opts = opts || {};
    return new Promise(function (resolve) {
      var settled = false;
      var settle = function (value) {
        if (settled) return;
        settled = true;
        resolve(value);
      };

      open({
        title: opts.title || "Are you sure?",
        subtitle: opts.subtitle,
        body: opts.body || "",
        size: opts.size || "sm",
        trust: opts.trust,
        closable: opts.closable !== false,
        onMount: opts.onMount,
        actions: [
          {
            label: opts.cancelLabel || "Cancel",
            variant: "glass",
            onClick: function () { settle(false); },
          },
          {
            label: opts.confirmLabel || "Confirm",
            variant: opts.confirmVariant || "gold",
            onClick: function () { settle(true); },
          },
        ],
        onClose: function () {
          settle(false);
          if (typeof opts.onClose === "function") opts.onClose();
        },
      });
    });
  }

  window.PepeModal = {
    open: open,
    close: closeTop,
    confirm: confirmModal,
    icon: pmIcon,
  };
})();
