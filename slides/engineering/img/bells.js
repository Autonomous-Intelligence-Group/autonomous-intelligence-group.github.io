/*
 * bells.js: the 1D Kalman update as two Gaussian bells and their product.
 * A reusable lesson component: vanilla JavaScript, no libraries, works offline from file://.
 *
 * Mount it on any empty block element:
 *
 *   <div id="demo"></div>
 *   <script src="../assets/bells.js"></script>
 *   <script>
 *     var demo = Bells.mountUpdate(document.getElementById('demo'), {
 *       prior: { mean: 50, sigma: 2 },    // the prediction d⁻ and its σ⁻, in `unit`
 *       meas:  { mean: 51.2, sigma: 1 },  // the measurement z and its σ_z, in `unit`
 *       panels: ['bells', 'parabolas', 'precision'],
 *       formula: true
 *     });
 *   </script>
 *
 * Options (all optional; DEFAULTS below):
 *   prior, meas       {mean, sigma}: the two bells, in `unit` (σ, not variance)
 *   xRange            [from, to]: the visible axis, in `unit`
 *   meanRange         [min, max]: slider range for both means
 *   sigmaRange        [min, max]: slider range for both σ
 *   step              slider step, in `unit`
 *   unit              unit label: 'см'; variances print as unit², precisions as unit⁻²
 *   decimal           the decimal mark of every printed number: ',' (default) or '.'
 *   xLabel            axis title; '' for none
 *   panels            any of 'bells' (densities), 'parabolas' (ln of the bells: the exponents add),
 *                     'precision' (bars: 1/P⁻ + 1/R = 1/P), drawn top to bottom in this order
 *   formula           true: a live line 1/P = 1/P⁻ + 1/R with the numbers
 *   controls          false: a static figure with no sliders
 *   axis              false: the bells panel shows only a baseline (a board sketch)
 *   sigmaBars         false: no ±σ bars under the bells
 *   parabolaRange     [min, max] of the parabolas panel's vertical axis
 *   presets           [{label, set: {priorMean, priorSigma, measMean, measSigma}}]: buttons
 *   resetLabel        the text of the button that returns to the mount options
 *   labels, symbols   words and symbols on the picture (see DEFAULTS)
 *   onChange          function(state), called after every change
 *
 * Returns a controller:
 *   get()        → {priorMean, priorSigma, measMean, measSigma, postMean, postSigma, Pm, R, P, K}
 *   set(values)  → change any of priorMean, priorSigma, measMean, measSigma (clamped to the slider ranges)
 *   reset()      → back to the mount options
 *   element      → the mounted element
 *
 * The maths, shared with other lessons: Bells.fuse(prior, meas), Bells.pdf(x, mean, sigma).
 * Colours come from the custom properties --pred (blue), --meas (red), --est (green), --ink, --muted,
 * --rule, --bg of assets/course.css; the hex fallbacks keep the SVG readable without the stylesheet.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Bells = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var DEFAULTS = {
    prior: { mean: 50, sigma: 2 },
    meas: { mean: 51.2, sigma: 1 },
    xRange: [40, 60],
    meanRange: [42, 58],
    sigmaRange: [0.3, 5],
    step: 0.1,
    unit: 'см',
    decimal: ',',
    xLabel: null,
    panels: ['bells'],
    formula: false,
    controls: true,
    axis: true,
    sigmaBars: true,
    parabolaRange: [-6, 0.6],
    presets: [],
    resetLabel: '↺ скинути',
    labels: { prior: 'прогноз', meas: 'лідар', post: 'оцінка' },
    symbols: {
      priorMean: 'd⁻', measMean: 'z', postMean: 'd̂',
      priorVar: 'P⁻', measVar: 'R', postVar: 'P',
      priorSigma: 'σ⁻', measSigma: 'σ_z', postSigma: 'σ'
    },
    ariaLabel: 'Update: два дзвони і вужчий третій',
    onChange: null
  };

  var COLOR = {
    pred: 'var(--pred, #2563c4)',
    meas: 'var(--meas, #cf3a2c)',
    est: 'var(--est, #13894a)',
    ink: 'var(--ink, #1d1d1b)',
    muted: 'var(--muted, #6b6a63)',
    rule: 'var(--rule, #d8d5c7)',
    bg: 'var(--bg, #fffff8)'
  };

  /* ---------------- maths ---------------- */

  var SQRT_2PI = Math.sqrt(2 * Math.PI);

  /** Density of N(mean, sigma²) at x. */
  function pdf(x, mean, sigma) {
    var u = (x - mean) / sigma;
    return Math.exp(-0.5 * u * u) / (sigma * SQRT_2PI);
  }

  /** ln of the bell without its constant: the parabola −(x − mean)² / (2σ²). */
  function logBell(x, mean, sigma) {
    var u = (x - mean) / sigma;
    return -0.5 * u * u;
  }

  /**
   * The update: the normalised product of two bells.
   * Precisions add, 1/P = 1/P⁻ + 1/R; the mean is weighted by them, d̂/P = d⁻/P⁻ + z/R.
   */
  function fuse(prior, meas) {
    var Pm = prior.sigma * prior.sigma;
    var R = meas.sigma * meas.sigma;
    var info = 1 / Pm + 1 / R;
    var P = 1 / info;
    return {
      mean: P * (prior.mean / Pm + meas.mean / R),
      sigma: Math.sqrt(P),
      Pm: Pm, R: R, P: P, info: info,
      K: Pm / (Pm + R)
    };
  }

  /* ---------------- small helpers ---------------- */

  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // The decimal mark of the widget being drawn: draw() sets it from its options before printing anything.
  var DECIMAL = ',';

  /** A number with the decimal mark and a true minus sign. */
  function fmt(v, digits) {
    var t = Math.abs(v) < 0.5 * Math.pow(10, -digits) ? 0 : v;
    return t.toFixed(digits).replace('.', DECIMAL).replace('-', '−');
  }

  /** 'σ_z' → σ with a subscript z, for SVG text. */
  function symSVG(s) {
    var i = s.indexOf('_');
    if (i < 0) return esc(s);
    return esc(s.slice(0, i)) + '<tspan baseline-shift="sub" font-size="75%">' + esc(s.slice(i + 1)) + '</tspan>';
  }

  /** 'σ_z' → σ with a subscript z, for HTML; letters in italics. */
  function symHTML(s) {
    var i = s.indexOf('_');
    if (i < 0) return '<i>' + esc(s) + '</i>';
    return '<i>' + esc(s.slice(0, i)) + '</i><sub><i>' + esc(s.slice(i + 1)) + '</i></sub>';
  }

  /** Rough width of a UI-font label, enough to keep labels inside the frame. */
  function textWidth(s, size) {
    return String(s).replace(/_/g, '').length * size * 0.58;
  }

  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

  /** A uniform grid over the axis plus a dense one around a narrow bell, so its peak stays smooth. */
  function samples(x0, x1, mean, sigma) {
    var xs = [], i, n = 240, m = 160;
    for (i = 0; i <= n; i++) xs.push(x0 + (x1 - x0) * i / n);
    var a = Math.max(x0, mean - 5 * sigma), b = Math.min(x1, mean + 5 * sigma);
    if (b > a) for (i = 0; i <= m; i++) xs.push(a + (b - a) * i / m);
    xs.sort(function (p, q) { return p - q; });
    return xs;
  }

  function linePath(xs, f, sx, sy, yLo, yHi) {
    var d = '';
    for (var i = 0; i < xs.length; i++) {
      var y = sy(f(xs[i]));
      if (yLo !== undefined) y = clamp(y, yLo, yHi);
      d += (i ? 'L' : 'M') + sx(xs[i]).toFixed(1) + ',' + y.toFixed(1);
    }
    return d;
  }

  /** Round axis steps: 1, 2, 2.5, 5 × 10ⁿ, at most about six labels. */
  function niceStep(span) {
    var raw = span / 5, p = Math.pow(10, Math.floor(Math.log(raw) / Math.LN10));
    var cands = [1, 2, 2.5, 5, 10];
    for (var i = 0; i < cands.length; i++) if (cands[i] * p >= raw) return cands[i] * p;
    return 10 * p;
  }

  function halo() {
    return 'paint-order: stroke; stroke: ' + COLOR.bg + '; stroke-width: 4px; stroke-linejoin: round;';
  }

  function svgOpen(W, H, label) {
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + W + ' ' + H + '" width="' + W +
      '" height="' + H + '" role="img" aria-label="' + esc(label) + '">';
  }

  /* ---------------- the panels (pure: state → SVG string) ---------------- */

  function describe(st, o) {
    var p = st.post, u = o.unit, s = o.symbols;
    return o.labels.prior + ' ' + s.priorMean + ' = ' + fmt(st.priorMean, 1) + ' ' + u + ', ' + s.priorSigma + ' = ' +
      fmt(st.priorSigma, 2) + '; ' + o.labels.meas + ' ' + s.measMean + ' = ' + fmt(st.measMean, 1) + ' ' + u + ', ' +
      s.measSigma.replace('_', '') + ' = ' + fmt(st.measSigma, 2) + '; ' + o.labels.post + ' ' + s.postMean + ' = ' +
      fmt(p.mean, 2) + ' ' + u + ', ' + s.postSigma + ' = ' + fmt(p.sigma, 2) + ' ' + u;
  }

  /** Panel 1: the three densities, direct labels, ±σ bars under the axis. */
  function renderBells(st, o, W) {
    var post = st.post;
    var L = 18, Rr = 18, top = 30, base = 172;
    var axisH = o.axis ? 36 : 8;
    var rows = o.sigmaBars ? 3 : 0;
    var H = base + axisH + rows * 18 + (rows ? 6 : 0);
    var x0 = o.xRange[0], x1 = o.xRange[1];
    var sx = function (x) { return L + (x - x0) / (x1 - x0) * (W - L - Rr); };

    var bells = [
      { key: 'pred', m: st.priorMean, s: st.priorSigma, name: o.labels.prior, sym: o.symbols.priorMean, ssym: o.symbols.priorSigma },
      { key: 'meas', m: st.measMean, s: st.measSigma, name: o.labels.meas, sym: o.symbols.measMean, ssym: o.symbols.measSigma },
      { key: 'est', m: post.mean, s: post.sigma, name: o.labels.post, sym: o.symbols.postMean, ssym: o.symbols.postSigma }
    ];
    var peakMax = 0;
    bells.forEach(function (b) { b.peak = 1 / (b.s * SQRT_2PI); peakMax = Math.max(peakMax, b.peak); });
    var yMax = Math.max(o.yBase || 0, 1.08 * peakMax);
    var sy = function (p) { return base - p / yMax * (base - top); };

    var out = [svgOpen(W, H, describe(st, o))];

    // The estimate's area first, so the outlines stay on top.
    var g = bells[2], gx = samples(x0, x1, g.m, g.s);
    out.push('<path d="' + linePath(gx, function (x) { return pdf(x, g.m, g.s); }, sx, sy) +
      'L' + sx(x1).toFixed(1) + ',' + base + 'L' + sx(x0).toFixed(1) + ',' + base +
      'Z" style="fill: ' + COLOR.est + '; fill-opacity: .13; stroke: none"/>');
    bells.forEach(function (b, i) {
      var xs = samples(x0, x1, b.m, b.s);
      out.push('<path d="' + linePath(xs, function (x) { return pdf(x, b.m, b.s); }, sx, sy) +
        '" style="fill: none; stroke: ' + COLOR[b.key] + '; stroke-width: ' + (i === 2 ? 2.6 : 2) +
        '; stroke-linejoin: round"/>');
    });

    // Axis.
    out.push('<line x1="' + L + '" y1="' + base + '" x2="' + (W - Rr) + '" y2="' + base +
      '" style="stroke: ' + COLOR.muted + '; stroke-width: 1"/>');
    if (o.axis) {
      var step = niceStep(x1 - x0), minor = step / 5, t;
      for (t = Math.ceil(x0 / minor) * minor; t <= x1 + 1e-9; t += minor) {
        var major = Math.abs(t / step - Math.round(t / step)) < 1e-6;
        out.push('<line x1="' + sx(t).toFixed(1) + '" y1="' + base + '" x2="' + sx(t).toFixed(1) + '" y2="' +
          (base + (major ? 6 : 3)) + '" style="stroke: ' + COLOR.muted + '; stroke-width: 1"/>');
        if (major) out.push('<text x="' + sx(t).toFixed(1) + '" y="' + (base + 19) +
          '" text-anchor="middle" font-size="11" style="fill: ' + COLOR.muted + '">' + fmt(t, step < 1 ? 1 : 0) + '</text>');
      }
      var xl = o.xLabel === null ? 'x, ' + o.unit : o.xLabel;
      if (xl) out.push('<text x="' + (W - Rr) + '" y="' + (base + 33) + '" text-anchor="end" font-size="11" style="fill: ' +
        COLOR.muted + '">' + esc(xl) + '</text>');
    }

    // Direct labels: the estimate at its peak; the other two on their outer flanks, away from it.
    var size = 12.5;
    bells.forEach(function (b, i) {
      var text = b.name + ' ', w = textWidth(text + b.sym, size), x, y, anchor;
      if (i === 2) {
        x = clamp(sx(b.m), L + w / 2, W - Rr - w / 2); y = sy(b.peak) - 9; anchor = 'middle';
      } else {
        var side = b.m < post.mean - 1e-9 ? -1 : b.m > post.mean + 1e-9 ? 1 : (i === 0 ? -1 : 1);
        var fx = b.m + side * 1.15 * b.s;
        x = sx(fx) + side * 4; y = sy(pdf(fx, b.m, b.s)) - 6; anchor = side < 0 ? 'end' : 'start';
        if (side < 0 && x - w < L) { x = clamp(sx(b.m), L + w / 2, W - Rr - w / 2); y = sy(b.peak) - 8; anchor = 'middle'; }
        if (side > 0 && x + w > W - Rr) { x = clamp(sx(b.m), L + w / 2, W - Rr - w / 2); y = sy(b.peak) - 8; anchor = 'middle'; }
      }
      y = Math.max(y, 13);
      out.push('<text x="' + x.toFixed(1) + '" y="' + y.toFixed(1) + '" text-anchor="' + anchor + '" font-size="' + size +
        '" style="fill: ' + COLOR[b.key] + '; ' + halo() + '">' + esc(text) +
        '<tspan class="sym" font-style="italic">' + symSVG(b.sym) + '</tspan></text>');
    });

    // ±σ bars: the widths, side by side, measured on the same axis.
    if (rows) {
      bells.forEach(function (b, i) {
        var y = base + axisH + 8 + i * 18;
        var a = sx(b.m - b.s), c = sx(b.m + b.s), lo = sx(x0), hi = sx(x1);
        var ac = clamp(a, lo, hi), cc = clamp(c, lo, hi);
        var st2 = 'stroke: ' + COLOR[b.key] + '; stroke-width: ' + (i === 2 ? 2.6 : 2) + '; stroke-linecap: butt';
        out.push('<line x1="' + ac.toFixed(1) + '" y1="' + y + '" x2="' + cc.toFixed(1) + '" y2="' + y + '" style="' + st2 + '"/>');
        if (a >= lo) out.push('<line x1="' + a.toFixed(1) + '" y1="' + (y - 4) + '" x2="' + a.toFixed(1) + '" y2="' + (y + 4) + '" style="' + st2 + '"/>');
        if (c <= hi) out.push('<line x1="' + c.toFixed(1) + '" y1="' + (y - 4) + '" x2="' + c.toFixed(1) + '" y2="' + (y + 4) + '" style="' + st2 + '"/>');
        if (b.m >= x0 && b.m <= x1) out.push('<circle cx="' + sx(b.m).toFixed(1) + '" cy="' + y + '" r="2.6" style="fill: ' + COLOR[b.key] + '"/>');
        var label = '<tspan class="sym" font-style="italic">±' + symSVG(b.ssym) + '</tspan> = ' + fmt(b.s, 2) + ' ' + esc(o.unit);
        var lw = textWidth('±' + b.ssym + ' = 0,00 ' + o.unit, 11.5), lx, anchor;
        if (cc + 8 + lw <= W - Rr) { lx = cc + 8; anchor = 'start'; }
        else if (ac - 8 - lw >= L) { lx = ac - 8; anchor = 'end'; }
        else { lx = W - Rr; anchor = 'end'; }
        out.push('<text x="' + lx.toFixed(1) + '" y="' + (y + 4) + '" text-anchor="' + anchor + '" font-size="11.5" style="fill: ' +
          COLOR[b.key] + '; ' + halo() + '">' + label + '</text>');
      });
    }
    out.push('</svg>');
    return out.join('');
  }

  /** Panel 2: ln of each bell is a parabola; the estimate's is their sum, so its bend is the sum of bends. */
  function renderParabolas(st, o, W, uid) {
    var L = 18, Rr = 18;
    var narrow = W < 600;
    var top = narrow ? 44 : 30, bot = top + 150, H = bot + 10;
    var x0 = o.xRange[0], x1 = o.xRange[1], y0 = o.parabolaRange[0], y1 = o.parabolaRange[1];
    var sx = function (x) { return L + (x - x0) / (x1 - x0) * (W - L - Rr); };
    var sy = function (q) { return bot - (q - y0) / (y1 - y0) * (bot - top); };
    var pm = st.priorMean, ps = st.priorSigma, mm = st.measMean, ms = st.measSigma, p = st.post;
    var qb = function (x) { return logBell(x, pm, ps); };
    var qr = function (x) { return logBell(x, mm, ms); };
    var qg = function (x) { return qb(x) + qr(x); };
    var clip = 'bells-clip-' + uid;
    var xs = [], i, n = 400;
    for (i = 0; i <= n; i++) xs.push(x0 + (x1 - x0) * i / n);

    var out = [svgOpen(W, H, 'Логарифми дзвонів: зелена парабола — сума синьої і червоної; крутизна ' +
      fmt(1 / p.Pm, 2) + ' + ' + fmt(1 / p.R, 2) + ' = ' + fmt(p.info, 2))];
    out.push('<defs><clipPath id="' + clip + '"><rect x="' + L + '" y="' + top + '" width="' + (W - L - Rr) +
      '" height="' + (bot - top) + '"/></clipPath></defs>');
    out.push('<rect x="' + L + '" y="' + top + '" width="' + (W - L - Rr) + '" height="' + (bot - top) +
      '" style="fill: none; stroke: ' + COLOR.rule + '; stroke-width: 1"/>');
    out.push('<line x1="' + L + '" y1="' + sy(0).toFixed(1) + '" x2="' + (W - Rr) + '" y2="' + sy(0).toFixed(1) +
      '" style="stroke: ' + COLOR.muted + '; stroke-width: 1; stroke-dasharray: 3 3"/>');
    out.push('<text x="' + (L + 4) + '" y="' + (sy(0) - 4).toFixed(1) + '" font-size="10.5" style="fill: ' + COLOR.muted + '">0</text>');

    var lo = top - 40, hi = bot + 40;
    out.push('<g clip-path="url(#' + clip + ')">');
    out.push('<path d="' + linePath(xs, qb, sx, sy, lo, hi) + '" style="fill: none; stroke: ' + COLOR.pred + '; stroke-width: 2"/>');
    out.push('<path d="' + linePath(xs, qr, sx, sy, lo, hi) + '" style="fill: none; stroke: ' + COLOR.meas + '; stroke-width: 2"/>');
    out.push('<path d="' + linePath(xs, qg, sx, sy, lo, hi) + '" style="fill: none; stroke: ' + COLOR.est + '; stroke-width: 2.6"/>');
    // Where one parabola is zero, the sum touches the other: at x = z it meets the blue, at x = d⁻ the red.
    [[mm, qb(mm)], [pm, qr(pm)]].forEach(function (pt) {
      if (pt[0] >= x0 && pt[0] <= x1 && pt[1] >= y0 && pt[1] <= y1) {
        out.push('<circle cx="' + sx(pt[0]).toFixed(1) + '" cy="' + sy(pt[1]).toFixed(1) + '" r="3.6" style="fill: ' +
          COLOR.bg + '; stroke: ' + COLOR.est + '; stroke-width: 1.6"/>');
      }
    });
    out.push('</g>');

    var c = qg(p.mean);
    if (c < y0) {
      var vx = clamp(sx(p.mean), L + 90, W - Rr - 90);
      out.push('<text x="' + vx.toFixed(1) + '" y="' + (bot - 8) + '" text-anchor="middle" font-size="11" style="fill: ' +
        COLOR.est + '; ' + halo() + '">↓ вершина зеленої нижче: ' + fmt(c, 1) + '</text>');
    }

    var ty = 14;
    out.push('<text x="' + L + '" y="' + ty + '" font-size="11.5" style="fill: ' + COLOR.muted + '">ln дзвонів: ' +
      '<tspan style="fill: ' + COLOR.est + '">зелена</tspan> = <tspan style="fill: ' + COLOR.pred + '">синя</tspan> + ' +
      '<tspan style="fill: ' + COLOR.meas + '">червона</tspan> у кожній точці</text>');
    var rx = narrow ? L : W - Rr, ry = narrow ? 31 : ty, ra = narrow ? 'start' : 'end';
    out.push('<text x="' + rx + '" y="' + ry + '" text-anchor="' + ra + '" font-size="11.5" style="fill: ' + COLOR.muted +
      '">крутизна <tspan class="sym" font-style="italic">1/σ²</tspan>: <tspan style="fill: ' + COLOR.pred + '">' + fmt(1 / p.Pm, 2) +
      '</tspan> + <tspan style="fill: ' + COLOR.meas + '">' + fmt(1 / p.R, 2) + '</tspan> = <tspan style="fill: ' +
      COLOR.est + '; font-weight: 600">' + fmt(p.info, 2) + '</tspan></text>');
    out.push('</svg>');
    return out.join('');
  }

  /** Panel 3: precisions as bars; the blue and the red laid end to end make the green. */
  function renderPrecision(st, o, W) {
    var L = 18, Rr = 18, labW = 92, H = 80;
    var bx0 = L + labW, bx1 = W - Rr, full = bx1 - bx0;
    var p = st.post, s = o.symbols, u = o.unit;
    var ib = 1 / p.Pm, ir = 1 / p.R, wb = full * ib / p.info;
    var out = [svgOpen(W, H, '1/' + s.priorVar + ' + 1/' + s.measVar + ' = 1/' + s.postVar + ': ' +
      fmt(ib, 3) + ' + ' + fmt(ir, 3) + ' = ' + fmt(p.info, 3))];
    out.push('<rect x="' + bx0 + '" y="6" width="' + wb.toFixed(1) + '" height="16" style="fill: ' + COLOR.pred + '; fill-opacity: .85"/>');
    out.push('<rect x="' + (bx0 + wb).toFixed(1) + '" y="6" width="' + (full - wb).toFixed(1) + '" height="16" style="fill: ' + COLOR.meas + '; fill-opacity: .85"/>');
    out.push('<rect x="' + bx0 + '" y="28" width="' + full.toFixed(1) + '" height="16" style="fill: ' + COLOR.est + '; fill-opacity: .85"/>');
    out.push('<text x="' + (bx0 - 8) + '" y="18.5" text-anchor="end" font-size="12.5" class="sym" font-style="italic">' +
      '<tspan style="fill: ' + COLOR.pred + '">1/' + symSVG(s.priorVar) + '</tspan><tspan style="fill: ' + COLOR.muted +
      '"> + </tspan><tspan style="fill: ' + COLOR.meas + '">1/' + symSVG(s.measVar) + '</tspan></text>');
    out.push('<text x="' + (bx0 - 8) + '" y="40.5" text-anchor="end" font-size="12.5" class="sym" font-style="italic" style="fill: ' +
      COLOR.est + '">1/' + symSVG(s.postVar) + '</text>');
    out.push('<text x="' + bx0 + '" y="64" font-size="11.5" style="fill: ' + COLOR.muted + '"><tspan style="fill: ' + COLOR.pred + '">' +
      fmt(ib, 3) + '</tspan> + <tspan style="fill: ' + COLOR.meas + '">' + fmt(ir, 3) + '</tspan> = <tspan style="fill: ' +
      COLOR.est + '; font-weight: 600">' + fmt(p.info, 3) + '</tspan> ' + esc(u) + '⁻²</text>');
    if (W >= 480) {
      out.push('<text x="' + bx1 + '" y="64" text-anchor="end" font-size="11.5" style="fill: ' + COLOR.muted +
        '">частка <tspan style="fill: ' + COLOR.meas + '">червоної</tspan> = <tspan class="sym" font-style="italic">K</tspan> = ' +
        fmt(p.K, 2) + '</text>');
    }
    out.push('</svg>');
    return out.join('');
  }

  /** The live formula under the panels, HTML. */
  function renderFormula(st, o) {
    var p = st.post, s = o.symbols, u = esc(o.unit);
    var f = function (num, den, cls) {
      return '<span class="frac ' + cls + '"><span>' + num + '</span><span>' + den + '</span></span>';
    };
    return '<div>' + f('1', symHTML(s.postVar), 'est') + ' = ' + f('1', symHTML(s.priorVar), 'pred') + ' + ' +
      f('1', symHTML(s.measVar), 'meas') + ' = ' + f('1', fmt(p.Pm, 2), 'pred') + ' + ' + f('1', fmt(p.R, 2), 'meas') +
      ' = <span class="pred">' + fmt(1 / p.Pm, 3) + '</span> + <span class="meas">' + fmt(1 / p.R, 3) + '</span> = <span class="est">' +
      fmt(p.info, 3) + '</span> ' + u + '⁻²</div>' +
      '<div class="est">' + symHTML(s.postVar) + ' = ' + fmt(p.P, 2) + ' ' + u + '², ' + symHTML(s.postSigma) + ' = ' +
      fmt(p.sigma, 2) + ' ' + u + ', ' + symHTML(s.postMean) + ' = ' + fmt(p.mean, 2) + ' ' + u + '</div>';
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
    ['prior', 'meas', 'labels', 'symbols'].forEach(function (key) {
      var m = {}, j;
      for (j in DEFAULTS[key]) m[j] = DEFAULTS[key][j];
      if (opts[key]) for (j in opts[key]) m[j] = opts[key][j];
      o[key] = m;
    });
    return o;
  }

  function derive(v) {
    return {
      priorMean: v.priorMean, priorSigma: v.priorSigma, measMean: v.measMean, measSigma: v.measSigma,
      post: fuse({ mean: v.priorMean, sigma: v.priorSigma }, { mean: v.measMean, sigma: v.measSigma })
    };
  }

  var uidCounter = 0;

  function mountUpdate(el, options) {
    var o = merge(options || {});
    var uid = ++uidCounter;
    var init = { priorMean: o.prior.mean, priorSigma: o.prior.sigma, measMean: o.meas.mean, measSigma: o.meas.sigma };
    var st = derive(init);
    // Fixed vertical scale for the starting state, so bells visibly grow taller as they narrow;
    // it only stretches when the estimate outgrows it.
    o.yBase = 1.35 / (st.post.sigma * SQRT_2PI);

    var doc = el.ownerDocument;
    function make(tag, cls, html) {
      var e = doc.createElement(tag);
      if (cls) e.className = cls;
      if (html !== undefined) e.innerHTML = html;
      return e;
    }

    el.classList.add('bells');
    el.innerHTML = '';
    var panels = {};
    ['bells', 'parabolas', 'precision'].forEach(function (name) {
      if (o.panels.indexOf(name) < 0) return;
      panels[name] = el.appendChild(make('div', 'bells-panel bells-' + name));
    });
    var formulaEl = o.formula ? el.appendChild(make('div', 'bells-formula')) : null;

    var inputs = {}, outputs = {}, readout = null;
    if (o.controls) {
      var box = el.appendChild(make('div', 'bells-controls'));
      var groups = [
        ['pred', o.labels.prior, [['priorMean', o.symbols.priorMean, o.meanRange, 1], ['priorSigma', o.symbols.priorSigma, o.sigmaRange, 1]]],
        ['meas', o.labels.meas, [['measMean', o.symbols.measMean, o.meanRange, 1], ['measSigma', o.symbols.measSigma, o.sigmaRange, 1]]]
      ];
      groups.forEach(function (g) {
        var fs = box.appendChild(make('fieldset', 'bells-group ' + g[0]));
        fs.appendChild(make('legend', '', esc(g[1])));
        g[2].forEach(function (sl) {
          var key = sl[0];
          var lab = fs.appendChild(make('label', 'bells-slider'));
          lab.appendChild(make('span', 'sym', symHTML(sl[1]).replace(/<\/?i>/g, '')));
          var inp = make('input');
          inp.type = 'range';
          inp.min = sl[2][0]; inp.max = sl[2][1]; inp.step = o.step;
          inp.value = init[key];
          inp.setAttribute('aria-label', g[1] + ': ' + sl[1].replace('_', ''));
          keepTouches(inp);
          lab.appendChild(inp);
          var out = lab.appendChild(make('output'));
          inputs[key] = inp; outputs[key] = out;
          inp.addEventListener('input', function () {
            var v = {}; v[key] = parseFloat(inp.value);
            set(v);
          });
        });
      });
      readout = box.appendChild(make('p', 'bells-readout'));
      readout.setAttribute('aria-live', 'polite');
      var buttons = box.appendChild(make('div', 'bells-buttons'));
      o.presets.forEach(function (pr) {
        var b = buttons.appendChild(make('button', 'chip', esc(pr.label)));
        b.type = 'button';
        b.addEventListener('click', function () { set(pr.set); });
      });
      var rb = buttons.appendChild(make('button', 'chip', esc(o.resetLabel)));
      rb.type = 'button';
      rb.addEventListener('click', function () { set(init); });
    }

    function width() {
      var w = el.clientWidth || 640;
      return Math.max(320, Math.min(900, Math.round(w)));
    }

    var raf = 0;
    function draw() {
      raf = 0;
      DECIMAL = o.decimal;
      var W = width();
      if (panels.bells) panels.bells.innerHTML = renderBells(st, o, W);
      if (panels.parabolas) panels.parabolas.innerHTML = renderParabolas(st, o, W, uid);
      if (panels.precision) panels.precision.innerHTML = renderPrecision(st, o, W);
      if (formulaEl) formulaEl.innerHTML = renderFormula(st, o);
      if (readout) {
        readout.innerHTML = esc(o.labels.post) + ': <span class="sym">' + esc(o.symbols.postMean) + '</span> = ' +
          fmt(st.post.mean, 2) + ' ' + esc(o.unit) + ', <span class="sym">' + esc(o.symbols.postSigma) + '</span> = ' +
          fmt(st.post.sigma, 2) + ' ' + esc(o.unit);
      }
      for (var k in outputs) outputs[k].textContent = fmt(st[k], 1) + ' ' + o.unit;
    }
    function schedule() {
      if (raf) return;
      var w = el.ownerDocument.defaultView;
      raf = w && w.requestAnimationFrame ? w.requestAnimationFrame(draw) : (draw(), 0);
    }

    function get() {
      var p = st.post;
      return {
        priorMean: st.priorMean, priorSigma: st.priorSigma, measMean: st.measMean, measSigma: st.measSigma,
        postMean: p.mean, postSigma: p.sigma, Pm: p.Pm, R: p.R, P: p.P, K: p.K
      };
    }

    function set(values) {
      var v = { priorMean: st.priorMean, priorSigma: st.priorSigma, measMean: st.measMean, measSigma: st.measSigma };
      if (values.priorMean !== undefined) v.priorMean = clamp(+values.priorMean, o.meanRange[0], o.meanRange[1]);
      if (values.measMean !== undefined) v.measMean = clamp(+values.measMean, o.meanRange[0], o.meanRange[1]);
      if (values.priorSigma !== undefined) v.priorSigma = clamp(+values.priorSigma, o.sigmaRange[0], o.sigmaRange[1]);
      if (values.measSigma !== undefined) v.measSigma = clamp(+values.measSigma, o.sigmaRange[0], o.sigmaRange[1]);
      st = derive(v);
      for (var k in inputs) if (parseFloat(inputs[k].value) !== v[k]) inputs[k].value = v[k];
      schedule();
      if (typeof o.onChange === 'function') o.onChange(get());
    }

    var view = el.ownerDocument.defaultView;
    if (view && view.ResizeObserver) {
      var lastW = 0;
      new view.ResizeObserver(function () {
        var w = width();
        if (w !== lastW) { lastW = w; schedule(); }
      }).observe(el);
    } else if (view) {
      view.addEventListener('resize', schedule);
    }

    draw();
    return { element: el, get: get, set: set, reset: function () { set(init); } };
  }

  return {
    mountUpdate: mountUpdate,
    fuse: fuse,
    pdf: pdf,
    logBell: logBell,
    DEFAULTS: DEFAULTS,
    // For tests and for lessons that need a picture without a widget.
    render: { bells: renderBells, parabolas: renderParabolas, precision: renderPrecision, formula: renderFormula, derive: derive, merge: merge }
  };
});
