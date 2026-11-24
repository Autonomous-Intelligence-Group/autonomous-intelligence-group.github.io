/*
 * corridor.js: least squares by hand on the SLAM deck's corridor — four poses on a line, x₀ = 0 pinned, three odometry
 * edges that each measured 1.0 m, and a loop edge from a cylinder seen 1.5 m ahead of x₀ and z₀₃ − 1.5 behind x₃.
 * Vanilla JavaScript, no libraries, works offline from file:// (D24). No data file: the sum is solved here, exactly.
 *
 *   <link rel="stylesheet" href="img/corridor-slide.css">
 *   <div id="corridor-widget"></div>
 *   <script src="img/corridor.js"></script>
 *   <script>Corridor.mount(document.getElementById('corridor-widget'));</script>
 *
 * The sum, as the slide «A Corridor by Hand: the Same Sum in 1D» writes it, x₀ = 0:
 *   Σ over the four edges ((x_j − x_i) − z_ij)² / σ_ij²
 * z₀₁ = z₁₂ = z₂₃ = 1.0 m (odometry), z₀₃ the loop edge; σ₀₁ = σ₁₂ = σ₂₃ one slider, σ₀₃ another, z₀₃ the third.
 * Its bottom: the derivative by each pose is 0, one equation per pose — the slide's system, each edge weighted by w = 1/σ²
 * (w for an odometry edge, w₀₃ for the loop edge):
 *   2w·x₁ − w·x₂ = 0      −w·x₁ + 2w·x₂ − w·x₃ = 0      −w·x₂ + (w + w₀₃)·x₃ = w·1.0 + w₀₃·z₀₃
 * solved together by Cramer's rule. With all σ equal it is the slide's 2x₁ − x₂ = 0, −x₁ + 2x₂ − x₃ = 0, −x₂ + 2x₃ = 3.6.
 * The same in one line, for the notes: x₃ = 3(σ₀₃² + σ²·z₀₃) / (σ₀₃² + 3σ²), x₁ = x₃/3, x₂ = 2x₃/3 — the inverse-variance mix
 * of the chain's 3.0 m (its variance 3σ², three steps' variances added) and the loop's z₀₃ (variance σ₀₃²).
 *
 * The picture, two rows on one metre axis: the poses odometry gives (grey, x₃ = 3.0 — the slide «A Corridor by Hand: the Same
 * Sum in 1D») and the poses least squares gives (green). Each row: the corridor's walls, the cylinder laid from x₀'s scan (black
 * ring) and from x₃'s (red), each reading a dashed line from its pose with its distance written along it, above it; the gap
 * between the two rings, or, when they agree to the centimetre, the two rings one inside the other; every edge with its error,
 * (x_j − x_i) − z_ij: by the poses − measured, as Ceres's PoseGraph2dErrorTerm and the slides. The panel: a line saying in
 * words what the widget does (deck rule 14), three sliders and the button back to the slide's example. Under it the legend:
 * only the marks the corridor slide does not draw — the green poses and the edges' errors; the rest (grey poses and edges,
 * the red loop edge, the rings, the gap, z_ij, σ_ij) is that slide's.
 * Options: odom, loop (σ in m, one of SIGMAS), z (m, one of ZS); blur (true: a used control gives the keyboard back to the deck).
 * Returns {get(), set(odom, loop, z), element}. The maths, for tests: Corridor.solve(σ, σ₀₃, z₀₃) -> [x₀, x₁, x₂, x₃].
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Corridor = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var SIGMAS = [0.01, 0.02, 0.03, 0.05, 0.07, 0.1, 0.15, 0.2, 0.3, 0.5, 0.7, 1.0];   // m, the σ sliders' stops
  var ZS = [];                                                                         // m, z₀₃'s stops: 2.0 … 3.4
  for (var s = 20; s <= 34; s++) ZS.push(s / 10);
  var STEP = 1.0, AHEAD = 1.5;          // what each odometry edge measured; the cylinder ahead of x₀ in its scan, m
  var START = { odom: 0.1, loop: 0.1, z: 2.6 };   // the slides' numbers: x̂ = 0.9, 1.8, 2.7
  var AGREE = 0.005;                    // m: below it the gap prints as 0.00, so the two rings are drawn as one cylinder

  /* ---------------- maths ---------------- */

  function solve(sOdom, sLoop, z) {     // the bottom of the sum: three equations, one per pose, solved together
    var w = 1 / (sOdom * sOdom), wl = 1 / (sLoop * sLoop);
    var A = [[2 * w, -w, 0], [-w, 2 * w, -w], [0, -w, w + wl]];
    var b = [0, 0, w * STEP + wl * z];  // row k: + w·z on the edge into x_k, − w·z on the edge out of it; 1.0 − 1.0 = 0
    function det(m) {
      return m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) +
        m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
    }
    var d = det(A), x = [0];
    for (var c = 0; c < 3; c++) {        // Cramer: column c replaced by the right side
      x.push(det(A.map(function (row, r) { return row.map(function (v, k) { return k === c ? b[r] : v; }); })) / d);
    }
    return x;
  }

  function edges(x, sOdom, sLoop, z) {  // every edge: i, j, z_ij, σ_ij, x_j − x_i, the error (x_j − x_i) − z_ij, its term
    return [[0, 1, STEP, sOdom], [1, 2, STEP, sOdom], [2, 3, STEP, sOdom], [0, 3, z, sLoop]].map(function (e) {
      var held = x[e[1]] - x[e[0]], err = held - e[2];
      return { i: e[0], j: e[1], z: e[2], sigma: e[3], held: held, err: err, term: (err / e[3]) * (err / e[3]), loop: e[1] - e[0] === 3 };
    });
  }
  function sum(es) { return es.reduce(function (a, e) { return a + e.term; }, 0); }

  /* ---------------- drawing ---------------- */

  var C = { ink: '#222222', grey: '#9a9a9a', est: '#2ca02c', red: '#d62728', muted: '#555555', grid: '#d4d4d4' };
  var ARROW = 'M 1 0 L -0.75 0.65 L -0.35 0 L -0.75 -0.65 Z';      // style7.pose_marker: a notched arrowhead
  var MATH = "'STIX Two Math', 'STIX Two Text', 'Cambria Math', 'Times New Roman', serif";
  var W = 690, XMIN = -0.3, SC = 180, ROW = 210, H = 2 * ROW + 26;  // the picture: px, m at its left edge, px per m
  var Y = { title: 15, wall: 27, label: 44, brace: 50, ring: 70, pose: 114, err: 133, wall2: 142, name: 160, loop: 172, loopText: 189 };
  var R_RING = 10, R_OUT = 12.5, R_IN = 7.5, ARROW_PX = 12, CHAR = 7.6;   // px; CHAR — a name's width per character

  function X(m) { return 8 + (m - XMIN) * SC; }
  function keepTouches(input) {         // as pf.js: Marp's swipe must not take the slider
    ['touchstart', 'touchmove', 'touchend'].forEach(function (type) {
      input.addEventListener(type, function (e) { e.stopPropagation(); }, { passive: true });
    });
  }
  function signed(v, d) {               // an error with its sign; a zero is a plain 0
    return Math.abs(v) < 0.5 * Math.pow(10, -d) ? '0' : (v < 0 ? '−' : '+') + Math.abs(v).toFixed(d);
  }
  function metres(v) { return v < 0.1 ? v.toFixed(2) : v < 1 ? v.toFixed(2).replace(/0$/, '') : v.toFixed(1); }

  function mount(el, options) {
    var o = { odom: START.odom, loop: START.loop, z: START.z, blur: true };
    for (var key in options) if (Object.prototype.hasOwnProperty.call(options, key)) o[key] = options[key];
    var doc = el.ownerDocument;
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
    /* a label with maths on the picture: parts are plain strings or [letter, subscript]; the letter in italics */
    function label(parent, attrs, parts) {
      var t = parent.appendChild(svgEl('text', attrs)), size = +(attrs['font-size'] || 14), low = false;
      parts.forEach(function (p) {
        if (typeof p === 'string') {
          t.appendChild(svgEl('tspan', low ? { dy: -0.22 * size } : {}, p));
          low = false;
        } else {
          t.appendChild(svgEl('tspan', { 'font-style': 'italic', style: 'font-family:' + MATH, dy: low ? -0.22 * size : 0 }, p[0]));
          t.appendChild(svgEl('tspan', { dy: 0.22 * size, 'font-size': 0.72 * size }, p[1]));
          low = true;
        }
      });
      if (low) t.appendChild(svgEl('tspan', { dy: -0.22 * size }, '​'));
      return t;
    }
    function sym(letter, sub) { return '<i>' + letter + '</i><sub>' + sub + '</sub>'; }

    el.classList.add('crw');
    el.innerHTML = '';

    /* ---------------- the picture ---------------- */
    var pic = el.appendChild(make('div', 'crw-pic'));
    var svg = pic.appendChild(svgEl('svg', { width: W, height: H, viewBox: '0 0 ' + W + ' ' + H, role: 'img',
      'aria-label': 'The corridor twice on one metre axis: the poses odometry gives, and the poses least squares gives' }));
    for (var g = 0; g <= 3; g++) {
      svg.appendChild(svgEl('line', { x1: X(g), x2: X(g), y1: 20, y2: H - 18, stroke: C.grid, 'stroke-width': 1, 'stroke-dasharray': '1.5 3.5' }));
      svg.appendChild(svgEl('text', { x: X(g), y: H - 4, 'text-anchor': 'middle', 'font-size': 13, fill: C.muted }, g + (g === 3 ? ' m' : '')));
    }
    var rows = [0, 1].map(function (r) { return svg.appendChild(svgEl('g', { transform: 'translate(0 ' + r * ROW + ')' })); });

    /* ---------------- the panel: first, in words, what the widget does ---------------- */
    var panel = el.appendChild(make('div', 'crw-panel'));
    panel.appendChild(make('div', 'crw-what', 'the corridor\'s least squares, solved again at every move of a slider — a teaching example'));
    var sliders = [
      ['odom', sym('σ', '01') + ' = ' + sym('σ', '12') + ' = ' + sym('σ', '23'), 'each odometry edge\'s typical error', SIGMAS],
      ['loop', sym('σ', '03'), 'the loop edge\'s typical error', SIGMAS],
      ['z', sym('z', '03'), 'what the loop edge measured', ZS]
    ].map(function (d) {
      var row = panel.appendChild(make('label', 'crw-slider'));
      row.appendChild(make('span', 'crw-name', '<span class="crw-sym">' + d[1] + '</span><span class="crw-words">' + d[2] + '</span>'));
      var inp = make('input');
      inp.type = 'range'; inp.min = 0; inp.max = d[3].length - 1; inp.step = 1;
      inp.value = Math.max(0, d[3].indexOf(o[d[0]]));
      inp.setAttribute('aria-label', d[2]);
      keepTouches(inp);
      row.appendChild(inp);
      var out = row.appendChild(make('output'));
      inp.addEventListener('input', function () { o[d[0]] = d[3][+inp.value]; draw(); });
      if (o.blur) inp.addEventListener('change', function () { inp.blur(); });
      return { key: d[0], inp: inp, out: out, stops: d[3] };
    });
    var reset = panel.appendChild(make('button', 'chip', '↺ the slide\'s example'));
    reset.type = 'button';
    reset.addEventListener('click', function () {
      o.odom = START.odom; o.loop = START.loop; o.z = START.z;
      sliders.forEach(function (s) { s.inp.value = s.stops.indexOf(o[s.key]); });
      draw();
      if (o.blur) reset.blur();
    });

    /* ---------------- the legend: only what the corridor slide does not draw, in columns ---------------- */
    function icon(inner) { return '<svg width="26" height="14" viewBox="0 0 26 14" aria-hidden="true">' + inner + '</svg>'; }
    function arrowIcon(fill) { return icon('<path transform="translate(13 7) scale(6.5)" d="' + ARROW + '" fill="' + fill + '"/>'); }
    var legend = el.appendChild(make('div', 'crw-legend'));
    [
      [[arrowIcon(C.est), 'a pose least squares gives, <i>x̂</i>']],
      [[icon('<text x="13" y="11" text-anchor="middle" font-size="11" fill="' + C.muted + '">−0.1</text>'),
        'under an edge: its error (' + sym('x', 'j') + ' − ' + sym('x', 'i') + ') − ' + sym('z', 'ij')]]
    ].forEach(function (items) {
      var col = legend.appendChild(make('div', 'col'));
      items.forEach(function (item) { col.appendChild(make('div', 'it', item[0] + '<span>' + item[1] + '</span>')); });
    });

    /* ---------------- one row: the corridor, the poses, the cylinder, the edges ---------------- */
    function drawRow(gr, x, es, opts) {
      gr.innerHTML = '';
      var z = es[3].z, x3 = x[3], seen = x3 - (z - AHEAD);           // the cylinder from x₃'s scan: z₀₃ − 1.5 behind x₃
      var one = Math.abs(seen - AHEAD) < AGREE;                       // the two readings agree: one cylinder
      label(gr, { x: 2, y: Y.title, 'font-size': 15, 'font-weight': 600, fill: opts.colour === C.est ? C.est : C.muted }, [opts.title]);
      [Y.wall, Y.wall2].forEach(function (y) {
        gr.appendChild(svgEl('line', { x1: X(-0.27), x2: X(3.42), y1: y, y2: y, stroke: C.ink, 'stroke-width': 2 }));
      });
      // a reading: from the pose to its ring, dashed, under the arrows; its distance along the line, above it
      function reading(from, at, r, colour, text) {
        var ax = X(from), ay = Y.pose, bx = X(at), by = Y.ring, len = Math.hypot(bx - ax, by - ay);
        var ex = bx - (bx - ax) * r / len, ey = by - (by - ay) * r / len;
        gr.appendChild(svgEl('line', { x1: ax, y1: ay, x2: ex, y2: ey, stroke: colour, 'stroke-width': 1.2, 'stroke-dasharray': '4 3' }));
        var ux = (bx - ax) / len, uy = (by - ay) / len;
        if (ux < 0) { ux = -ux; uy = -uy; }                           // the text reads left to right
        var mx = (ax + ex) / 2 + uy * 5, my = (ay + ey) / 2 - ux * 5;  // 5 px off the line, on its upper side
        gr.appendChild(svgEl('text', { x: mx.toFixed(1), y: my.toFixed(1), 'text-anchor': 'middle', 'font-size': 13, fill: colour,
          transform: 'rotate(' + (Math.atan2(uy, ux) * 180 / Math.PI).toFixed(1) + ' ' + mx.toFixed(1) + ' ' + my.toFixed(1) + ')' }, text));
      }
      reading(0, AHEAD, one ? R_OUT : R_RING, C.ink, metres(AHEAD) + ' ahead');
      reading(x3, seen, one ? R_IN : R_RING, C.red, metres(z - AHEAD) + ' behind');
      if (one) {                                                      // one inside the other: both seen, one place
        gr.appendChild(svgEl('circle', { cx: X(AHEAD), cy: Y.ring, r: R_OUT, fill: '#ffffff', stroke: C.ink, 'stroke-width': 2.2 }));
        gr.appendChild(svgEl('circle', { cx: X(AHEAD), cy: Y.ring, r: R_IN, fill: 'none', stroke: C.red, 'stroke-width': 2.2 }));
        gr.appendChild(svgEl('text', { x: X(AHEAD), y: Y.label, 'text-anchor': 'middle', 'font-size': 13.5, fill: C.ink }, 'one cylinder'));
      } else {
        gr.appendChild(svgEl('circle', { cx: X(AHEAD), cy: Y.ring, r: R_RING, fill: '#ffffff', stroke: C.ink, 'stroke-width': 2.2 }));
        gr.appendChild(svgEl('circle', { cx: X(seen), cy: Y.ring, r: R_RING, fill: 'none', stroke: C.red, 'stroke-width': 2.2 }));
        // the gap between the two rings: the loop edge's error
        var gap = Math.abs(seen - AHEAD), a = X(Math.min(seen, AHEAD)), b = X(Math.max(seen, AHEAD)), m = (a + b) / 2;
        gr.appendChild(svgEl('path', { d: 'M' + a + ' ' + (Y.brace + 6) + ' V' + Y.brace + ' H' + b + ' V' + (Y.brace + 6) + ' M' + m + ' ' + Y.brace + ' V' + (Y.brace - 4),
          fill: 'none', stroke: C.red, 'stroke-width': 1.4 }));
        gr.appendChild(svgEl('text', { x: m, y: Y.label, 'text-anchor': 'middle', 'font-size': 13.5, fill: C.red }, 'gap ' + gap.toFixed(2) + ' m'));
      }
      // the odometry edges, the loop edge under the corridor, each with its error
      es.forEach(function (e) {
        var xa = X(x[e.i]), xb = X(x[e.j]);
        if (!e.loop) {
          gr.appendChild(svgEl('line', { x1: xa, x2: xb, y1: Y.pose, y2: Y.pose, stroke: C.grey, 'stroke-width': 3 }));
          gr.appendChild(svgEl('text', { x: (xa + xb) / 2, y: Y.err, 'text-anchor': 'middle', 'font-size': 13.5, fill: C.muted }, signed(e.err, 2)));
        } else {
          gr.appendChild(svgEl('path', { d: 'M' + xa + ' ' + (Y.pose + 9) + ' V' + Y.loop + ' H' + xb + ' V' + (Y.pose + 9), fill: 'none', stroke: C.red, 'stroke-width': 1 }));
          gr.appendChild(svgEl('line', { x1: xa, x2: xb, y1: Y.loop, y2: Y.loop, stroke: C.red, 'stroke-width': 3.5 }));
          label(gr, { x: (xa + xb) / 2, y: Y.loopText, 'text-anchor': 'middle', 'font-size': 13.5, fill: C.red },
            ['loop edge: ', ['z', '03'], ' = ' + z.toFixed(1) + ', the poses hold ' + e.held.toFixed(2) + ', error ' + signed(e.err, 2)]);
        }
      });
      // the poses: the first pinned; each named with its place, to the left of a pose too near the right edge
      x.forEach(function (v, k) {
        gr.appendChild(svgEl('path', { d: ARROW, fill: opts.colour, transform: 'translate(' + X(v).toFixed(1) + ' ' + Y.pose + ') scale(' + ARROW_PX + ')' }));
        var value = k === 0 ? ' = 0 pinned' : ' = ' + (opts.hat ? v.toFixed(2) : v.toFixed(0));
        var left = X(v) + 4 + CHAR * (3 + value.length) > W;
        label(gr, { x: X(v) + (left ? -4 : 4), y: Y.name, 'font-size': 14.5, 'text-anchor': left ? 'end' : 'start',
          fill: k === 0 ? C.ink : opts.colour === C.est ? C.est : C.ink }, [[k && opts.hat ? 'x̂' : 'x', String(k)], value]);
      });
    }

    function draw() {
      var x = solve(o.odom, o.loop, o.z), es = edges(x, o.odom, o.loop, o.z);
      var chain = [0, 1, 2, 3], before = edges(chain, o.odom, o.loop, o.z);
      drawRow(rows[0], chain, before, { title: 'the poses odometry gives', colour: C.grey, hat: false });
      drawRow(rows[1], x, es, { title: 'the poses least squares gives', colour: C.est, hat: true });
      sliders.forEach(function (s) {
        s.out.textContent = metres(o[s.key]) + ' m';
        s.inp.style.setProperty('--f', (+s.inp.value / (s.stops.length - 1)).toFixed(4));
      });
    }

    draw();
    return {
      get: function () { var x = solve(o.odom, o.loop, o.z); return { x: x, sum: sum(edges(x, o.odom, o.loop, o.z)), odom: o.odom, loop: o.loop, z: o.z }; },
      set: function (odom, loop, z) {
        o.odom = odom; o.loop = loop; o.z = z;
        sliders.forEach(function (s) { s.inp.value = Math.max(0, s.stops.indexOf(o[s.key])); });
        draw();
      },
      element: el
    };
  }

  return { mount: mount, solve: solve, SIGMAS: SIGMAS, ZS: ZS };
});
