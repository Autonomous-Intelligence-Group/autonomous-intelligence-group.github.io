/*
 * pf.js: Monte Carlo localization by hand, step by step, on our drive — nav2_amcl's three steps, as its code does them.
 * Vanilla JavaScript, no libraries, works offline from file:// (D24). Data: slam-pf-data.js (plots/pf_plots.py widget):
 * the map nav2_amcl was given in our run, its distance field and our drive cut where nav2_amcl updates (after 0.25 m or
 * 0.2 rad of the wheel odometry).
 *
 *   <div id="pf"></div>
 *   <script src="img/slam-pf-data.js"></script>
 *   <script src="img/pf.js"></script>
 *   <script>ParticleFilter.mount(document.getElementById('pf'), {data: window.SLAM_PF_DATA});</script>
 *
 * One press of the main button is one step of an update; three presses, one update, as nav2_amcl (navigation2 jazzy):
 *   1 · move      DifferentialMotionModel::odometryUpdate — every particle moves by the wheel odometry's step
 *                 (turn, drive, turn), each with its own random error: alpha1…alpha4 = 0.2
 *   2 · weigh     LikelihoodFieldModel::sensorFunction — the scan laid from each particle, 60 rays (max_beams); each ray
 *                 that hit something gives pz = z_hit·exp(−d² / 2σ_hit²) + z_rand / range_max, d — the distance from its
 *                 end to the nearest occupied cell; the weight is multiplied by p = 1 + Σ pz³, then all weights are
 *                 scaled to add up to 1 (z_hit 0.5, z_rand 0.5, σ_hit 0.2 m)
 *   3 · resample  pf_update_resample — new particles one at a time, each a copy of an old one drawn with probability
 *                 equal to its weight (the «naive discrete event sampler»); light ones vanish by chance, heavy ones are
 *                 copied; after each copy its histogram cell (0.5 m × 0.5 m × 10°) is noted, and the drawing stops when
 *                 the copies pass n(k), KLD's count for the k occupied cells so far (pf_resample_limit, pf_err 0.05,
 *                 pf_z 0.99), never below min_particles = min(500, N), never above max_particles = N
 * The estimate is nav2_amcl's /amcl_pose: the particles grouped by touching cells of 0.5 m × 0.5 m × 10°
 * (pf_kdtree_cluster), the heaviest group's weighted mean, the heading from the sum of sines and cosines.
 * The start: around a first guess, σ = 0.5 m and 15° — nav2_amcl's spread for a pose set without a covariance — or
 * anywhere: every particle on a random free cell with a random heading, as /reinitialize_global_localization.
 *
 * Options: data (required); n (max_particles, one of NS: the count at the start); start ('guess' | 'anywhere'); seed;
 * size (the map's width, px);
 * blur (true: a used control gives the keyboard back to the deck); legend (HTML under the readouts: what the marks are).
 * Returns {get(), step(), run(k), restart(), element}. The maths, for tests: ParticleFilter.core(data).
 * Colours from pf-slide.css (--est green, --ink, --scan red, --muted, --rule, --bg), hex fallbacks in the SVG.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ParticleFilter = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var NS = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000];   // the slider's stops: up to nav2's max_particles
  var ALPHA = [0.2, 0.2, 0.2, 0.2];                             // alpha1…alpha4
  var Z_HIT = 0.5, Z_RAND = 0.5, SIGMA_HIT = 0.2, MAX_OCC = 2.0; // laser_likelihood_max_dist 2.0 m
  var BIN = [0.5, 0.5, 10 * Math.PI / 180];
  var POP_ERR = 0.05, POP_Z = 0.99, MIN_N = 500;                 // pf_err, pf_z, min_particles
  var GUESS = [0.5, 0.5, Math.PI / 12];                          // σ of x, y (m) and yaw (rad) around the first guess

  /* ---------------- maths ---------------- */

  function rng(seed) {                                           // mulberry32
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function gauss(r, sigma) {                                     // Box–Muller
    var u = 1 - r(), v = r();
    return sigma * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }
  function angleDiff(a, b) {                                     // angleutils::angle_diff: a − b in (−π, π]
    var d = Math.atan2(Math.sin(a), Math.cos(a)) - Math.atan2(Math.sin(b), Math.cos(b));
    var d2 = d < 0 ? d + 2 * Math.PI : d - 2 * Math.PI;
    return Math.abs(d) < Math.abs(d2) ? d : d2;
  }

  function limit(k, minN, maxN) {                                // pf_resample_limit: KLD's count for k occupied cells
    if (k <= 1) return maxN;
    var b = 2 / (9 * (k - 1)), x = 1 - b + Math.sqrt(b) * POP_Z;
    return Math.min(maxN, Math.max(minN, Math.ceil((k - 1) / (2 * POP_ERR) * x * x * x)));
  }

  function core(data) {
    var W = data.w, H = data.h, res = data.res, x0 = data.x0, y0 = data.y0;
    var free = [];
    for (var i = 0; i < W * H; i++) if (data.occ[i] === '.') free.push(i);
    var cs = data.angles.map(Math.cos), sn = data.angles.map(Math.sin);
    var zRandTerm = Z_RAND / data.rangeMax, denom = 2 * SIGMA_HIT * SIGMA_HIT;

    function fieldAt(x, y) {                                     // the distance to the nearest occupied cell, m
      var c = Math.floor((x - x0) / res), r = Math.floor((y - y0) / res);
      if (c < 0 || r < 0 || c >= W || r >= H) return MAX_OCC;    // off the map: «penalized as max distance»
      return Math.min(MAX_OCC, data.dist[r * W + c] / 100);
    }

    function init(n, start, r, gt0) {
      var ps = [];
      for (var k = 0; k < n; k++) {
        var p;
        if (start === 'anywhere') {
          var cell = free[Math.floor(r() * free.length)];
          p = [x0 + (cell % W + r()) * res, y0 + (Math.floor(cell / W) + r()) * res, r() * 2 * Math.PI - Math.PI];
        } else {
          p = [gt0[0] + gauss(r, GUESS[0]), gt0[1] + gauss(r, GUESS[1]), gt0[2] + gauss(r, GUESS[2])];
        }
        ps.push({ x: p[0], y: p[1], t: p[2], w: 1 / n });
      }
      return ps;
    }

    // DifferentialMotionModel::odometryUpdate: the step from odometry pose a to b as turn, drive, turn; each particle
    // makes it with its own random errors.
    function move(ps, a, b, r) {
      var dx = b[0] - a[0], dy = b[1] - a[1], dth = angleDiff(b[2], a[2]);
      var trans = Math.hypot(dx, dy);
      var rot1 = trans < 0.01 ? 0 : angleDiff(Math.atan2(dy, dx), a[2]);
      var rot2 = angleDiff(dth, rot1);
      var n1 = Math.min(Math.abs(angleDiff(rot1, 0)), Math.abs(angleDiff(rot1, Math.PI)));
      var n2 = Math.min(Math.abs(angleDiff(rot2, 0)), Math.abs(angleDiff(rot2, Math.PI)));
      ps.forEach(function (p) {
        var r1 = angleDiff(rot1, gauss(r, Math.sqrt(ALPHA[0] * n1 * n1 + ALPHA[1] * trans * trans)));
        var tr = trans - gauss(r, Math.sqrt(ALPHA[2] * trans * trans + ALPHA[3] * n1 * n1 + ALPHA[3] * n2 * n2));
        var r2 = angleDiff(rot2, gauss(r, Math.sqrt(ALPHA[0] * n2 * n2 + ALPHA[1] * trans * trans)));
        p.x += tr * Math.cos(p.t + r1);
        p.y += tr * Math.sin(p.t + r1);
        p.t += r1 + r2;
      });
    }

    // LikelihoodFieldModel::sensorFunction, then pf_update_sensor's scaling to a sum of 1.
    function weigh(ps, ranges) {
      var total = 0;
      ps.forEach(function (p) {
        var lx = p.x + data.lidarX * Math.cos(p.t), ly = p.y + data.lidarX * Math.sin(p.t);
        var c = Math.cos(p.t), s = Math.sin(p.t), q = 1;
        for (var j = 0; j < ranges.length; j++) {
          var rr = ranges[j] / 1000;
          if (!(rr > 0) || rr >= data.rangeMax - 0.01) continue;   // «this model ignores max range readings»
          var ca = c * cs[j] - s * sn[j], sa = s * cs[j] + c * sn[j];
          var z = fieldAt(lx + rr * ca, ly + rr * sa);
          var pz = Z_HIT * Math.exp(-(z * z) / denom) + zRandTerm;
          q += pz * pz * pz;
        }
        p.w *= q;
        total += p.w;
      });
      ps.forEach(function (p) { p.w /= total; });
    }

    // pf_update_resample: each new particle a copy of an old one, drawn by the cumulative weights; a copy goes into the
    // histogram, and the drawing stops when the copies pass KLD's count for the cells occupied so far.
    function resample(ps, r, maxN) {
      var c = [0], minN = Math.min(MIN_N, maxN), lim = maxN, k = 0;
      ps.forEach(function (p, i) { c.push(c[i] + p.w); });
      var out = [], picked = {}, cells = {};
      while (out.length < maxN) {
        var u = r() * c[ps.length], lo = 0, hi = ps.length - 1;
        while (lo < hi) { var mid = (lo + hi) >> 1; if (c[mid + 1] <= u) lo = mid + 1; else hi = mid; }
        picked[lo] = true;
        out.push({ x: ps[lo].x, y: ps[lo].y, t: ps[lo].t, w: 0 });
        var id = Math.floor(ps[lo].x / BIN[0]) + ',' + Math.floor(ps[lo].y / BIN[1]) + ',' + Math.floor(ps[lo].t / BIN[2]);
        if (!cells[id]) { cells[id] = true; k++; }
        lim = limit(k, minN, maxN);
        if (out.length > lim) break;
      }
      out.forEach(function (p) { p.w = 1 / out.length; });
      return { ps: out, distinct: Object.keys(picked).length, k: k, limit: lim };
    }

    // pf_cluster_stats + getMaxWeightHyp: groups of touching histogram cells, the heaviest group's weighted mean.
    function estimate(ps) {
      var cells = {}, keys = [];
      ps.forEach(function (p, i) {
        var k = [Math.floor(p.x / BIN[0]), Math.floor(p.y / BIN[1]), Math.floor(p.t / BIN[2])];
        var id = k.join(',');
        if (!cells[id]) { cells[id] = { key: k, members: [], group: -1 }; keys.push(id); }
        cells[id].members.push(i);
      });
      var groups = [];
      keys.forEach(function (id) {
        if (cells[id].group >= 0) return;
        var g = { w: 0, sx: 0, sy: 0, sc: 0, ss: 0 }, stack = [id];
        cells[id].group = groups.length;
        while (stack.length) {
          var cell = cells[stack.pop()];
          cell.members.forEach(function (i) {
            var p = ps[i];
            g.w += p.w; g.sx += p.w * p.x; g.sy += p.w * p.y; g.sc += p.w * Math.cos(p.t); g.ss += p.w * Math.sin(p.t);
          });
          for (var a = -1; a <= 1; a++) for (var b = -1; b <= 1; b++) for (var d = -1; d <= 1; d++) {
            var nid = [cell.key[0] + a, cell.key[1] + b, cell.key[2] + d].join(',');
            if (cells[nid] && cells[nid].group < 0) { cells[nid].group = groups.length; stack.push(nid); }
          }
        }
        groups.push(g);
      });
      var best = groups[0];
      groups.forEach(function (g) { if (g.w > best.w) best = g; });
      return { x: best.sx / best.w, y: best.sy / best.w, t: Math.atan2(best.ss, best.sc), groups: groups.length, w: best.w };
    }

    return { init: init, move: move, weigh: weigh, resample: resample, estimate: estimate, fieldAt: fieldAt };
  }

  /* ---------------- drawing ---------------- */

  var COLOR = { est: 'var(--est, #2ca02c)', ink: 'var(--ink, #222222)', scan: 'var(--scan, #d62728)',
    muted: 'var(--muted, #555555)', bg: 'var(--bg, #ffffff)' };
  var ARROW = 'M 1 0 L -0.75 0.65 L -0.35 0 L -0.75 -0.65 Z';  // style7.pose_marker: a notched arrowhead

  function mapImage(doc, data) {                                 // the map in map_server's colours, one pixel a cell
    var cv = doc.createElement('canvas');
    cv.width = data.w; cv.height = data.h;
    var ctx = cv.getContext('2d'), img = ctx.createImageData(data.w, data.h);
    for (var r = 0; r < data.h; r++) for (var c = 0; c < data.w; c++) {
      var ch = data.occ[r * data.w + c], v = ch === '#' ? 0 : ch === '.' ? 255 : 205;
      var o = ((data.h - 1 - r) * data.w + c) * 4;               // row 0 is the lowest y: the image's last row
      img.data[o] = img.data[o + 1] = img.data[o + 2] = v;
      img.data[o + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    return cv.toDataURL('image/png');
  }

  function keepTouches(input) {                                  // as ellipse.js: Marp's swipe must not take the slider
    ['touchstart', 'touchmove', 'touchend'].forEach(function (type) {
      input.addEventListener(type, function (e) { e.stopPropagation(); }, { passive: true });
    });
  }

  function mount(el, options) {
    var o = { n: 100, start: 'guess', seed: 7, size: 600, blur: true };
    for (var key in options) if (Object.prototype.hasOwnProperty.call(options, key)) o[key] = options[key];
    var data = o.data, pf = core(data), doc = el.ownerDocument;
    var scale = o.size / (data.w * data.res), Hpx = data.h * data.res * scale;
    function sx(x) { return (x - data.x0) * scale; }
    function sy(y) { return Hpx - (y - data.y0) * scale; }

    function make(tag, cls, html) {
      var e = doc.createElement(tag);
      if (cls) e.className = cls;
      if (html !== undefined) e.innerHTML = html;
      return e;
    }
    function svgEl(tag, attrs) {
      var e = doc.createElementNS('http://www.w3.org/2000/svg', tag);
      for (var a in attrs) e.setAttribute(a, attrs[a]);
      return e;
    }

    el.classList.add('pfw');
    el.innerHTML = '';
    var plot = el.appendChild(make('div', 'pfw-plot'));
    var svg = plot.appendChild(svgEl('svg', { width: o.size, height: Hpx.toFixed(0), viewBox: '0 0 ' + o.size + ' ' +
      Hpx.toFixed(0), role: 'img', 'aria-label': 'Particles of Monte Carlo localization on our room\'s map' }));
    svg.appendChild(svgEl('image', { href: mapImage(doc, data), x: 0, y: 0, width: o.size, height: Hpx.toFixed(0),
      preserveAspectRatio: 'none', style: 'image-rendering: pixelated' }));
    var gScan = svg.appendChild(svgEl('g', { fill: COLOR.scan }));
    var gParts = svg.appendChild(svgEl('g', { fill: COLOR.est, 'fill-opacity': '0.55' }));
    var truth = svg.appendChild(svgEl('path', { d: ARROW, fill: COLOR.ink, stroke: '#ffffff', 'stroke-width': '0.12' }));
    var est = svg.appendChild(svgEl('path', { d: ARROW, fill: COLOR.est, stroke: COLOR.ink, 'stroke-width': '0.16' }));
    var badge = svg.appendChild(svgEl('text', { x: 8, y: 22, 'font-size': 15, fill: '#ffffff' }));
    var badgeBg = svgEl('rect', { x: 4, y: 6, rx: 4, height: 22, fill: 'rgba(34,34,34,0.82)' });
    svg.insertBefore(badgeBg, badge);

    var panel = el.appendChild(make('div', 'pfw-panel'));
    var sl = panel.appendChild(make('label', 'pfw-slider'));
    sl.appendChild(make('span', 'pfw-name', '<i>N</i> — max_particles'));
    var inp = make('input');
    inp.type = 'range'; inp.min = 0; inp.max = NS.length - 1; inp.step = 1;
    inp.value = Math.max(0, NS.indexOf(o.n));
    inp.setAttribute('aria-label', 'number of particles');
    keepTouches(inp);
    sl.appendChild(inp);
    var nOut = sl.appendChild(make('output'));
    var starts = panel.appendChild(make('div', 'pfw-chips'));
    starts.appendChild(make('span', 'pfw-name', 'start'));
    var chips = {};
    [['guess', 'near a first guess'], ['anywhere', 'anywhere']].forEach(function (s) {
      var b = starts.appendChild(make('button', 'chip', s[1]));
      b.type = 'button';
      b.addEventListener('click', function () { o.start = s[0]; restart(); if (o.blur) b.blur(); });
      chips[s[0]] = b;
    });
    var buttons = panel.appendChild(make('div', 'pfw-buttons'));
    var bStep = buttons.appendChild(make('button', 'pfw-main'));
    var bRun = buttons.appendChild(make('button', 'chip', '▶▶ 10 updates'));
    var bReset = buttons.appendChild(make('button', 'chip', '↺ restart'));
    [bStep, bRun, bReset].forEach(function (b) { b.type = 'button'; });
    var count = panel.appendChild(make('div', 'pfw-count'));
    var info = panel.appendChild(make('div', 'pfw-info'));
    var lines = ['update', 'parts', 'heavy', 'est', 'err'].map(function (c) { return info.appendChild(make('div', 'pfw-' + c)); });
    if (o.legend) panel.appendChild(make('div', 'pfw-legend', o.legend));

    var st, seed = o.seed;
    function restart() {
      var r = rng(seed++);
      var n = NS[+inp.value];
      st = { r: r, u: 0, phase: 'resampled', ps: pf.init(n, o.start, r, data.steps[0].gt), distinct: n, maxN: n, k: 0, limit: n };
      st.est = pf.estimate(st.ps);
      draw();
    }

    function step() {
      if (st.phase === 'resampled') {
        if (st.u >= data.steps.length - 1) return false;
        pf.move(st.ps, data.steps[st.u].odom, data.steps[st.u + 1].odom, st.r);
        st.u += 1;
        st.phase = 'moved';
      } else if (st.phase === 'moved') {
        pf.weigh(st.ps, data.steps[st.u].r);
        st.phase = 'weighed';
      } else {
        var res = pf.resample(st.ps, st.r, st.maxN);
        st.ps = res.ps;
        st.distinct = res.distinct;
        st.k = res.k;
        st.limit = res.limit;
        st.est = pf.estimate(st.ps);
        st.phase = 'resampled';
      }
      return true;
    }

    function run(k) {                                            // k whole updates, drawn as they go
      var left = k * 3 - { resampled: 0, moved: 1, weighed: 2 }[st.phase];
      (function tick() {
        if (left-- <= 0 || !step()) { draw(); return; }
        if (st.phase === 'resampled') { draw(); setTimeout(tick, 140); } else tick();
      })();
    }

    var NEXT = { resampled: '1 · move', moved: '2 · weigh', weighed: '3 · resample' };
    function draw() {
      var n = st.ps.length, s = data.steps[st.u];
      while (gParts.childNodes.length < n) gParts.appendChild(svgEl('path', { d: ARROW }));
      while (gParts.childNodes.length > n) gParts.removeChild(gParts.lastChild);
      var big = st.phase === 'weighed';
      st.ps.forEach(function (p, i) {
        var size = big ? 3 + 9 * Math.sqrt(p.w * n) : 7;          // in step 2 the area grows with the weight
        gParts.childNodes[i].setAttribute('transform', 'translate(' + sx(p.x).toFixed(1) + ' ' + sy(p.y).toFixed(1) +
          ') rotate(' + (-p.t * 180 / Math.PI).toFixed(1) + ') scale(' + Math.min(size, 26).toFixed(2) + ')');
      });
      truth.setAttribute('transform', 'translate(' + sx(s.gt[0]).toFixed(1) + ' ' + sy(s.gt[1]).toFixed(1) +
        ') rotate(' + (-s.gt[2] * 180 / Math.PI).toFixed(1) + ') scale(13)');
      var e = st.est;
      est.setAttribute('transform', 'translate(' + sx(e.x).toFixed(1) + ' ' + sy(e.y).toFixed(1) + ') rotate(' +
        (-e.t * 180 / Math.PI).toFixed(1) + ') scale(13)');
      // the scan laid from the estimate, as RViz lays /scan through AMCL's map → odom
      while (gScan.firstChild) gScan.removeChild(gScan.firstChild);
      var lx = e.x + data.lidarX * Math.cos(e.t), ly = e.y + data.lidarX * Math.sin(e.t);
      s.r.forEach(function (mm, j) {
        var rr = mm / 1000;
        if (!(rr > 0) || rr >= data.rangeMax - 0.01) return;
        var a = e.t + data.angles[j];
        gScan.appendChild(svgEl('circle', { cx: sx(lx + rr * Math.cos(a)).toFixed(1),
          cy: sy(ly + rr * Math.sin(a)).toFixed(1), r: 2.6 }));
      });
      var label = 'update ' + st.u + ' of ' + (data.steps.length - 1) + ' · ' + s.t.toFixed(0) + ' s';
      badge.textContent = label;
      badgeBg.setAttribute('width', (label.length * 7.6 + 8).toFixed(0));
      nOut.textContent = String(st.maxN);
      count.innerHTML = '<b>' + n + '</b> particles now <span>· never below ' + Math.min(MIN_N, st.maxN) + ', never above ' + st.maxN + '</span>';
      inp.style.setProperty('--f', (+inp.value / (NS.length - 1)).toFixed(4));
      chips.guess.classList.toggle('on', o.start === 'guess');
      chips.anywhere.classList.toggle('on', o.start === 'anywhere');
      bStep.textContent = st.u >= data.steps.length - 1 && st.phase === 'resampled' ? 'the drive is over' :
        '▶ ' + NEXT[st.phase];
      var wmax = 0;
      st.ps.forEach(function (p) { wmax = Math.max(wmax, p.w); });
      lines[0].innerHTML = 'last step: <b>' + { resampled: st.u ? '3 · resample' : 'start', moved: '1 · move',
        weighed: '2 · weigh' }[st.phase] + '</b>';
      lines[1].innerHTML = st.phase === 'resampled' && st.u ?
        'drawn: <b>' + n + '</b> copies until <i>k</i> = <b>' + st.k + '</b> cells gave <i>n(k)</i> = <b>' + st.limit + '</b>; different poses: <b>' + st.distinct + '</b>' :
        'each a pose (x, y, θ) and a weight';
      lines[2].innerHTML = 'the heaviest particle\'s weight: <b>' + Math.round(100 * wmax) + ' %</b>' +
        (st.phase === 'weighed' ? '' : ' — all equal');
      lines[3].innerHTML = 'clusters: <b>' + e.groups + '</b>, the heaviest holds <b>' + Math.round(100 * e.w) + ' %</b> of the weight';
      var err = Math.hypot(e.x - s.gt[0], e.y - s.gt[1]);
      lines[4].innerHTML = 'error: <b>' + (err < 1 ? Math.round(err * 100) + ' cm' : err.toFixed(1) + ' m') +
        '</b> — from the estimate to ground truth';
    }

    inp.addEventListener('input', restart);
    if (o.blur) inp.addEventListener('change', function () { inp.blur(); });
    bStep.addEventListener('click', function () { step(); draw(); if (o.blur) bStep.blur(); });
    bRun.addEventListener('click', function () { run(10); if (o.blur) bRun.blur(); });
    bReset.addEventListener('click', function () { restart(); if (o.blur) bReset.blur(); });
    restart();
    return { get: function () { return st; }, step: function () { var ok = step(); draw(); return ok; },
      run: run, restart: restart, element: el };
  }

  return { mount: mount, core: core, NS: NS };
});
