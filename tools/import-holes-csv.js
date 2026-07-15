/*
 * import-holes-csv.js — CLI над js/holder-import.js: печатает фрагмент записи
 * диска (blankDiameter, fixtures, holes) из выгрузки DumpHoles.iLogicVb.
 *
 * Запуск: node tools/import-holes-csv.js файл-holes.csv [--disc 298]
 *
 * (Ту же логику использует кнопка «Загрузить подложку» на странице —
 * см. HC.holderImport в js/holder-import.js.)
 */
"use strict";
const fs = require("fs");
const path = require("path");
require(path.join(__dirname, "..", "js", "holder-import.js"));
const HI = globalThis.HC.holderImport;

// совместимость со старым API теста
const build = function (file, discDia) { return HI.buildFromCSV(fs.readFileSync(file, "utf8"), discDia); };
module.exports = { build: build, parseCSV: HI.parseCSV, buildFromCSV: HI.buildFromCSV, buildDiscEntry: HI.buildDiscEntry };

function fnum(v) { return typeof v === "number" ? v : JSON.stringify(v); }
function ptsStr(points) { return "[" + points.map(function (p) { return "[" + fnum(p[0]) + ", " + fnum(p[1]) + "]"; }).join(", ") + "]"; }

function fixturesStr(fx) {
  const lines = ["fixtures: {", "  holes: ["];
  fx.holes.forEach(function (h, i) {
    lines.push('    { d: ' + fnum(h.d) + ', label: ' + JSON.stringify(h.label) + ', points: ' + ptsStr(h.points) + " }" + (i < fx.holes.length - 1 ? "," : ""));
  });
  lines.push("  ],", "  cutouts: [");
  fx.cutouts.forEach(function (c, i) {
    const depth = c.depth != null ? ", depth: " + fnum(c.depth) : "";
    lines.push('    { label: ' + JSON.stringify(c.label) + depth + ", points: " + ptsStr(c.points) + " }" + (i < fx.cutouts.length - 1 ? "," : ""));
  });
  lines.push("  ]", "}");
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
  const res = HI.buildFromCSV(fs.readFileSync(file, "utf8"), discDia);
  if (!res) { console.error("Отверстия не найдены — это файл из DumpHoles.iLogicVb?"); process.exit(1); }
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
    ", вырезов " + res.fixtures.cutouts.length + ".");
}
