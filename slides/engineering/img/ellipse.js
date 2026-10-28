/*
 * ellipse.js: the covariance ellipse. Three sliders (σx, σy, ρ) set the covariance P of a cloud of 2D errors;
 * the picture shows the cloud, its 1σ and 2σ ellipses and its centre, and the panel prints P and how many of
 * the points each ellipse holds. A lesson component in the manner of bells.js: vanilla JavaScript, no libraries,
 * works offline from file://.
 *
 * Mount it on any empty block element:
 *
 *   <div id="demo"></div>
 *   <script src="img/ellipse.js"></script>
 *   <script>
 *     var demo = Ellipse.mount(document.getElementById('demo'), {
 *       sigmaX: Math.sqrt(13), sigmaY: Math.sqrt(13), rho: 12 / 13    // P = [[13, 12], [12, 13]] cm²
 *     });
 *   </script>
 *
 * The cloud. n pairs (u, v) from a seeded generator (mulberry32 + Box–Muller), shifted and turned once so that
 * their mean is exactly 0 and their mean products exactly [[1, 0], [0, 1]]. The sliders map the SAME pairs to errors
 *
 *     x = σx·u,   y = σy·(ρ·u + √(1 − ρ²)·v),
 *
 * so the mean products of the errors are exactly P = [[σx², ρσxσy], [ρσxσy, σy²]]: the printed P is the cloud's own.
 * The kσ ellipse is the circle u² + v² = k² pushed through the same map, and a point is inside it when
 * xᵀP⁻¹x ≤ k². That number equals u² + v² whatever the sliders, so the counts never change: about 39 % of the
 * points inside 1σ and 86 % inside 2σ (in 2D the share inside kσ is 1 − e^(−k²/2)). That is the lesson.
 * No eigenvalues anywhere: the slide does not need them.
 *
 * Options (all optional; DEFAULTS below):
 *   sigmaX, sigmaY, rho   the start, and what reset returns to; σ in `unit`
 *   sigmaRange, rhoRange  the slider ranges; sigmaStep, rhoStep their steps
 *   n, seed               the fixed cloud: how many points, and the generator's seed
 *   levels                the ellipses drawn and counted, in σ: [1, 2] (the first solid, the others dashed)
 *   range, tick           the plot shows −range … range on both axes, in `unit`; grid lines every `tick`
 *   size                  the plot's side, px: the SVG is drawn at 1 unit = 1 slide px
 *   unit, decimal         the unit of x and y; the decimal mark of every printed number
 *   xLabel, yLabel        the axis titles
 *   resetLabel            the text of the button that returns to the start
 *   blur                  true: a released slider or a pressed button gives the keyboard back to the deck,
 *                         so → and the clicker change the slide again
 *   onChange              function(state), called after every change
 *
 * Returns a controller:
 *   get()        → {sigmaX, sigmaY, rho, P: [[a, b], [b, c]], inside: [count per level], n}
 *   set(values)  → change any of sigmaX, sigmaY, rho (clamped to the slider ranges)
 *   reset()      → back to the start
 *   element      → the mounted element
 *
 * The maths, for tests: Ellipse.cloud(n, seed), Ellipse.place(points, s), Ellipse.cov(s), Ellipse.dist2(q, s),
 * Ellipse.inside(errors, s, k), Ellipse.outline(s, k, m); s = {sigmaX, sigmaY, rho}.
 * Colours come from the custom properties --est (green), --ink, --muted, --rule, --bg (ellipse-slide.css);
 * the hex fallbacks keep the SVG readable without the stylesheet.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Ellipse = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var DEFAULTS = {
    sigmaX: Math.sqrt(13),
    sigmaY: Math.sqrt(13),
    rho: 12 / 13,
    sigmaRange: [0.5, 6],
    rhoRange: [-0.99, 0.99],
    sigmaStep: 0.01,
    rhoStep: 0.01,
    n: 500,
    // Seed 64: the first of seeds 1–2000 whose 500 points give the theory's nearest counts, 197 inside 1σ and 432
    // inside 2σ (39.4 %, 86.4 %), so the counter agrees with the slide's 39 % and 86 %. Over those seeds the shares
    // spread with sd 1.7 pp (1σ) and 1.0 pp (2σ).
    seed: 64,
    levels: [1, 2],
    range: 11.5,
    tick: 5,
    size: 380,
    unit: 'cm',
    decimal: '.',
    xLabel: 'x error, cm',
    yLabel: 'y error, cm',
    resetLabel: '↺ reset',
    blur: true,
    ariaLabel: 'A cloud of position errors with its 1σ and 2σ ellipses',
    onChange: null
  };

  var COLOR = {
    est: 'var(--est, #2ca02c)',
    ink: 'var(--ink, #222222)',
    muted: 'var(--muted, #555555)',
    rule: 'var(--rule, #e4e4e4)',
    bg: 'var(--bg, #ffffff)'
  };

  /* ---------------- maths ---------------- */

  /** mulberry32: a small seeded generator, uniform on [0, 1). */
  function rng(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /** n standard-normal pairs (u, v), made exact: mean 0, mean products [[1, 0], [0, 1]]. */
  function cloud(n, seed) {
    var r = rng(seed), raw = [], i, p;
    for (i = 0; i < n; i++) {
      var rad = Math.sqrt(-2 * Math.log(1 - r())), ang = 2 * Math.PI * r();   // Box–Muller; 1 − r() > 0
      raw.push([rad * Math.cos(ang), rad * Math.sin(ang)]);
    }
    var mu = 0, mv = 0;
    for (i = 0; i < n; i++) { mu += raw[i][0]; mv += raw[i][1]; }
    mu /= n; mv /= n;
    var a = 0, b = 0, c = 0;
    for (i = 0; i < n; i++) {
      p = raw[i]; p[0] -= mu; p[1] -= mv;
      a += p[0] * p[0]; b += p[0] * p[1]; c += p[1] * p[1];
    }
    a /= n; b /= n; c /= n;
    // The sample's mean products S = [[a, b], [b, c]] = C·Cᵀ, C = [[l11, 0], [l21, l22]]; C⁻¹·p has mean products I.
    var l11 = Math.sqrt(a), l21 = b / l11, l22 = Math.sqrt(c - l21 * l21);
    return raw.map(function (q) {
      var u = q[0] / l11;
      return [u, (q[1] - l21 * u) / l22];
    });
  }

  /** The covariance of the state s = {sigmaX, sigmaY, rho}: [[σx², ρσxσy], [ρσxσy, σy²]]. */
  function cov(s) {
    var b = s.rho * s.sigmaX * s.sigmaY;
    return [[s.sigmaX * s.sigmaX, b], [b, s.sigmaY * s.sigmaY]];
  }

  /** A standard pair (u, v) as an error (x, y) with covariance P. */
  function map(p, s) {
    return [s.sigmaX * p[0], s.sigmaY * (s.rho * p[0] + Math.sqrt(1 - s.rho * s.rho) * p[1])];
  }

  function place(points, s) {
    return points.map(function (p) { return map(p, s); });
  }

  /** xᵀP⁻¹x: the squared distance of the error q from the centre, counted in σ. */
  function dist2(q, s) {
    var P = cov(s), a = P[0][0], b = P[0][1], c = P[1][1];
    return (c * q[0] * q[0] - 2 * b * q[0] * q[1] + a * q[1] * q[1]) / (a * c - b * b);
  }

  /** How many of the errors lie inside the kσ ellipse. */
  function inside(errors, s, k) {
    var m = 0;
    for (var i = 0; i < errors.length; i++) if (dist2(errors[i], s) <= k * k) m++;
    return m;
  }

  /** m + 1 points of the kσ ellipse, closed: the circle of radius k through the same map. */
  function outline(s, k, m) {
    var out = [];
    for (var i = 0; i <= m; i++) {
      var t = 2 * Math.PI * i / m;
      out.push(map([k * Math.cos(t), k * Math.sin(t)], s));
    }
    return out;
  }

  /* ---------------- small helpers ---------------- */

  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  var DECIMAL = '.';

  /** A number with the decimal mark and a true minus sign. */
  function fmt(v, digits) {
    var t = Math.abs(v) < 0.5 * Math.pow(10, -digits) ? 0 : v;
    return t.toFixed(digits).replace('.', DECIMAL).replace('-', '−');
  }

  /** An entry of P: one decimal, two below 1 (σ = 0.5 cm gives 0.25, not 0.3), and a plain 0 for no tie. */
  function entry(v) {
    if (Math.abs(v) < 0.005) return '0';
    return fmt(v, Math.abs(v) < 0.995 ? 2 : 1);
  }

  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

  function halo(w) {
    return 'paint-order: stroke; stroke: ' + COLOR.bg + '; stroke-width: ' + (w || 4) + 'px; stroke-linejoin: round;';
  }

  // 'σ_x' → σ with a subscript x, for HTML; the symbol font comes from .sym in the CSS.
  function symHTML(s) {
    var i = s.indexOf('_');
    if (i < 0) return '<i>' + esc(s) + '</i>';
    return '<i>' + esc(s.slice(0, i)) + '</i><sub><i>' + esc(s.slice(i + 1)) + '</i></sub>';
  }

  // σ with a 2 over an x, stacked as TeX sets σ_x^2 (.ell-ss in the CSS).
  function squareHTML(letter, index) {
    return '<i>' + esc(letter) + '</i><span class="ell-ss"><span>2</span><i>' + esc(index) + '</i></span>';
  }

  /* ---------------- the picture ---------------- */

  var PAD = { l: 54, r: 6, t: 10, b: 48 };

  /** The plot's geometry: side S of the square, and the scales from `unit` to px. */
  function frame(o) {
    var S = o.size - PAD.l - PAD.r, L = PAD.l, T = PAD.t, x0 = -o.range, x1 = o.range;
    return {
      S: S, L: L, T: T, W: o.size, H: PAD.t + S + PAD.b,
      sx: function (x) { return L + (x - x0) / (x1 - x0) * S; },
      sy: function (y) { return T + S - (y - x0) / (x1 - x0) * S; }
    };
  }

  /** The static picture: grid, axes, titles; empty marks that draw() moves. */
  function renderFrame(o, n) {
    var f = frame(o), S = f.S, L = f.L, T = f.T, out = [], t, i;
    out.push('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + f.W + ' ' + f.H + '" width="' + f.W +
      '" height="' + f.H + '" role="img" aria-label="' + esc(o.ariaLabel) + '">');
    var ticks = [];
    for (t = Math.ceil(-o.range / o.tick) * o.tick; t <= o.range + 1e-9; t += o.tick) ticks.push(t);
    ticks.forEach(function (v) {
      var x = f.sx(v).toFixed(1), y = f.sy(v).toFixed(1);
      out.push('<line x1="' + x + '" y1="' + T + '" x2="' + x + '" y2="' + (T + S) + '" style="stroke: ' + COLOR.rule + '; stroke-width: 1"/>');
      out.push('<line x1="' + L + '" y1="' + y + '" x2="' + (L + S) + '" y2="' + y + '" style="stroke: ' + COLOR.rule + '; stroke-width: 1"/>');
      out.push('<line x1="' + x + '" y1="' + (T + S) + '" x2="' + x + '" y2="' + (T + S + 5) + '" style="stroke: ' + COLOR.muted + '; stroke-width: 1"/>');
      out.push('<line x1="' + (L - 5) + '" y1="' + y + '" x2="' + L + '" y2="' + y + '" style="stroke: ' + COLOR.muted + '; stroke-width: 1"/>');
      out.push('<text x="' + x + '" y="' + (T + S + 20) + '" text-anchor="middle" font-size="13" style="fill: ' + COLOR.muted + '">' + fmt(v, 0) + '</text>');
      out.push('<text x="' + (L - 9) + '" y="' + (f.sy(v) + 4.5).toFixed(1) + '" text-anchor="end" font-size="13" style="fill: ' + COLOR.muted + '">' + fmt(v, 0) + '</text>');
    });
    out.push('<path d="M' + L + ',' + T + 'V' + (T + S) + 'H' + (L + S) + '" style="fill: none; stroke: ' + COLOR.muted + '; stroke-width: 1"/>');
    out.push('<text x="' + (L + S / 2) + '" y="' + (T + S + 42) + '" text-anchor="middle" font-size="14" style="fill: ' + COLOR.muted + '">' + esc(o.xLabel) + '</text>');
    out.push('<text transform="translate(15 ' + (T + S / 2) + ') rotate(-90)" text-anchor="middle" font-size="14" style="fill: ' + COLOR.muted + '">' + esc(o.yLabel) + '</text>');

    // The data, clipped to the square: an inner <svg> hides what falls outside ±range.
    out.push('<svg x="' + L + '" y="' + T + '" width="' + S + '" height="' + S + '" viewBox="' + L + ' ' + T + ' ' + S + ' ' + S + '" overflow="hidden">');
    out.push('<g class="ell-dots" style="fill: ' + COLOR.est + '; fill-opacity: .42">');
    for (i = 0; i < n; i++) out.push('<circle r="2.3" cx="0" cy="0"/>');
    out.push('</g>');
    // Each ellipse twice: a white ring under the green line keeps it visible on the cloud.
    o.levels.forEach(function (k, j) {
      var dash = j ? 'stroke-dasharray: 8 5; ' : '';
      out.push('<path class="ell-ring" style="fill: none; stroke: ' + COLOR.bg + '; stroke-opacity: .85; stroke-width: ' + (j ? 5 : 5.6) + '"/>');
      out.push('<path class="ell-line" style="fill: none; stroke: ' + COLOR.est + '; stroke-width: ' + (j ? 2.2 : 2.8) + '; ' + dash + 'stroke-linejoin: round"/>');
    });
    var cx = f.sx(0), cy = f.sy(0), arm = 7;
    var plus = 'M' + (cx - arm) + ',' + cy + 'H' + (cx + arm) + 'M' + cx + ',' + (cy - arm) + 'V' + (cy + arm);
    out.push('<path d="' + plus + '" style="fill: none; stroke: ' + COLOR.bg + '; stroke-width: 5; stroke-linecap: round"/>');
    out.push('<path d="' + plus + '" style="fill: none; stroke: ' + COLOR.ink + '; stroke-width: 2; stroke-linecap: round"/>');
    out.push('</svg>');

    o.levels.forEach(function (k) {
      out.push('<text class="ell-label" text-anchor="middle" font-size="15" font-weight="600" style="fill: ' + COLOR.est + '; ' +
        halo(4) + '">' + fmt(k, 0) + 'σ</text>');
    });
    out.push('</svg>');
    return out.join('');
  }

  function pathOf(points, f) {
    var d = '';
    for (var i = 0; i < points.length; i++) {
      d += (i ? 'L' : 'M') + f.sx(points[i][0]).toFixed(1) + ',' + f.sy(points[i][1]).toFixed(1);
    }
    return d + 'Z';
  }

  /** The swatch before a count: a short line drawn like the ellipse it counts. */
  function swatch(j) {
    return '<svg class="ell-swatch" viewBox="0 0 34 12" width="34" height="12" aria-hidden="true">' +
      '<line x1="1" y1="6" x2="33" y2="6" style="stroke: ' + COLOR.est + '; stroke-width: ' + (j ? 2.2 : 2.8) +
      (j ? '; stroke-dasharray: 8 5' : '') + '"/></svg>';
  }

  /* ---------------- mounting ---------------- */

  /**
   * A slider keeps its touches: the deck's HTML (Marp's bespoke template) turns the slide on a swipe and cancels every
   * touchmove on the way, so on a phone, a tablet or a touch screen the thumb stood still and the slide turned instead.
   * A swipe anywhere else on the slide still turns it.
   */
  function keepTouches(input) {
    ['touchstart', 'touchmove', 'touchend'].forEach(function (type) {
      input.addEventListener(type, function (e) { e.stopPropagation(); }, { passive: true });
    });
  }

  function merge(opts) {
    var o = {}, k;
    for (k in DEFAULTS) o[k] = DEFAULTS[k];
    for (k in opts) if (Object.prototype.hasOwnProperty.call(opts, k)) o[k] = opts[k];
    return o;
  }

  function mount(el, options) {
    var o = merge(options || {});
    var init = { sigmaX: o.sigmaX, sigmaY: o.sigmaY, rho: o.rho };
    var st = { sigmaX: init.sigmaX, sigmaY: init.sigmaY, rho: init.rho };
    var base = cloud(o.n, o.seed);
    var f = frame(o);
    var doc = el.ownerDocument;

    function make(tag, cls, html) {
      var e = doc.createElement(tag);
      if (cls) e.className = cls;
      if (html !== undefined) e.innerHTML = html;
      return e;
    }

    el.classList.add('ell');
    el.innerHTML = '';
    var plot = el.appendChild(make('div', 'ell-plot', renderFrame(o, o.n)));
    var svg = plot.querySelector('svg');
    var dots = svg.querySelectorAll('.ell-dots circle');
    var rings = svg.querySelectorAll('.ell-ring'), lines = svg.querySelectorAll('.ell-line');
    var labels = svg.querySelectorAll('.ell-label');

    var panel = el.appendChild(make('div', 'ell-panel'));
    var box = panel.appendChild(make('div', 'ell-sliders'));
    var inputs = {}, outputs = {};
    [['sigmaX', 'σ_x', o.sigmaRange, o.sigmaStep],
     ['sigmaY', 'σ_y', o.sigmaRange, o.sigmaStep],
     ['rho', 'ρ', o.rhoRange, o.rhoStep]].forEach(function (sl) {
      var key = sl[0];
      var lab = box.appendChild(make('label', 'ell-slider'));
      lab.appendChild(make('span', 'sym', symHTML(sl[1])));
      var inp = make('input');
      inp.type = 'range';
      inp.min = sl[2][0]; inp.max = sl[2][1]; inp.step = sl[3];
      inp.value = init[key];
      inp.setAttribute('aria-label', sl[1].replace('_', ''));
      keepTouches(inp);
      lab.appendChild(inp);
      inputs[key] = inp;
      outputs[key] = lab.appendChild(make('output'));
      inp.addEventListener('input', function () {
        var v = {}; v[key] = parseFloat(inp.value);
        set(v);
      });
      if (o.blur) inp.addEventListener('change', function () { inp.blur(); });
    });

    // P with its letters and with its numbers, then the counts with the reset button at their right.
    var u = esc(o.unit);
    var cross = symHTML('ρ') + symHTML('σ_x') + symHTML('σ_y');
    var sym = '<span class="ell-m sym"><span>' + squareHTML('σ', 'x') + '</span><span>' + cross + '</span>' +
      '<span>' + cross + '</span><span>' + squareHTML('σ', 'y') + '</span></span>';
    var matrix = panel.appendChild(make('div', 'ell-matrix',
      '<span class="sym"><i>P</i></span><span>=</span>' + sym + '<span>=</span>' +
      '<span class="ell-m ell-num"><span></span><span></span><span></span><span></span></span><span>' + u + '²</span>'));
    var cells = matrix.querySelectorAll('.ell-num > span');
    var bottom = panel.appendChild(make('div', 'ell-bottom'));
    var countBox = bottom.appendChild(make('div', 'ell-counts'));
    var counts = o.levels.map(function (k, j) {
      var row = countBox.appendChild(make('div', 'ell-count', swatch(j) +
        '<span>inside ' + fmt(k, 0) + 'σ: <span class="ell-n"></span> of ' + o.n + ' points — <span class="ell-pct"></span></span>'));
      return { n: row.querySelector('.ell-n'), pct: row.querySelector('.ell-pct') };
    });

    var buttons = bottom.appendChild(make('div', 'ell-buttons'));
    var rb = buttons.appendChild(make('button', 'chip', esc(o.resetLabel)));
    rb.type = 'button';
    rb.addEventListener('click', function () {
      set(init);
      if (o.blur) rb.blur();
    });

    var last = null;
    var raf = 0;
    function draw() {
      raf = 0;
      DECIMAL = o.decimal;
      var errs = place(base, st), i;
      for (i = 0; i < dots.length; i++) {
        dots[i].setAttribute('cx', f.sx(errs[i][0]).toFixed(1));
        dots[i].setAttribute('cy', f.sy(errs[i][1]).toFixed(1));
      }
      o.levels.forEach(function (k, j) {
        var d = pathOf(outline(st, k, 160), f);
        rings[j].setAttribute('d', d);
        lines[j].setAttribute('d', d);
        // The first label above the ellipse's top point (x = kρσx, y = kσy), the others below its bottom point:
        // on opposite sides, so they never overlap; hidden when that point leaves the plot.
        var up = j === 0, tx = (up ? 1 : -1) * k * st.rho * st.sigmaX, ty = (up ? 1 : -1) * k * st.sigmaY;
        var lx = clamp(f.sx(tx), f.L + 14, f.L + f.S - 14), ly = f.sy(ty) + (up ? -8 : 19);
        labels[j].setAttribute('x', lx.toFixed(1));
        labels[j].setAttribute('y', ly.toFixed(1));
        labels[j].style.visibility = ly > f.T + 14 && ly < f.T + f.S - 4 ? 'visible' : 'hidden';
      });
      var P = cov(st);
      cells[0].textContent = entry(P[0][0]);
      cells[1].textContent = entry(P[0][1]);
      cells[2].textContent = entry(P[1][0]);
      cells[3].textContent = entry(P[1][1]);
      last = o.levels.map(function (k) { return inside(errs, st, k); });
      counts.forEach(function (c, j) {
        c.n.textContent = last[j];
        c.pct.textContent = Math.round(100 * last[j] / o.n) + ' %';
      });
      outputs.sigmaX.textContent = fmt(st.sigmaX, 2) + ' ' + o.unit;
      outputs.sigmaY.textContent = fmt(st.sigmaY, 2) + ' ' + o.unit;
      outputs.rho.textContent = fmt(st.rho, 2);
      // The filled part of each track, read by the CSS (--f, 0…1): the slider is drawn by the stylesheet, not by
      // the browser, whose own track turns dark next to a light accent such as this green.
      for (var key in inputs) {
        var inp = inputs[key];
        inp.style.setProperty('--f', ((st[key] - inp.min) / (inp.max - inp.min)).toFixed(4));
      }
      svg.setAttribute('aria-label', o.ariaLabel + ': σx = ' + fmt(st.sigmaX, 2) + ' ' + o.unit + ', σy = ' +
        fmt(st.sigmaY, 2) + ' ' + o.unit + ', ρ = ' + fmt(st.rho, 2) + '; ' + o.levels.map(function (k, j) {
          return last[j] + ' of ' + o.n + ' inside ' + k + 'σ';
        }).join(', '));
    }
    function schedule() {
      if (raf) return;
      var w = doc.defaultView;
      raf = w && w.requestAnimationFrame ? w.requestAnimationFrame(draw) : (draw(), 0);
    }

    function get() {
      if (!last) draw();
      return { sigmaX: st.sigmaX, sigmaY: st.sigmaY, rho: st.rho, P: cov(st), inside: last.slice(), n: o.n };
    }

    function set(values) {
      if (values.sigmaX !== undefined) st.sigmaX = clamp(+values.sigmaX, o.sigmaRange[0], o.sigmaRange[1]);
      if (values.sigmaY !== undefined) st.sigmaY = clamp(+values.sigmaY, o.sigmaRange[0], o.sigmaRange[1]);
      if (values.rho !== undefined) st.rho = clamp(+values.rho, o.rhoRange[0], o.rhoRange[1]);
      for (var k in inputs) if (parseFloat(inputs[k].value) !== st[k]) inputs[k].value = st[k];
      schedule();
      if (typeof o.onChange === 'function') o.onChange({ sigmaX: st.sigmaX, sigmaY: st.sigmaY, rho: st.rho, P: cov(st) });
    }

    draw();
    return { element: el, get: get, set: set, reset: function () { set(init); } };
  }

  return {
    mount: mount,
    cloud: cloud,
    place: place,
    cov: cov,
    dist2: dist2,
    inside: inside,
    outline: outline,
    DEFAULTS: DEFAULTS
  };
});
