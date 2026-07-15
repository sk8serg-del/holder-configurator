/*
 * import-holes-csv.js — конвертирует выгрузку DumpHoles.iLogicVb в готовый
 * фрагмент js/catalog.js (массив holes для controlVariants).
 *
 * Запуск: node tools/import-holes-csv.js путь/к/имя-holes.csv
 * Результат печатается в консоль — вставить вручную в нужный disc/variant
 * в js/catalog.js и поправить slotAvailable/название/d по месту.
 *
 * Свидетели/Reference выходят из Inventor несколькими строками на один центр
 * (посадка-counterbore + сквозная зона напыления, иногда + сверление). Скрипт
 * группирует строки по координате (в пределах TOL мм) и собирает из них одну
 * запись с seatD / apertureCA / depth:
 *   - самое большое кольцо с конечной глубиной → посадка (seatD + depth);
 *   - сквозное кольцо меньшего Ø → зона напыления (apertureCA);
 *   - одиночное сквозное отверстие → обычное отверстие (d).
 */
"use strict";
const fs = require("fs");

const TOL = 0.15; // мм — допуск на совпадение центров

function parseCSV(text) {
  const lines = text.replace(/^﻿/, "").split(/\r?\n/).filter(function (l) { return l.trim() !== ""; });
  let cols = null;
  const rows = [];
  lines.forEach(function (line) {
    const f = line.split(";");
    if (f[0] === "columns") { cols = f.slice(1); return; }
    if (cols && f.length >= cols.length && f[0] !== "holes-dump" && f[0] !== "part") {
      const row = {};
      cols.forEach(function (c, i) { row[c] = f[i]; });
      rows.push(row);
    }
  });
  return rows;
}

function num(s) {
  if (s == null || s === "") return null;
  const v = parseFloat(s);
  return isNaN(v) ? null : Math.round(v * 1000) / 1000;
}

// строка выгрузки → набор «колец» {dia, depth|null(сквозное), source}
function ringsOf(r) {
  const rings = [];
  const dia = num(r.diameter);
  const depth = r.depth === "through" ? null : num(r.depth);
  if (r.type === "counterbore") {
    const cbD = num(r.extra1), cbDepth = num(r.extra2);
    if (cbD) rings.push({ dia: cbD, depth: cbDepth, seat: true }); // цековка = посадка
    if (dia) rings.push({ dia: dia, depth: depth });               // сверление под ней
  } else {
    if (dia) rings.push({ dia: dia, depth: depth, tapped: r.tapped === "yes", countersink: r.type === "countersink" });
  }
  return rings;
}

function baseName(name) {
  // WitnesCenterCounterbore / WitnesCenterClearAperture → WitnesCenter
  return String(name)
    .replace(/-\d+$/, "")
    .replace(/(Counterbore|ClearAperture|Clear|Aperture|Seat|Hole|Drill)$/i, "")
    .trim() || String(name);
}

function build(file) {
  const rows = parseCSV(fs.readFileSync(file, "utf8"));
  if (!rows.length) {
    console.error("Отверстия не найдены — это файл из DumpHoles.iLogicVb?");
    process.exit(1);
  }

  // группировка по центру
  const groups = [];
  rows.forEach(function (r) {
    const x = num(r.x), y = num(r.y);
    let gr = groups.find(function (g) { return Math.abs(g.x - x) < TOL && Math.abs(g.y - y) < TOL; });
    if (!gr) { gr = { x: x, y: y, rings: [], names: [], notes: [] }; groups.push(gr); }
    ringsOf(r).forEach(function (ring) { gr.rings.push(ring); });
    gr.names.push(r.name);
    if (r.tapped === "yes") gr.notes.push("резьбовое (Ø резьбы Inventor не отдал) — задать вручную");
    if (r.type === "countersink") gr.notes.push("зенковка Ø" + r.extra1 + " угол " + r.extra2 + "° — при необходимости учесть вручную");
  });

  // сборка записи каталога из колец группы
  const holes = groups.map(function (g) {
    const rings = g.rings.slice().sort(function (a, b) { return b.dia - a.dia; });
    const seat = rings.filter(function (r) { return r.depth != null; }).sort(function (a, b) { return b.dia - a.dia; })[0];
    const through = rings.filter(function (r) { return r.depth == null; }).sort(function (a, b) { return a.dia - b.dia; })[0];

    const o = { x: g.x, y: g.y, name: baseName(g.names[0]) };
    if (seat) {
      o.seatD = seat.dia;
      if (seat.depth) o.depth = seat.depth;
      if (through && through.dia < seat.dia) o.apertureCA = through.dia; // сквозная = зона напыления
    } else if (through) {
      o.d = through.dia; // обычное сквозное отверстие без посадки
    } else if (rings[0]) {
      o.d = rings[0].dia;
    }
    o._notes = Array.from(new Set(g.notes));
    return o;
  });

  return holes;
}

function field(k, v) {
  if (v == null) return null;
  return k + ": " + (typeof v === "string" ? JSON.stringify(v) : v);
}

const file = process.argv[2];
if (!file) {
  console.error("Использование: node tools/import-holes-csv.js файл-holes.csv");
  process.exit(1);
}

const holes = build(file);
const body = holes.map(function (h, i) {
  const parts = [field("x", h.x), field("y", h.y), field("name", h.name),
    field("d", h.d), field("seatD", h.seatD), field("apertureCA", h.apertureCA),
    field("depth", h.depth)].filter(Boolean);
  const comma = i < holes.length - 1 ? "," : "";
  const note = h._notes && h._notes.length ? " // " + h._notes.join("; ") : "";
  return "  { " + parts.join(", ") + " }" + comma + note;
}).join("\n");

console.log("holes: [\n" + body + "\n]");
console.log("\n// групп-отверстий: " + holes.length + " (после слияния строк по общему центру).");
console.log("// Проверьте slotAvailable (где нужен паз под пинцет) и названия/стандартный d для свидетелей.");
