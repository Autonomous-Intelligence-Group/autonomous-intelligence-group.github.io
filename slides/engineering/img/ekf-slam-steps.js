/*
 * ekf-slam-steps.js: EKF-SLAM with landmarks in the state, step by step: every predict, update and new landmark of MRPT's
 * CRangeBearingKFSLAM2D on our drive, one after another, nothing left out. Vanilla JavaScript, no libraries, works offline
 * from file:// (D24). Data: ekf-slam-steps-data.js (mrpt_ekf.py widget). Nothing is computed here but what is drawn from the
 * logged state and P.
 *
 *   <div id="esl"></div>
 *   <script src="img/ekf-slam-steps-data.js"></script>
 *   <script src="img/ekf-slam-steps.js"></script>
 *   <script>EkfSlamSteps.mount(document.getElementById('esl'), {data: window.EKF_SLAM_STEPS_DATA});</script>
 *
 * The strip on top: a block per step, blue — predict, red — update, brown — a new landmark. The map: the room, the robot,
 * ground truth as a black outline, the landmarks in the state with their 2σ ellipses, each drawn from its x, y block of P,
 * gliding from one step to the next; no path, since the EKF keeps only the current pose. Beside it the state s as one column with each number's σ, and P as a square, row for row: the darker a cell, the larger
 * its number, on one scale, and under the cursor the cell says which two numbers it belongs to and holds one value: σ² on
 * the diagonal, a covariance off it. The panel: what the step did, with its numbers and, for each landmark seen, its
 * ellipse magnified: grey before, brown after.
 * A landmark has one written form everywhere: ℓ in italics, its number a subscript.
 * Under the controls the legend: the marks drawn, with a few words, in columns.
 * Options: data (required); start (event index); blur (true: a used control gives the keyboard back to the deck).
 * Returns {get(), go(i), element}.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.EkfSlamSteps = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var C = { ink: '#222222', pred: '#1f77b4', est: '#7b3fa0', scan: '#d62728', cyl: '#8c564b', cross: '#7a6a8f', wall: '#9a9a9a',
            faint: '#c8c8c8', muted: '#555555' };
  var ARROW = 'M1 0 L-0.75 0.65 L-0.35 0 L-0.75 -0.65 Z';
  var SCENE_W = 400, STRIP_W = 1150, GUTTER = 92, CELL = 13, TOP = 14;
  var KIND = { predict: C.pred, update: C.scan, 'new': C.cyl };
  var LM = '<span class="esl-l">ℓ</span>', MATH = "'STIX Two Math', 'STIX Two Text', 'Cambria Math', 'Times New Roman', serif";

  function keepTouches(input) {                                // as pf.js: Marp's swipe must not take the slider
    ['touchstart', 'touchmove', 'touchend'].forEach(function (type) {
      input.addEventListener(type, function (e) { e.stopPropagation(); }, { passive: true });
    });
  }
  function axes(p) {                                           // half-axes and angle of a 2 × 2 covariance [xx, xy, yy]
    var m = (p[0] + p[2]) / 2, d = Math.sqrt(Math.pow((p[0] - p[2]) / 2, 2) + p[1] * p[1]);
    return { a: Math.sqrt(Math.max(m + d, 0)), b: Math.sqrt(Math.max(m - d, 0)), ang: 0.5 * Math.atan2(2 * p[1], p[0] - p[2]) };
  }
  function signed(v, d) { return (v < 0 ? '−' : '+') + Math.abs(v).toFixed(d); }
  function num(v, d) { return (v < 0 ? '−' : '') + Math.abs(v).toFixed(d); }
  function deg(r) { return r * 180 / Math.PI; }
  function wrap(a) { return Math.atan2(Math.sin(a), Math.cos(a)); }
  function pOf(n, list, r, c) {                                // a cell of P, from its upper triangle in row order
    if (r > c) { var t = r; r = c; c = t; }
    return list[r * n - r * (r - 1) / 2 + c - r];
  }
  function maskOf(n, mask, r, c) {
    if (r > c) { var t = r; r = c; c = t; }
    return mask.charAt(r * n - r * (r - 1) / 2 + c - r) === '1';
  }
  function block(n, list, ix) { return [pOf(n, list, ix, ix), pOf(n, list, ix, ix + 1), pOf(n, list, ix + 1, ix + 1)]; }
  function poseText(p) { return '(' + num(p[0], 2) + ', ' + num(p[1], 2) + ') m, θ ' + signed(deg(p[2]), 1) + '°'; }
  function lmHtml(j) { return LM + '<sub>' + (j + 1) + '</sub>'; }
  function nameOf(q) {                                         // a number of the state: the same in the column and under the cursor
    return q < 3 ? '<i>' + ['x', 'y', 'θ'][q] + '</i>' : LM + '<sub>' + (Math.floor((q - 3) / 2) + 1) + (q % 2 ? ',x' : ',y') + '</sub>';
  }

  function mount(el, options) {
    var o = { blur: true };
    for (var key in options) if (Object.prototype.hasOwnProperty.call(options, key)) o[key] = options[key];
    var data = o.data, ev = data.events, N = ev.length, doc = el.ownerDocument;
    var maxN = ev.reduce(function (m, e) { return Math.max(m, e.x.length); }, 3);
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
    function lmLabel(j, size, attrs) {                         // lmHtml on a picture: ℓ in italics, its number a subscript
      var label = svgEl('text', attrs);
      label.setAttribute('font-size', size);
      label.appendChild(svgEl('tspan', { 'font-style': 'italic', style: 'font-family:' + MATH }, 'ℓ'));
      label.appendChild(svgEl('tspan', { dy: 0.2 * size, 'font-size': 0.75 * size }, String(j + 1)));
      return label;
    }

    el.classList.add('esl');
    el.innerHTML = '';

    /* the scale of P's cells: the largest root of a number's size over the whole drive, so that the darker a cell, the
       larger its number */
    var refP = 1e-9;
    ev.forEach(function (e) { e.P.forEach(function (v) { refP = Math.max(refP, Math.sqrt(Math.abs(v))); }); });
    function shade(v) { return v === 0 ? 0 : 0.04 + 0.96 * Math.min(1, Math.sqrt(Math.abs(v)) / refP); }

    /* ---------------- the strip: a block per step ---------------- */
    var BAR = (STRIP_W - GUTTER) / N;
    var strip = el.appendChild(make('div', 'esl-strip'));
    var STRIP_H = 24;
    var sv = strip.appendChild(svgEl('svg', { width: STRIP_W, height: STRIP_H, viewBox: '0 0 ' + STRIP_W + ' ' + STRIP_H, role: 'img',
      'aria-label': 'Every step of the EKF in order' }));
    function BX(i) { return GUTTER + i * BAR; }
    function CXE(i) { return BX(i) + BAR / 2; }
    sv.appendChild(svgEl('text', { x: GUTTER - 8, y: 17, 'text-anchor': 'end', 'font-size': 14, fill: C.muted }, 'EKF steps'));
    ev.forEach(function (e, i) {
      var r = sv.appendChild(svgEl('rect', { x: BX(i) + 0.5, y: 3, width: Math.max(BAR - 1, 1), height: 18, fill: KIND[e.kind], style: 'cursor:pointer' }));
      r.addEventListener('click', function () { go(i); });
      if (e.kind === 'new') {
        sv.appendChild(svgEl('text', { x: CXE(i), y: 16, 'text-anchor': 'middle', 'font-size': 12, 'font-weight': 700, fill: '#ffffff',
          style: 'pointer-events:none' }, '+'));
      }
    });
    var frame = sv.appendChild(svgEl('rect', { y: 2, height: 20, width: BAR, fill: 'none', stroke: C.ink, 'stroke-width': 2 }));

    /* ---------------- the map ---------------- */
    var main = el.appendChild(make('div', 'esl-main'));
    var R = data.room, M = 0.2, sc = SCENE_W / (R[1] - R[0] + 2 * M), SH = Math.round((R[3] - R[2] + 2 * M) * sc);
    function X(x) { return (x - R[0] + M) * sc; }
    function Y(y) { return (R[3] + M - y) * sc; }
    var scene = main.appendChild(svgEl('svg', { width: SCENE_W, height: SH, viewBox: '0 0 ' + SCENE_W + ' ' + SH, role: 'img',
      'aria-label': 'The room from above: the robot and the landmarks in the state with their ellipses', class: 'esl-map' }));
    scene.appendChild(svgEl('rect', { x: X(R[0]), y: Y(R[3]), width: (R[1] - R[0]) * sc, height: (R[3] - R[2]) * sc, fill: '#ffffff',
      stroke: C.wall, 'stroke-width': 5 }));
    scene.appendChild(svgEl('rect', { x: X(data.island[0]), y: Y(data.island[1] + data.island[3]), width: data.island[2] * sc,
      height: data.island[3] * sc, fill: C.faint }));
    data.cyl.forEach(function (c) {
      scene.appendChild(svgEl('circle', { cx: X(c[0]), cy: Y(c[1]), r: data.rCyl * sc, fill: 'none', stroke: C.ink, 'stroke-width': 0.9 }));
    });
    var rays = scene.appendChild(svgEl('g', {}));              // under the ellipses, so that a ray does not hide one
    var layer = scene.appendChild(svgEl('g', {}));
    var eRobot = scene.appendChild(svgEl('ellipse', { fill: C.est, 'fill-opacity': 0.14, stroke: C.est, 'stroke-width': 2 }));
    var sPose = scene.appendChild(svgEl('path', { d: ARROW, fill: C.est }));
    /* ground truth an outline over the filled estimate: where they coincide, both can be seen */
    var sTruth = scene.appendChild(svgEl('path', { d: ARROW, fill: 'none', stroke: C.ink, 'stroke-width': 0.13 }));

    /* ---------------- the state as a column, P as a square, row for row ---------------- */
    var colWrap = main.appendChild(make('div', 'esl-state'));
    var pW = maxN * CELL;
    var gridWrap = main.appendChild(make('div', 'esl-p'));
    var pHead = gridWrap.appendChild(make('div', 'esl-cap'));
    var grid = gridWrap.appendChild(svgEl('svg', { width: pW, height: pW + TOP, viewBox: '0 0 ' + pW + ' ' + (pW + TOP), role: 'img',
      'aria-label': 'The covariance matrix P as a square of cells: the darker, the larger the number' }));
    var tip = gridWrap.appendChild(make('div', 'esl-tip'));
    tip.style.display = 'none';
    var hoverBox = svgEl('rect', { width: CELL, height: CELL, fill: 'none', stroke: C.ink, 'stroke-width': 2, style: 'pointer-events:none' });
    var hover = null;                                          // [row, column] of the cell under the cursor

    /* ---------------- the panel ---------------- */
    var panel = main.appendChild(make('div', 'esl-panel'));
    var head = panel.appendChild(make('div', 'esl-head'));
    var say = panel.appendChild(make('div', 'esl-say'));
    var body = panel.appendChild(make('div', 'esl-body'));

    /* ---------------- controls and legend ---------------- */
    var ctrl = el.appendChild(make('div', 'esl-ctrl'));
    var bStart = ctrl.appendChild(make('button', 'chip', '⏮ start'));
    var bBack = ctrl.appendChild(make('button', 'chip', '◀ back'));
    var bNext = ctrl.appendChild(make('button', 'esl-next', 'next step ▶'));
    var bNew = ctrl.appendChild(make('button', 'chip', 'next new landmark ⏭'));
    var inp = ctrl.appendChild(make('input'));
    inp.type = 'range'; inp.min = 0; inp.max = N - 1; inp.step = 1;
    inp.setAttribute('aria-label', 'the step of the EKF');
    keepTouches(inp);
    var count = ctrl.appendChild(make('output'));
    [bStart, bBack, bNext, bNew].forEach(function (b) { b.type = 'button'; });

    /* ---------------- the legend: every mark drawn, in columns ---------------- */
    function icon(inner) { return '<svg width="26" height="14" viewBox="0 0 26 14" aria-hidden="true">' + inner + '</svg>'; }
    function lineIcon(colour, width, op) {
      return icon('<line x1="1" y1="7" x2="25" y2="7" stroke="' + colour + '" stroke-width="' + width + '" stroke-opacity="' + (op || 1) + '"/>');
    }
    function oval(cx, rx, ry, fill, op, stroke, width) {
      return '<ellipse cx="' + cx + '" cy="7" rx="' + rx + '" ry="' + ry + '" fill="' + fill + '" fill-opacity="' + op + '" stroke="' + stroke + '" stroke-width="' + width + '"/>';
    }
    function cell(x, op) { return '<rect x="' + x + '" y="1" width="12" height="12" fill="' + C.cyl + '" fill-opacity="' + op + '"/>'; }
    function stepIcon(fill, plus) {
      return icon('<rect x="7" y="1" width="12" height="12" fill="' + fill + '"/>' + (plus ? '<text x="13" y="11.5" text-anchor="middle" font-size="12" font-weight="700" fill="#ffffff">+</text>' : ''));
    }
    var legend = el.appendChild(make('div', 'esl-legend'));
    [
      [[icon(oval(13, 12, 6, C.est, 0.14, C.est, 1.4) + '<path transform="translate(13 7) scale(6.5)" d="' + ARROW + '" fill="' + C.est + '"/>'), 'the robot in the EKF; ellipse: 2σ of <i>x</i>, <i>y</i>'],
       [icon('<path transform="translate(13 7) scale(6.5)" d="' + ARROW + '" fill="none" stroke="' + C.ink + '" stroke-width="0.16"/>'), 'ground truth']],
      [[icon(oval(13, 11, 5, C.cyl, 0.2, C.cyl, 1) + '<circle cx="13" cy="7" r="2.3" fill="' + C.cyl + '"/>'), 'landmark ' + lmHtml(0) + '; ellipse: 2σ of its <i>x</i>, <i>y</i>'],
       [icon('<circle cx="13" cy="7" r="5.5" fill="none" stroke="' + C.ink + '" stroke-width="0.9"/>'), 'real cylinder']],
      [[lineIcon(C.scan, 2), 'reading <i>z</i>; <i>ẑ</i> in the panel — expected from the state'],
       [icon(cell(0, 1) + cell(14, 0.25)), 'covariance <i>P</i>: darker, larger']],
      [[stepIcon(C.pred), 'predict'], [stepIcon(C.scan), 'update'], [stepIcon(C.cyl, true), 'new landmark']]
    ].forEach(function (items) {
      var col = legend.appendChild(make('div', 'col'));
      items.forEach(function (item) { col.appendChild(make('div', 'it', item[0] + '<span>' + item[1] + '</span>')); });
    });

    function line(sym, cls, val, note) {
      return '<div class="esl-sym ' + cls + '">' + sym + '</div><div class="esl-val">' + val +
        (note ? '<span class="esl-note">' + note + '</span>' : '') + '</div>';
    }
    function place(path, p, size) {
      path.setAttribute('transform', 'translate(' + X(p[0]).toFixed(1) + ' ' + Y(p[1]).toFixed(1) + ') rotate(' + (-deg(p[2])).toFixed(1) +
        ') scale(' + (size * sc).toFixed(1) + ')');
    }
    function shape(cov, p) {                                   // a 2σ ellipse on the map, as numbers one can glide between
      var ax = axes(cov);
      return { rx: Math.max(2 * ax.a * sc, 0.6), ry: Math.max(2 * ax.b * sc, 0.6), ang: -deg(ax.ang), x: X(p[0]), y: Y(p[1]) };
    }
    function between(a, b, t) {
      var turn = ((b.ang - a.ang + 90) % 180 + 180) % 180 - 90;   // an ellipse is the same after half a turn
      return { rx: a.rx + (b.rx - a.rx) * t, ry: a.ry + (b.ry - a.ry) * t, ang: a.ang + turn * t, x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
    }
    function setShape(e, q) {
      e.setAttribute('rx', q.rx.toFixed(1)); e.setAttribute('ry', q.ry.toFixed(1));
      e.setAttribute('transform', 'translate(' + q.x.toFixed(1) + ' ' + q.y.toFixed(1) + ') rotate(' + q.ang.toFixed(1) + ')');
    }
    function posed(a, b, t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + wrap(b[2] - a[2]) * t]; }
    var raf = 0, glide = false, ready = false;
    function play(moves) {                                     // one step forward or back glides, any other jump is at once
      cancelAnimationFrame(raf);
      if (!glide) { moves.forEach(function (f) { f(1); }); return; }
      moves.forEach(function (f) { f(0); });
      var t0 = null;
      (function frame(now) {
        if (now !== undefined) {
          if (t0 === null) t0 = now;
          var u = Math.min(1, (now - t0) / 420);
          moves.forEach(function (f) { f(u * (2 - u)); });
          if (u >= 1) return;
        }
        raf = requestAnimationFrame(frame);
      })();
    }
    function lens(was, now) {                                  // the landmark's ellipse magnified: grey before, brown after
      var A = axes(was), B = axes(now), S = 19 / Math.max(A.a, B.a, 1e-6);
      function shapeOf(ax, attrs) {
        return '<ellipse rx="' + Math.max(ax.a * S, 0.8).toFixed(1) + '" ry="' + Math.max(ax.b * S, 0.8).toFixed(1) + '" transform="rotate(' + (-deg(ax.ang)).toFixed(1) + ')" ' + attrs + '/>';
      }
      return '<svg class="esl-lens" width="46" height="46" viewBox="-23 -23 46 46" role="img" aria-label="The landmark\'s ellipse magnified: grey before this update, brown after">' +
        shapeOf(A, 'fill="none" stroke="#8a8a8a" stroke-width="1.5"') + shapeOf(B, 'fill="' + C.cyl + '" fill-opacity="0.8" stroke="' + C.cyl + '" stroke-width="1"') + '</svg>';
    }
    function numText(v) { return v === 0 ? '0' : (v < 0 ? '−' : '') + Math.abs(v).toPrecision(3); }
    function showTip() {                                       // the cell under the cursor: its two numbers and the one value it holds
      var e = ev[i], n = e.x.length;
      if (!hover || hover[0] >= n || hover[1] >= n) { tip.style.display = 'none'; hoverBox.style.display = 'none'; return; }
      var r = hover[0], c = hover[1], v = pOf(n, e.P, r, c);
      var unit = r === 2 && c === 2 ? 'rad²' : r === 2 || c === 2 ? 'm·rad' : 'm²';
      tip.innerHTML = nameOf(r) + ' · ' + nameOf(c) + '<br>' + (r === c ? 'σ² ' : 'covariance ') + numText(v) + ' ' + unit;
      tip.style.display = 'block';
      hoverBox.style.display = '';
      hoverBox.setAttribute('x', c * CELL); hoverBox.setAttribute('y', TOP + r * CELL);
      var w = tip.offsetWidth, h = tip.offsetHeight, top = pHead.offsetHeight + TOP + r * CELL;
      tip.style.left = Math.max(0, Math.min(pW - w, (c + 0.5) * CELL - w / 2)) + 'px';
      tip.style.top = (top - h - 5 >= 0 ? top - h - 5 : top + CELL + 5) + 'px';
    }
    function cellAt(evt) {
      var box = grid.getBoundingClientRect(), k = box.width / pW;  // Marp scales the slide
      var c = Math.floor((evt.clientX - box.left) / k / CELL), r = Math.floor(((evt.clientY - box.top) / k - TOP) / CELL);
      return r >= 0 && c >= 0 ? [r, c] : null;
    }
    grid.addEventListener('mousemove', function (evt) { hover = cellAt(evt); showTip(); });
    grid.addEventListener('click', function (evt) { hover = cellAt(evt); showTip(); });
    grid.addEventListener('mouseleave', function () { hover = null; showTip(); });
    function ray(x1, y1, x2, y2, colour, dash, w) {
      var attrs = { x1: X(x1), y1: Y(y1), x2: X(x2), y2: Y(y2), stroke: colour, 'stroke-width': w || 2 };
      if (dash) attrs['stroke-dasharray'] = dash;
      rays.appendChild(svgEl('line', attrs));
    }
    var seenAt = [];                                           // for each step, how many steps ago each landmark seen in it was last seen
    (function () {
      var last = {};
      ev.forEach(function (e, q) {
        var gaps = {};
        if (e.kind === 'update') e.z.forEach(function (z) { gaps[z[2]] = last[z[2]] === undefined ? 0 : q - last[z[2]]; last[z[2]] = q; });
        if (e.kind === 'new') last[e.lm] = q;
        seenAt[q] = gaps;
      });
    })();

    var i = 0;
    function draw() {
      var e = ev[i], n = e.x.length, L = (n - 3) / 2, g = data.gt[e.k];
      var prev = i ? ev[i - 1] : null, pn = prev ? prev.x.length : 0;
      var isNew = e.kind === 'new', isUp = e.kind === 'update', isPred = e.kind === 'predict';
      /* the strip and the controls */
      frame.setAttribute('x', BX(i));
      inp.value = i; inp.style.setProperty('--f', i / (N - 1));
      count.textContent = 'step ' + (i + 1) + ' / ' + N;
      /* the map */
      layer.innerHTML = '';
      rays.innerHTML = '';
      var seen = {}, moves = [];
      if (isUp) e.z.forEach(function (z) { seen[z[2]] = true; });
      for (var j = 0; j < L; j++) {
        (function (j) {
          var ix = 3 + 2 * j, on = (isNew && e.lm === j) || seen[j];
          var to = shape(block(n, e.P, ix), [e.x[ix], e.x[ix + 1]]);
          var was = prev && ix + 1 < pn ? shape(block(pn, prev.P, ix), [prev.x[ix], prev.x[ix + 1]]) : to;
          var oval = layer.appendChild(svgEl('ellipse', { fill: C.cyl, 'fill-opacity': on ? 0.3 : 0.14, stroke: C.cyl, 'stroke-width': on ? 2 : 1 }));
          var dot = layer.appendChild(svgEl('circle', { r: on ? 3.6 : 2.6, fill: C.cyl }));
          var lab = layer.appendChild(lmLabel(j, 14, { fill: C.cyl }));
          moves.push(function (t) {
            var q = between(was, to, t);
            setShape(oval, q);
            dot.setAttribute('cx', q.x.toFixed(1)); dot.setAttribute('cy', q.y.toFixed(1));
            lab.setAttribute('x', (q.x + 6).toFixed(1)); lab.setAttribute('y', (q.y - 5).toFixed(1));
          });
        })(j);
      }
      if (isUp) {
        e.z.forEach(function (z) {                             // a reading starts at the robot and moves with it
          var beam = rays.appendChild(svgEl('line', { stroke: C.scan, 'stroke-width': 2 }));
          moves.push(function (t) {
            var p = posed(e.a, e.x, t), a = p[2] + z[1];
            beam.setAttribute('x1', X(p[0]).toFixed(1)); beam.setAttribute('y1', Y(p[1]).toFixed(1));
            beam.setAttribute('x2', X(p[0] + z[0] * Math.cos(a)).toFixed(1)); beam.setAttribute('y2', Y(p[1] + z[0] * Math.sin(a)).toFixed(1));
          });
        });
      }
      if (isNew) {
        var nix = 3 + 2 * e.lm;
        ray(e.x[0], e.x[1], e.x[nix], e.x[nix + 1], C.scan, null, 2.4);
      }
      var rTo = shape(block(n, e.P, 0), e.x), rWas = prev ? shape(block(pn, prev.P, 0), prev.x) : rTo;
      var pWas = prev ? prev.x : e.x, gWas = prev ? data.gt[prev.k] : g;
      moves.push(function (t) {
        setShape(eRobot, between(rWas, rTo, t));
        place(sPose, posed(pWas, e.x, t), 0.2);
        place(sTruth, posed(gWas, g, t), 0.2);
      });

      /* the state, one column, each number with its σ */
      var changed = {}, sd = [];
      e.cx.forEach(function (q) { changed[q] = true; });
      var cls = isPred ? 'p' : isUp ? 'u' : 'n';
      var rowHead = '<div class="esl-rowhead"><span></span><span>m</span><span>σ, cm</span></div>';
      var rows = '<div class="esl-cap">state: ' + n + ' numbers</div>' + rowHead, poseRows = rowHead;
      for (var q = 0; q < n; q++) {
        sd[q] = Math.sqrt(Math.max(pOf(n, e.P, q, q), 0));
        var nm = nameOf(q);
        var t = q < 3 ? 'r' : 'l';
        var sep = q === 3 || (q > 3 && q % 2 === 1) ? ' sep' : '';
        var lvl = changed[q] ? ' on ' + cls : '';
        var val = q === 2 ? num(deg(e.x[q]), 1) + '°' : num(e.x[q], 2);
        var sdv = q === 2 ? deg(sd[q]).toFixed(1) + '°' : (sd[q] * 100).toFixed(1);
        var row = '<div class="esl-row ' + t + sep + lvl + '" style="height:' + CELL + 'px"><span>' + nm + '</span><b>' + val + '</b><span class="sd">' + sdv + '</span></div>';
        rows += row;
        if (q < 3) poseRows += row;
      }
      colWrap.innerHTML = rows;

      /* P, the square, row for row with the column: the darker a cell, the larger its number */
      grid.innerHTML = '';
      var size = n * CELL;
      var cP = 0;
      ['x', 'y', 'θ'].forEach(function (s, q) {
        grid.appendChild(svgEl('text', { x: (q + 0.5) * CELL, y: 10, 'text-anchor': 'middle', 'font-size': 12, 'font-style': 'italic', fill: C.muted }, s));
      });
      for (var b = 0; b < L; b++) grid.appendChild(lmLabel(b, 12, { x: (3 + 2 * b + 1) * CELL, y: 10, 'text-anchor': 'middle', fill: C.muted }));
      for (var r = 0; r < n; r++) {
        for (var c = 0; c < n; c++) {
          var v = pOf(n, e.P, r, c), ch = maskOf(n, e.cP, r, c);
          if (ch) cP++;
          var hue = r < 3 && c < 3 ? C.est : r >= 3 && c >= 3 ? C.cyl : C.cross;
          (function (rect, to, was) {                          // a cell that changed fades to its new shade
            if (to !== was) moves.push(function (t) { rect.setAttribute('fill-opacity', (was + (to - was) * t).toFixed(3)); });
          })(grid.appendChild(svgEl('rect', { x: c * CELL + 0.5, y: TOP + r * CELL + 0.5, width: CELL - 1, height: CELL - 1, fill: hue, 'fill-opacity': shade(v).toFixed(3) })),
             shade(v), r < pn && c < pn ? shade(pOf(pn, prev.P, r, c)) : shade(v));
        }
      }
      grid.appendChild(svgEl('rect', { x: 0.5, y: TOP + 0.5, width: size - 1, height: size - 1, fill: 'none', stroke: C.muted, 'stroke-width': 1 }));
      if (n > 3) {
        grid.appendChild(svgEl('line', { x1: 3 * CELL, x2: 3 * CELL, y1: TOP + 1, y2: TOP + size - 1, stroke: '#ffffff', 'stroke-width': 2 }));
        grid.appendChild(svgEl('line', { y1: TOP + 3 * CELL, y2: TOP + 3 * CELL, x1: 1, x2: size - 1, stroke: '#ffffff', 'stroke-width': 2 }));
      }
      pHead.innerHTML = '<i>P</i>: ' + n + ' × ' + n + ', ' + cP + ' changed';
      grid.appendChild(hoverBox);
      showTip();
      play(moves);

      /* the panel: the step's name and its numbers; a phrase only for what the picture cannot show */
      var pose = '<div class="esl-pose">' + poseRows + '</div>';   // the state's first rows: the same numbers in the same form
      if (isPred) {
        head.innerHTML = '<b class="p">predict step</b>';
        say.textContent = e.skipped ? 'no landmarks yet: MRPT skips predict' : e.off ? 'the readings of this step are taken away' : '';
        body.innerHTML = line('pose', 'w', pose);
      } else if (isUp) {
        head.innerHTML = '<b class="u">update step</b>';
        var gaps = seenAt[i], back = -1, who = -1;
        e.z.forEach(function (z) { if (gaps[z[2]] > back) { back = gaps[z[2]]; who = z[2]; } });
        say.innerHTML = back >= 24 ? lmHtml(who) + ' seen again after ' + back + ' steps: the loop closes' : '';
        var html = e.z.slice().sort(function (p, q) { return gaps[q[2]] - gaps[p[2]]; }).map(function (z) {
          var ix3 = 3 + 2 * z[2], before = block(pn, prev.P, ix3), after = block(n, e.P, ix3);
          var went = 100 * Math.hypot(e.x[ix3] - prev.x[ix3], e.x[ix3 + 1] - prev.x[ix3 + 1]);
          return '<div class="esl-seen">' + lens(before, after) + '<div class="esl-val"><span class="esl-sym c">' + lmHtml(z[2]) + '</span>moved ' + went.toFixed(went < 10 ? 1 : 0) +
            ' cm<span class="esl-note"><i>z</i> − <i>ẑ</i> = ' + signed((z[0] - z[3]) * 100, 1) + ' cm range, ' + signed(deg(wrap(z[1] - z[4])), 1) + '° bearing</span></div></div>';
        }).join('');
        var readings = e.z.length;
        html += line('Kalman gain', 'w', n + ' × ' + (2 * readings), n + ' numbers of the state; ' + (2 * readings) + ' = ' + readings + (readings > 1 ? ' landmarks' : ' landmark') + ' × 2 (range, bearing)');
        html += line('pose', 'w', pose, 'moved by ' + (100 * Math.hypot(e.x[0] - e.a[0], e.x[1] - e.a[1])).toFixed(1) + ' cm');
        body.innerHTML = html;
      } else {
        var ix2 = 3 + 2 * e.lm;
        head.innerHTML = '<b class="n">new landmark</b> ' + lmHtml(e.lm);
        say.textContent = e.corner ? 'a corner of the island, not a cylinder' : '';
        body.innerHTML =
          line('z', 'r', 'r ' + e.z[0].toFixed(2) + ' m, φ ' + signed(deg(e.z[1]), 1) + '°', 'the reading: range r, bearing φ from the heading') +
          line(lmHtml(e.lm), 'c', '(' + num(e.x[ix2], 2) + ', ' + num(e.x[ix2 + 1], 2) + ') m', 'x + r cos(θ + φ), y + r sin(θ + φ)');
      }
    }

    function go(k) {
      var to = Math.max(0, Math.min(N - 1, k));
      glide = ready && Math.abs(to - i) === 1;
      i = to;
      draw();
    }
    bNext.addEventListener('click', function () { go(i + 1); if (o.blur) bNext.blur(); });
    bBack.addEventListener('click', function () { go(i - 1); if (o.blur) bBack.blur(); });
    bStart.addEventListener('click', function () { go(0); if (o.blur) bStart.blur(); });
    bNew.addEventListener('click', function () {
      var j = i + 1;
      while (j < N && ev[j].kind !== 'new') j++;
      go(j < N ? j : 0);
      if (o.blur) bNew.blur();
    });
    inp.addEventListener('input', function () { go(+inp.value); });
    inp.addEventListener('change', function () { if (o.blur) inp.blur(); });

    go(o.start === undefined ? 0 : o.start);
    ready = true;
    return { get: function () { return { i: i, event: ev[i] }; }, go: go, element: el };
  }

  return { mount: mount };
});
