/*
 * ekf-rf2o-steps.js: robot_localization's EKF + rf2o on our drive, step by step: rf2o's pose went into the EKF once in 2 s
 * of the drive (topic_tools throttle), and every update with it is two steps, one after another, nothing left out —
 * predict: the EKF just before the update, after 2 s of the wheels and the gyroscope; update: the EKF after rf2o's pose.
 * Vanilla JavaScript, no libraries, works offline from file:// (D24). Data: ekf-rf2o-steps-data.js (ekf_rf2o/widget_data.py:
 * ekf_node's own debug log, rf2o's poses, the scans, ground truth). Nothing is computed here but what is drawn from the
 * logged state and P.
 *
 *   <div id="erf"></div>
 *   <script src="img/ekf-rf2o-steps-data.js"></script>
 *   <script src="img/ekf-rf2o-steps.js"></script>
 *   <script>EkfRf2oSteps.mount(document.getElementById('erf'), {data: window.EKF_RF2O_STEPS_DATA});</script>
 *
 * The strip on top: a block per step, blue — predict, red — update, the current one outlined. The map: the room, pale;
 * the robot in the EKF, purple, with its 2σ ellipse from P's x, y block, gliding from one step to the next — no path,
 * since an online filter keeps only the pose now; ground truth as a black outline over it; on an update, rf2o's pose,
 * orange, a larger arrow under the robot's (the two nearly coincide), and the two scans rf2o matched for it, grey the one
 * before, red the one now, each laid from rf2o's pose at its time. The panel: the step's name, the pose as a column with
 * its σ — before the update, rf2o's, after it — and on an update the update magnified: grey before, orange rf2o, purple
 * after, with how far the EKF moved towards rf2o. Under the controls the legend: the marks drawn, with a few words, in
 * columns.
 * Options: data (required); start (step index); blur (true: a used control gives the keyboard back to the deck).
 * Returns {get(), go(i), element}.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.EkfRf2oSteps = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var C = { ink: '#222222', pred: '#1f77b4', upd: '#d62728', est: '#7b3fa0', rf2o: '#e8710a', scan: '#d62728',
            before: '#8a8a8a', wall: '#cfcfcf', island: '#ececec', cyl: '#e3d3cb', muted: '#555555' };
  var ARROW = 'M1 0 L-0.75 0.65 L-0.35 0 L-0.75 -0.65 Z';
  var STRIP_W = 1150, GUTTER = 92, SCENE_W = 450, LENS = 104;
  var SIZE = 0.2, SIZE_RF2O = 0.3;                             // the arrows, m: rf2o's larger, so that it shows round the robot's
  var GLIDE = 420, PLAY = 520;                                 // ms: one step's glide; play's pace
  var KIND = [C.pred, C.upd];                                  // step 2j: predict, step 2j + 1: update
  var SPAN = [0.001, 0.002, 0.005, 0.01, 0.02, 0.05, 0.1];    // the lens's scale bar, m: the largest that fits

  function keepTouches(input) {                                // as pf.js: Marp's swipe must not take the slider
    ['touchstart', 'touchmove', 'touchend'].forEach(function (type) {
      input.addEventListener(type, function (e) { e.stopPropagation(); }, { passive: true });
    });
  }
  function axes(p) {                                           // half-axes and angle of a 2 × 2 covariance [xx, xy, yy]
    var m = (p[0] + p[2]) / 2, d = Math.sqrt(Math.pow((p[0] - p[2]) / 2, 2) + p[1] * p[1]);
    return { a: Math.sqrt(Math.max(m + d, 0)), b: Math.sqrt(Math.max(m - d, 0)), ang: 0.5 * Math.atan2(2 * p[1], p[0] - p[2]) };
  }
  function num(v, d) { var s = Math.abs(v).toFixed(d); return (v < 0 && +s !== 0 ? '−' : '') + s; }   // no «−0.000»
  function deg(r) { return r * 180 / Math.PI; }
  function wrap(a) { return Math.atan2(Math.sin(a), Math.cos(a)); }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function posed(a, b, t) { return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), a[2] + wrap(b[2] - a[2]) * t]; }
  function covd(a, b, t) { return [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)]; }
  function sdCm(v) { return (100 * Math.sqrt(v)).toFixed(1); }  // a variance, m², as σ in cm
  function share(part, whole) { return Math.abs(whole) < 1e-6 ? '' : Math.round(100 * part / whole) + ' %'; }

  function mount(el, options) {
    var o = { blur: true };
    for (var key in options) if (Object.prototype.hasOwnProperty.call(options, key)) o[key] = options[key];
    var data = o.data, U = data.ups, N = 2 * U.length, doc = el.ownerDocument;
    function make(tag, cls, html) {
      var e = doc.createElement(tag);
      if (cls) e.className = cls;
      if (html !== undefined) e.innerHTML = html;
      return e;
    }
    function svgEl(tag, attrs, text) {
      var e = doc.createElementNS('http://www.w3.org/2000/svg', tag);
      for (var a in attrs) e.setAttribute(a, attrs[a]);
      if (text !== undefined) e.textContent = text;
      return e;
    }

    el.classList.add('erf');
    el.innerHTML = '';

    /* ---------------- the strip: a block per step ---------------- */
    var BAR = (STRIP_W - GUTTER) / N, STRIP_H = 24;
    var sv = el.appendChild(make('div', 'erf-strip')).appendChild(svgEl('svg', { width: STRIP_W, height: STRIP_H,
      viewBox: '0 0 ' + STRIP_W + ' ' + STRIP_H, role: 'img', 'aria-label': 'Every step of the EKF in order: blue predict, red update' }));
    sv.appendChild(svgEl('text', { x: GUTTER - 8, y: 17, 'text-anchor': 'end', 'font-size': 14, fill: C.muted }, 'EKF steps'));
    for (var q = 0; q < N; q++) {
      (function (q) {
        var r = sv.appendChild(svgEl('rect', { x: GUTTER + q * BAR + 0.5, y: 3, width: Math.max(BAR - 1, 1), height: 18,
          fill: KIND[q % 2], style: 'cursor:pointer' }));
        r.addEventListener('click', function () { halt(); go(q); });
      })(q);
    }
    var frame = sv.appendChild(svgEl('rect', { y: 2, height: 20, width: BAR, fill: 'none', stroke: C.ink, 'stroke-width': 2 }));

    /* ---------------- the map: world coordinates in a group, y up ---------------- */
    var main = el.appendChild(make('div', 'erf-main'));
    /* a margin of 0.45 m round the walls: a scan laid from rf2o's pose, off by its drift (up to 0.44 m beyond a wall on our
       drive), stays in the picture */
    var R = data.room, M = 0.45, sc = SCENE_W / (R[1] - R[0] + 2 * M), SH = Math.round((R[3] - R[2] + 2 * M) * sc), k = 1 / sc;
    var map = main.appendChild(svgEl('svg', { width: SCENE_W, height: SH, viewBox: '0 0 ' + SCENE_W + ' ' + SH, role: 'img',
      'aria-label': "The room from above: the robot in the EKF with its ellipse, ground truth, rf2o's pose and its two scans", class: 'erf-map' }));
    var g = map.appendChild(svgEl('g', { transform: 'matrix(' + sc + ' 0 0 ' + (-sc) + ' ' + ((M - R[0]) * sc) + ' ' + ((R[3] + M) * sc) + ')' }));
    g.appendChild(svgEl('rect', { x: R[0], y: R[2], width: R[1] - R[0], height: R[3] - R[2], fill: '#ffffff', stroke: C.wall, 'stroke-width': 4 * k }));
    g.appendChild(svgEl('rect', { x: data.island[0], y: data.island[1], width: data.island[2], height: data.island[3], fill: C.island }));
    data.cyl.forEach(function (c) { g.appendChild(svgEl('circle', { cx: c[0], cy: c[1], r: data.rCyl, fill: C.cyl })); });
    /* a return as a dot: a zero-length line with round ends */
    var sPrev = g.appendChild(svgEl('path', { fill: 'none', stroke: C.before, 'stroke-width': 3.6 * k, 'stroke-linecap': 'round' }));
    var sNow = g.appendChild(svgEl('path', { fill: 'none', stroke: C.scan, 'stroke-width': 3.6 * k, 'stroke-linecap': 'round' }));
    var eRobot = g.appendChild(svgEl('ellipse', { fill: C.est, 'fill-opacity': 0.14, stroke: C.est, 'stroke-width': 2 * k }));
    var aRf2o = g.appendChild(svgEl('path', { d: ARROW, fill: C.rf2o }));
    var aRobot = g.appendChild(svgEl('path', { d: ARROW, fill: C.est }));
    /* ground truth an outline over the filled estimate: where they coincide, both can be seen */
    var aTruth = g.appendChild(svgEl('path', { d: ARROW, fill: 'none', stroke: C.ink, 'stroke-width': 1.3 * k / SIZE, 'stroke-linejoin': 'round' }));

    /* ---------------- the panel ---------------- */
    var panel = main.appendChild(make('div', 'erf-panel'));
    var head = panel.appendChild(make('div', 'erf-head'));
    var say = panel.appendChild(make('div', 'erf-say'));
    var table = panel.appendChild(make('div', 'erf-table'));
    var lensBox = panel.appendChild(make('div', 'erf-lensbox'));
    var lens = lensBox.appendChild(svgEl('svg', { width: LENS, height: LENS, viewBox: '0 0 ' + LENS + ' ' + LENS, role: 'img',
      'aria-label': 'The update magnified: grey the EKF before, orange rf2o, purple the EKF after', class: 'erf-lens' }));
    var lLine = lens.appendChild(svgEl('line', { stroke: '#c4c4c4', 'stroke-width': 1.5 }));
    var lB = lens.appendChild(svgEl('circle', { r: 5, fill: C.before }));
    var lO = lens.appendChild(svgEl('circle', { r: 5, fill: C.rf2o }));
    var lA = lens.appendChild(svgEl('circle', { r: 5, fill: C.est }));
    var lBar = lens.appendChild(svgEl('line', { y1: LENS - 9, y2: LENS - 9, x1: 8, stroke: C.ink, 'stroke-width': 2 }));
    var lBarText = lens.appendChild(svgEl('text', { x: 8, y: LENS - 14, 'font-size': 12, fill: C.ink }));
    var note = lensBox.appendChild(make('div', 'erf-note'));

    /* ---------------- controls and legend ---------------- */
    var ctrl = el.appendChild(make('div', 'erf-ctrl'));
    var bStart = ctrl.appendChild(make('button', 'chip', '⏮ start'));
    var bBack = ctrl.appendChild(make('button', 'chip', '◀ back'));
    var bNext = ctrl.appendChild(make('button', 'erf-next', 'next step ▶'));
    var bPlay = ctrl.appendChild(make('button', 'chip erf-play', '▶ play'));
    var inp = ctrl.appendChild(make('input'));
    inp.type = 'range'; inp.min = 0; inp.max = N - 1; inp.step = 1;
    inp.setAttribute('aria-label', 'the step of the EKF');
    keepTouches(inp);
    var count = ctrl.appendChild(make('output'));
    [bStart, bBack, bNext, bPlay].forEach(function (b) { b.type = 'button'; });

    /* the legend: every mark drawn, in columns */
    function icon(inner) { return '<svg width="26" height="14" viewBox="0 0 26 14" aria-hidden="true">' + inner + '</svg>'; }
    function arrowIcon(fill, stroke, s) {
      return '<path transform="translate(13 7) scale(' + (s || 6.5) + ')" d="' + ARROW + '" fill="' + fill + '"' +
        (stroke ? ' stroke="' + stroke + '" stroke-width="0.16"' : '') + '/>';
    }
    function dots(colour) {
      return icon([5, 11, 17, 23].map(function (x, n) { return '<circle cx="' + x + '" cy="' + (n % 2 ? 5 : 9) + '" r="1.9" fill="' + colour + '"/>'; }).join(''));
    }
    function stepIcon(fill) { return icon('<rect x="7" y="1" width="12" height="12" fill="' + fill + '"/>'); }
    var legend = el.appendChild(make('div', 'erf-legend'));
    [
      [[icon('<ellipse cx="13" cy="7" rx="12" ry="6" fill="' + C.est + '" fill-opacity="0.14" stroke="' + C.est + '" stroke-width="1.4"/>' + arrowIcon(C.est)),
        'the robot in the EKF; ellipse: 2σ of <i>x</i>, <i>y</i>'],
       [icon(arrowIcon('none', C.ink)), 'ground truth']],
      [[icon(arrowIcon(C.rf2o, null, 8)), "rf2o's pose"]],
      [[dots(C.before), 'the scan before'], [dots(C.scan), 'the scan now']],
      [[stepIcon(C.pred), 'predict'], [stepIcon(C.upd), 'update']]
    ].forEach(function (items) {
      var col = legend.appendChild(make('div', 'col'));
      items.forEach(function (item) { col.appendChild(make('div', 'it', item[0] + '<span>' + item[1] + '</span>')); });
    });

    /* ---------------- drawing ---------------- */
    function show(e, on) { e.style.display = on ? '' : 'none'; }
    function place(path, p, size) {
      path.setAttribute('transform', 'translate(' + p[0].toFixed(4) + ' ' + p[1].toFixed(4) + ') rotate(' + deg(p[2]).toFixed(2) + ') scale(' + size + ')');
    }
    function setEllipse(e, p, c) {                             // a 2σ ellipse from P's x, y block
      var ax = axes(c);
      e.setAttribute('rx', Math.max(2 * ax.a, 0.6 * k).toFixed(4)); e.setAttribute('ry', Math.max(2 * ax.b, 0.6 * k).toFixed(4));
      e.setAttribute('transform', 'translate(' + p[0].toFixed(4) + ' ' + p[1].toFixed(4) + ') rotate(' + deg(ax.ang).toFixed(2) + ')');
    }
    function scanD(r, pose) {                                  // a scan's returns, cm, laid from rf2o's pose at its time
      var c = Math.cos(pose[2]), s = Math.sin(pose[2]), d = '';
      for (var n = 0; n < r.length; n++) {
        if (!r[n]) continue;
        var a = data.angleMin + n * data.angleInc, px = data.lidarX + r[n] / 100 * Math.cos(a), py = r[n] / 100 * Math.sin(a);
        d += 'M' + (pose[0] + c * px - s * py).toFixed(3) + ' ' + (pose[1] + s * px + c * py).toFixed(3) + 'h0';
      }
      return d;
    }
    function stateOf(q) {                                      // what the map shows at step q: the EKF's pose, its P, ground truth
      var u = U[q >> 1];
      return q % 2 ? { p: u.a, c: u.aP, g: u.g } : { p: u.b, c: u.bP, g: u.g };
    }
    var raf = 0, glide = false, ready = false, shown = 0;
    function play(moves) {                                     // one step forward or back glides, any other jump is at once
      cancelAnimationFrame(raf);
      if (!glide) { moves.forEach(function (f) { f(1); }); return; }
      moves.forEach(function (f) { f(0); });
      var t0 = null;
      (function step(now) {
        if (now !== undefined) {
          if (t0 === null) t0 = now;
          var w = Math.min(1, (now - t0) / GLIDE);
          moves.forEach(function (f) { f(w * (2 - w)); });
          if (w >= 1) return;
        }
        raf = requestAnimationFrame(step);
      })();
    }

    /* the panel's column: the pose and its σ — before the update, rf2o's measurement, after the update */
    var NAMES = ['<i>x</i>, m', '<i>y</i>, m', 'yaw, °', 'σ of <i>x</i>, cm', 'σ of <i>y</i>, cm', 'σ of yaw, °'];
    var rf2oVar = [data.sigma[0] * data.sigma[0], 0, data.sigma[1] * data.sigma[1], data.sigma[2] * data.sigma[2]];
    function column(p, c) {
      return [num(p[0], 3), num(p[1], 3), num(deg(p[2]), 2), sdCm(c[0]), sdCm(c[2]), deg(Math.sqrt(c[3])).toFixed(1)];
    }

    var i = 0;
    function draw() {
      var j = i >> 1, up = i % 2 === 1, u = U[j];
      /* the strip and the controls */
      frame.setAttribute('x', GUTTER + i * BAR);
      inp.value = i; inp.style.setProperty('--f', i / (N - 1));
      count.textContent = 'step ' + (i + 1) + ' / ' + N + ' · ' + u.tf.toFixed(1) + ' s';

      /* the map: the robot glides from the step shown before; rf2o and its scans on an update */
      var to = stateOf(i), from = glide ? stateOf(shown) : to, forward = glide && shown === i - 1;
      show(sPrev, up); show(sNow, up); show(aRf2o, up);
      if (up) {
        sPrev.setAttribute('d', scanD(u.sp, u.zp));
        sNow.setAttribute('d', scanD(u.sc, u.z));
        place(aRf2o, u.z, SIZE_RF2O);
      }
      var moves = [function (t) {
        var p = posed(from.p, to.p, t);
        setEllipse(eRobot, p, covd(from.c, to.c, t));
        place(aRobot, p, SIZE);
        place(aTruth, posed(from.g, to.g, t), SIZE);
      }];

      /* the panel: the step's name, what changed, the pose as a column */
      head.innerHTML = up ? '<b class="u">update step</b>' : '<b class="p">predict step</b>';
      if (up) {
        say.innerHTML = "rf2o's pose: the scan now matched against the one " + data.scanDt.toFixed(1) + ' s before<br>' +
          'σ of <i>x</i> shrank: ' + sdCm(u.bP[0]) + ' → ' + sdCm(u.aP[0]) + ' cm';
      } else {
        say.innerHTML = (u.tf - (j ? U[j - 1].tf : data.start)).toFixed(1) + ' s of the wheels and the gyroscope since ' +
          (j ? 'the update before<br>σ of <i>x</i> grew: ' + sdCm(U[j - 1].aP[0]) + ' → ' + sdCm(u.bP[0]) + ' cm' : 'the start');
      }
      var cols = [['b', 'before', column(u.b, u.bP)], ['o', 'rf2o', column(u.z, rf2oVar)], ['a', 'after', column(u.a, u.aP)]];
      var html = '<div class="l h"></div>' + cols.map(function (c) { return '<div class="h ' + c[0] + '">' + c[1] + '</div>'; }).join('');
      NAMES.forEach(function (name, r) {
        var sep = r === 3 ? ' sep' : '';
        html += '<div class="l' + sep + '">' + name + '</div>';
        cols.forEach(function (c, n) {
          var on = n === 0 || up;                              // predict: only the EKF before the update so far
          var lit = (n === 0 && !up) ? ' p' : (n === 2 && up) ? ' u' : '';   // what this step changed: its colour, pale
          html += '<div class="' + c[0] + (on ? ' on' : ' e') + lit + sep + '">' + (on ? c[2][r] : '') + '</div>';
        });
      });
      table.innerHTML = html;

      /* the update magnified: from before towards rf2o, and how far the EKF went */
      lensBox.style.visibility = up ? 'visible' : 'hidden';
      if (up) {
        var gap = Math.hypot(u.z[0] - u.b[0], u.z[1] - u.b[1]), went = Math.hypot(u.a[0] - u.b[0], u.a[1] - u.b[1]);
        var yGap = wrap(u.z[2] - u.b[2]), yWent = wrap(u.a[2] - u.b[2]);
        var s = 64 / Math.max(gap, 0.002), mx = (u.b[0] + u.z[0]) / 2, my = (u.b[1] + u.z[1]) / 2;
        var LX = function (x) { return LENS / 2 + (x - mx) * s; }, LY = function (y) { return LENS / 2 - 8 - (y - my) * s; };
        lLine.setAttribute('x1', LX(u.b[0])); lLine.setAttribute('y1', LY(u.b[1]));
        lLine.setAttribute('x2', LX(u.z[0])); lLine.setAttribute('y2', LY(u.z[1]));
        lB.setAttribute('cx', LX(u.b[0])); lB.setAttribute('cy', LY(u.b[1]));
        lO.setAttribute('cx', LX(u.z[0])); lO.setAttribute('cy', LY(u.z[1]));
        moves.push(function (t) {                              // from its predict step the purple leaves the grey, as on the map
          var f = forward ? t : 1;
          lA.setAttribute('cx', LX(lerp(u.b[0], u.a[0], f))); lA.setAttribute('cy', LY(lerp(u.b[1], u.a[1], f)));
        });
        var unit = SPAN.filter(function (v) { return v * s <= 60; }).pop() || SPAN[0];
        lBar.setAttribute('x2', 8 + unit * s);
        lBarText.textContent = (unit * 100) + ' cm';
        var dy = Math.abs(deg(yGap)) < 0.1 ? 3 : 2;           // a tiny turn keeps a digit more, so that its share can be read
        note.innerHTML = '<div class="nh">the EKF moved towards rf2o</div>' +
          '<div><i>x</i>, <i>y</i></div><div><b>' + (100 * went).toFixed(2) + '</b> of ' + (100 * gap).toFixed(2) + ' cm</div><div><b>' + share(went, gap) + '</b></div>' +
          '<div>yaw</div><div><b>' + Math.abs(deg(yWent)).toFixed(dy) + '</b> of ' + Math.abs(deg(yGap)).toFixed(dy) + '°</div><div><b>' + share(yWent, yGap) + '</b></div>';
      }

      shown = i;
      play(moves);
    }

    function go(q) {
      var to = Math.max(0, Math.min(N - 1, q));
      glide = ready && Math.abs(to - i) === 1;
      i = to;
      draw();
    }
    var timer = 0;
    function halt() {
      if (!timer) return;
      clearInterval(timer); timer = 0;
      bPlay.textContent = '▶ play';
    }
    function after(b) { if (o.blur) b.blur(); }
    bNext.addEventListener('click', function () { halt(); go(i + 1); after(bNext); });
    bBack.addEventListener('click', function () { halt(); go(i - 1); after(bBack); });
    bStart.addEventListener('click', function () { halt(); go(0); after(bStart); });
    bPlay.addEventListener('click', function () {             // a step every PLAY ms; it stops at the last step
      if (timer) halt();
      else {
        if (i >= N - 1) go(0);
        bPlay.textContent = '❚❚ pause';
        timer = setInterval(function () { go(i + 1); if (i >= N - 1) halt(); }, PLAY);
      }
      after(bPlay);
    });
    inp.addEventListener('input', function () { halt(); go(+inp.value); });
    inp.addEventListener('change', function () { if (o.blur) inp.blur(); });

    go(o.start === undefined ? 0 : o.start);
    ready = true;
    return { get: function () { return { i: i, up: i % 2 === 1, update: U[i >> 1] }; }, go: go, element: el };
  }

  return { mount: mount };
});
