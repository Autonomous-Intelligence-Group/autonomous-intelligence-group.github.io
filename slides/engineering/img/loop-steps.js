/*
 * loop-steps.js: loop closure step by step on our drive — slam_toolbox's own graph, node by node: each node as slam_toolbox
 * made it, the loop-closure check Karto made at it, its loop edge, and the poses it kept after the one solve. Vanilla
 * JavaScript, no libraries, works offline from file:// (D24). Data: loop-steps-data.js (loop_widget.py widget, from
 * slam_toolbox's runs in toolbox_graph/ and Karto's own checks in a replay of the loop run, loop_checks.json): each node's
 * pose as made, after the solve and in the run with loop closure off, ground truth, its scan in base_link, its edge from the
 * node before with that edge's σ, its loop-closure check; the loop edge with its σ; Ceres's report of the solve. Nothing is
 * estimated here: what is drawn and counted comes from those poses and checks.
 *
 *   <link rel="stylesheet" href="img/loop-steps.css">
 *   <div id="loop-widget"></div>
 *   <script src="img/loop-steps-data.js"></script>
 *   <script src="img/loop-steps.js"></script>
 *   <script>LoopSteps.mount(document.getElementById('loop-widget'), {data: window.LOOP_STEPS_DATA});</script>
 *
 * The steps, one after another, one counter «node k / 52» (nodes numbered from 0, as on the slides): node 0 … 46, then
 * «46 · after the loop», then node 47 … 51. At each node: the node (a green arrow) with ground truth (a black outline of the
 * same size), its edge to the node before (grey), its scan laid from its pose (bright green; the earlier nodes' scans pale —
 * each node keeps its own), the room from ground truth (thin black). And Karto's loop-closure check at that node: the dashed
 * circle d_max round the node's scan centre (+); the old nodes whose scan centre lies in it (Karto tests the centres, not
 * the poses), grey the linked ones (joined to the new node through edges), orange the chain of unlinked ones in a row that
 * Karto matched, pale orange an unlinked run too short for a chain; the panel says what the check came to: no old node in
 * the circle, all linked, the run too short (k of 10), or the chain's coarse and fine match against their thresholds and the
 * loop edge. At 46 the loop edge 4 → 46 slam_toolbox added (red, dashed, drawn as an arc so that it shows between two nodes
 * 13 cm apart) and its error, as the poses stand; at «46 · after the loop» the poses glide to where Ceres put them and the
 * doubled walls merge, the values before beside the values after (in the panel; in the magnified square, the scans before in
 * grey, which its caption then says), and the search Karto made again after the closure: every old node in the circle linked.
 * Under the slider a strip, a cell under each of its positions, coloured by what the step's check came to: grey no
 * candidates, pale orange the chain too short, red the loop edge, green after the loop; a press on a cell goes to its step,
 * a drag along the strip steps through (by touch too: keepTouches, as on the slider).
 * «loop closure off» shows slam_toolbox's run with do_loop_closing: false — the same nodes up to 46, no check, no loop edge.
 * The panel: the step and its numbers, the node's pose as a column, an edge's three numbers each with its σ, the check.
 * Counters: memory (nodes, edges, scan points) and the ATE of the nodes shown, both ways. Under the cursor a node gives one
 * value: how far it is from ground truth. One step forward or back glides, as does the switch; a jump is at once.
 * Under the controls the legend: the marks drawn, a few words each, in columns (as ekf-slam-steps.js).
 * Options: data (required); start (step index); off (true: loop closure off); blur (true: a used control gives the keyboard back
 * to the deck). Returns {get(), go(i), off(b), element}.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.LoopSteps = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var C = { est: '#2ca02c', scan: '#a8dba8', ink: '#222222', grey: '#9a9a9a', loop: '#d62728', muted: '#555555',
            before: '#8a8a8a', frame: '#555555', chain: '#e8710a', short: '#f7c193', ring: '#444444', none: '#c8c8c8' };
  var ARROW = 'M1 0 L-0.75 0.65 L-0.35 0 L-0.75 -0.65 Z';      // style7.pose_marker: a notched arrowhead
  var PLUS = 'M-6 0 H6 M0 -6 V6';                               // the scan centre
  var SC = 55, ARROW_PX = 7.5, LENS_PX = 200, DOT = 2.1, LENS_DOT = 3.4, BOW = 22;   // px per m on the map; px
  var PARTS = [['x', 'forward'], ['y', 'left'], ['θ', 'turn']];                    // an edge's three numbers
  var NODE = { linked: C.grey, chain: C.chain, short: C.short };                  // an old node in the circle
  /* the strip: what a step's check came to, its colour and its name beside the strip */
  var KINDS = [['none', C.none, 'no candidates'], ['short', C.short, 'too short'], ['chain', C.loop, 'loop edge'],
               ['after', C.est, 'after the loop']];
  /* the new node's number: under it, else beside or above it, wherever it keeps clear of the scan centre and of the
     loop edge's other number (offsets in px, the text's anchor) */
  var SPOTS = [[0, 20, 'middle'], [-9, 20, 'middle'], [9, 20, 'middle'], [11, 5, 'start'], [-11, 5, 'end'], [0, -11, 'middle']];

  function keepTouches(input) {                                 // as pf.js: Marp's swipe must not take the slider
    ['touchstart', 'touchmove', 'touchend'].forEach(function (type) {
      input.addEventListener(type, function (e) { e.stopPropagation(); }, { passive: true });
    });
  }
  function wrap(a) { return Math.atan2(Math.sin(a), Math.cos(a)); }
  function deg(r) { return r * 180 / Math.PI; }
  function relative(a, b) {                                     // pose b seen from pose a: forward, left, the turn
    var dx = b[0] - a[0], dy = b[1] - a[1], c = Math.cos(a[2]), s = Math.sin(a[2]);
    return [c * dx + s * dy, -s * dx + c * dy, wrap(b[2] - a[2])];
  }
  function zero(v, d) { return Math.abs(v) < 0.5 * Math.pow(10, -d); }
  function num(v, d) { return (v < 0 && !zero(v, d) ? '−' : '') + Math.abs(v).toFixed(d); }
  function signed(v, d) { return zero(v, d) ? (0).toFixed(d) : (v < 0 ? '−' : '+') + Math.abs(v).toFixed(d); }
  function thousands(v) { return String(v).replace(/\B(?=(\d{3})+(?!\d))/g, ' '); }
  function sym(letter, sub) { return '<i>' + letter + '</i><sub><i>' + sub + '</i></sub>'; }
  function runs(list) {                                         // node ids, a run of three or more as «a … b»: 0 … 9, 37 … 45
    if (!list.length) return '—';
    var out = [], k = 0;
    while (k < list.length) {
      var m = k;
      while (m + 1 < list.length && list[m + 1] === list[m] + 1) m++;
      out.push(m === k ? String(list[k]) : m === k + 1 ? list[k] + ', ' + list[m] : list[k] + ' … ' + list[m]);
      k = m + 1;
    }
    return out.join(', ');
  }
  function count(n, word) { return n + ' ' + word + (n === 1 ? '' : 's'); }
  function part(c, v, sign) {                                   // one of an edge's numbers: cm, or degrees
    var f = sign ? signed : num;
    if (c < 2) return f(100 * v, 1) + ' cm';
    var d = deg(v);
    return f(d, Math.abs(d) < 0.095 && !zero(d, 2) ? 2 : 1) + '°';
  }
  function sigmaText(c, s) { return c < 2 ? Math.round(100 * s[c]) + ' cm' : deg(s[c]).toFixed(1) + '°'; }
  function cost(v) { return v < 1 ? v.toFixed(2) : v.toFixed(1); }

  function mount(el, options) {
    var o = { blur: true, off: false };
    for (var key in options) if (Object.prototype.hasOwnProperty.call(options, key)) o[key] = options[key];
    var data = o.data, nodes = data.nodes, N = nodes.length, I = data.loop.i, J = data.loop.j, doc = el.ownerDocument;
    var steps = [];
    nodes.forEach(function (nd, k) { steps.push({ node: k, after: false }); if (k === J) steps.push({ node: k, after: true }); });
    var S = steps.length;
    function kindOf(st) { var w = nodes[st.node].check.why; return st.after ? 'after' : w === 'linked' ? 'none' : w; }

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

    el.classList.add('lsw');
    el.innerHTML = '';

    /* ---------------- the map ---------------- */
    var V = data.view, MW = Math.round((V[1] - V[0]) * SC), MH = Math.round((V[3] - V[2]) * SC);
    function X(x) { return (x - V[0]) * SC; }
    function Y(y) { return (V[3] - y) * SC; }
    var map = el.appendChild(svgEl('svg', { width: MW, height: MH, viewBox: '0 0 ' + MW + ' ' + MH, class: 'lsw-map', role: 'img',
      'aria-label': 'Our drive from above: slam_toolbox\'s nodes with their scans, the loop-closure check round the newest, the room from ground truth' }));
    function room(parent, width) {                              // ground truth: the walls' inner faces, the island, the cylinders
      var g = parent.appendChild(svgEl('g', { fill: 'none', stroke: C.ink, 'stroke-width': width }));
      var R = data.room, isl = data.island;
      g.appendChild(svgEl('rect', { x: X(R[0]), y: Y(R[3]), width: (R[1] - R[0]) * SC, height: (R[3] - R[2]) * SC }));
      g.appendChild(svgEl('rect', { x: X(isl[0]), y: Y(isl[1] + isl[3]), width: isl[2] * SC, height: isl[3] * SC }));
      data.cyl.forEach(function (c) { g.appendChild(svgEl('circle', { cx: X(c[0]), cy: Y(c[1]), r: data.rCyl * SC })); });
    }
    function dots(nd) {                                         // a scan as dots, in px around its node: x ahead, y to the left
      var d = '';
      for (var q = 0; q < nd.pts.length; q += 2) d += 'M' + (nd.pts[q] * SC / 100).toFixed(1) + ' ' + (-nd.pts[q + 1] * SC / 100).toFixed(1) + 'h0';
      return d;
    }
    var L = data.lens, LX = X(L[0]), LY = Y(L[1] + L[2]), LW = L[2] * SC, ZOOM = LENS_PX / LW;
    room(map, 1);
    var gScans = map.appendChild(svgEl('g', { fill: 'none', stroke: C.scan, 'stroke-width': DOT, 'stroke-linecap': 'round' }));
    /* the check's circle d_max round the node's scan centre: under the graph, so that it hides no node */
    var ring = map.appendChild(svgEl('circle', { r: data.dMax * SC, fill: 'none', stroke: C.ring, 'stroke-width': 1.4,
      'stroke-dasharray': '7 5' }));
    map.appendChild(svgEl('rect', { x: LX, y: LY, width: LW, height: LW, fill: 'none', stroke: C.frame, 'stroke-width': 1.3 }));
    var gEdges = map.appendChild(svgEl('g', { stroke: C.grey, 'stroke-width': 1.8 }));
    var gNodes = map.appendChild(svgEl('g', { fill: C.est }));
    var loopPath = map.appendChild(svgEl('path', { fill: 'none', stroke: C.loop, 'stroke-width': 3, 'stroke-dasharray': '5 3' }));
    var gTruth = map.appendChild(svgEl('g', { fill: 'none', stroke: C.ink, 'stroke-width': 0.15 }));
    /* the scan centre over the nodes, with a white edge: it reads over an arrow or the dots */
    var centre = map.appendChild(svgEl('g', { fill: 'none', 'stroke-linecap': 'round' }));
    centre.appendChild(svgEl('path', { d: PLUS, stroke: '#ffffff', 'stroke-width': 4.6 }));
    centre.appendChild(svgEl('path', { d: PLUS, stroke: C.ring, 'stroke-width': 2 }));
    var gLabels = map.appendChild(svgEl('g', { 'font-size': 13, 'font-weight': 600, stroke: '#ffffff', 'stroke-width': 3,
      'stroke-linejoin': 'round', 'paint-order': 'stroke' }));                // a white edge: the number reads over the dots
    var label = gLabels.appendChild(svgEl('text', { 'text-anchor': 'middle', fill: C.est }));
    var labelI = gLabels.appendChild(svgEl('text', { 'text-anchor': 'end', fill: C.est }));
    /* under the cursor: one value in a dark box, drawn in the map itself (a positioned <div> inside Marp's slide, a
       foreignObject, does not always paint) */
    var tip = map.appendChild(svgEl('g', { style: 'pointer-events:none', display: 'none' }));
    var tipBox = tip.appendChild(svgEl('rect', { rx: 4, height: 21, fill: '#222222' }));
    var tipText = tip.appendChild(svgEl('text', { 'font-size': 13, fill: '#ffffff' }));
    var els = nodes.map(function (nd, m) {
      var g = gScans.appendChild(svgEl('g', {}));
      var path = dots(nd);
      g.appendChild(svgEl('path', { d: path }));
      return { scan: g, path: path, arrow: gNodes.appendChild(svgEl('path', { d: ARROW })),
        truth: gTruth.appendChild(svgEl('path', { d: ARROW })),
        edge: m ? gEdges.appendChild(svgEl('line', {})) : null };
    });

    /* ---------------- the side: counter and memory, the step, the magnified square, the ATE ---------------- */
    var side = el.appendChild(make('div', 'lsw-side'));
    var top = side.appendChild(make('div', 'lsw-top'));
    var counter = top.appendChild(make('div', 'lsw-count'));
    var memory = top.appendChild(make('div', 'lsw-memory'));
    var mid = side.appendChild(make('div', 'lsw-mid'));
    var panel = mid.appendChild(make('div', 'lsw-panel'));
    var lensBox = mid.appendChild(make('div', 'lsw-lens'));
    var lensCap = lensBox.appendChild(make('div', 'cap'));      // its text in draw(): after the loop it names the grey scans
    var lens = lensBox.appendChild(svgEl('svg', { width: LENS_PX, height: LENS_PX, viewBox: LX + ' ' + LY + ' ' + LW + ' ' + LW, role: 'img',
      'aria-label': 'The square by the start, magnified: the south wall and a cylinder, doubled before the loop closes' }));
    lens.appendChild(svgEl('rect', { x: LX, y: LY, width: LW, height: LW, fill: '#ffffff' }));
    room(lens, 1.1 / ZOOM);
    var lBefore = lens.appendChild(svgEl('g', { fill: 'none', stroke: C.before, 'stroke-width': LENS_DOT / ZOOM, 'stroke-linecap': 'round' }));
    var lNow = lens.appendChild(svgEl('g', { fill: 'none', stroke: C.scan, 'stroke-width': LENS_DOT / ZOOM, 'stroke-linecap': 'round' }));
    els.forEach(function (e) {
      e.lens = lNow.appendChild(svgEl('g', {}));
      e.lens.appendChild(svgEl('path', { d: e.path }));
      e.before = lBefore.appendChild(svgEl('g', {}));
      e.before.appendChild(svgEl('path', { d: e.path }));
    });
    var ate = side.appendChild(make('div', 'lsw-ate'));

    /* ---------------- controls; under the slider the strip: a cell per step, under the slider's position for it -------- */
    var ctrl = el.appendChild(make('div', 'lsw-ctrl'));
    var bStart = ctrl.appendChild(make('button', 'chip', '⏮ the start'));   // no run node numbers (user, 2026-11-24)
    var bBack = ctrl.appendChild(make('button', 'chip', '◀ back'));
    var bNext = ctrl.appendChild(make('button', 'lsw-next', 'next ▶'));
    var bLoop = ctrl.appendChild(make('button', 'chip', '⏭ the loop'));
    var inp = ctrl.appendChild(make('input'));
    inp.type = 'range'; inp.min = 0; inp.max = S - 1; inp.step = 1;
    inp.setAttribute('aria-label', 'the step: the node added');
    keepTouches(inp);
    var sw = ctrl.appendChild(make('label', 'lsw-switch'));
    var box = sw.appendChild(make('input'));
    box.type = 'checkbox';
    box.checked = !!o.off;
    sw.appendChild(make('span', '', 'loop closure off'));
    [bStart, bBack, bNext, bLoop].forEach(function (b) { b.type = 'button'; });
    /* the strip's colours, beside it: inside a box of its own, so that they do not widen the buttons' columns */
    var kinds = ctrl.appendChild(make('div', 'lsw-kinds')).appendChild(make('div'));
    KINDS.forEach(function (k) { kinds.appendChild(make('span', 'kd', '<span class="sq" style="background:' + k[1] + '"></span>' + k[2])); });
    /* the slider's thumb (18 px) runs from 9 px to 9 px before the end: a cell as wide as one step of it, centred under it */
    var strip = ctrl.appendChild(make('div', 'lsw-strip'));
    strip.style.margin = '0 calc(9px - (100% - 18px) / ' + (2 * (S - 1)) + ')';
    strip.setAttribute('role', 'img');
    strip.setAttribute('aria-label', 'Every step in order, coloured by what its loop-closure check came to');
    var cells = steps.map(function (st) {
      var c = strip.appendChild(make('div', 'cell'));
      c.style.background = KINDS.filter(function (k) { return k[0] === kindOf(st); })[0][1];
      return c;
    });
    /* a press on the strip goes to its cell, a drag along it steps through: pointer events, not click — on a phone a touch
       brings up Marp's own controls over the slide's foot, and the click that follows lands on them */
    var scrub = false;
    function cellAt(evt) {
      var r = strip.getBoundingClientRect();
      return Math.max(0, Math.min(S - 1, Math.floor((evt.clientX - r.left) / r.width * S)));
    }
    strip.addEventListener('pointerdown', function (evt) {
      scrub = true;
      if (strip.setPointerCapture) strip.setPointerCapture(evt.pointerId);
      go(cellAt(evt));
    });
    strip.addEventListener('pointermove', function (evt) { if (scrub && cellAt(evt) !== i) go(cellAt(evt)); });
    ['pointerup', 'pointercancel'].forEach(function (type) { strip.addEventListener(type, function () { scrub = false; }); });
    keepTouches(strip);                                         // Marp's swipe must not take a drag along the strip
    strip.addEventListener('touchend', function (e) { e.preventDefault(); }, { passive: false });   // no click after a tap

    /* ---------------- the legend: the marks drawn, a few words each, in columns ---------------- */
    function icon(inner) { return '<svg width="26" height="14" viewBox="0 0 26 14" aria-hidden="true">' + inner + '</svg>'; }
    function arrowAtIcon(x, s, fill) { return '<path transform="translate(' + x + ' 7) scale(' + s + ')" d="' + ARROW + '" fill="' + fill + '"/>'; }
    function dotsAt(xs, colour) {
      return xs.map(function (x, n) { return '<circle cx="' + x + '" cy="' + (n % 2 ? 5.5 : 8.5) + '" r="1.6" fill="' + colour + '"/>'; }).join('');
    }
    var truthIcon = icon('<path d="M2 13 V2 H24" fill="none" stroke="' + C.ink + '" stroke-width="1"/>' +   // a wall's corner
      '<path transform="translate(15 8.5) scale(5.2)" d="' + ARROW + '" fill="none" stroke="' + C.ink + '" stroke-width="0.2"/>');
    var ringIcon = icon('<circle cx="13" cy="7" r="6.2" fill="none" stroke="' + C.ring + '" stroke-width="1.1" stroke-dasharray="2.6 1.8"/>' +
      '<path d="M10.5 7 H15.5 M13 4.5 V9.5" stroke="' + C.ring + '" stroke-width="1.4"/>');
    var legend = el.appendChild(make('div', 'lsw-legend'));
    [
      [[icon(arrowAtIcon(13, 6.5, C.est)), 'node: its pose <i>x</i>, <i>y</i>, <i>θ</i>'],
       [icon(arrowAtIcon(13, 6.5, C.grey)), 'old node, linked to the new one'],
       [icon(arrowAtIcon(7, 5.6, C.chain) + arrowAtIcon(19, 5.6, C.short)), 'chain of candidates; pale: too short']],
      [[ringIcon, '<i>d</i><sub class="w">max</sub> round the node\'s scan centre'],
       [icon(dotsAt([3, 7, 11], C.est) + dotsAt([16, 20, 24], C.scan)), 'this node\'s scan; pale: earlier nodes\''],
       [icon(''), 'each keeps its own; /map from all, every ' + data.mapEvery + ' s']],
      [[truthIcon, 'ground truth: the room, the pose at a node'],
       [icon('<line x1="1" y1="7" x2="25" y2="7" stroke="' + C.grey + '" stroke-width="1.8"/>'), 'edge between neighbours']],
      [[icon('<path d="M2 11 Q13 0 24 11" fill="none" stroke="' + C.loop + '" stroke-width="2.6" stroke-dasharray="5 3"/>'), 'loop edge'],
       [icon('<text x="13" y="11.5" text-anchor="middle" font-size="13" fill="' + C.ink + '">σ</text>'), 'typical error, from the scan match']]
    ].forEach(function (items) {
      var col = legend.appendChild(make('div', 'col'));
      items.forEach(function (item) { col.appendChild(make('div', 'it', item[0] + '<span>' + item[1] + '</span>')); });
    });

    /* ---------------- what each step holds ---------------- */
    function poseOf(m, st, off) { return off ? nodes[m].off : (st.node > J || st.after) ? nodes[m].on : nodes[m].made; }
    function posesAt(st, off) { var out = []; for (var m = 0; m <= st.node; m++) out.push(poseOf(m, st, off)); return out; }
    function hasLoop(st, off) { return !off && st.node >= J; }
    function checkAt(st, off) {                                  // the search the step shows: none with loop closure off
      if (off) return null;
      var ck = nodes[st.node].check;
      return st.after ? ck.again : ck;
    }
    function statusOf(ck) {                                      // old node → linked, chain, short; the rest outside the circle
      var out = {};
      if (!ck) return out;
      ck.linked.forEach(function (q) { out[q] = 'linked'; });
      (ck.chain || []).forEach(function (q) { out[q] = 'chain'; });
      (ck.short || []).forEach(function (q) { out[q] = 'short'; });
      return out;
    }
    function ateOf(ps) {                                         // the root mean square of each node's distance to ground truth
      var s = 0;
      ps.forEach(function (p, m) { var g = nodes[m].gt; s += (p[0] - g[0]) * (p[0] - g[0]) + (p[1] - g[1]) * (p[1] - g[1]); });
      return Math.sqrt(s / ps.length);
    }
    function loopError(ps) {      // the loop edge's error: what the poses give − measured, as Ceres's PoseGraph2dErrorTerm
      var r = relative(ps[I], ps[J]), z = data.loop.z;
      return [r[0] - z[0], r[1] - z[1], wrap(r[2] - z[2])];
    }

    /* ---------------- drawing ---------------- */
    function transform(p) { return 'translate(' + X(p[0]).toFixed(1) + ' ' + Y(p[1]).toFixed(1) + ') rotate(' + (-deg(p[2])).toFixed(2) + ')'; }
    function arrowAt(path, p, size) {
      path.setAttribute('transform', 'translate(' + X(p[0]).toFixed(1) + ' ' + Y(p[1]).toFixed(1) + ') rotate(' + (-deg(p[2])).toFixed(1) +
        ') scale(' + size + ')');
    }
    function arc(a, b) {                                         // the loop edge: an arc from node I to node J, bowed to one side
      var ax = X(a[0]), ay = Y(a[1]), bx = X(b[0]), by = Y(b[1]);
      if (bx < ax) { var tx = ax, ty = ay; ax = bx; ay = by; bx = tx; by = ty; }   // bowed up, whichever end is to the left
      var dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy) || 1;
      var cx = (ax + bx) / 2 + dy / len * BOW, cy = (ay + by) / 2 - dx / len * BOW;
      return 'M' + ax.toFixed(1) + ' ' + ay.toFixed(1) + ' Q' + cx.toFixed(1) + ' ' + cy.toFixed(1) + ' ' + bx.toFixed(1) + ' ' + by.toFixed(1);
    }
    function between(a, b, t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + wrap(b[2] - a[2]) * t]; }
    var raf = 0, glide = false, ready = false, cur = [], shownK = -1, loopShown = false, topK = -1;
    var ringFrom = null, ringTo = null, ringAt = null;           // the scan centre: it glides with the poses at the solve
    function play(from, to, after) {                            // a step forward or back, or the switch, glides; a jump is at once
      cancelAnimationFrame(raf);
      function frame(t) {
        for (var m = 0; m < to.length; m++) {
          var p = from[m] && glide ? between(from[m], to[m], t) : to[m];
          cur[m] = p;
          els[m].scan.setAttribute('transform', transform(p));
          els[m].lens.setAttribute('transform', transform(p));
          arrowAt(els[m].arrow, p, ARROW_PX);
          if (m) {
            var a = cur[m - 1];
            els[m].edge.setAttribute('x1', X(a[0]).toFixed(1)); els[m].edge.setAttribute('y1', Y(a[1]).toFixed(1));
            els[m].edge.setAttribute('x2', X(p[0]).toFixed(1)); els[m].edge.setAttribute('y2', Y(p[1]).toFixed(1));
          }
        }
        if (loopShown) loopPath.setAttribute('d', arc(cur[I], cur[J]));
        ringAt = null;
        if (ringTo) {
          var c = ringFrom && glide ? [ringFrom[0] + (ringTo[0] - ringFrom[0]) * t, ringFrom[1] + (ringTo[1] - ringFrom[1]) * t] : ringTo;
          ringAt = [X(c[0]), Y(c[1])];
          ring.setAttribute('cx', ringAt[0].toFixed(1)); ring.setAttribute('cy', ringAt[1].toFixed(1));
          centre.setAttribute('transform', 'translate(' + ringAt[0].toFixed(1) + ' ' + ringAt[1].toFixed(1) + ')');
        }
        after();
      }
      if (!glide) { frame(1); return; }
      var t0 = null;
      (function tick(now) {
        if (now !== undefined) {
          if (t0 === null) t0 = now;
          var u = Math.min(1, (now - t0) / 480);
          frame(u * (2 - u));
          if (u >= 1) return;
        }
        raf = requestAnimationFrame(tick);
      })();
    }

    /* the panel's pieces: a row of a grid, the node's pose as a column, an edge's three numbers with their σ, the check */
    function row(name, val, note, cls) {
      return '<div class="k' + (cls ? ' ' + cls : '') + '">' + name + '</div><div class="v' + (cls ? ' ' + cls : '') + '">' + val +
        (note ? ' <span class="n">' + note + '</span>' : '') + '</div>';
    }
    function partName(c) { return 'Δ' + sym(PARTS[c][0], 'ij') + ' <span class="pw">' + PARTS[c][1] + '</span>'; }   // Δx_ij, as on the slides
    function poseBlock(m, p) {
      return '<div class="lsw-grid"><div class="cap">this node: its pose</div>' +
        row('<i>x</i>', num(p[0], 2) + ' m') + row('<i>y</i>', num(p[1], 2) + ' m') + row('<i>θ</i>', num(deg(wrap(p[2])), 1) + '°') + '</div>';
    }
    function edgeBlock(m, off) {
      if (!m) return '<div class="lsw-grid"><div class="cap">pinned: the map\'s origin</div></div>';
      var nd = nodes[m], z = off && nd.zOff ? nd.zOff : nd.z, s = off && nd.sOff ? nd.sOff : nd.s;
      return '<div class="lsw-grid"><div class="cap">edge from the node before, from scan matching</div>' +
        [0, 1, 2].map(function (c) { return row(partName(c), part(c, z[c]), 'σ ' + sigmaText(c, s)); }).join('') + '</div>';
    }
    var DMAX = '<i>d</i><sub class="w">max</sub>';
    function checkBlock(st, off) {                              // Karto's loop-closure check at the step, as it came out
      /* the caption above the grid, not in it: a long caption would widen the grid's columns */
      function block(cap, rows) { return '<div class="lsw-check"><div class="cap">' + cap + '</div><div class="lsw-grid">' + rows + '</div></div>'; }
      if (off) return '<div class="lsw-check"><div class="cap">loop closure check: none, loop closure is off</div></div>';
      var ck = checkAt(st, off), near = ck.near, linked = ck.linked, x = ck.match, n = near.length, apart = n - linked.length;
      var cap = st.after ? 'loop closure check again, after the solve'
        : 'loop closure check: old nodes with their scan centre within ' + DMAX + ' = ' + data.dMax.toFixed(1) + ' m';
      if (!n) return block(cap, row('in the circle', 'no old node'));
      if (!apart) return block(cap, row('in the circle', count(n, 'old node') + (n > 1 ? ', all' : ',') + ' linked' + (st.after ? ' now' : ''),
        '', 'gr'));
      var rows = row('in the circle', count(n, 'old node') + ': ' + linked.length + ' linked, ' + apart + ' not');
      if (ck.short) return block(cap, rows + row('not linked in a row', ck.short.length + ' of ' + data.chainMin + ' — no match tried',
        '', 'o'));
      return block(cap, rows + row('not linked in a row', ck.chain.length + ' of ' + data.chainMin + ': a chain', '', 'o') +
        row('coarse match', 'response ' + x.coarse.toFixed(2) + ' &gt; ' + x.coarseMin + ' · σ ' + Math.sqrt(x.var[0]).toFixed(2) + ' m, ' +
          Math.sqrt(x.var[1]).toFixed(2) + ' m &lt; ' + Math.sqrt(x.varMax).toFixed(1) + ' m') +
        row('fine match', 'response ' + x.fine.toFixed(2) + ' ≥ ' + x.fineMin) +
        row('loop edge', '<i>i</i> → <i>j</i>', 'from the chain\'s node nearest by scan centre', 'r'));
    }
    function head(name, rest) { return '<div class="lsw-head"><b class="g">' + name + '</b>' + (rest ? ' · ' + rest : '') + '</div>'; }

    var i = 0;
    function draw() {
      var st = steps[i], K = st.node, off = box.checked, ps = posesAt(st, off), ck = checkAt(st, off), status = statusOf(ck);
      loopShown = hasLoop(st, off);
      els.forEach(function (e, m) {
        var on = m <= K, was = st.after && !off && m <= J;    // in the square: the scans before the loop, beside those after
        e.before.style.display = was ? '' : 'none';
        if (was) e.before.setAttribute('transform', transform(nodes[m].made));
        e.scan.style.display = e.lens.style.display = e.arrow.style.display = e.truth.style.display = on ? '' : 'none';
        if (e.edge) e.edge.style.display = on ? '' : 'none';
        if (!on) return;
        arrowAt(e.truth, nodes[m].gt, ARROW_PX);
        e.arrow.setAttribute('fill', m < K && status[m] ? NODE[status[m]] : C.est);
        e.scan.setAttribute('stroke', m === K ? C.est : C.scan);      // this node's scan bright, the earlier ones pale
        e.lens.setAttribute('stroke', m === K ? C.est : C.scan);
      });
      if (topK !== K) { gScans.appendChild(els[K].scan); lNow.appendChild(els[K].lens); topK = K; }   // this node's scan on top
      lensCap.innerHTML = 'the square, magnified ×' + ZOOM.toFixed(1) + (st.after && !off ? '<br>grey — the scans before the loop' : '');
      loopPath.style.display = loopShown ? '' : 'none';
      ring.style.display = centre.style.display = ck ? '' : 'none';
      ringFrom = ck && ringTo && shownK === K ? ringTo : null;    // the same node: the centre glides (the solve); a new one, at once
      ringTo = ck ? ck.c : null;
      var from = cur.slice(0, K + 1);
      play(from, ps, function () {                               // the numbers: the new node's, and the loop edge's other end
        var avoid = [];                                          // boxes the new node's number keeps clear of, px
        if (ringAt) avoid.push([ringAt[0] - 9, ringAt[1] - 9, ringAt[0] + 9, ringAt[1] + 9]);
        labelI.style.display = loopShown ? '' : 'none';
        if (loopShown) {
          var ix = X(cur[I][0]) - 4, iy = Y(cur[I][1]) - 9;
          labelI.setAttribute('x', ix.toFixed(1)); labelI.setAttribute('y', iy.toFixed(1));
          labelI.textContent = 'i';                              // letters, not the run's node numbers
          labelI.setAttribute('fill', status[I] ? NODE[status[I]] : C.est);   // the colour of its node
          avoid.push([ix - 8 - 2, iy - 12, ix + 2, iy + 4]);
        }
        var nx = X(cur[K][0]), ny = Y(cur[K][1]), w = 8, spot = SPOTS[0];
        for (var q = 0; q < SPOTS.length; q++) {
          var s = SPOTS[q], x0 = nx + s[0] - (s[2] === 'middle' ? w / 2 : s[2] === 'end' ? w : 0), y0 = ny + s[1] - 10;
          if (avoid.every(function (a) { return x0 + w < a[0] || x0 > a[2] || y0 + 13 < a[1] || y0 > a[3]; })) { spot = s; break; }
        }
        label.setAttribute('x', (nx + spot[0]).toFixed(1)); label.setAttribute('y', (ny + spot[1]).toFixed(1));
        label.setAttribute('text-anchor', spot[2]);
        label.textContent = K ? 'j' : '';
      });
      shownK = K;
      inp.value = i; inp.style.setProperty('--f', (i / (S - 1)).toFixed(4));
      cells.forEach(function (c, q) { c.classList.toggle('cur', q === i); });
      strip.classList.toggle('off', off);

      /* the counter and the memory: what the graph keeps */
      counter.innerHTML = '<span class="w">node</span> <b>' + K + '</b> <span class="w">/ ' + N + '</span>' +
        '<div class="phase">' + (st.after ? 'after the loop' : '') + '</div>';
      var points = 0;
      for (var m = 0; m <= K; m++) points += nodes[m].n;
      var edges = K + (loopShown ? 1 : 0);
      function tally(value, name, how) { return '<div><div class="m"><b>' + value + '</b> ' + name + '</div><span>' + how + '</span></div>'; }
      memory.innerHTML =
        tally(K + 1, K ? 'nodes' : 'node', K ? 'one per ' + data.step[0] + ' m or ' + data.step[1] + ' rad' : 'the start') +
        tally(edges, edges === 1 ? 'edge' : 'edges', K + ' between neighbours' + (loopShown ? ' + 1 loop edge' : '')) +
        tally(thousands(points), 'scan points', 'every node keeps its scan');

      /* the step and its numbers */
      var html = '', ls = data.loop.s;
      if (st.after && !off) {
        var before = posesAt({ node: J, after: false }, false), eb = loopError(before), ea = loopError(ps), cr = data.ceres;
        var moved = [], still = [], most = 0, who = 0, worst = 0;
        for (var q = 0; q <= J; q++) {
          var d = Math.hypot(ps[q][0] - before[q][0], ps[q][1] - before[q][1]);
          (d >= 5e-4 ? moved : still).push(q);
          if (d > most) { most = d; who = q; }
        }
        for (var e = 1; e <= J; e++) {
          var r = relative(ps[e - 1], ps[e]), z = nodes[e].z;
          worst = Math.max(worst, Math.hypot(r[0] - z[0], r[1] - z[1]));
        }
        html = head('Ceres: all poses at once') + '<div class="lsw-grid">' +
          row('Ceres\'s report', 'cost ' + cost(cr.initial) + ' → <b>' + cost(cr.final) + '</b>', cr.iterations + ' iterations, ' + cr.poses + ' poses, ' + cr.edges + ' edges') +
          '<div class="sub">loop edge <i>i</i> → <i>j</i>: error = by the poses − measured</div>' +
          [0, 1, 2].map(function (c) { return row(partName(c), part(c, eb[c], true) + ' → <b>' + part(c, ea[c], true) + '</b>', '', 'in'); }).join('') +
          row('edges between neighbours', 'error ≤ ' + (1000 * worst).toFixed(1) + ' mm') +
          row('moved', count(moved.length, 'node') + '; the most ' + (100 * most).toFixed(1) + ' cm') +
          row('did not move', count(still.length, 'node') + ' by the start') + '</div>' + checkBlock(st, off);
      } else if (st.after) {
        html = head('loop closure off') + '<div class="lsw-say">no loop edge: nothing is solved</div>' +
          '<div class="lsw-cols">' + poseBlock(J, ps[J]) + edgeBlock(J, off) + '</div>' + checkBlock(st, off);
      } else if (K === J && !off) {
        var bc = loopError(ps), byPoses = relative(ps[I], ps[J]);
        html = head('new node <i>j</i>', 'slam_toolbox adds a loop edge') + checkBlock(st, off) +
          '<div class="lsw-table"><div></div><div class="h">by the poses</div><div class="h">measured, σ</div><div class="h">error</div>' +
          [0, 1, 2].map(function (c) {
            return '<div>' + partName(c) + '</div><div>' + part(c, byPoses[c]) + '</div><div>' + part(c, data.loop.z[c]) +
              ' <span class="n">σ ' + sigmaText(c, ls) + '</span></div><div class="r">' + part(c, bc[c], true) + '</div>';
          }).join('') + '</div><div class="lsw-note">loop edge <i>i</i> → <i>j</i>: error = by the poses − measured</div>';
      } else {
        html = head(K === 0 ? 'the first node' : 'a new node', K === 0 ? 'the start' : '') + '<div class="lsw-cols">' + poseBlock(K, ps[K]) +
          edgeBlock(K, off) + '</div>' + checkBlock(st, off);
        if (K > J && !off) html += '<div class="lsw-say">no new loop edge: nothing is solved</div>';
      }
      panel.innerHTML = html;

      /* the ATE of the nodes shown, both ways: the one drawn in bold */
      var aOn = ateOf(posesAt(st, false)), aOff = ateOf(posesAt(st, true));
      ate.innerHTML = '<div class="cap">ATE of the nodes so far against ground truth</div>' +
        '<div class="two"><span class="' + (off ? '' : 'sel') + '">loop closure on <b>' + (100 * aOn).toFixed(1) + ' cm</b></span>' +
        '<span class="' + (off ? 'sel' : '') + '">off <b>' + (100 * aOff).toFixed(1) + ' cm</b></span></div>';
      showTip();
    }

    /* ---------------- under the cursor: a node and how far it is from ground truth ---------------- */
    var hover = null;
    function showTip() {
      if (hover === null || hover > shownK) { tip.setAttribute('display', 'none'); return; }
      var p = cur[hover], g = nodes[hover].gt, d = Math.hypot(p[0] - g[0], p[1] - g[1]);
      tipText.textContent = 'this node: ' + (100 * d).toFixed(1) + ' cm from ground truth';
      tip.setAttribute('display', '');
      var w = (tipText.getComputedTextLength() || 7 * tipText.textContent.length) + 14;
      var x = Math.max(2, Math.min(MW - w - 2, X(p[0]) - w / 2)), y = Y(p[1]) - 33;
      if (y < 2) y = Y(p[1]) + 12;                               // no room above: under the node
      tipBox.setAttribute('x', x.toFixed(1)); tipBox.setAttribute('y', y.toFixed(1)); tipBox.setAttribute('width', w.toFixed(1));
      tipText.setAttribute('x', (x + 7).toFixed(1)); tipText.setAttribute('y', (y + 15).toFixed(1));
    }
    function nodeAt(evt) {                                       // the shown node nearest the cursor, within 9 px
      var box2 = map.getBoundingClientRect(), k = box2.width / MW || 1;
      var x = (evt.clientX - box2.left) / k, y = (evt.clientY - box2.top) / k, best = null, bd = 9;
      for (var m = 0; m <= shownK; m++) {
        var d = Math.hypot(X(cur[m][0]) - x, Y(cur[m][1]) - y);
        if (d < bd) { bd = d; best = m; }
      }
      return best;
    }
    map.addEventListener('mousemove', function (evt) { hover = nodeAt(evt); showTip(); });
    map.addEventListener('click', function (evt) { hover = nodeAt(evt); showTip(); });
    map.addEventListener('mouseleave', function () { hover = null; showTip(); });

    function go(k) {
      var to = Math.max(0, Math.min(S - 1, k));
      glide = ready && Math.abs(to - i) === 1;
      i = to;
      draw();
    }
    bNext.addEventListener('click', function () { go(i + 1); if (o.blur) bNext.blur(); });
    bBack.addEventListener('click', function () { go(i - 1); if (o.blur) bBack.blur(); });
    bStart.addEventListener('click', function () { go(0); if (o.blur) bStart.blur(); });
    bLoop.addEventListener('click', function () { go(J); if (o.blur) bLoop.blur(); });
    inp.addEventListener('input', function () { go(+inp.value); });
    inp.addEventListener('change', function () { if (o.blur) inp.blur(); });
    box.addEventListener('change', function () { glide = ready; draw(); if (o.blur) box.blur(); });

    go(o.start === undefined ? 0 : o.start);
    ready = true;
    return { get: function () { return { i: i, step: steps[i], off: box.checked }; }, go: go,
      off: function (b) { box.checked = !!b; glide = false; draw(); }, element: el };
  }

  return { mount: mount };
});
