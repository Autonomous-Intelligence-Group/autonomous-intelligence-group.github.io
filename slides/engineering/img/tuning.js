/*
 * tuning.js: one Kalman filter on one recorded drive, run at several Q/R ratios; a slider picks the run, and the
 * plot shows that run's error against the truth: the truth as the zero line, the ray's error as dots, the
 * estimate's error with its ±2√P band. Vanilla JavaScript, no libraries, works offline from file://.
 * Modelled on the teach workspace's assets/runs.js (a slider over precomputed runs, the SVG drawn as a string, the
 * controller); runs.js has no band and no share of scans inside it, so this is a small component of its own, and
 * fmt, niceStep, digitsOf, ticks and halo are runs.js's helpers.
 *
 *   <link rel="stylesheet" href="img/tuning-slide.css">
 *   <div id="w6-tuning"></div>
 *   <script src="img/w6-tuning-data.js"></script>          // window.W6_TUNING, written by export_tuning.py
 *   <script src="img/tuning.js"></script>
 *   <script>
 *     Tuning.mount(document.getElementById('w6-tuning'), { data: window.W6_TUNING, start: 0, yRange: [-40, 40] });
 *   </script>
 *
 * Data:
 *   t          [s]: the scans' times
 *   moving     [from, to], s: the interval the run's numbers are taken over; shaded on the plot
 *   ray        [mm]: the ray's error z − d per scan, the same in every run
 *   runs       [run], in slider order: {e, q, r, K, rmse, inside, insideN, n, est, band}
 *              e: log10 of Q/R over the measured ratio (−4 … 4); q, r: the factors on the measured Q and R;
 *              K: K at the last scan; rmse (mm), inside (a share), insideN of n: over the moving scans, printed as
 *              given; est [mm]: d̂ − d per scan; band [mm]: 2√P per scan
 *
 * Options (all optional except data; DEFAULTS below):
 *   start        the e of the run shown first and restored by reset; default 0, the measured ratio
 *   xRange       [s]: default from the whole second before the first scan to the half second after the last
 *   yRange       [mm]: the error axis; values beyond it are clipped
 *   height       the plot's height, px (the SVG adds 50 px of legend and time axis)
 *   decimal      the decimal mark: '.' (default) or ','
 *   resetLabel   the text of the button that returns to start; '' for no button
 *   hover        false: no cursor; otherwise moving over the plot prints the scan's numbers in its corner
 *   releaseKeys  false keeps the focus on the slider; by default a released slider or a pressed button gives
 *                the keyboard back to the page, so → and a clicker change the slide again
 *   labels       every word the widget prints (English by default; see DEFAULTS.labels)
 *   ariaLabel    the start of the plot's text description
 *   onChange     function(state), called after every change
 *
 * Returns a controller: get() → {index, e, run} · select(i) · set(e) → the run nearest to that e · reset() · element.
 * Colours come from the custom properties --ink, --meas, --est, --muted, --rule, --faint, --bg (tuning-slide.css);
 * the hex fallbacks are the deck 6 palette.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Tuning = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var DEFAULTS = {
    data: null,
    start: 0,
    xRange: null,
    yRange: [-40, 40],
    height: 240,
    decimal: '.',
    resetLabel: '↺ reset',
    hover: true,
    releaseKeys: true,
    labels: {
      slider: 'the ratio of the two noises, over the measured one',
      truth: 'truth', ray: 'lidar ray', est: 'estimate', band: '±2σ',
      moving: 'moving', xLabel: 't, s', yLabel: 'distance − truth, mm', time: 't',
      measuredTick: '(measured)', asMeasured: 'as measured', bothMeasured: 'both noises as measured', wheels: 'the wheels', lidar: 'the lidar',
      kEnd: 'K at the end', rmse: 'while moving: RMSE', inside: 'truth inside ±2σ', of: 'of'
    },
    ariaLabel: 'The distance error of a Kalman filter on the drive to the wall',
    onChange: null
  };

  var COLOR = {
    ink: 'var(--ink, #222222)',
    meas: 'var(--meas, #d62728)',
    est: 'var(--est, #2ca02c)',
    muted: 'var(--muted, #555555)',
    rule: 'var(--rule, #e4e4e4)',
    faint: 'var(--faint, #f2f2f2)',
    bg: 'var(--bg, #ffffff)'
  };
  var FONT = 13;            // every SVG label, px; the widget draws 1 SVG unit = 1 slide px, and the deck's floor is 12
  var NBSP = ' ';

  /* ---------------- small helpers (runs.js) ---------------- */

  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function ok(v) { return typeof v === 'number' && isFinite(v); }

  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

  // The decimal mark of the widget being drawn: draw() sets it from its options before printing anything.
  var DECIMAL = '.';

  /** A number with the decimal mark and a true minus sign. */
  function fmt(v, digits) {
    if (!ok(v)) return '—';
    var t = Math.abs(v) < 0.5 * Math.pow(10, -digits) ? 0 : v;
    return t.toFixed(digits).replace('.', DECIMAL).replace('-', '−');
  }

  /** The same with a plus on positive numbers: an error reads +3.1 or −3.1. */
  function signed(v, digits) {
    var s = fmt(v, digits);
    return ok(v) && s.charAt(0) !== '−' && +v.toFixed(digits) !== 0 ? '+' + s : s;
  }

  /** Round axis steps: 1, 2, 5 × 10ⁿ, at most about `count` labels. */
  function niceStep(span, count) {
    var raw = span / (count || 5), p = Math.pow(10, Math.floor(Math.log(raw) / Math.LN10));
    var cands = [1, 2, 5, 10];
    for (var i = 0; i < cands.length; i++) if (cands[i] * p >= raw) return cands[i] * p;
    return 10 * p;
  }

  /** Decimals a tick step needs: 5 → 0, 2.5 → 1, 0.25 → 2. */
  function digitsOf(step) {
    for (var d = 0; d < 4; d++) {
      var s = step * Math.pow(10, d);
      if (Math.abs(s - Math.round(s)) < 1e-6 * Math.max(1, s)) return d;
    }
    return 4;
  }

  function ticks(lo, hi, count) {
    var step = niceStep(hi - lo, count), out = [];
    for (var v = Math.ceil(lo / step - 1e-9) * step; v <= hi + 1e-9 * step; v += step) out.push(Math.abs(v) < 1e-12 ? 0 : v);
    return { values: out, digits: digitsOf(step) };
  }

  function halo() {
    return 'paint-order: stroke; stroke: ' + COLOR.bg + '; stroke-width: 4px; stroke-linejoin: round;';
  }

  /** Rough width of a label in the UI font, enough to lay out the legend. */
  function textWidth(s, size) { return String(s).length * size * 0.56; }

  /** 10^e as the slider prints it: 0.0001 … 10 000, the widget's decimal mark, a no-break space in five digits. */
  function factor(e) {
    if (e < 0) return '0' + DECIMAL + new Array(-e).join('0') + '1';
    var s = '1' + new Array(e + 1).join('0');
    return s.length > 4 ? s.replace(/\B(?=(\d{3})+$)/g, NBSP) : s;
  }

  function factorOf(v) { return factor(Math.round(Math.log(v) / Math.LN10)); }

  /** The symbols Q, R, K, P of a plain label in italics: HTML <i> or an SVG tspan. */
  function symHTML(s) { return esc(s).replace(/\b([QRKP])\b/g, '<i>$1</i>'); }
  function symSVG(s) { return esc(s).replace(/\b([QRKP])\b/g, '<tspan font-style="italic">$1</tspan>'); }

  /** Which noise a run moved: 'the wheels × 0.01, the lidar as measured', … or 'both noises as measured'. */
  function knobs(run, lab) {
    if (run.q === 1 && run.r === 1) return lab.bothMeasured;
    function one(name, v) { return name + ' ' + (v === 1 ? lab.asMeasured : '×' + NBSP + factorOf(v)); }
    return one(lab.wheels, run.q) + ', ' + one(lab.lidar, run.r);
  }

  /* ---------------- drawing (pure: run → SVG string) ---------------- */

  function layout(o, W) {
    var L = 42, R = 10, top = 26, H = o.height, B = top + H;
    var x0 = o.xRange[0], x1 = o.xRange[1], y0 = o.yRange[0], y1 = o.yRange[1], pw = W - L - R;
    return {
      W: W, L: L, R: R, top: top, B: B, H: B + 24, pw: pw, x0: x0, x1: x1,
      sx: function (v) { return L + (v - x0) / (x1 - x0) * pw; },
      sy: function (v) { return B - (v - y0) / (y1 - y0) * H; }
    };
  }

  function path(t, y, g) {
    var d = '', pen = false;
    for (var i = 0; i < t.length; i++) {
      if (!ok(y[i])) { pen = false; continue; }
      d += (pen ? 'L' : 'M') + g.sx(t[i]).toFixed(1) + ',' + g.sy(y[i]).toFixed(1);
      pen = true;
    }
    return d;
  }

  /** The band: the upper edge forward, the lower edge back. */
  function bandPath(t, mid, half, g) {
    var up = [], down = [];
    for (var i = 0; i < t.length; i++) {
      if (!ok(mid[i]) || !ok(half[i])) continue;
      var x = g.sx(t[i]).toFixed(1);
      up.push(x + ',' + g.sy(mid[i] + half[i]).toFixed(1));
      down.push(x + ',' + g.sy(mid[i] - half[i]).toFixed(1));
    }
    return up.length ? 'M' + up.join('L') + 'L' + down.reverse().join('L') + 'Z' : '';
  }

  function describe(run, o) {
    return o.ariaLabel + ': the noise ratio × ' + factor(run.e) + ', ' + knobs(run, o.labels) + '; ' + o.labels.kEnd + ' ' +
      fmt(run.K, 3) + '; ' + o.labels.rmse + ' ' + fmt(run.rmse, 1) + ' mm; ' + o.labels.inside + ' ' +
      fmt(100 * run.inside, 0) + ' %';
  }

  function renderFigure(run, o, W, uid) {
    var d = o.data, lab = o.labels, g = layout(o, W), out = [];
    var clip = 'tn-clip-' + uid, t = d.t;
    out.push('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + W + ' ' + g.H + '" width="' + W + '" height="' + g.H +
      '" role="img" aria-label="' + esc(describe(run, o)) + '">');
    out.push('<defs><clipPath id="' + clip + '"><rect x="' + g.L + '" y="' + g.top + '" width="' + g.pw + '" height="' +
      (g.B - g.top) + '"/></clipPath></defs>');

    // The moving interval, shaded, with its word above the plot: the run's numbers are taken over it.
    var m0 = clamp(g.sx(d.moving[0]), g.L, g.L + g.pw), m1 = clamp(g.sx(d.moving[1]), g.L, g.L + g.pw);
    out.push('<rect x="' + m0.toFixed(1) + '" y="' + g.top + '" width="' + (m1 - m0).toFixed(1) + '" height="' + (g.B - g.top) +
      '" style="fill: ' + COLOR.faint + '"/>');
    out.push('<text x="' + ((m0 + m1) / 2).toFixed(1) + '" y="' + (g.top - 9) + '" text-anchor="middle" font-size="' + FONT +
      '" style="fill: ' + COLOR.muted + '">' + esc(lab.moving) + '</text>');

    // The error axis: a dotted grid, its numbers, its title in the corner.
    var yt = ticks(o.yRange[0], o.yRange[1], 5);
    yt.values.forEach(function (v) {
      var y = g.sy(v).toFixed(1);
      if (v !== 0) out.push('<line x1="' + g.L + '" y1="' + y + '" x2="' + (g.L + g.pw) + '" y2="' + y + '" style="stroke: ' +
        COLOR.rule + '; stroke-width: 1; stroke-dasharray: 2 3"/>');
      out.push('<text x="' + (g.L - 6) + '" y="' + (+y + 4.5).toFixed(1) + '" text-anchor="end" font-size="' + FONT +
        '" style="fill: ' + COLOR.muted + '">' + fmt(v, yt.digits) + '</text>');
    });
    out.push('<text x="0" y="' + (g.top - 9) + '" font-size="' + FONT + '" style="fill: ' + COLOR.muted + '">' +
      esc(lab.yLabel) + '</text>');

    // The data, clipped to the plot: the band under everything, the ray's dots, the truth's zero line, the estimate.
    out.push('<g clip-path="url(#' + clip + ')">');
    out.push('<path d="' + bandPath(t, run.est, run.band, g) + '" style="fill: ' + COLOR.est + '; fill-opacity: 0.2; stroke: none"/>');
    for (var i = 0; i < t.length; i++) {
      if (!ok(d.ray[i])) continue;
      out.push('<circle cx="' + g.sx(t[i]).toFixed(1) + '" cy="' + g.sy(d.ray[i]).toFixed(1) + '" r="2.4" style="fill: ' +
        COLOR.meas + '; fill-opacity: 0.8"/>');
    }
    out.push('<line x1="' + g.L + '" y1="' + g.sy(0).toFixed(1) + '" x2="' + (g.L + g.pw) + '" y2="' + g.sy(0).toFixed(1) +
      '" style="stroke: ' + COLOR.ink + '; stroke-width: 1.6"/>');
    out.push('<path d="' + path(t, run.est, g) + '" style="fill: none; stroke: ' + COLOR.est +
      '; stroke-width: 2.4; stroke-linejoin: round; stroke-linecap: round"/>');
    out.push('</g>');

    // The time axis.
    var xt = ticks(g.x0, g.x1, Math.max(3, Math.round(g.pw / 80)));
    out.push('<line x1="' + g.L + '" y1="' + g.B + '" x2="' + (g.L + g.pw) + '" y2="' + g.B + '" style="stroke: ' + COLOR.muted +
      '; stroke-width: 1"/>');
    xt.values.forEach(function (v) {
      var x = g.sx(v).toFixed(1);
      out.push('<line x1="' + x + '" y1="' + g.B + '" x2="' + x + '" y2="' + (g.B + 5) + '" style="stroke: ' + COLOR.muted +
        '; stroke-width: 1"/>');
      out.push('<text x="' + x + '" y="' + (g.B + 18) + '" text-anchor="middle" font-size="' + FONT + '" style="fill: ' +
        COLOR.muted + '">' + fmt(v, xt.digits) + '</text>');
    });
    out.push('<text x="' + (g.L + g.pw) + '" y="' + (g.B + 18) + '" text-anchor="end" font-size="' + FONT + '" style="fill: ' +
      COLOR.muted + '">' + esc(lab.xLabel) + '</text>');

    // The legend, right-aligned above the plot: a swatch in each series' style, then its word.
    var items = [
      { label: lab.truth, swatch: '<line x1="0" y1="0" x2="18" y2="0" style="stroke: ' + COLOR.ink + '; stroke-width: 1.6"/>' },
      { label: lab.ray, swatch: '<circle cx="9" cy="0" r="3" style="fill: ' + COLOR.meas + '; fill-opacity: 0.8"/>' },
      { label: lab.est, swatch: '<line x1="0" y1="0" x2="18" y2="0" style="stroke: ' + COLOR.est + '; stroke-width: 2.4"/>' },
      { label: lab.band, swatch: '<rect x="0" y="-5" width="18" height="10" style="fill: ' + COLOR.est + '; fill-opacity: 0.2"/>' }
    ];
    var widths = items.map(function (it) { return 23 + textWidth(it.label, FONT); });
    var x = g.L + g.pw - widths.reduce(function (a, b) { return a + b; }, 0) - 16 * (items.length - 1);
    var ly = g.top - 9;
    items.forEach(function (it, k) {
      out.push('<g transform="translate(' + x.toFixed(1) + ',' + (ly - 4.5) + ')">' + it.swatch + '</g>');
      out.push('<text x="' + (x + 23).toFixed(1) + '" y="' + ly + '" font-size="' + FONT + '" style="fill: ' + COLOR.ink + '">' +
        symSVG(it.label) + '</text>');
      x += widths[k] + 16;
    });

    out.push('<g class="tn-cursor"></g>');
    out.push('</svg>');
    return { svg: out.join(''), geometry: g };
  }

  /** The line of numbers under the plot: which knob moved, K at the end, RMSE and the share inside the band. */
  function renderReadout(run, o) {
    var lab = o.labels;
    return '<span class="tn-knobs">' + symHTML(knobs(run, lab)) + '</span> · ' + symHTML(lab.kEnd) + ' <span class="tn-v">' +
      fmt(run.K, 3) + '</span> · ' + symHTML(lab.rmse) + ' <span class="tn-v">' + fmt(run.rmse, 1) + NBSP + 'mm</span>, ' +
      symHTML(lab.inside) + ' <span class="tn-v">' + fmt(100 * run.inside, 0) + NBSP + '%</span> (' + run.insideN + ' ' +
      esc(lab.of) + ' ' + run.n + ')';
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
    var m = {}, j;
    for (j in DEFAULTS.labels) m[j] = DEFAULTS.labels[j];
    if (opts.labels) for (j in opts.labels) m[j] = opts.labels[j];
    o.labels = m;
    var d = o.data;
    if (!d || !d.t || !d.runs || !d.runs.length) throw new Error('Tuning.mount: data needs t and at least one run');
    if (!o.xRange) {
      var t = d.t;
      o.xRange = [Math.floor(t[0]), Math.ceil(2 * t[t.length - 1]) / 2];
    }
    return o;
  }

  function nearest(runs, e) {
    var best = 0;
    for (var i = 1; i < runs.length; i++) if (Math.abs(runs[i].e - e) < Math.abs(runs[best].e - e)) best = i;
    return best;
  }

  var uidCounter = 0;

  function mount(el, options) {
    var o = merge(options || {});
    var uid = ++uidCounter, runs = o.data.runs, doc = el.ownerDocument;
    var startIndex = nearest(runs, o.start), index = startIndex;
    DECIMAL = o.decimal;

    function make(tag, cls, html) {
      var e = doc.createElement(tag);
      if (cls) e.className = cls;
      if (html !== undefined) e.innerHTML = html;
      return e;
    }

    el.classList.add('tn');
    el.innerHTML = '';
    var panel = el.appendChild(make('div', 'tn-panel'));
    var readout = el.appendChild(make('div', 'tn-readout'));
    readout.setAttribute('aria-live', 'polite');

    var box = el.appendChild(make('div', 'tn-controls'));
    box.appendChild(make('span', 'tn-sym', '<i>σ</i><sub><i>u</i></sub><sup>2</sup>/<i>σ</i><sub><i>z</i></sub><sup>2</sup>'));
    var input = make('input');
    input.type = 'range';
    input.min = 0; input.max = runs.length - 1; input.step = 1;
    input.value = index;
    input.setAttribute('aria-label', o.labels.slider);
    keepTouches(input);
    box.appendChild(input);
    var output = box.appendChild(make('output'));
    var buttons = box.appendChild(make('div', 'tn-buttons'));
    var resetButton = null;
    if (o.resetLabel) {
      resetButton = buttons.appendChild(make('button', 'chip', esc(o.resetLabel)));
      resetButton.type = 'button';
      resetButton.addEventListener('click', function () {
        select(startIndex);
        if (o.releaseKeys) resetButton.blur();
      });
    }
    // The ratio under each stop of the thumb; the measured one in bold.
    var track = box.appendChild(make('div', 'tn-ticks'));
    track.setAttribute('aria-hidden', 'true');
    runs.forEach(function (r, i) {
      var text = '×' + NBSP + factor(r.e) + (r.e === 0 && o.labels.measuredTick ? ' ' + o.labels.measuredTick : '');
      var tick = track.appendChild(make('span', r.e === 0 ? 'on' : '', esc(text)));
      tick.style.left = (100 * i / Math.max(1, runs.length - 1)) + '%';
    });
    input.addEventListener('input', function () { select(parseInt(input.value, 10)); });
    if (o.releaseKeys) input.addEventListener('change', function () { input.blur(); });

    function width() {
      var w = el.clientWidth || 640;
      return Math.max(320, Math.min(900, Math.round(w)));
    }

    var geom = null, raf = 0;
    function draw() {
      raf = 0;
      DECIMAL = o.decimal;
      var run = runs[index];
      var fig = renderFigure(run, o, width(), uid);
      geom = fig.geometry;
      panel.innerHTML = fig.svg;
      readout.innerHTML = renderReadout(run, o);
      output.textContent = '×' + NBSP + factor(run.e);
      if (parseInt(input.value, 10) !== index) input.value = index;
    }
    function schedule() {
      if (raf) return;
      var w = doc.defaultView;
      raf = w && w.requestAnimationFrame ? w.requestAnimationFrame(draw) : (draw(), 0);
    }

    // The cursor: a line at the nearest scan, a dot on the ray and on the estimate, their numbers in the corner.
    function showCursor(evt) {
      var svg = panel.querySelector('svg'), layer = panel.querySelector('.tn-cursor');
      if (!geom || !svg || !layer) return;
      var rect = svg.getBoundingClientRect();
      var px = (evt.clientX - rect.left) * geom.W / (rect.width || geom.W);
      if (px < geom.L || px > geom.L + geom.pw) { hideCursor(); return; }
      var tx = geom.x0 + (px - geom.L) / geom.pw * (geom.x1 - geom.x0), t = o.data.t, i = 0;
      for (var k = 1; k < t.length; k++) if (Math.abs(t[k] - tx) < Math.abs(t[i] - tx)) i = k;
      var run = runs[index], ray = o.data.ray[i], x = geom.sx(t[i]).toFixed(1), lab = o.labels;
      DECIMAL = o.decimal;
      var text = esc(lab.time) + ' = ' + fmt(t[i], 1) + ' s · ' + esc(lab.ray) + ' ' + signed(ray, 1) + ' · ' + esc(lab.est) + ' ' +
        signed(run.est[i], 1) + ' ± ' + fmt(run.band[i], 1) + ' mm';
      var left = geom.sx(t[i]) < geom.L + geom.pw / 2;
      layer.innerHTML = '<line x1="' + x + '" y1="' + geom.top + '" x2="' + x + '" y2="' + geom.B + '" style="stroke: ' + COLOR.ink +
        '; stroke-width: 1; stroke-opacity: 0.45"/>' +
        '<circle cx="' + x + '" cy="' + clamp(geom.sy(ray), geom.top, geom.B).toFixed(1) + '" r="3.4" style="fill: ' + COLOR.meas +
        '; stroke: ' + COLOR.bg + '; stroke-width: 1"/>' +
        '<circle cx="' + x + '" cy="' + clamp(geom.sy(run.est[i]), geom.top, geom.B).toFixed(1) + '" r="3.4" style="fill: ' +
        COLOR.est + '; stroke: ' + COLOR.bg + '; stroke-width: 1"/>' +
        '<text x="' + (left ? +x + 8 : +x - 8) + '" y="' + (geom.top + 16) + '" text-anchor="' + (left ? 'start' : 'end') +
        '" font-size="' + FONT + '" style="fill: ' + COLOR.ink + '; ' + halo() + '">' + text + '</text>';
    }
    function hideCursor() {
      var layer = panel.querySelector('.tn-cursor');
      if (layer) layer.innerHTML = '';
    }
    if (o.hover) {
      panel.addEventListener('pointermove', showCursor);
      panel.addEventListener('pointerdown', showCursor);
      panel.addEventListener('pointerleave', hideCursor);
    }

    function get() { return { index: index, e: runs[index].e, run: runs[index] }; }

    function select(i) {
      index = clamp(Math.round(+i) || 0, 0, runs.length - 1);
      schedule();
      if (typeof o.onChange === 'function') o.onChange(get());
    }

    var win = doc.defaultView;
    if (win && win.ResizeObserver) {
      var lastW = 0;
      new win.ResizeObserver(function () {
        var w = width();
        if (w !== lastW) { lastW = w; schedule(); }
      }).observe(el);
    } else if (win) {
      win.addEventListener('resize', schedule);
    }

    draw();
    return {
      element: el,
      get: get,
      select: select,
      set: function (e) { select(nearest(runs, e)); },
      reset: function () { select(startIndex); }
    };
  }

  return {
    mount: mount,
    factor: factor,
    DEFAULTS: DEFAULTS,
    // For tests and for pages that need a picture without a widget.
    render: { figure: renderFigure, readout: renderReadout, merge: merge }
  };
});
