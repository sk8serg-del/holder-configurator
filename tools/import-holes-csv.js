/*
 * import-holes-csv.js — конвертирует выгрузку DumpHoles.iLogicVb в готовый
 * фрагмент записи диска для js/catalog.js.
 *
 * Запуск: node tools/import-holes-csv.js путь/к/имя-holes.csv [--disc 298]
 *
 * Печатает три блока для вставки в запись диска:
 *   blankDiameter — полный Ø болванки (самая большая окружность выгрузки);
 *   fixtures      — то, что ВНЕ полезной зоны/декор (крепёж, фигурные вырезы),
 *                   только отображается, на раскладку не влияет;
 *   holes         — контрольные отверстия ВНУТРИ полезной зоны (в controlVariants).
 *
 * Слияние: строки с общим центром сливаются (посадка-counterbore → seatD+depth,
 * самый большой сквозной вырез меньше посадки → apertureCA). Круглые вырезы вне
 * полезной зоны идут в fixtures.holes (группировкой по Ø); контуры (contour-строки
 * из выгрузки — фигурные вырезы) → fixtures.cutouts. --disc <Ø> задаёт полезную
 * зону: центр в её пределах → контрольное отверстие, вне → крепёж/декор.
 * Гравировки (текст) выгрузка не даёт — вносятся отдельно вручную.
 */
"use strict";
const fs = require("fs");

const TOL = 0.15; // мм — допуск на совпадение центров

function num(s) {
  if (s == null || s === "") return null;
  const v = parseFloat(s);
  return isNaN(v) ? null : Math.round(v * 1000) / 1000;
}

function parseCSV(text) {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/).filter(function (l) { return l.trim() !== ""; });
  let cols = null;
  const rows = [];
  const contours = [];
  lines.forEach(function (line) {
    const f = line.split(";");
    if (f[0] === "columns") { cols = f.slice(1); return; }
    if (f[0] === "contour") {
      const pts = [];
      for (let i = 3; i + 1 < f.length; i += 2) {
        const x = num(f[i]), y = num(f[i + 1]);
        if (x != null && y != null) pts.push([x, y]);
      }
      contours.push({ label: f[1] || "Вырез", depth: f[2] === "through" ? null : num(f[2]), points: pts });
      return;
    }
    if (cols && f.length >= cols.length && f[0] !== "holes-dump" && f[0] !== "part") {
      const row = {};
      cols.forEach(function (c, i) { row[c] = f[i]; });
      rows.push(row);
    }
  });
  return { rows: rows, contours: contours };
}

// строка выгрузки → набор «колец» {dia, depth|null(сквозное), name}
function ringsOf(r) {
  const rings = [];
  const dia = num(r.diameter);
  const depth = r.depth === "through" ? null : num(r.depth);
  if (r.type === "counterbore") {
    const cbD = num(r.extra1), cbDepth = num(r.extra2);
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

function build(file, discDia) {
  const parsed = parseCSV(fs.readFileSync(file, "utf8"));
  const rows = parsed.rows, contours = parsed.contours;
  if (!rows.length && !contours.length) {
    console.error("Отверстия не найдены — это файл из DumpHoles.iLogicVb?");
    process.exit(1);
  }

  // полный Ø болванки — самая большая окружность выгрузки (контур/край)
  let blankD = 0;
  rows.forEach(function (r) {
    [num(r.diameter), num(r.extra1)].forEach(function (d) { if (d && d > blankD) blankD = d; });
  });

  const maxDia = discDia ? discDia * 0.9 : Infinity; // кольца крупнее — граница/контур, не отверстие
  const maxR = discDia ? discDia / 2 : Infinity;

  // группировка по центру (без отбрасывания — классифицируем ниже)
  const groups = [];
  rows.forEach(function (r) {
    const x = num(r.x), y = num(r.y);
    let gr = groups.find(function (g) { return Math.abs(g.x - x) < TOL && Math.abs(g.y - y) < TOL; });
    if (!gr) { gr = { x: x, y: y, rings: [], names: [], notes: [], tapped: false }; groups.push(gr); }
    ringsOf(r).forEach(function (ring) { if (ring.dia <= maxDia) gr.rings.push(ring); });
    gr.names.push(r.name);
    if (r.tapped === "yes") gr.tapped = true;
    if (r.type === "countersink") gr.notes.push("зенковка Ø" + r.extra1 + " угол " + r.extra2 + "°");
  });

  // слияние колец группы в одну запись
  const entries = groups.map(function (g) {
    const rings = g.rings.slice().sort(function (a, b) { return b.dia - a.dia; });
    const seat = rings.filter(function (r) { return r.depth != null; }).sort(function (a, b) { return b.dia - a.dia; })[0];
    let through;
    if (seat) through = rings.filter(function (r) { return r.depth == null && r.dia < seat.dia - 1e-6; }).sort(function (a, b) { return b.dia - a.dia; })[0];
    else through = rings.filter(function (r) { return r.depth == null; }).sort(function (a, b) { return b.dia - a.dia; })[0];

    const src = seat || through || rings[0];
    const o = { x: g.x, y: g.y, name: baseName(src ? src.name : g.names[0]), tapped: g.tapped, notes: Array.from(new Set(g.notes)) };
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

  // классификация: внутри полезной зоны → контрольное отверстие; вне → крепёж
  const holes = [];
  const fixtureKey = {};
  const threadPoints = []; // резьбовые без Ø (задать вручную)
  entries.forEach(function (e) {
    const R = Math.sqrt(e.x * e.x + e.y * e.y);
    const inside = !discDia || R <= maxR + TOL;
    if (inside) {
      if (e.empty && !e.notes.length) return;
      const h = { x: e.x, y: e.y, name: e.name };
      if (e.d != null) h.d = e.d;
      if (e.seatD != null) h.seatD = e.seatD;
      if (e.apertureCA != null) h.apertureCA = e.apertureCA;
      if (e.depth != null) h.depth = e.depth;
      h._notes = e.notes;
      holes.push(h);
    } else {
      const dia = e.seatD != null ? e.seatD : e.d;
      if (dia == null) { if (e.tapped) threadPoints.push([e.x, e.y]); return; }
      const key = (e.tapped ? "T" : "") + dia;
      if (!fixtureKey[key]) fixtureKey[key] = { d: dia, tapped: e.tapped, points: [] };
      fixtureKey[key].points.push([e.x, e.y]);
    }
  });

  // контуры: внутри полезной зоны — это обводки посадок свидетелей/reference
  // (у них паз делает профиль некруглым), они уже описаны контрольными
  // отверстиями → отбрасываем; снаружи — настоящие фигурные вырезы (Mountings).
  const cutouts = contours.filter(function (c) {
    if (c.points.length < 3) return false;
    if (!discDia) return true;
    let sx = 0, sy = 0;
    c.points.forEach(function (p) { sx += p[0]; sy += p[1]; });
    const cr = Math.sqrt(Math.pow(sx / c.points.length, 2) + Math.pow(sy / c.points.length, 2));
    return cr > maxR;
  }).map(function (c) { return { label: c.label, depth: c.depth, points: c.points }; });

  const fixtures = {
    holes: Object.keys(fixtureKey).map(function (k) {
      const g = fixtureKey[k];
      return { d: g.d, label: (g.tapped ? "Резьба" : "Крепёж") + " Ø" + g.d, points: g.points };
    }),
    cutouts: cutouts
  };

  return { blankDiameter: blankD || null, fixtures: fixtures, holes: holes, threadPoints: threadPoints };
}

// ---------- печать фрагмента каталога ----------

function fnum(v) { return typeof v === "number" ? v : JSON.stringify(v); }

function ptsStr(points) {
  return "[" + points.map(function (p) { return "[" + fnum(p[0]) + ", " + fnum(p[1]) + "]"; }).join(", ") + "]";
}

function fixturesStr(fx) {
  const lines = [];
  lines.push("fixtures: {");
  lines.push("  holes: [");
  fx.holes.forEach(function (h, i) {
    lines.push('    { d: ' + fnum(h.d) + ', label: ' + JSON.stringify(h.label) + ', points: ' + ptsStr(h.points) + " }" + (i < fx.holes.length - 1 ? "," : ""));
  });
  lines.push("  ],");
  lines.push("  cutouts: [");
  fx.cutouts.forEach(function (c, i) {
    const depth = c.depth != null ? ", depth: " + fnum(c.depth) : "";
    lines.push('    { label: ' + JSON.stringify(c.label) + depth + ", points: " + ptsStr(c.points) + " }" + (i < fx.cutouts.length - 1 ? "," : ""));
  });
  lines.push("  ]");
  lines.push("}");
  return lines.join("\n");
}

function holesStr(holes) {
  const field = function (k, v) { return v == null ? null : k + ": " + fnum(v); };
  const body = holes.map(function (h, i) {
    const parts = [field("x", h.x), field("y", h.y), field("name", h.name),
      field("d", h.d), field("seatD", h.seatD), field("apertureCA", h.apertureCA), field("depth", h.depth)].filter(Boolean);
    const note = h._notes && h._notes.length ? " // " + h._notes.join("; ") : "";
    return "  { " + parts.join(", ") + " }" + (i < holes.length - 1 ? "," : "") + note;
  }).join("\n");
  return "holes: [\n" + body + "\n]";
}

module.exports = { build: build, parseCSV: parseCSV };

if (require.main === module) {
  const args = process.argv.slice(2);
  let file = null, discDia = null;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--disc") discDia = parseFloat(args[++i]);
    else file = args[i];
  }
  if (!file) {
    console.error("Использование: node tools/import-holes-csv.js файл-holes.csv [--disc 298]");
    process.exit(1);
  }
  const res = build(file, discDia);
  console.log("// --- вставить в запись диска в js/catalog.js ---\n");
  if (res.blankDiameter) console.log("blankDiameter: " + fnum(res.blankDiameter) + ",\n");
  console.log(fixturesStr(res.fixtures) + ",\n");
  console.log("// внутри controlVariants[]:");
  console.log(holesStr(res.holes));
  if (res.threadPoints.length) {
    console.log("\n// резьбовые отверстия — Ø резьбы Inventor не отдал, задать вручную. Позиции:");
    res.threadPoints.forEach(function (p) { console.log("//   [" + p[0] + ", " + p[1] + "]"); });
  }
  console.log("\n// групп: контрольных " + res.holes.length + ", крепёж-групп " + res.fixtures.holes.length +
    ", вырезов " + res.fixtures.cutouts.length + ". Проверьте slotAvailable, названия, стандартный d, толщину.");
}
