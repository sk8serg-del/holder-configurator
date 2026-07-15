/*
 * import-holes-csv.js — конвертирует выгрузку DumpHoles.iLogicVb в готовый
 * фрагмент js/catalog.js (массив holes для controlVariants).
 *
 * Запуск: node tools/import-holes-csv.js путь/к/имя-holes.csv
 * Результат печатается в консоль — вставить вручную в нужный disc/variant
 * в js/catalog.js и поправить slotAvailable/depth/seatD по месту.
 */
"use strict";
const fs = require("fs");

const file = process.argv[2];
if (!file) {
  console.error("Использование: node tools/import-holes-csv.js файл-holes.csv");
  process.exit(1);
}

const lines = fs.readFileSync(file, "utf8").replace(/^﻿/, "").split(/\r?\n/).filter(function (l) { return l.trim() !== ""; });

let cols = null;
const rows = [];
lines.forEach(function (line) {
  const f = line.split(";");
  if (f[0] === "columns") { cols = f.slice(1); return; }
  if (cols && f.length >= cols.length) {
    const row = {};
    cols.forEach(function (c, i) { row[c] = f[i]; });
    rows.push(row);
  }
});

if (!rows.length) {
  console.error("Отверстия не найдены — это файл из DumpHoles.iLogicVb?");
  process.exit(1);
}

function num(s) {
  if (s == null || s === "") return null;
  return Math.round(parseFloat(s) * 1000) / 1000;
}

const holes = rows.map(function (r) {
  var o = { x: num(r.x), y: num(r.y), name: r.name };
  if (r.diameter && parseFloat(r.diameter) > 0) o.d = num(r.diameter);
  if (r.depth !== "through") o.depth = num(r.depth);
  if (r.type === "counterbore" && r.extra1) o.seatD = num(r.extra1);
  if (r.type === "countersink") o._countersinkNote = "зенковка Ø" + r.extra1 + " угол " + r.extra2 + "° — перенести вручную";
  if (r.tapped === "yes") o._tappedNote = "резьбовое — seatD/CA задать вручную";
  return o;
});

function field(k, v) {
  if (v == null) return null;
  return k + ": " + (typeof v === "string" ? JSON.stringify(v) : v);
}

const body = holes.map(function (h, i) {
  var parts = [field("x", h.x), field("y", h.y), field("name", h.name), field("d", h.d),
    field("depth", h.depth), field("seatD", h.seatD)].filter(Boolean);
  var note = h._countersinkNote || h._tappedNote;
  var comma = i < holes.length - 1 ? "," : "";
  // запятая — сразу после объекта, комментарий — в конце строки, иначе при
  // вставке в catalog.js комментарий проглотит запятую и сломает массив
  return "  { " + parts.join(", ") + " }" + comma + (note ? " // " + note : "");
}).join("\n");

console.log("holes: [\n" + body + "\n]");
console.log("\n// найдено отверстий: " + holes.length + ". Проверьте slotAvailable там, где нужен паз под пинцет,");
console.log("// и вручную задайте seatD/apertureCA для отверстий без явного diameter в Inventor.");
