/*
 * grid.js: the Bayes recipe on a grid of cells: update multiplies and rescales, predict shifts and blurs.
 * A reusable lesson component: vanilla JavaScript, no libraries, works offline from file://.
 * Its arithmetic is filterpy.discrete_bayes 1.4.5 line for line (Grid.predict, Grid.update, Grid.normalize),
 * checked against filterpy on random cases in both modes: they agree to 1e-9.
 *
 *   <div id="demo"></div>
 *   <script src="../assets/grid.js"></script>
 *   <script>
 *     var demo = Grid.mount(document.getElementById('demo'), {
 *       cells: { from: 40, step: 1, count: 171 },          // cell centres, in `unit`
 *       start: 'uniform',                                   // the belief before the first step
 *       mode: 'constant',                                   // filterpy's predict mode: 'wrap' (a ring), 'constant' (a wall)
 *       steps: [                                            // one per scan, in time order
 *         { t: 0.08, truth: 198.8,
 *           motion: { offset: -2, kernel: [0.057, 0.886, 0.057] },
 *           scan: { z: 197.5, sigma: 1.012 } }
 *       ],
 *       window: { width: 25 },                               // 25 cells that follow the belief
 *       unit: 'cm', decimal: '.', xLabel: 'distance to the wall, cm'
 *     });
 *   </script>
 *
 * Data:
 *   cells       [x, …]: the cell centres, increasing and evenly spaced; or {from, step, count}
 *   cellLabels  [word, …]: one word per cell under the axis ('door', 'wall') instead of numbers
 *   start       'uniform' or [p, …]: the belief before the first step, used as given (filterpy does not normalise it)
 *   startTruth  where the robot really is before the first step, in `unit`
 *   steps       [step, …]: each is one motion and then one scan, both optional:
 *     motion    {offset, kernel}: filterpy's predict(pdf, offset, kernel, mode, cval); offset is a whole number of
 *               cells (positive: towards larger x; a fraction is rounded), kernel[j] the chance of moving
 *               offset + j − c cells, c = floor(kernel.length / 2): [0.1, 0.8, 0.1] is one short, exact, one long.
 *               null: nothing moved, and update() may run without a predict first
 *     scan      {z, sigma}: the likelihood is the bell N(z; x, sigma²) at every cell centre;
 *               or {likelihood: [l, …]}, one number per cell; label: a word for the readout ('wall'); null: no scan
 *     truth     where the robot really is, in `unit` (a black line); t: the time; label: a word for the readout
 *
 * Options (all optional except cells and steps; DEFAULTS below):
 *   mode, cval        filterpy's predict mode, 'wrap' by default as in filterpy, and its fill value
 *   rows              the rows, top to bottom, any of: 'before' (the belief before the motion, bel(x′)),
 *                     'prior' (after the motion, bel⁻), 'likelihood' (the scan, p(z | x)), 'posterior' (after the scan)
 *   ghost             true: the belief before the motion as a dashed outline in the prior row
 *   flows             true: arrows from the 'before' row to the 'prior' row, as thick as the probability they carry
 *   window            null: every cell; [from, to] in `unit`; {width, margin} in cells: a window that follows the belief
 *   overview          'auto' (when the window is narrower than the grid), true, false: a strip with the whole grid
 *   yRange            [0, max] of the probability rows; default: the tallest bar of the whole run, rounded up
 *   likelihoodRange   [0, max] of the likelihood row; default: yRange when the scans fit in it, else their own
 *   values            true, false or 'auto' (at most 12 cells in view): each bar's value above it
 *   digits            decimals of those values; likelihoodDigits: the likelihood row's, if different (a density
 *                     per metre reads 36.3, not 36.26)
 *   rowNotes          true: each row's sum and mean ± σ (or the scan) at its right end
 *   noteDigits        decimals of a mean, z and the truth in the notes and the default readout (4 for metres)
 *   sigmaUnit         {unit, factor, digits}: print σ in a finer unit, e.g. {unit: 'mm', factor: 1000, digits: 1}
 *   counter           function (info) → text: the step counter's words (default 'step k of n')
 *   ring              'auto' (mode 'wrap' with every cell in view), true, false: an arrow from the last cell to the first
 *   unit, decimal     the unit of x and the decimal mark of every printed number: '.' (default) or ','
 *   xLabel            the axis title
 *   rowHeight         px per row
 *   buttons           which buttons, in order: any of 'predict', 'update', 'reset'
 *   resetLabel        the text of the button that returns to `initial` (as in bells.js and runs.js); default labels.reset
 *   controls          false: a static figure, no buttons
 *   readout           true: a line about the state; false: none; function (info, fmt) → HTML: a line of your own
 *   presets           [{label, step, phase}]: buttons that jump to a state, as goTo(step, phase)
 *   initial           {step, phase}: the state at mount and after reset; default: the start
 *   labels            the words of the buttons, rows and picture (DEFAULTS: English; a lesson passes its own)
 *   symbols           the rows' symbols; text between two ‾ gets an overline, _x a subscript: '‾bel‾(x)'
 *   ariaLabel         the start of the figure's text description
 *   onChange          function (info), called after every change
 *
 * Returns a controller:
 *   predict(), update()  one half of the recipe; false when there is nothing to do
 *   reset()              back to `initial`
 *   goTo(step, phase)    the state after `step` steps of predict-then-update ('predicted': the last update not yet)
 *   get()                the info object the readout gets: step, steps, phase, t, truth, motion, offset, kernel,
 *                        z, sigma, scanLabel, sumProducts, eta, skipped, canPredict, canUpdate and the beliefs
 *                        before, prior, likelihood, posterior, current ({p, sum, mean, sigma, peak, peakX})
 *   element
 *
 * The maths, for other lessons and for tests: Grid.predict, Grid.update, Grid.normalize, Grid.convolve, Grid.roll,
 * Grid.shift, Grid.gaussLikelihood, Grid.gaussKernel, Grid.erf, Grid.moments.
 * Colours come from the custom properties --pred (prior, blue), --meas (scan, red), --est (posterior, green),
 * --truth or else --ink (truth, black), --muted, --rule, --bg; the hex fallbacks are the deck's palette.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Grid = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var DEFAULTS = {
    cells: null,
    cellLabels: null,
    start: 'uniform',
    startTruth: null,
    steps: [],
    mode: 'wrap',
    cval: 0,
    rows: ['prior', 'likelihood', 'posterior'],
    ghost: true,
    flows: false,
    window: null,
    overview: 'auto',
    yRange: null,
    likelihoodRange: null,
    values: 'auto',
    digits: 2,
    likelihoodDigits: null,
    rowNotes: false,
    noteDigits: 2,
    sigmaUnit: null,
    counter: null,
    ring: 'auto',
    unit: '',
    decimal: '.',
    xLabel: '',
    rowHeight: 86,
    buttons: ['predict', 'update', 'reset'],
    resetLabel: null,
    controls: true,
    readout: true,
    presets: [],
    initial: null,
    labels: {
      predict: 'predict', update: 'update', reset: '↺ reset',
      step: 'step', of: 'of', start: 'start',
      before: 'before the motion', prior: 'before the scan', likelihood: 'the scan', posterior: 'after the scan',
      truth: 'truth', ring: 'a ring', sum: 'sum', time: 't', timeUnit: 's',
      offset: 'offset', kernel: 'kernel', stand: 'nothing moved', skipped: 'scans skipped',
      failed: 'the scan rules out every cell: the belief is kept'
    },
    symbols: { before: 'bel(x′)', prior: '‾bel‾(x)', likelihood: 'p(z | x)', posterior: 'bel(x)' },
    ariaLabel: 'Bayes filter on a grid',
    onChange: null
  };

  var COLOR = {
    pred: 'var(--pred, #1f77b4)',
    meas: 'var(--meas, #d62728)',
    est: 'var(--est, #2ca02c)',
    truth: 'var(--truth, var(--ink, #222222))',
    ink: 'var(--ink, #222222)',
    muted: 'var(--muted, #555555)',
    rule: 'var(--rule, #e4e4e4)',
    bg: 'var(--bg, #ffffff)'
  };

  // The colour of each row's bars; 'before' takes the colour of whatever it was made by (see beforeKind).
  var ROW_COLOR = { prior: COLOR.pred, likelihood: COLOR.meas, posterior: COLOR.est };

  /* ---------------- maths: filterpy.discrete_bayes 1.4.5, and helpers ---------------- */

  function mod(a, n) { return ((a % n) + n) % n; }

  /** np.roll(pdf, offset) on a 1D array: the cell i moves to i + offset, round the ring. */
  function roll(pdf, offset) {
    var n = pdf.length, out = new Array(n);
    for (var i = 0; i < n; i++) out[mod(i + offset, n)] = +pdf[i];
    return out;
  }

  /**
   * scipy.ndimage.shift(pdf, offset, cval=cval) for a whole offset: cell i takes cell i − offset, and what comes
   * in from beyond the edge is cval. (With an integer offset scipy's spline is exact to 1e-16.)
   */
  function shift(pdf, offset, cval) {
    var n = pdf.length, out = new Array(n), c = cval === undefined ? 0 : +cval;
    for (var i = 0; i < n; i++) {
      var j = i - offset;
      out[i] = j >= 0 && j < n ? +pdf[j] : c;
    }
    return out;
  }

  /**
   * scipy.ndimage.convolve(input, weights, mode=mode, cval=cval) in 1D:
   * out[i] = Σ_j weights[j] · input[i + c − j], c = floor(weights.length / 2);
   * beyond the edges 'wrap' goes round the ring, any other mode reads cval (filterpy passes 'constant').
   */
  function convolve(input, weights, mode, cval) {
    var n = input.length, m = weights.length, c = Math.floor(m / 2), out = new Array(n);
    var fill = cval === undefined ? 0 : +cval;
    for (var i = 0; i < n; i++) {
      var s = 0;
      for (var j = 0; j < m; j++) {
        var k = i + c - j, v;
        if (k >= 0 && k < n) v = +input[k];
        else if (mode === 'wrap') v = +input[mod(k, n)];
        else v = fill;
        s += weights[j] * v;
      }
      out[i] = s;
    }
    return out;
  }

  /**
   * filterpy.discrete_bayes.predict(pdf, offset, kernel, mode='wrap', cval=0.):
   *   if mode == 'wrap': return convolve(np.roll(pdf, offset), kernel, mode='wrap')
   *   return convolve(shift(pdf, offset, cval=cval), kernel, cval=cval, mode='constant')
   */
  function predict(pdf, offset, kernel, mode, cval) {
    var k = Math.round(+offset) || 0;
    var c = cval === undefined ? 0 : +cval;
    if (mode === undefined || mode === 'wrap') return convolve(roll(pdf, k), kernel, 'wrap', 0);
    return convolve(shift(pdf, k, c), kernel, 'constant', c);
  }

  /** filterpy.discrete_bayes.normalize(pdf): pdf /= sum(pdf), in place, and returns pdf. */
  function normalize(pdf) {
    var s = 0, i;
    for (i = 0; i < pdf.length; i++) s += +pdf[i];
    for (i = 0; i < pdf.length; i++) pdf[i] = pdf[i] / s;
    return pdf;
  }

  /** filterpy.discrete_bayes.update(likelihood, prior): posterior = prior * likelihood; return normalize(posterior). */
  function update(likelihood, prior) {
    var post = new Array(prior.length);
    for (var i = 0; i < prior.length; i++) post[i] = prior[i] * likelihood[i];
    return normalize(post);
  }

  var SQRT_2PI = Math.sqrt(2 * Math.PI);

  /** The bell N(z; x, sigma²) at every cell centre x: how likely the reading z is if the truth is x. */
  function gaussLikelihood(xs, z, sigma) {
    var out = new Array(xs.length);
    for (var i = 0; i < xs.length; i++) {
      var u = (z - xs[i]) / sigma;
      out[i] = Math.exp(-0.5 * u * u) / (sigma * SQRT_2PI);
    }
    return out;
  }

  /** The error function, to about 1e-15: a Taylor series near 0, a continued fraction for erfc further out. */
  function erf(x) {
    var ax = Math.abs(x);
    if (ax < 2.5) {
      var sum = x, term = x, x2 = x * x;
      for (var n = 1; n < 200; n++) {
        term *= -x2 / n;
        var add = term / (2 * n + 1);
        sum += add;
        if (Math.abs(add) < 1e-17 * Math.abs(sum)) break;
      }
      return 2 / Math.sqrt(Math.PI) * sum;
    }
    var f = 0;
    for (var k = 80; k >= 1; k--) f = (k / 2) / (ax + f);
    var erfc = Math.exp(-ax * ax) / Math.sqrt(Math.PI) / (ax + f);
    return x > 0 ? 1 - erfc : erfc - 1;
  }

  function Phi(x) { return 0.5 * (1 + erf(x / Math.SQRT2)); }

  /**
   * A kernel from a bell: the chance that a motion error N(mean, sigma²), in cells, lands j cells off,
   * j = −half … half (the share of the bell over [j − ½, j + ½]), rescaled to add up to 1.
   * half: default ceil(4σ + |mean| − ½), at least 1.
   */
  function gaussKernel(sigma, half, mean) {
    var m = mean || 0;
    var h = half === undefined || half === null ? Math.max(1, Math.ceil(4 * sigma + Math.abs(m) - 0.5)) : half;
    var k = [], s = 0, j;
    for (j = -h; j <= h; j++) {
      var p = Phi((j + 0.5 - m) / sigma) - Phi((j - 0.5 - m) / sigma);
      k.push(p); s += p;
    }
    for (j = 0; j < k.length; j++) k[j] /= s;
    return k;
  }

  /** Sum, mean, σ and the tallest cell of a belief over the cell centres xs (mean and σ of p / sum). */
  function moments(xs, p) {
    var s = 0, m = 0, v = 0, peak = -Infinity, at = 0, i;
    for (i = 0; i < p.length; i++) {
      s += p[i];
      if (p[i] > peak) { peak = p[i]; at = i; }
    }
    for (i = 0; i < p.length; i++) m += xs[i] * p[i];
    m /= s;
    for (i = 0; i < p.length; i++) v += (xs[i] - m) * (xs[i] - m) * p[i];
    return { p: p, sum: s, mean: m, sigma: Math.sqrt(Math.max(0, v / s)), peak: peak, peakX: xs[at], peakIndex: at };
  }

  /* ---------------- small helpers ---------------- */

  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function ok(v) { return typeof v === 'number' && isFinite(v); }

  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

  // The decimal mark of the widget being drawn: every entry point sets it from its options before printing.
  var DECIMAL = '.';

  /** A number with the decimal mark and a true minus sign. */
  function fmt(v, digits) {
    if (!ok(v)) return '—';
    var d = digits === undefined ? 2 : digits;
    var t = Math.abs(v) < 0.5 * Math.pow(10, -d) ? 0 : v;
    return t.toFixed(d).replace('.', DECIMAL).replace('-', '−');
  }

  /** 'mean ± σ unit': the mean in `unit` with noteDigits; σ the same, or in sigmaUnit ({unit, factor, digits}). */
  function beliefText(mean, sigma, o) {
    var u = o.unit ? ' ' + o.unit : '', su = o.sigmaUnit;
    if (!su) return fmt(mean, o.noteDigits) + ' ± ' + fmt(sigma, o.noteDigits) + u;
    return fmt(mean, o.noteDigits) + u + ' ± ' + fmt(sigma * (su.factor || 1), su.digits === undefined ? 1 : su.digits) +
      (su.unit ? ' ' + su.unit : '');
  }

  /** σ alone, in sigmaUnit if given. */
  function sigmaText(sigma, o) {
    var su = o.sigmaUnit;
    if (!su) return fmt(sigma, o.noteDigits) + (o.unit ? ' ' + o.unit : '');
    return fmt(sigma * (su.factor || 1), su.digits === undefined ? 1 : su.digits) + (su.unit ? ' ' + su.unit : '');
  }

  /** Rough width of a UI-font label, enough to keep labels apart and inside the frame. */
  function textWidth(s, size) { return String(s).replace(/[‾_]/g, '').length * size * 0.56; }

  /** A symbol for SVG text: text between two ‾ gets an overline, _x a subscript of the next letters or digits. */
  function symSVG(s) {
    var parts = String(s).split('‾'), out = '';
    parts.forEach(function (part, i) {
      var html = esc(part).replace(/_([A-Za-z0-9]+)/g, '<tspan baseline-shift="sub" font-size="75%">$1</tspan>');
      out += i % 2 ? '<tspan text-decoration="overline">' + html + '</tspan>' : html;
    });
    return out;
  }

  /** Round axis steps: 1, 2, 5 × 10ⁿ, at most about `count` labels. */
  function niceStep(span, count) {
    var raw = span / (count || 6), p = Math.pow(10, Math.floor(Math.log(raw) / Math.LN10));
    var cands = [1, 2, 5, 10];
    for (var i = 0; i < cands.length; i++) if (cands[i] * p >= raw - 1e-12) return cands[i] * p;
    return 10 * p;
  }

  /** Decimals a step needs: 5 → 0, 0.5 → 1, 0.25 → 2. */
  function digitsOf(step) {
    for (var d = 0; d < 6; d++) {
      var s = step * Math.pow(10, d);
      if (Math.abs(s - Math.round(s)) < 1e-6 * Math.max(1, s)) return d;
    }
    return 6;
  }

  /** The top of a value axis: a little above the largest value, on a round number. */
  function niceTop(v) {
    if (!(v > 0)) return 1;
    var raw = v * 1.06, p = Math.pow(10, Math.floor(Math.log(raw) / Math.LN10));
    var cands = [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10];
    for (var i = 0; i < cands.length; i++) if (cands[i] * p >= raw - 1e-12) return cands[i] * p;
    return 10 * p;
  }

  /** One round gridline under the top of a value axis: 0.5 for a top of 0.6, 0.2 for 0.25. */
  function gridTick(top) {
    var p = Math.pow(10, Math.floor(Math.log(top) / Math.LN10));
    var cands = [5, 2.5, 2, 1, 0.5, 0.25, 0.2, 0.1];
    for (var i = 0; i < cands.length; i++) if (cands[i] * p <= top * 0.92 + 1e-12) return cands[i] * p;
    return top / 2;
  }

  function halo() {
    return 'paint-order: stroke; stroke: ' + COLOR.bg + '; stroke-width: 4px; stroke-linejoin: round;';
  }

  function cellCentres(cells) {
    if (Array.isArray(cells)) return cells.map(Number);
    if (cells && ok(+cells.count)) {
      var from = ok(+cells.from) ? +cells.from : 0, step = ok(+cells.step) ? +cells.step : 1, out = [];
      for (var i = 0; i < cells.count; i++) out.push(+(from + i * step).toFixed(10));
      return out;
    }
    throw new Error('Grid.mount: cells must be an array of centres or {from, step, count}');
  }

  /* ---------------- the recipe as a state machine ---------------- */

  function hasMotion(step) { return !!(step && step.motion && step.motion.kernel); }
  function hasScan(step) { return !!(step && step.scan); }

  function likelihoodOf(step, xs) {
    var sc = step.scan;
    if (sc.likelihood) return sc.likelihood.map(Number);
    return gaussLikelihood(xs, +sc.z, +sc.sigma);
  }

  /**
   * The engine: pure data, no drawing. A state is
   *   {k: steps applied (0 = the start), phase: 'start' | 'predicted' | 'updated',
   *    before, beforeKind, prior, lik, post, sumProducts, skipped, failed}
   * Every belief is a fresh array, so nothing a figure holds is ever changed in place.
   */
  function makeEngine(o, xs) {
    var n = xs.length, steps = o.steps || [];
    var start;
    if (o.start === 'uniform' || o.start === undefined || o.start === null) {
      start = [];
      for (var i = 0; i < n; i++) start.push(1 / n);
    } else {
      start = o.start.map(Number);
      if (start.length !== n) throw new Error('Grid.mount: start has ' + start.length + ' values for ' + n + ' cells');
    }

    function initial() {
      return { k: 0, phase: 'start', before: null, beforeKind: 'start', prior: null, lik: null, post: null,
        current: start.slice(), currentKind: 'start', sumProducts: NaN, skipped: 0, failed: false };
    }

    function canPredict(st) { return st.k < steps.length; }

    function canUpdate(st) {
      if (st.phase === 'predicted') return hasScan(steps[st.k - 1]);
      return st.k < steps.length && !hasMotion(steps[st.k]) && hasScan(steps[st.k]);
    }

    function doPredict(st) {
      if (!canPredict(st)) return st;
      var step = steps[st.k];
      var base = st.current;
      var prior = hasMotion(step) ? predict(base, step.motion.offset, step.motion.kernel, o.mode, o.cval) : base.slice();
      return { k: st.k + 1, phase: 'predicted', before: base, beforeKind: st.currentKind, prior: prior, lik: null,
        post: null, current: prior, currentKind: 'prior', sumProducts: NaN,
        skipped: st.phase === 'predicted' && hasScan(steps[st.k - 1]) ? st.skipped + 1 : st.phase === 'predicted' ? st.skipped : 0,
        failed: false };
    }

    function doUpdate(st) {
      if (!canUpdate(st)) return st;
      if (st.phase !== 'predicted') st = doPredict(st);
      var step = steps[st.k - 1];
      var lik = likelihoodOf(step, xs);
      var sp = 0;
      for (var i = 0; i < n; i++) sp += st.prior[i] * lik[i];
      if (!(sp > 0) || !isFinite(sp)) {
        // The scan rules out every cell the belief holds: filterpy would return NaN. Keep the prior and say so.
        var keep = {}, key;
        for (key in st) keep[key] = st[key];
        keep.failed = true;
        keep.lik = lik;
        return keep;
      }
      var post = update(lik, st.prior);
      return { k: st.k, phase: 'updated', before: st.before, beforeKind: st.beforeKind, prior: st.prior, lik: lik,
        post: post, current: post, currentKind: 'posterior', sumProducts: sp, skipped: st.skipped, failed: false };
    }

    /** The state after `step` steps of predict-then-update; 'predicted' stops before the last update. */
    function goTo(step, phase) {
      var st = initial(), target = clamp(Math.round(+step) || 0, 0, steps.length);
      while (st.k < target) {
        st = doPredict(st);
        if (st.k < target || phase !== 'predicted') { if (hasScan(steps[st.k - 1])) st = doUpdate(st); }
      }
      return st;
    }

    return { n: n, steps: steps, start: start, initial: initial, predict: doPredict, update: doUpdate,
      canPredict: canPredict, canUpdate: canUpdate, goTo: goTo };
  }

  /* ---------------- drawing (pure: state → SVG string) ---------------- */

  /** Mean and σ of a belief in cell indices. */
  function indexStats(p) {
    var s = 0, m = 0, v = 0, i;
    for (i = 0; i < p.length; i++) { s += p[i]; m += i * p[i]; }
    if (!(s > 0)) return { mean: (p.length - 1) / 2, sigma: Infinity };
    m /= s;
    for (i = 0; i < p.length; i++) v += (i - m) * (i - m) * p[i];
    return { mean: m, sigma: Math.sqrt(v / s) };
  }

  /**
   * The cells in view: [first, last] indices. A following window keeps still while the belief stays inside its
   * middle, so a predict is seen as a shift; it jumps to the latest belief when that leaves the middle, and keeps
   * the belief before it in view too when both fit. A belief spread wider than the window centres it on the truth.
   */
  function windowOf(o, xs, st, prevStart, truth) {
    var n = xs.length;
    if (!o.window) return [0, n - 1];
    if (Array.isArray(o.window)) {
      var a0 = 0, b0 = n - 1;
      while (a0 < n - 1 && xs[a0] < o.window[0] - 1e-9) a0++;
      while (b0 > 0 && xs[b0] > o.window[1] + 1e-9) b0--;
      return [Math.min(a0, b0), Math.max(a0, b0)];
    }
    var w = clamp(Math.round(o.window.width || 25), 1, n);
    var margin = o.window.margin !== undefined ? o.window.margin : Math.max(1, Math.round(0.2 * w));
    var latest = st.phase === 'predicted' ? st.prior : st.phase === 'updated' ? st.post : st.current;
    var other = st.phase === 'predicted' ? st.before : st.phase === 'updated' ? st.prior : null;
    var Ls = indexStats(latest), Os = other ? indexStats(other) : null;
    var lo, hi;
    if (Ls.sigma > w / 2) {
      // Spread over more than the window: nothing to follow; keep the window, or start it at the truth.
      if (prevStart !== null && prevStart !== undefined) return [prevStart, prevStart + w - 1];
      var c0 = Ls.mean;
      if (ok(truth)) { var best = 0; for (var i = 1; i < n; i++) if (Math.abs(xs[i] - truth) < Math.abs(xs[best] - truth)) best = i; c0 = best; }
      lo = hi = c0;
    } else if (Os && Os.sigma <= w / 2 && Math.abs(Os.mean - Ls.mean) <= w - 1 - 2 * margin) {
      lo = Math.min(Ls.mean, Os.mean); hi = Math.max(Ls.mean, Os.mean);
    } else {
      lo = hi = Ls.mean;
    }
    var a = prevStart;
    if (a === null || a === undefined || lo < a + margin || hi > a + w - 1 - margin) a = Math.round((lo + hi) / 2 - (w - 1) / 2);
    a = clamp(a, 0, n - w);
    return [a, a + w - 1];
  }

  /** What each row shows in a state: {p, kind} or null for an empty row. */
  function rowContent(name, st, o) {
    if (st.phase === 'start') {
      var first = ['before', 'prior', 'posterior'].filter(function (r) { return o.rows.indexOf(r) >= 0; })[0];
      return name === first ? { p: st.current, kind: name === 'before' ? 'start' : name } : null;
    }
    if (name === 'before') return { p: st.before, kind: st.beforeKind };
    if (name === 'prior') return { p: st.prior, kind: 'prior' };
    if (name === 'likelihood') return st.lik && !st.failed ? { p: st.lik, kind: 'likelihood' } : null;
    if (name === 'posterior') return st.post ? { p: st.post, kind: 'posterior' } : null;
    return null;
  }

  function kindColor(kind) {
    if (kind === 'prior') return COLOR.pred;
    if (kind === 'likelihood') return COLOR.meas;
    return COLOR.est;   // posterior, start
  }

  function rowColor(name, content) {
    if (name === 'before') return content ? kindColor(content.kind) : COLOR.est;
    return ROW_COLOR[name];
  }

  /** The SVG of one state. */
  function renderFigure(view, o, W, uid) {
    var xs = view.xs, st = view.state, win = view.win, n = xs.length;
    var a = win[0], b = win[1];
    var h = n > 1 ? xs[1] - xs[0] : 1;
    var L = 40, R = 14;
    var showOverview = o.overview === true || (o.overview === 'auto' && (b - a + 1) < n);
    var ovH = showOverview ? 30 : 0;
    var values = o.values === 'auto' ? (b - a + 1) <= 12 : !!o.values;
    var rowH = o.rowHeight, titleH = 17;
    var rows = o.rows;
    var flowGap = o.flows ? 46 : 0;
    var gaps = [];
    for (var r = 0; r < rows.length - 1; r++) {
      gaps.push(o.flows && rows[r] === 'before' && rows[r + 1] === 'prior' ? Math.max(flowGap, 12) : 12);
    }
    var x0 = xs[a] - h / 2, x1 = xs[b] + h / 2;
    var sx = function (x) { return L + (x - x0) / (x1 - x0) * (W - L - R); };
    var showRing = (o.ring === true || (o.ring === 'auto' && o.mode === 'wrap')) && a === 0 && b === n - 1 && n > 1;
    var showTruth = ok(view.truth) && view.truth >= x0 && view.truth <= x1;
    // Under the last row, one line each: the ticks, the truth's label, the ring, the axis title.
    var axisH = 24 + (showTruth ? 15 : 0) + (showRing ? 38 : 0) + (o.xLabel ? 15 : 0) + 4;
    var valH = values ? 15 : 0;   // headroom for the values printed above the bars
    var top0 = 6 + ovH;
    var rowTops = [], y = top0;
    rows.forEach(function (name, i) { rowTops.push(y); y += rowH + (i < gaps.length ? gaps[i] : 0); });
    var lastBase = rowTops[rows.length - 1] + rowH;
    var H = lastBase + axisH;

    var out = [];
    out.push('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + W + ' ' + H + '" width="' + W + '" height="' + H +
      '" role="img" aria-label="' + esc(view.aria) + '">');
    // Arrowheads in user units, so a thick flow does not get a giant head.
    out.push('<defs><marker id="grid-ar-' + uid + '" viewBox="0 0 8 8" refX="7" refY="4" markerUnits="userSpaceOnUse" ' +
      'markerWidth="9" markerHeight="9" orient="auto"><path d="M0,0 L8,4 L0,8 Z" style="fill: ' + COLOR.pred + '"/></marker>' +
      '<marker id="grid-ring-' + uid + '" viewBox="0 0 8 8" refX="7" refY="4" markerUnits="userSpaceOnUse" markerWidth="8" ' +
      'markerHeight="8" orient="auto"><path d="M0,0 L8,4 L0,8 Z" style="fill: ' + COLOR.muted + '"/></marker></defs>');

    // The overview strip: the whole grid, the cells in view, the belief and the truth.
    if (showOverview) {
      var oy = 14, ox0 = L, ox1 = W - R;
      var gx = function (x) { return ox0 + (x - (xs[0] - h / 2)) / ((xs[n - 1] + h / 2) - (xs[0] - h / 2)) * (ox1 - ox0); };
      out.push('<line x1="' + ox0 + '" y1="' + oy + '" x2="' + ox1 + '" y2="' + oy + '" style="stroke: ' + COLOR.muted + '; stroke-width: 1"/>');
      out.push('<rect x="' + gx(x0).toFixed(1) + '" y="' + (oy - 6) + '" width="' + Math.max(2, gx(x1) - gx(x0)).toFixed(1) +
        '" height="12" rx="2" style="fill: ' + COLOR.rule + '; fill-opacity: .7; stroke: ' + COLOR.muted + '; stroke-width: 1"/>');
      var ot = niceStep(xs[n - 1] - xs[0], 5), od = digitsOf(ot);
      for (var tv = Math.ceil((xs[0] - h / 2) / ot - 1e-9) * ot; tv <= xs[n - 1] + h / 2 + 1e-9; tv += ot) {
        out.push('<line x1="' + gx(tv).toFixed(1) + '" y1="' + oy + '" x2="' + gx(tv).toFixed(1) + '" y2="' + (oy + 3) +
          '" style="stroke: ' + COLOR.muted + '; stroke-width: 1"/>');
        out.push('<text x="' + gx(tv).toFixed(1) + '" y="' + (oy + 13) + '" text-anchor="middle" font-size="10" style="fill: ' +
          COLOR.muted + '">' + fmt(tv, od) + '</text>');
      }
      var cur = moments(xs, st.current);
      if (ok(cur.mean) && cur.sigma <= (b - a + 1) * h / 2) {   // a belief spread over the whole grid has no dot
        out.push('<circle cx="' + gx(cur.mean).toFixed(1) + '" cy="' + oy + '" r="3.2" style="fill: ' +
          kindColor(st.currentKind === 'start' ? 'posterior' : st.currentKind) + '"/>');
      }
      if (ok(view.truth)) {
        out.push('<line x1="' + gx(view.truth).toFixed(1) + '" y1="' + (oy - 7) + '" x2="' + gx(view.truth).toFixed(1) + '" y2="' +
          (oy + 7) + '" style="stroke: ' + COLOR.truth + '; stroke-width: 1.6"/>');
      }
    }

    // The rows.
    var yTop = view.yTop, lTop = view.lTop;
    rows.forEach(function (name, ri) {
      var t = rowTops[ri], base = t + rowH, area = rowH - titleH;
      var content = rowContent(name, st, o);
      var col = rowColor(name, content);
      var vmax = name === 'likelihood' ? lTop : yTop;
      var sy = function (v) { return base - clamp(v / vmax, 0, 1) * (area - valH); };
      var empty = !content;

      // A round gridline with its value, then the baseline.
      var gt = gridTick(vmax), gd = digitsOf(gt);
      out.push('<line x1="' + L + '" y1="' + sy(gt).toFixed(1) + '" x2="' + (W - R) + '" y2="' + sy(gt).toFixed(1) +
        '" style="stroke: ' + COLOR.rule + '; stroke-width: 1; stroke-dasharray: 1 3"/>');
      out.push('<text x="' + (L - 6) + '" y="' + (sy(gt) + 3.5).toFixed(1) + '" text-anchor="end" font-size="10" style="fill: ' +
        COLOR.muted + '">' + fmt(gt, gd) + '</text>');
      out.push('<text x="' + (L - 6) + '" y="' + (base + 3.5) + '" text-anchor="end" font-size="10" style="fill: ' +
        COLOR.muted + '">0</text>');

      // The row's title: its symbol and its words; the sum and mean ± σ on the right if asked.
      var label = o.labels[name] || name, sym = o.symbols[name] || '';
      out.push('<text x="' + L + '" y="' + (t + 12) + '" font-size="12.5" style="fill: ' + (empty ? COLOR.muted : col) + '">' +
        (sym ? '<tspan class="sym" font-style="italic">' + symSVG(sym) + '</tspan>  ' : '') + esc(label) + '</text>');
      if (o.rowNotes && content) {
        var note;
        if (name === 'likelihood') {
          var sc = view.step && view.step.scan;
          note = sc && ok(+sc.z) ? 'z = ' + fmt(+sc.z, o.noteDigits) + (o.unit ? ' ' + o.unit : '') + ', σ = ' + sigmaText(+sc.sigma, o) :
            (sc && sc.label ? sc.label : '');
        } else {
          var mm = moments(xs, content.p);
          note = o.labels.sum + ' ' + fmt(mm.sum, 2) + ' · ' + beliefText(mm.mean, mm.sigma, o);
        }
        if (note && textWidth(sym + '  ' + label, 12.5) + textWidth(note, 11) + 20 < W - L - R) {
          out.push('<text x="' + (W - R) + '" y="' + (t + 12) + '" text-anchor="end" font-size="11" style="fill: ' + col + '">' +
            esc(note) + '</text>');
        }
      }

      // Bars.
      var bw = sx(xs[a] + h / 2) - sx(xs[a] - h / 2);
      var gap = bw >= 4 ? Math.min(3, bw * 0.16) : 0;
      if (content) {
        for (var i = a; i <= b; i++) {
          var v = content.p[i];
          if (!(v > 0)) continue;
          var yv = sy(v), xl = sx(xs[i] - h / 2) + gap / 2;
          out.push('<rect x="' + xl.toFixed(1) + '" y="' + yv.toFixed(1) + '" width="' + Math.max(0.6, bw - gap).toFixed(1) +
            '" height="' + Math.max(0, base - yv).toFixed(1) + '" style="fill: ' + col + '; fill-opacity: ' +
            (name === 'likelihood' ? 0.55 : 0.82) + '"/>');
          if (v > vmax * 1.0001) {
            out.push('<path d="M' + (sx(xs[i]) - 4).toFixed(1) + ',' + (yv + 6).toFixed(1) + ' L' + sx(xs[i]).toFixed(1) + ',' +
              (yv + 1).toFixed(1) + ' L' + (sx(xs[i]) + 4).toFixed(1) + ',' + (yv + 6).toFixed(1) +
              '" style="fill: none; stroke: ' + COLOR.bg + '; stroke-width: 1.5"/>');
          }
        }
        // The scan's bell over its bars, when it is a bell.
        if (name === 'likelihood' && view.step && view.step.scan && ok(+view.step.scan.z) && ok(+view.step.scan.sigma)) {
          var z = +view.step.scan.z, sg = +view.step.scan.sigma, d = '', ns = 240;
          for (var q = 0; q <= ns; q++) {
            var xq = x0 + (x1 - x0) * q / ns, uq = (z - xq) / sg;
            d += (q ? 'L' : 'M') + sx(xq).toFixed(1) + ',' + sy(Math.exp(-0.5 * uq * uq) / (sg * SQRT_2PI)).toFixed(1);
          }
          out.push('<path d="' + d + '" style="fill: none; stroke: ' + COLOR.meas + '; stroke-width: 1.6; stroke-linejoin: round"/>');
          if (z >= x0 && z <= x1) {
            out.push('<line x1="' + sx(z).toFixed(1) + '" y1="' + base + '" x2="' + sx(z).toFixed(1) + '" y2="' + (base + 5) +
              '" style="stroke: ' + COLOR.meas + '; stroke-width: 2"/>');
          }
        }
        // The belief before the motion, as a dashed outline over the prior.
        if (name === 'prior' && o.ghost && st.before && st.phase !== 'start' && hasMotion(view.step)) {
          var gc = kindColor(st.beforeKind === 'start' ? 'posterior' : st.beforeKind);
          for (var g = a; g <= b; g++) {
            var gv = st.before[g];
            if (!(gv > 0) || gv < vmax * 0.004) continue;
            var gy = sy(gv);
            out.push('<rect x="' + (sx(xs[g] - h / 2) + gap / 2).toFixed(1) + '" y="' + gy.toFixed(1) + '" width="' +
              Math.max(0.6, bw - gap).toFixed(1) + '" height="' + Math.max(0, base - gy).toFixed(1) + '" style="fill: none; stroke: ' +
              gc + '; stroke-width: 1.3; stroke-dasharray: 3 2"/>');
          }
        }
        if (values) {
          var vd = name === 'likelihood' && o.likelihoodDigits !== null && o.likelihoodDigits !== undefined ? o.likelihoodDigits : o.digits;
          for (var vi = a; vi <= b; vi++) {
            var val = content.p[vi];
            if (!(val >= 0.5 * Math.pow(10, -vd))) continue;
            var ty = Math.max(t + titleH + 10, sy(val) - 4);
            out.push('<text x="' + sx(xs[vi]).toFixed(1) + '" y="' + ty.toFixed(1) + '" text-anchor="middle" font-size="11.5" style="fill: ' +
              col + '; ' + halo() + '">' + fmt(val, vd) + '</text>');
          }
        }
      }
      out.push('<line x1="' + L + '" y1="' + base + '" x2="' + (W - R) + '" y2="' + base + '" style="stroke: ' + COLOR.muted +
        '; stroke-width: 1"/>');
    });

    // Flows: from each cell of 'before' to the cells its probability moves to, as thick as what it carries.
    var bi = rows.indexOf('before'), pi = rows.indexOf('prior');
    if (o.flows && bi >= 0 && pi === bi + 1 && st.phase !== 'start' && view.step && hasMotion(view.step)) {
      var mo = view.step.motion, ker = mo.kernel, c = Math.floor(ker.length / 2), off = Math.round(+mo.offset) || 0;
      var yA = rowTops[bi] + rowH + 3, yB = rowTops[pi] + 4, maxF = 0, flows = [], kept = [];
      for (var j = a; j <= b; j++) {
        var m0 = st.before[j];
        if (!(m0 > 1e-9)) continue;
        for (var kk = 0; kk < ker.length; kk++) {
          if (!(ker[kk] > 0)) continue;
          var to = j + off + (kk - c);
          if (o.mode === 'wrap') to = mod(to, n);
          else if (to < 0 || to >= n) continue;
          if (to < a || to > b) continue;
          var f = m0 * ker[kk];
          flows.push({ from: j, to: to, f: f });
          maxF = Math.max(maxF, f);
        }
      }
      // Only flows worth an arrow: at least 1.2 % of the largest.
      flows.forEach(function (fl) { if (fl.f >= 0.012 * maxF) kept.push(fl); });
      kept.forEach(function (fl) {
        var xa = sx(xs[fl.from]), xb = sx(xs[fl.to]);
        var wdt = Math.max(0.8, 5.5 * fl.f / maxF);
        out.push('<line x1="' + xa.toFixed(1) + '" y1="' + yA + '" x2="' + xb.toFixed(1) + '" y2="' + (yB - 2) +
          '" style="stroke: ' + COLOR.pred + '; stroke-width: ' + wdt.toFixed(2) + '; stroke-opacity: .55" marker-end="url(#grid-ar-' +
          uid + ')"/>');
      });
    }

    // Truth: one black line through every row; its word goes under the axis, clear of the bars' values.
    if (showTruth) {
      var tx = sx(view.truth).toFixed(1);
      out.push('<line x1="' + tx + '" y1="' + (rowTops[0] + titleH - 2) + '" x2="' + tx + '" y2="' + (lastBase + 4) + '" style="stroke: ' +
        COLOR.truth + '; stroke-width: 1.4"/>');
    }

    // The axis under the last row: cell words, or round numbers.
    var ay = lastBase;
    if (o.cellLabels) {
      for (var ci = a; ci <= b; ci++) {
        out.push('<text x="' + sx(xs[ci]).toFixed(1) + '" y="' + (ay + 16) + '" text-anchor="middle" font-size="11.5" style="fill: ' +
          COLOR.muted + '">' + esc(o.cellLabels[ci] === undefined ? '' : o.cellLabels[ci]) + '</text>');
      }
    } else {
      var span = x1 - x0, cols = Math.max(3, Math.round((W - L - R) / 70));
      var step = Math.max(h, niceStep(span, cols)), dg = digitsOf(step);
      for (var tv2 = Math.ceil(xs[a] / step - 1e-9) * step; tv2 <= xs[b] + 1e-9; tv2 += step) {
        var px = sx(tv2).toFixed(1);
        out.push('<line x1="' + px + '" y1="' + ay + '" x2="' + px + '" y2="' + (ay + 5) + '" style="stroke: ' + COLOR.muted +
          '; stroke-width: 1"/>');
        out.push('<text x="' + px + '" y="' + (ay + 17) + '" text-anchor="middle" font-size="11" style="fill: ' + COLOR.muted + '">' +
          fmt(tv2, dg) + '</text>');
      }
    }
    var below = ay + 24;
    if (showTruth) {
      var lw = textWidth(o.labels.truth, 10.5);
      var lx = clamp(sx(view.truth), L + lw / 2, W - R - lw / 2);
      out.push('<text x="' + lx.toFixed(1) + '" y="' + (below + 9) + '" text-anchor="middle" font-size="10.5" style="fill: ' + COLOR.truth +
        '; font-weight: 600; ' + halo() + '">▲ ' + esc(o.labels.truth) + '</text>');
      below += 15;
    }
    if (showRing) {
      var rx0 = sx(xs[n - 1]), rx1 = sx(xs[0]), ry = below;
      out.push('<path d="M' + rx0.toFixed(1) + ',' + (ry - 2) + ' C' + rx0.toFixed(1) + ',' + (ry + 20) + ' ' + rx1.toFixed(1) + ',' +
        (ry + 20) + ' ' + rx1.toFixed(1) + ',' + ry + '" style="fill: none; stroke: ' + COLOR.muted +
        '; stroke-width: 1.2; stroke-dasharray: 4 3" marker-end="url(#grid-ring-' + uid + ')"/>');
      out.push('<text x="' + ((rx0 + rx1) / 2).toFixed(1) + '" y="' + (ry + 31) + '" text-anchor="middle" font-size="10.5" style="fill: ' +
        COLOR.muted + '; ' + halo() + '">' + esc(o.labels.ring) + '</text>');
      below += 38;
    }
    if (o.xLabel) {
      out.push('<text x="' + (W - R) + '" y="' + (below + 10) + '" text-anchor="end" font-size="10.5" style="fill: ' + COLOR.muted + '">' +
        esc(o.xLabel) + '</text>');
    }
    out.push('</svg>');
    return out.join('');
  }

  /* ---------------- the readout ---------------- */

  /** Everything the readout and onChange get about a state. */
  function describe(engine, xs, st, o) {
    var step = st.k > 0 ? engine.steps[st.k - 1] : null;
    var info = {
      step: st.k, steps: engine.steps.length, phase: st.phase, data: step,
      t: step && ok(+step.t) ? +step.t : null,
      truth: step && ok(+step.truth) ? +step.truth : (st.k === 0 && ok(+o.startTruth) ? +o.startTruth : null),
      label: step ? step.label : null,
      motion: hasMotion(step), offset: hasMotion(step) ? Math.round(+step.motion.offset) || 0 : 0,
      kernel: hasMotion(step) ? step.motion.kernel : null,
      z: step && step.scan && ok(+step.scan.z) ? +step.scan.z : null,
      sigma: step && step.scan && ok(+step.scan.sigma) ? +step.scan.sigma : null,
      scanLabel: step && step.scan ? step.scan.label || null : null,
      sumProducts: st.sumProducts, eta: st.sumProducts > 0 ? 1 / st.sumProducts : NaN,
      skipped: st.skipped, failed: st.failed, unit: o.unit,
      canPredict: engine.canPredict(st), canUpdate: engine.canUpdate(st),
      before: st.before ? moments(xs, st.before) : null,
      prior: st.prior ? moments(xs, st.prior) : null,
      likelihood: st.lik || null,
      posterior: st.post ? moments(xs, st.post) : null,
      current: moments(xs, st.current),
      cells: xs
    };
    return info;
  }

  /** The default readout line, in the words of `labels`. */
  function defaultReadout(info, f, o) {
    var lb = o.labels, u = o.unit ? ' ' + o.unit : '';
    var belief = function (m) { return beliefText(m.mean, m.sigma, o); };
    if (info.phase === 'start') return esc(lb.start) + ': ' + belief(info.current);
    var parts = [];
    if (info.t !== null) parts.push(esc(lb.time) + ' = ' + f(info.t, 2) + ' ' + esc(lb.timeUnit));
    if (info.phase === 'predicted') {
      parts.push(esc(lb.predict) + ': ' + (info.motion ? esc(lb.offset) + ' ' + f(info.offset, 0) + ', ' + esc(lb.kernel) + ' ' +
        info.kernel.map(function (k) { return f(k, 3); }).join(' · ') : esc(lb.stand)));
      parts.push('<span class="val">' + esc(lb.prior) + ' ' + belief(info.prior) + '</span>');
    } else {
      parts.push(esc(lb.update) + ': ' + (info.z !== null ? 'z = ' + f(info.z, o.noteDigits) + u : esc(info.scanLabel || '')));
      parts.push('<span class="val">' + esc(lb.posterior) + ' ' + belief(info.posterior) + '</span>');
    }
    if (info.truth !== null) parts.push(esc(lb.truth) + ' ' + f(info.truth, o.noteDigits) + u);
    if (info.skipped) parts.push(esc(lb.skipped) + ' ' + info.skipped);
    if (info.failed) parts.push(esc(lb.failed));
    return parts.join(' · ');
  }

  /* ---------------- mounting ---------------- */

  function merge(opts) {
    var o = {}, k;
    for (k in DEFAULTS) o[k] = DEFAULTS[k];
    for (k in opts) if (Object.prototype.hasOwnProperty.call(opts, k)) o[k] = opts[k];
    ['labels', 'symbols'].forEach(function (key) {
      var m = {}, j;
      for (j in DEFAULTS[key]) m[j] = DEFAULTS[key][j];
      if (opts[key]) for (j in opts[key]) m[j] = opts[key][j];
      o[key] = m;
    });
    if (!o.steps) o.steps = [];
    return o;
  }

  /** The tallest bar of the whole default path (predict then update every step): the fixed height of the rows. */
  function ranges(engine, o) {
    var st = engine.initial(), top = Math.max.apply(null, st.current), ltop = 0, guard = 0;
    while (st.k < engine.steps.length && guard++ < 100000) {
      st = engine.predict(st);
      top = Math.max(top, Math.max.apply(null, st.prior));
      if (engine.canUpdate(st)) {
        st = engine.update(st);
        if (st.lik) ltop = Math.max(ltop, Math.max.apply(null, st.lik));
        if (st.post) top = Math.max(top, Math.max.apply(null, st.post));
      }
    }
    var yTop = o.yRange ? +o.yRange[1] : top <= 1 ? Math.min(1, niceTop(top)) : niceTop(top);
    var lTop = o.likelihoodRange ? +o.likelihoodRange[1] : (ltop <= yTop ? yTop : niceTop(ltop));
    return { yTop: yTop, lTop: lTop };
  }

  var uidCounter = 0;

  function mount(el, options) {
    var o = merge(options || {});
    var uid = ++uidCounter;
    var xs = cellCentres(o.cells);
    var engine = makeEngine(o, xs);
    DECIMAL = o.decimal;
    var rg = ranges(engine, o);
    var doc = el.ownerDocument;

    function make(tag, cls, html) {
      var e = doc.createElement(tag);
      if (cls) e.className = cls;
      if (html !== undefined) e.innerHTML = html;
      return e;
    }

    function initialState() {
      return o.initial ? engine.goTo(o.initial.step, o.initial.phase) : engine.initial();
    }

    var st = initialState(), winStart = null, win = null;

    el.classList.add('grid-widget');
    el.innerHTML = '';
    var panel = el.appendChild(make('div', 'grid-panel'));
    var btn = {}, counter = null, readoutEl = null;
    if (o.controls) {
      var box = el.appendChild(make('div', 'grid-controls'));
      var row = box.appendChild(make('div', 'grid-buttons'));
      o.buttons.forEach(function (name) {
        var text = name === 'reset' && o.resetLabel ? o.resetLabel : (o.labels[name] || name);
        var b = row.appendChild(make('button', 'chip grid-' + name, esc(text)));
        b.type = 'button';
        btn[name] = b;
        b.addEventListener('click', function () {
          if (name === 'predict') api.predict();
          else if (name === 'update') api.update();
          else api.reset();
        });
      });
      (o.presets || []).forEach(function (pr) {
        var b = row.appendChild(make('button', 'chip grid-preset', esc(pr.label)));
        b.type = 'button';
        b.addEventListener('click', function () { api.goTo(pr.step, pr.phase); });
      });
      counter = box.appendChild(make('span', 'grid-counter'));
      counter.setAttribute('aria-live', 'polite');
    }
    if (o.readout) {
      readoutEl = el.appendChild(make('p', 'grid-readout'));
      readoutEl.setAttribute('aria-live', 'polite');
    }

    function width() {
      var w = el.clientWidth || 640;
      return Math.max(300, Math.min(900, Math.round(w)));
    }

    function aria(info) {
      var m = info.current;
      return o.ariaLabel + ': ' + (info.phase === 'start' ? o.labels.start : o.labels.step + ' ' + info.step + ' ' + o.labels.of + ' ' +
        info.steps + ', ' + (info.phase === 'predicted' ? o.labels.predict : o.labels.update)) + '; ' + fmt(m.mean, 1) + ' ± ' +
        fmt(m.sigma, 2) + (o.unit ? ' ' + o.unit : '');
    }

    var raf = 0;
    function draw() {
      raf = 0;
      DECIMAL = o.decimal;
      var info = describe(engine, xs, st, o);
      var view = { xs: xs, state: st, win: win, yTop: rg.yTop, lTop: rg.lTop, truth: info.truth,
        step: st.k > 0 ? engine.steps[st.k - 1] : null, aria: aria(info) };
      panel.innerHTML = renderFigure(view, o, width(), uid);
      if (counter) {
        counter.textContent = typeof o.counter === 'function' ? o.counter(info) : st.phase === 'start' ? o.labels.start :
          o.labels.step + ' ' + st.k + ' ' + o.labels.of + ' ' + engine.steps.length;
      }
      if (btn.predict) btn.predict.disabled = !info.canPredict;
      if (btn.update) btn.update.disabled = !info.canUpdate;
      if (readoutEl) {
        DECIMAL = o.decimal;
        readoutEl.innerHTML = typeof o.readout === 'function' ? o.readout(info, fmt) : defaultReadout(info, fmt, o);
      }
    }
    function schedule() {
      if (raf) return;
      var w = doc.defaultView;
      raf = w && w.requestAnimationFrame ? w.requestAnimationFrame(draw) : (draw(), 0);
    }
    function truthOf(s) {
      var step = s.k > 0 ? engine.steps[s.k - 1] : null;
      return step && ok(+step.truth) ? +step.truth : (ok(+o.startTruth) ? +o.startTruth : null);
    }
    function changed() {
      win = windowOf(o, xs, st, winStart, truthOf(st));
      winStart = win[0];
      schedule();
      if (typeof o.onChange === 'function') { DECIMAL = o.decimal; o.onChange(describe(engine, xs, st, o)); }
    }

    var api = {
      element: el,
      predict: function () {
        if (!engine.canPredict(st)) return false;
        st = engine.predict(st); changed(); return true;
      },
      update: function () {
        if (!engine.canUpdate(st)) return false;
        st = engine.update(st); changed(); return true;
      },
      reset: function () { st = initialState(); winStart = null; changed(); },
      goTo: function (step, phase) { st = engine.goTo(step, phase); winStart = null; changed(); },
      get: function () { DECIMAL = o.decimal; return describe(engine, xs, st, o); }
    };

    var view = doc.defaultView;
    if (view && view.ResizeObserver) {
      var lastW = 0;
      new view.ResizeObserver(function () {
        var w = width();
        if (w !== lastW) { lastW = w; schedule(); }
      }).observe(el);
    } else if (view) {
      view.addEventListener('resize', schedule);
    }

    win = windowOf(o, xs, st, null, truthOf(st));
    winStart = win[0];
    draw();
    return api;
  }

  return {
    mount: mount,
    predict: predict,
    update: update,
    normalize: normalize,
    convolve: convolve,
    roll: roll,
    shift: shift,
    gaussLikelihood: gaussLikelihood,
    gaussKernel: gaussKernel,
    erf: erf,
    moments: moments,
    DEFAULTS: DEFAULTS,
    // For tests and for pages that need a picture or a run without a widget.
    render: { engine: makeEngine, figure: renderFigure, describe: describe, merge: merge, cells: cellCentres, window: windowOf }
  };
});
