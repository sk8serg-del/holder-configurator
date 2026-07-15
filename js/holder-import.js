/*
 * holder-import.js — разбор выгрузки DumpHoles.iLogicVb в запись диска.
 * Работает и в браузере (HC.holderImport), и в node (для CLI/тестов).
 *
 * HC.holderImport.buildFromCSV(text, discDia) →
 *   { blankDiameter, fixtures:{holes,cutouts}, holes:[...], threadPoints:[...] }
 * HC.holderImport.buildDiscEntry(text, {id,name,discDiameter,thickness}) →
 *   готовая запись диска для HC.CATALOG.discs (diameter, blankDiameter,
 *   thickness, fixtures, controlVariants).
 *
 * Маршрутизация по discDia: отверстия внутри полезной зоны → контрольные;
 * круглый крепёж на фланце → fixtures.holes (по Ø); фигурные контуры вне
 * зоны → fixtures.cutouts; крупные окружности-границы дают blankDiameter.
 * Ограничение: тип отверстия (зенковка/паз/сторона) выгрузка не различает —
 * такие уточнения вносятся в каталог вручную.
 */
(function (g) {
  "use strict";
  var HC = (g.HC = g.HC || {});

  var TOL = 0.15; // мм — допуск на совпадение центров

  function num(s) {
    if (s == null || s === "") return null;
    var v = parseFloat(s);
    return isNaN(v) ? null : Math.round(v * 1000) / 1000;
  }

  function parseCSV(text) {
    var lines = String(text).replace(/^﻿/, "").split(/\r?\n/).filter(function (l) { return l.trim() !== ""; });
    var cols = null, rows = [], contours = [];
    lines.forEach(function (line) {
      var f = line.split(";");
      if (f[0] === "columns") { cols = f.slice(1); return; }
      if (f[0] === "contour") {
        var pts = [];
        for (var i = 3; i + 1 < f.length; i += 2) {
          var x = num(f[i]), y = num(f[i + 1]);
          if (x != null && y != null) pts.push([x, y]);
        }
        contours.push({ label: f[1] || "Вырез", depth: f[2] === "through" ? null : num(f[2]), points: pts });
        return;
      }
      if (cols && f.length >= cols.length && f[0] !== "holes-dump" && f[0] !== "part") {
        var row = {};
        cols.forEach(function (c, i) { row[c] = f[i]; });
        rows.push(row);
      }
    });
    return { rows: rows, contours: contours };
  }

  function ringsOf(r) {
    var rings = [];
    var dia = num(r.diameter);
    var depth = r.depth === "through" ? null : num(r.depth);
    if (r.type === "counterbore") {
      var cbD = num(r.extra1), cbDepth = num(r.extra2);
      if (cbD) rings.push({ dia: cbD, depth: cbDepth, name: r.name });
      if (dia) rings.push({ dia: dia, depth: depth, name: r.name });
    } else {
      if (dia) rings.push({ dia: dia, depth: depth, name: r.name });
    }
    return rings;
  }

  function baseName(name) {
    return String(name)
      .replace(/-\d+$/, "")
      .replace(/(Counterbore|ClearAperture|Clear|Aperture|Seat|Hole|Drill)$/i, "")
      .trim() || String(name);
  }

  function pointInPoly(px, py, poly) {
    var inside = false;
    for (var i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      var xi = poly[i][0], yi = poly[i][1], xj = poly[j][0], yj = poly[j][1];
      if (((yi > py) !== (yj > py)) && (px < (xj - xi) * (py - yi) / (yj - yi) + xi)) inside = !inside;
    }
    return inside;
  }

  function buildFromCSV(text, discDia) {
    var parsed = parseCSV(text);
    var rows = parsed.rows, contours = parsed.contours;
    if (!rows.length && !contours.length) return null;

    var blankD = 0;
    rows.forEach(function (r) {
      [num(r.diameter), num(r.extra1)].forEach(function (d) { if (d && d > blankD) blankD = d; });
    });

    var maxDia = discDia ? discDia * 0.9 : Infinity;
    var maxR = discDia ? discDia / 2 : Infinity;

    var groups = [];
    rows.forEach(function (r) {
      var x = num(r.x), y = num(r.y);
      var gr = null;
      for (var i = 0; i < groups.length; i++) {
        if (Math.abs(groups[i].x - x) < TOL && Math.abs(groups[i].y - y) < TOL) { gr = groups[i]; break; }
      }
      if (!gr) { gr = { x: x, y: y, rings: [], names: [], notes: [], tapped: false }; groups.push(gr); }
      ringsOf(r).forEach(function (ring) { if (ring.dia <= maxDia) gr.rings.push(ring); });
      gr.names.push(r.name);
      if (r.tapped === "yes") gr.tapped = true;
      if (r.type === "countersink") gr.notes.push("зенковка Ø" + r.extra1 + " угол " + r.extra2 + "°");
    });

    var entries = groups.map(function (gg) {
      var rings = gg.rings.slice().sort(function (a, b) { return b.dia - a.dia; });
      var seat = rings.filter(function (r) { return r.depth != null; }).sort(function (a, b) { return b.dia - a.dia; })[0];
      var through;
      if (seat) through = rings.filter(function (r) { return r.depth == null && r.dia < seat.dia - 1e-6; }).sort(function (a, b) { return b.dia - a.dia; })[0];
      else through = rings.filter(function (r) { return r.depth == null; }).sort(function (a, b) { return b.dia - a.dia; })[0];

      var src = seat || through || rings[0];
      var o = { x: gg.x, y: gg.y, name: baseName(src ? src.name : gg.names[0]), tapped: gg.tapped, notes: Array.from(new Set(gg.notes)) };
      if (seat) {
        o.seatD = seat.dia;
        if (seat.depth) o.depth = seat.depth;
        if (through) o.apertureCA = through.dia;
      } else if (through) {
        o.d = through.dia;
      }
      o.empty = o.seatD == null && o.d == null;
      return o;
    });

    var holes = [];
    var fixtureKey = {};
    var threadPoints = [];
    entries.forEach(function (e) {
      var R = Math.sqrt(e.x * e.x + e.y * e.y);
      var inside = !discDia || R <= maxR + TOL;
      if (inside) {
        if (e.empty && !e.notes.length) return;
        var h = { x: e.x, y: e.y, name: e.name };
        if (e.d != null) h.d = e.d;
        if (e.seatD != null) h.seatD = e.seatD;
        if (e.apertureCA != null) h.apertureCA = e.apertureCA;
        if (e.depth != null) h.depth = e.depth;
        h._notes = e.notes;
        holes.push(h);
      } else {
        var dia = e.seatD != null ? e.seatD : e.d;
        if (dia == null) { if (e.tapped) threadPoints.push([e.x, e.y]); return; }
        var key = (e.tapped ? "T" : "") + dia;
        if (!fixtureKey[key]) fixtureKey[key] = { d: dia, tapped: e.tapped, points: [] };
        fixtureKey[key].points.push([e.x, e.y]);
      }
    });

    // контуры внутри полезной зоны — обводки посадок свидетелей, отбрасываем;
    // снаружи — настоящие фигурные вырезы
    var cutouts = contours.filter(function (c) {
      if (c.points.length < 3) return false;
      if (!discDia) return true;
      var sx = 0, sy = 0;
      c.points.forEach(function (p) { sx += p[0]; sy += p[1]; });
      var cr = Math.sqrt(Math.pow(sx / c.points.length, 2) + Math.pow(sy / c.points.length, 2));
      return cr > maxR;
    }).map(function (c) { return { label: c.label, depth: c.depth, points: c.points }; });

    var fixtures = {
      holes: Object.keys(fixtureKey).map(function (k) {
        var gp = fixtureKey[k];
        return { d: gp.d, label: (gp.tapped ? "Резьба" : "Крепёж") + " Ø" + gp.d, points: gp.points };
      }),
      cutouts: cutouts
    };

    return { blankDiameter: blankD || null, fixtures: fixtures, holes: holes, threadPoints: threadPoints };
  }

  // Полная запись диска для каталога из выгрузки.
  function buildDiscEntry(text, opts) {
    opts = opts || {};
    var res = buildFromCSV(text, opts.discDiameter);
    if (!res) return null;
    var holes = res.holes.map(function (h) {
      var o = { x: h.x, y: h.y, name: h.name, slotAvailable: false };
      if (h.d != null) o.d = h.d;
      if (h.seatD != null) o.seatD = h.seatD;
      if (h.apertureCA != null) o.apertureCA = h.apertureCA;
      if (h.depth != null) o.depth = h.depth;
      return o;
    });
    return {
      id: opts.id || ("disc-" + Date.now()),
      name: opts.name || "Подложка из CSV",
      diameter: opts.discDiameter || res.blankDiameter || 300,
      blankDiameter: res.blankDiameter || undefined,
      thickness: opts.thickness || 6,
      fixtures: res.fixtures,
      controlVariants: [
        { id: "std", name: "Из выгрузки", holes: holes },
        { id: "none", name: "Без контрольных отверстий", holes: [] }
      ],
      defaults: { partPart: 6, partEdge: 3, partControl: 6 },
      _threadPoints: res.threadPoints
    };
  }

  HC.holderImport = { parseCSV: parseCSV, buildFromCSV: buildFromCSV, buildDiscEntry: buildDiscEntry };
})(typeof globalThis !== "undefined" ? globalThis : window);
