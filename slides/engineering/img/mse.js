/*
 * mse.js: the best weight of a mix, as a parabola. The noise of the wheels' prediction (σ_d⁻) and of the lidar (σ_z)
 * give MSE(w) = (1 − w)²σ²_d⁻ + w²σ²_z, the mean squared error of the mix (1 − w)·d⁻ + w·z for every weight w of
 * the scan. Its bottom is w* = K = σ²_d⁻/(σ²_d⁻ + σ²_z), and the error there, (1 − K)·σ²_d⁻, lies below both.
 * A strip of three Gaussians under the plot shows the same on the distance axis: the prediction, the lidar and the
 * mix with the weight K, narrower than both. (The code keeps the libraries' names: Pm for σ²_d⁻, R for σ²_z.)
 * A reusable component with the look of bells.js: vanilla JavaScript, no libraries, works offline from file://.
 *
 *   <link rel="stylesheet" href="img/mse-slide.css">
 *   <div id="demo"></div>
 *   <script src="img/mse.js"></script>
 *   <script>
 *     var demo = Mse.mount(document.getElementById('demo'), {
 *       prior: { mean: 51.0, sigma: 2 },   // the wheels' prediction d⁻ and its σ⁻, in `unit`
 *       meas:  { mean: 49.7, sigma: 1 }    // the lidar's reading z and its σ_z, in `unit`
 *     });
 *   </script>
 *
 * Options (all optional; DEFAULTS below):
 *   prior, meas       {mean, sigma}: the two sensors at the start, in `unit`; the means stay fixed, the σ move
 *   sigmaRange        [min, max] of both sliders; step: their step
 *   xRange            [from, to] of the bells strip's distance axis
 *   unit, decimal     the unit and the decimal mark of every printed number
 *   xLabel            the strip's axis title
 *   plotHeight, stripHeight   px of the two pictures; their width is the column's
 *   hover             false: no crosshair and no tooltip on the plot
 *   releaseFocus      false: keep the focus on a slider after release (the deck wants it back for → and the clicker)
 *   resetLabel, labels   the words on the picture and the controls (DEFAULTS)
 *   onChange          function(state), called after every change
 *
 * Returns a controller:
 *   get()        → {priorSigma, measSigma, Pm, R, K, bottom, mixSigma, mixMean}
 *   set(values)  → change priorSigma and/or measSigma (clamped to sigmaRange)
 *   reset()      → back to the mount options
 *   element      → the mounted element
 *
 * The maths, for tests and other pictures: Mse.mse(w, Pm, R), Mse.best(Pm, R), Mse.yTop(v), Mse.pdf(x, mean, sigma).
 * Colours come from the custom properties --pred (blue), --meas (red), --est (green), --ink, --muted, --rule, --bg
 * (mse-slide.css); the hex fallbacks are the deck's palette.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Mse = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var DEFAULTS = {
    prior: { mean: 51.0, sigma: 2 },
    meas: { mean: 49.7, sigma: 1 },
    sigmaRange: [0.3, 4],
    step: 0.01,
    xRange: [44, 57],
    unit: 'cm',
    decimal: '.',
    xLabel: 'distance to the wall, cm',
    plotHeight: 272,
    stripHeight: 116,
    hover: true,
    releaseFocus: true,
    resetLabel: '↺ reset',
    labels: {
      prior: 'the wheels\' prediction', meas: 'the lidar',
      priorPart: 'the prediction\'s part', measPart: 'the lidar\'s part', sum: 'their sum',
      priorAlone: 'wheels alone', measAlone: 'lidar alone', weight: 'the scan\'s weight',
      priorBell: 'prediction', measBell: 'lidar', mixBell: 'mix',
      best: 'the best weight', bottom: 'MSE at the bottom',
      surer: 'the mix is surer than either sensor'
    },
    onChange: null
  };

  var COLOR = {
    pred: 'var(--pred, #1f77b4)',
    meas: 'var(--meas, #d62728)',
    est: 'var(--est, #2ca02c)',
    ink: 'var(--ink, #222222)',
    muted: 'var(--muted, #555555)',
    rule: 'var(--rule, #e4e4e4)',
    bg: 'var(--bg, #ffffff)'
  };

  /* ---------------- maths ---------------- */

  var SQRT_2PI = Math.sqrt(2 * Math.PI);

  /** The mean squared error of the mix (1 − w)·d⁻ + w·z: the errors are independent, so their squares add. */
  function mse(w, Pm, R) {
    return (1 - w) * (1 - w) * Pm + w * w * R;
  }

  /** The bottom of MSE(w): the slope −2(1 − w)P⁻ + 2wR is zero at w* = K = P⁻/(P⁻ + R); the error there. */
  function best(Pm, R) {
    return { K: Pm / (Pm + R), bottom: Pm * R / (Pm + R) };
  }

  /**
   * The top of the MSE axis: 4.5 · 2ⁿ, the smallest that holds the larger variance with 11 % to spare.
   * The scale stays put while the larger noise moves inside one octave, and the start (P⁻ = 4) gets 0 … 4.5.
   */
  function yTop(v) {
    return 4.5 * Math.pow(2, Math.ceil(Math.log(v / 4) / Math.LN2 - 1e-9));
  }

  /** Density of N(mean, sigma²) at x. */
  function pdf(x, mean, sigma) {
    var u = (x - mean) / sigma;
    return Math.exp(-0.5 * u * u) / (sigma * SQRT_2PI);
  }

  /** The state the pictures draw: both variances, the bottom, and the mix with the weight K as a bell. */
  function derive(v, o) {
    var Pm = v.priorSigma * v.priorSigma, R = v.measSigma * v.measSigma, b = best(Pm, R);
    return {
      priorSigma: v.priorSigma, measSigma: v.measSigma, Pm: Pm, R: R, K: b.K, bottom: b.bottom,
      priorMean: o.prior.mean, measMean: o.meas.mean,
      mixMean: (1 - b.K) * o.prior.mean + b.K * o.meas.mean,
      mixSigma: Math.sqrt(b.bottom),           // the mix's variance is MSE(K)
      dv: Math.min(Pm, R) < 0.5 ? 3 : 2        // the decimals of every printed variance (fmtVar)
    };
  }

  /* ---------------- small helpers ---------------- */

  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // The decimal mark of the widget being drawn: draw() sets it from its options before printing anything.
  var DECIMAL = '.';

  /** A number with the decimal mark and a true minus sign. */
  function fmt(v, digits) {
    var t = Math.abs(v) < 0.5 * Math.pow(10, -digits) ? 0 : v;
    return t.toFixed(digits).replace('.', DECIMAL).replace('-', '−');
  }

  /**
   * A variance or an MSE, cm², with the decimals of its state (derive: st.dv): two, or three once either variance is
   * below 0.5. One count for every number of a state, so a check by hand from the printed numbers lands within one
   * unit of the last printed digit.
   */
  function fmtVar(v, st) {
    return fmt(v, st.dv);
  }

  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

  /** Rough width of a UI-font label, enough to keep labels inside the frame. */
  function textWidth(s, size) {
    return String(s).length * size * 0.58;
  }

  /** Round axis steps: 1, 2, 2.5, 5 × 10ⁿ, at most about six labels. */
  function niceStep(span) {
    var raw = span / 5, p = Math.pow(10, Math.floor(Math.log(raw) / Math.LN10));
    var cands = [1, 2, 2.5, 5, 10];
    for (var i = 0; i < cands.length; i++) if (cands[i] * p >= raw - 1e-12) return cands[i] * p;
    return 10 * p;
  }

  /** Decimals a tick step needs: 1 → 0, 0.5 → 1, 0.25 → 2. */
  function decimals(step) {
    for (var d = 0; d < 4; d++) if (Math.abs(step * Math.pow(10, d) - Math.round(step * Math.pow(10, d))) < 1e-9) return d;
    return 4;
  }

  /**
   * A label on a light halo: the halo is a copy of the whole text underneath. paint-order: stroke on the label itself
   * paints each tspan's halo over the glyphs before it, and the halo of ⁻ wiped the bowl of P (P⁻ read F⁻).
   */
  function haloText(x, y, anchor, size, style, body) {
    var under = 'fill: ' + COLOR.bg + '; stroke: ' + COLOR.bg + '; stroke-width: 4px; stroke-linejoin: round' +
      (/font-weight/.test(style) ? '; font-weight: 700' : '');
    return '<g aria-hidden="true">' + text(x, y, anchor, size, under, body) + '</g>' + text(x, y, anchor, size, style, body);
  }

  function svgOpen(W, H, label) {
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + W + ' ' + H + '" width="' + W +
      '" height="' + H + '" role="img" aria-label="' + esc(label) + '">';
  }

  function line(x1, y1, x2, y2, style) {
    return '<line x1="' + x1.toFixed(1) + '" y1="' + y1.toFixed(1) + '" x2="' + x2.toFixed(1) + '" y2="' + y2.toFixed(1) +
      '" style="' + style + '"/>';
  }

  function text(x, y, anchor, size, style, body) {
    return '<text x="' + x.toFixed(1) + '" y="' + y.toFixed(1) + '" text-anchor="' + anchor + '" font-size="' + size +
      '" style="' + style + '">' + body + '</text>';
  }

  function pathD(xs, f, sx, sy) {
    var d = '';
    for (var i = 0; i < xs.length; i++) d += (i ? 'L' : 'M') + sx(xs[i]).toFixed(1) + ',' + sy(f(xs[i])).toFixed(1);
    return d;
  }

  function path(xs, f, sx, sy, style) {
    return '<path d="' + pathD(xs, f, sx, sy) + '" style="fill: none; ' + style + '"/>';
  }

  /** A variance in SVG, as the slides write it: σ, a superscript 2, a subscript ('d⁻' → σ²_d⁻). */
  function sig2(sub) {
    return '<tspan class="m"><tspan font-style="italic">σ</tspan><tspan baseline-shift="super" font-size="70%">2</tspan><tspan baseline-shift="sub" font-size="70%" font-style="italic">' +
      esc(sub) + '</tspan></tspan>';
  }

  /** A math symbol in SVG: the math font, the letter in italics, the rest upright ('w', '²' → w²). */
  function msym(letter, rest) {
    return '<tspan class="m"><tspan font-style="italic">' + esc(letter) + '</tspan>' + esc(rest || '') + '</tspan>';
  }

  /* ---------------- the pictures (pure: state → SVG string) ---------------- */

  // The plot's frame: margins for the tick labels, and an inner pad so the markers at w = 0 and 1 stay whole.
  var FRAME = { L: 58, R: 16, T: 26, B: 50, pad: 10 };

  function plotFrame(W, H) {
    var x0 = FRAME.L + FRAME.pad, x1 = W - FRAME.R - FRAME.pad;
    return {
      x0: x0, x1: x1, yt: FRAME.T, yb: H - FRAME.B, left: FRAME.L, right: W - FRAME.R,
      sx: function (w) { return x0 + w * (x1 - x0); },
      wAt: function (px) { return (px - x0) / (x1 - x0); }
    };
  }

  function describePlot(st, o) {
    var u = o.unit + '²';
    return 'MSE of the mix against the scan\'s weight w: the prediction\'s part (1 − w)²σ²_d⁻ with σ²_d⁻ = ' +
      fmtVar(st.Pm, st) + ' ' + u + ', the lidar\'s part w²σ²_z with σ²_z = ' + fmtVar(st.R, st) + ' ' + u +
      '; the bottom at w = K = ' + fmt(st.K, 2) + ', MSE = ' + fmtVar(st.bottom, st) + ' ' + u + ', below both';
  }

  /** The main plot: MSE(w), its two dashed parts, each sensor alone as a dotted level, the bottom at K. */
  function renderPlot(st, o, W, hoverW) {
    var H = o.plotHeight, f = plotFrame(W, H), sx = f.sx, ymax = yTop(Math.max(st.Pm, st.R));
    var sy = function (v) { return f.yb - v / ymax * (f.yb - f.yt); };
    var muted = 'fill: ' + COLOR.muted;
    var out = [svgOpen(W, H, describePlot(st, o))];

    // Where the bottom's two values sit on the axes; the tick labels they would cover are left out.
    var kx = sx(st.K), kLabelX = clamp(kx, f.left + 36, f.right - 36), by = sy(st.bottom);

    // y: grid lines and tick labels, the title above them.
    var step = niceStep(ymax), dig = decimals(step);
    for (var k = 0; k * step <= ymax + 1e-9; k++) {
      var y = sy(k * step);
      if (k > 0) out.push(line(f.left, y, f.right, y, 'stroke: ' + COLOR.rule + '; stroke-width: 1'));
      if (Math.abs(y - by) > 15) out.push(text(f.left - 8, y + 4.5, 'end', 13, muted, k ? fmt(k * step, dig) : '0'));
    }
    out.push(text(4, f.yt - 10, 'start', 13, muted, 'MSE, ' + esc(o.unit) + '²'));

    // x: the axis, its ticks and labels, the title under them.
    out.push(line(f.left, f.yb, f.right, f.yb, 'stroke: ' + COLOR.muted + '; stroke-width: 1'));
    [0, 0.2, 0.4, 0.5, 0.6, 0.8, 1].forEach(function (w) {
      var x = sx(w);
      out.push(line(x, f.yb, x, f.yb + 5, 'stroke: ' + COLOR.muted + '; stroke-width: 1'));
      if (Math.abs(x - kLabelX) > 48) out.push(text(x, f.yb + 20, 'middle', 13, muted, fmt(w, w % 1 ? 1 : 0)));
    });
    out.push(text((f.x0 + f.x1) / 2, H - 8, 'middle', 14, muted, msym('w') + ' — ' + esc(o.labels.weight)));

    // Each sensor alone: MSE(0) = P⁻, MSE(1) = R. Dotted levels, each named at the end where the curve meets it.
    // The sum stays under the P⁻ level only for w < 2K (and under R for w > 2K − 1), so near K = 0 the P⁻ name
    // moves to the far end, where the curve is high above it; near K = 1 the R name does the same.
    var yP = sy(st.Pm), yR = sy(st.R);
    var at = function (left) { return left ? [f.x0 + 2, 'start'] : [f.x1 - 2, 'end']; };
    var pAt = at(st.K >= 0.15), rAt = at(st.K > 0.85);
    out.push(line(f.x0, yP, f.x1, yP, 'stroke: ' + COLOR.pred + '; stroke-width: 1.4; stroke-dasharray: 2 4'));
    out.push(line(f.x0, yR, f.x1, yR, 'stroke: ' + COLOR.meas + '; stroke-width: 1.4; stroke-dasharray: 2 4'));
    out.push(haloText(pAt[0], yP - 7, pAt[1], 14, 'fill: ' + COLOR.pred,
      sig2('d⁻') + ' = ' + fmtVar(st.Pm, st) + ' · ' + esc(o.labels.priorAlone)));
    out.push(haloText(rAt[0], yR - 7, rAt[1], 14, 'fill: ' + COLOR.meas,
      esc(o.labels.measAlone) + ' · ' + sig2('z') + ' = ' + fmtVar(st.R, st)));

    // The two parts, dashed, and their sum on top.
    var ws = [];
    for (var i = 0; i <= 240; i++) ws.push(i / 240);
    out.push(path(ws, function (w) { return (1 - w) * (1 - w) * st.Pm; }, sx, sy,
      'stroke: ' + COLOR.pred + '; stroke-width: 2; stroke-dasharray: 7 5'));
    out.push(path(ws, function (w) { return w * w * st.R; }, sx, sy,
      'stroke: ' + COLOR.meas + '; stroke-width: 2; stroke-dasharray: 7 5'));
    out.push(path(ws, function (w) { return mse(w, st.Pm, st.R); }, sx, sy,
      'stroke: ' + COLOR.est + '; stroke-width: 3; stroke-linejoin: round'));

    // The bottom: drop lines to both axes, the marker, its K under the w axis and its MSE on the MSE axis.
    var drop = 'stroke: ' + COLOR.est + '; stroke-width: 1.3; stroke-dasharray: 3 3';
    out.push(line(kx, by, kx, f.yb, drop));
    out.push(line(f.left, by, kx, by, drop));
    out.push('<circle cx="' + kx.toFixed(1) + '" cy="' + by.toFixed(1) + '" r="6.5" style="fill: ' + COLOR.est +
      '; stroke: ' + COLOR.ink + '; stroke-width: 1.4"/>');
    out.push(text(kLabelX, f.yb + 20, 'middle', 14.5, 'fill: ' + COLOR.est + '; font-weight: 700',
      msym('K') + ' = ' + fmt(st.K, 2)));
    out.push(text(f.left - 8, by + 5, 'end', 14, 'fill: ' + COLOR.est + '; font-weight: 700', fmtVar(st.bottom, st)));

    // Hover: a weight to try, with the two parts and their sum on it (the tooltip is HTML, drawn by mount).
    if (hoverW !== null && hoverW !== undefined) {
      var hx = sx(hoverW);
      out.push(line(hx, f.yt, hx, f.yb, 'stroke: ' + COLOR.ink + '; stroke-width: 1; stroke-opacity: .45'));
      [[(1 - hoverW) * (1 - hoverW) * st.Pm, COLOR.pred], [hoverW * hoverW * st.R, COLOR.meas],
        [mse(hoverW, st.Pm, st.R), COLOR.est]].forEach(function (pt) {
        out.push('<circle cx="' + hx.toFixed(1) + '" cy="' + sy(pt[0]).toFixed(1) + '" r="4.5" style="fill: ' + pt[1] +
          '; stroke: ' + COLOR.bg + '; stroke-width: 2"/>');
      });
    }
    out.push('</svg>');
    return out.join('');
  }

  function describeStrip(st, o) {
    var u = ' ' + o.unit;
    return 'Three Gaussians: ' + o.labels.priorBell + ' ' + fmt(st.priorMean, 1) + ' ± ' + fmt(st.priorSigma, 2) + u + ', ' +
      o.labels.measBell + ' ' + fmt(st.measMean, 1) + ' ± ' + fmt(st.measSigma, 2) + u + ', ' + o.labels.mixBell +
      ' with the weight K ' + fmt(st.mixMean, 2) + ' ± ' + fmt(st.mixSigma, 2) + u + ', narrower than both';
  }

  /** The strip: the prediction, the lidar and the mix with the weight K as Gaussians on one distance axis. */
  function renderStrip(st, o, W, yBase) {
    var H = o.stripHeight, L = FRAME.L, Rr = FRAME.R, top = 22, base = H - 36;
    var x0 = o.xRange[0], x1 = o.xRange[1];
    var sx = function (x) { return L + (x - x0) / (x1 - x0) * (W - L - Rr); };
    var bells = [
      { key: 'pred', m: st.priorMean, s: st.priorSigma, name: o.labels.priorBell },
      { key: 'meas', m: st.measMean, s: st.measSigma, name: o.labels.measBell },
      { key: 'est', m: st.mixMean, s: st.mixSigma, name: o.labels.mixBell }
    ];
    var peakMax = 0;
    bells.forEach(function (b) { b.peak = 1 / (b.s * SQRT_2PI); peakMax = Math.max(peakMax, b.peak); });
    // The start's scale, so bells grow taller as they narrow; it only stretches when one outgrows it.
    var yMax = Math.max(yBase, 1.08 * peakMax);
    var sy = function (p) { return base - p / yMax * (base - top); };
    var xs = function (b) {
      var a = [], i, n = 260, m = 120, lo = Math.max(x0, b.m - 5 * b.s), hi = Math.min(x1, b.m + 5 * b.s);
      for (i = 0; i <= n; i++) a.push(x0 + (x1 - x0) * i / n);
      if (hi > lo) for (i = 0; i <= m; i++) a.push(lo + (hi - lo) * i / m);   // a dense run where a narrow bell peaks
      return a.sort(function (p, q) { return p - q; });
    };
    var out = [svgOpen(W, H, describeStrip(st, o))];

    // The mix's area first, so the outlines stay on top.
    var g = bells[2];
    out.push('<path d="' + pathD(xs(g), function (x) { return pdf(x, g.m, g.s); }, sx, sy) + 'L' + sx(x1).toFixed(1) + ',' + base + 'L' + sx(x0).toFixed(1) + ',' + base +
      'Z" style="fill: ' + COLOR.est + '; fill-opacity: .13; stroke: none"/>');
    bells.forEach(function (b, i) {
      out.push(path(xs(b), function (x) { return pdf(x, b.m, b.s); }, sx, sy,
        'stroke: ' + COLOR[b.key] + '; stroke-width: ' + (i === 2 ? 2.8 : 2) + '; stroke-linejoin: round'));
    });

    // The distance axis: a tick every unit, a label every unit when there is room.
    out.push(line(L, base, W - Rr, base, 'stroke: ' + COLOR.muted + '; stroke-width: 1'));
    var perUnit = (W - L - Rr) / (x1 - x0), every = perUnit >= 34 ? 1 : perUnit >= 17 ? 2 : 5;
    for (var t = Math.ceil(x0); t <= x1 + 1e-9; t++) {
      var labelled = t % every === 0;
      out.push(line(sx(t), base, sx(t), base + (labelled ? 5 : 3), 'stroke: ' + COLOR.muted + '; stroke-width: 1'));
      if (labelled) out.push(text(sx(t), base + 19, 'middle', 13, 'fill: ' + COLOR.muted, fmt(t, 0)));
    }
    out.push(text(W - Rr, base + 34, 'end', 13, 'fill: ' + COLOR.muted, esc(o.xLabel)));

    // Direct labels: the mix over its peak, the other two on their outer flanks, away from it.
    var size = 14;
    bells.forEach(function (b, i) {
      var body = esc(b.name) + ' ±' + fmt(b.s, 2), w = textWidth(b.name + ' ±0.00', size), x, y, anchor;
      var over = function () { x = clamp(sx(b.m), L + w / 2, W - Rr - w / 2); y = sy(b.peak) - 8; anchor = 'middle'; };
      if (i === 2) {
        over(); y -= 1;
      } else {
        var side = b.m < st.mixMean - 1e-9 ? -1 : b.m > st.mixMean + 1e-9 ? 1 : (i === 0 ? 1 : -1);
        var fx = b.m + side * 1.15 * b.s;
        x = sx(fx) + side * 4; y = sy(pdf(fx, b.m, b.s)) - 6; anchor = side < 0 ? 'end' : 'start';
        if ((side < 0 && x - w < L) || (side > 0 && x + w > W - Rr)) over();
      }
      y = Math.max(y, 14);
      out.push(haloText(x, y, anchor, size, 'fill: ' + COLOR[b.key] + (i === 2 ? '; font-weight: 700' : ''), body));
    });
    out.push('</svg>');
    return out.join('');
  }

  /* ---------------- the HTML parts ---------------- */

  /** A symbol in HTML: the math font, the letter in italics. */
  function hsym(letter, rest, cls) {
    return '<span class="m' + (cls ? ' ' + cls : '') + '"><i>' + esc(letter) + '</i>' + (rest || '') + '</span>';
  }
  var P_ = function () { return '<span class="m pred"><i>σ</i><sup>2</sup><sub><i>d</i>⁻</sub></span>'; };
  var R_ = function () { return '<span class="m meas"><i>σ</i><sup>2</sup><sub><i>z</i></sub></span>'; };
  var E_ = function () { return '<span class="m est"><i>σ</i><sup>2</sup><sub><i>d̂</i></sub></span>'; };

  function swatch(color, width, dash) {
    return '<svg class="mse-swatch" width="30" height="10" viewBox="0 0 30 10" aria-hidden="true"><line x1="1" y1="5" ' +
      'x2="29" y2="5" style="stroke: ' + color + '; stroke-width: ' + width + (dash ? '; stroke-dasharray: ' + dash : '') +
      '"/></svg>';
  }

  /** The key above the plot: the two dashed parts and their sum; each entry is a swatch and one label. */
  function renderKey(o) {
    var entry = function (sw, label) { return '<span>' + sw + '<span>' + label + '</span></span>'; };
    return entry(swatch(COLOR.pred, 2, '7 5'), '<span class="m">(1 − <i>w</i>)²</span>' + P_() + ' — ' +
      esc(o.labels.priorPart)) +
      entry(swatch(COLOR.meas, 2, '7 5'), hsym('w', '²') + R_() + ' — ' + esc(o.labels.measPart)) +
      entry(swatch(COLOR.est, 3), 'MSE — ' + esc(o.labels.sum));
  }

  /** The numbers: K and the bottom's MSE, each formula with the slider's values in it. */
  function renderReadout(st, o) {
    // A printed sum is the sum of the printed terms, so 1.23 + 2.46 never shows as 3.70.
    var shown = function (v) { return parseFloat(fmtVar(v, st).replace(DECIMAL, '.')); };
    var p = '<span class="pred">' + fmtVar(st.Pm, st) + '</span>', r = '<span class="meas">' + fmtVar(st.R, st) + '</span>';
    var sum = '(' + p + ' + ' + r + ')', u = esc(o.unit);
    // The bottom in the deck's one form, (1 − K)·σ²_d⁻. K as printed above, unless that product of the printed numbers
    // would land on another last digit than the bottom: then K gets a third decimal.
    var k2 = fmt(st.K, 2), k2v = parseFloat(k2.replace(DECIMAL, '.'));
    var kShown = fmt((1 - k2v) * shown(st.Pm), st.dv) === fmtVar(st.bottom, st) ? k2 : fmt(st.K, 3);
    return '<div>' + esc(o.labels.best) + ': ' + hsym('K') + ' = ' + P_() + '/(' + P_() + ' + ' + R_() + ')</div>' +
      '<div class="mse-eq">= ' + p + '/' + sum + ' = <span class="est mse-num">' + fmt(st.K, 2) + '</span></div>' +
      // the bottom is the loop's new doubt, σ²_d̂ = (1 − K)σ²_d⁻: named so, not as a second formula of its own
      '<div>' + E_() + ' = ' + esc(o.labels.bottom) + ' = <span class="m">(1 − <i>K</i>)</span>' + P_() + '</div>' +
      '<div class="mse-eq">= (1 − ' + kShown + ') · ' + p + ' = <span class="est mse-num">' +
      fmtVar(st.bottom, st) +
      '</span> ' + u + '²</div>' +
      '<div class="mse-surer">below both ' + P_() + ' and ' + R_() + ': ' + esc(o.labels.surer) + '</div>';
  }

  /** The tooltip of a hovered weight: the table's row, the two parts and their sum, all with the same decimals. */
  function renderTip(st, w, o) {
    var d = st.dv;
    return hsym('w') + ' = ' + fmt(w, 2) + ': <span class="pred">' + fmt((1 - w) * (1 - w) * st.Pm, d) + '</span> + ' +
      '<span class="meas">' + fmt(w * w * st.R, d) + '</span> = <span class="est mse-num">' + fmt(mse(w, st.Pm, st.R), d) +
      '</span> ' + esc(o.unit) + '²';
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
    ['prior', 'meas', 'labels'].forEach(function (key) {
      var m = {}, j;
      for (j in DEFAULTS[key]) m[j] = DEFAULTS[key][j];
      if (opts[key]) for (j in opts[key]) m[j] = opts[key][j];
      o[key] = m;
    });
    return o;
  }

  function mount(el, options) {
    var o = merge(options || {});
    var init = { priorSigma: o.prior.sigma, measSigma: o.meas.sigma };
    var st = derive(init, o);
    var yBase = 1.12 / (st.mixSigma * SQRT_2PI);
    var doc = el.ownerDocument;
    function make(tag, cls, html) {
      var e = doc.createElement(tag);
      if (cls) e.className = cls;
      if (html !== undefined) e.innerHTML = html;
      return e;
    }

    el.classList.add('mse');
    el.innerHTML = '';
    var fig = el.appendChild(make('div', 'mse-figure'));
    fig.appendChild(make('div', 'mse-key', renderKey(o)));
    var plot = fig.appendChild(make('div', 'mse-plot'));
    var plotSvg = plot.appendChild(make('div', 'mse-svg'));
    var tip = plot.appendChild(make('div', 'mse-tip'));
    tip.style.display = 'none';
    var strip = fig.appendChild(make('div', 'mse-strip'));

    var box = el.appendChild(make('div', 'mse-controls'));
    // Under each slider its variance, written as the slides write it: σ²_d⁻ = 2² = 4 (a subscript, so it never reads
    // as σ to the −2).
    var inputs = {}, outputs = {}, vars = {}, varSym = { priorSigma: P_(), measSigma: R_() };
    [['pred', o.labels.prior, 'priorSigma', hsym('σ', '<sub><i>d</i>⁻</sub>'), 'σ d⁻'],
      ['meas', o.labels.meas, 'measSigma', hsym('σ', '<sub><i>z</i></sub>'), 'σz']].forEach(function (g) {
      var key = g[2];
      var fs = box.appendChild(make('fieldset', 'mse-group ' + g[0]));
      fs.appendChild(make('legend', '', esc(g[1])));
      var lab = fs.appendChild(make('label', 'mse-slider'));
      lab.appendChild(make('span', 'mse-sym', g[3]));
      var inp = make('input');
      inp.type = 'range';
      inp.min = o.sigmaRange[0]; inp.max = o.sigmaRange[1]; inp.step = o.step;
      inp.value = init[key];
      inp.setAttribute('aria-label', g[1] + ': ' + g[4]);
      keepTouches(inp);
      lab.appendChild(inp);
      outputs[key] = lab.appendChild(make('output'));
      vars[key] = fs.appendChild(make('div', 'mse-var'));
      inputs[key] = inp;
      inp.addEventListener('input', function () {
        var v = {}; v[key] = parseFloat(inp.value);
        set(v);
      });
      // Give the keyboard back to the deck once the slider is released: → and the clicker change the slide again.
      if (o.releaseFocus) inp.addEventListener('change', function () { inp.blur(); });
    });
    var readout = box.appendChild(make('div', 'mse-readout'));
    readout.setAttribute('aria-live', 'polite');
    var buttons = box.appendChild(make('div', 'mse-buttons'));
    var rb = buttons.appendChild(make('button', 'mse-chip', esc(o.resetLabel)));
    rb.type = 'button';
    rb.addEventListener('click', function () { set(init); if (o.releaseFocus) rb.blur(); });

    var lastW = 0;
    function width() {
      var w = fig.clientWidth || 794;
      return Math.max(420, Math.min(1100, Math.round(w)));
    }

    var hoverW = null, raf = 0;
    function draw() {
      raf = 0;
      DECIMAL = o.decimal;
      var W = width();
      lastW = W;
      plotSvg.innerHTML = renderPlot(st, o, W, hoverW);
      strip.innerHTML = renderStrip(st, o, W, yBase);
      readout.innerHTML = renderReadout(st, o);
      for (var k in outputs) {
        outputs[k].textContent = fmt(st[k], 2) + ' ' + o.unit;
        vars[k].innerHTML = varSym[k] + ' = ' + fmt(st[k], 2) + '² = ' + fmtVar(k === 'priorSigma' ? st.Pm : st.R, st) + ' ' +
          esc(o.unit) + '²';
      }
      if (hoverW === null) {
        tip.style.display = 'none';
      } else {
        tip.innerHTML = renderTip(st, hoverW, o);
        tip.style.display = 'block';
        var f = plotFrame(W, o.plotHeight), hx = f.sx(hoverW), tw = tip.offsetWidth;
        tip.style.left = (hx + 12 + tw <= f.right ? hx + 12 : hx - 12 - tw).toFixed(1) + 'px';
        tip.style.top = (f.yt + 2) + 'px';
      }
    }
    function schedule() {
      if (raf) return;
      var w = doc.defaultView;
      raf = w && w.requestAnimationFrame ? w.requestAnimationFrame(draw) : (draw(), 0);
    }

    if (o.hover) {
      // The pointer's weight: the slide is scaled, so the drawn width over the shown width converts the pixels.
      plot.addEventListener('pointermove', function (e) {
        var svg = plotSvg.firstChild, r = svg && svg.getBoundingClientRect();
        if (!r || !r.width) return;
        var w = plotFrame(lastW, o.plotHeight).wAt((e.clientX - r.left) * lastW / r.width);
        w = w < -0.03 || w > 1.03 ? null : Math.round(clamp(w, 0, 1) * 100) / 100;
        if (w !== hoverW) { hoverW = w; schedule(); }
      });
      plot.addEventListener('pointerleave', function () { if (hoverW !== null) { hoverW = null; schedule(); } });
    }

    function get() {
      return {
        priorSigma: st.priorSigma, measSigma: st.measSigma, Pm: st.Pm, R: st.R, K: st.K, bottom: st.bottom,
        mixSigma: st.mixSigma, mixMean: st.mixMean
      };
    }

    function set(values) {
      var v = { priorSigma: st.priorSigma, measSigma: st.measSigma };
      if (values.priorSigma !== undefined) v.priorSigma = clamp(+values.priorSigma, o.sigmaRange[0], o.sigmaRange[1]);
      if (values.measSigma !== undefined) v.measSigma = clamp(+values.measSigma, o.sigmaRange[0], o.sigmaRange[1]);
      st = derive(v, o);
      for (var k in inputs) if (parseFloat(inputs[k].value) !== v[k]) inputs[k].value = v[k];
      schedule();
      if (typeof o.onChange === 'function') o.onChange(get());
    }

    var view = doc.defaultView;
    if (view && view.ResizeObserver) {
      new view.ResizeObserver(function () { if (width() !== lastW) schedule(); }).observe(fig);
    } else if (view) {
      view.addEventListener('resize', schedule);
    }

    draw();
    return { element: el, get: get, set: set, reset: function () { set(init); } };
  }

  return {
    mount: mount,
    mse: mse,
    best: best,
    yTop: yTop,
    pdf: pdf,
    DEFAULTS: DEFAULTS,
    // For tests and for lessons that need a picture without a widget.
    render: {
      plot: renderPlot, strip: renderStrip, readout: renderReadout, tip: renderTip, key: renderKey,
      derive: derive, merge: merge, fmt: fmt, fmtVar: fmtVar, niceStep: niceStep, plotFrame: plotFrame
    }
  };
});
