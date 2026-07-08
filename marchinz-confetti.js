/*
 * marchinz-confetti.js (v1.28.0)
 * 依存ゼロの紙吹雪。window.MarchinZConfetti.burst() で約1.2秒の祝福を表示する。
 * 発火点: MarchinZ Log 新規作成、Journey 完走。prefers-reduced-motion では何もしない。
 */
(function () {
  "use strict";

  var COLORS = ["#1e4fd6", "#d97706", "#0f2138", "#e8b931", "#7c3aed"];
  var running = false;

  function reducedMotion() {
    try {
      return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    } catch (e) {
      return false;
    }
  }

  function burst(opts) {
    if (running || reducedMotion()) return;
    opts = opts || {};
    var count = Math.min(opts.count || 90, 160);
    var durationMs = Math.min(opts.duration || 1300, 2500);

    var canvas = document.createElement("canvas");
    canvas.setAttribute("aria-hidden", "true");
    canvas.style.cssText =
      "position:fixed;inset:0;width:100vw;height:100vh;pointer-events:none;z-index:2400;";
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.floor(window.innerWidth * dpr);
    canvas.height = Math.floor(window.innerHeight * dpr);
    var ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    document.body.appendChild(canvas);
    running = true;

    var W = window.innerWidth;
    var H = window.innerHeight;
    var parts = [];
    for (var i = 0; i < count; i++) {
      var fromLeft = i % 2 === 0;
      parts.push({
        x: fromLeft ? -10 : W + 10,
        y: H * (0.25 + Math.random() * 0.3),
        vx: (fromLeft ? 1 : -1) * (4 + Math.random() * 7),
        vy: -(6 + Math.random() * 6),
        w: 6 + Math.random() * 5,
        h: 8 + Math.random() * 7,
        rot: Math.random() * Math.PI,
        vr: (Math.random() - 0.5) * 0.35,
        color: COLORS[i % COLORS.length],
      });
    }

    var start = performance.now();
    function frame(now) {
      var t = now - start;
      ctx.clearRect(0, 0, W, H);
      var alive = false;
      for (var i = 0; i < parts.length; i++) {
        var p = parts[i];
        p.vy += 0.28;
        p.vx *= 0.985;
        p.x += p.vx;
        p.y += p.vy;
        p.rot += p.vr;
        if (p.y < H + 30) alive = true;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.globalAlpha = t > durationMs ? Math.max(0, 1 - (t - durationMs) / 400) : 1;
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
        ctx.restore();
      }
      if (alive && t < durationMs + 420) {
        requestAnimationFrame(frame);
      } else {
        canvas.remove();
        running = false;
      }
    }
    requestAnimationFrame(frame);
  }

  window.MarchinZConfetti = { burst: burst };
})();
