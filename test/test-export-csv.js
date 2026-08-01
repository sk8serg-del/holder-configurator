// Тест экспорта CSV для Inventor: угол паза в CSV должен совпадать с тем, что
// реально стоит в раскладке (p.slotAngle) — а не пересчитываться радиально.
// Регрессия: для деталей гекс-сетки (slotAngle=90°, вертикаль) CSV резал паз
// радиально (atan2), из-за чего модель в Inventor не совпадала со страницей.
// Запуск: node test/test-export-csv.js
"use strict";
require("../js/geometry.js");
require("../js/export-csv.js");
var HC = globalThis.HC;

var failures = 0;
function check(name, cond, detail) {
  if (cond) console.log("  ok   " + name);
  else { failures++; console.log("  FAIL " + name + (detail ? " — " + detail : "")); }
}

function parseRow(csv, cx) {
  var line = csv.split(/\r?\n/).find(function (l) { return l.indexOf(";" + cx + ";") !== -1; });
  if (!line) return null;
  var f = line.split(";");
  // columns: kind;type;cx;cy;d;w;h;chamfer;rot;seatD;caDia;seatGap;caInset;slot;slotAngle;slotL;slotW;depth;markX;markY;markCount
  return { cx: f[2], cy: f[3], slot: f[13], slotAngle: f[14], markX: f[18], markY: f[19], markCount: f[20] };
}

// деталь из обычной гекс-сетки: slotAngle=90 (вертикаль), НЕ радиально
// (позиция (-13.527,110.173) даёт atan2 ≈ 96.99°, заметно отличается от 90°)
var order = {
  id: "T1", date: "2026-01-01", customer: { name: "T", org: "" },
  disc: { id: "d", name: "Диск", diameter: 298, thickness: 6 },
  clearances: { pp: 6, pe: 3, pc: 6 },
  controlHoles: [],
  placed: [
    { type: "circle", cx: -13.527, cy: 110.173, d: 25.4, seatD: 25.6, apertureCA: 22.6, slotOn: true, slotAngle: 90 }
  ]
};
var csv = HC.buildCSV(order);
var row = parseRow(csv, -13.527);
check("угол паза в CSV = 90 (из раскладки), а не atan2 ≈ 96.99 (радиально)",
  row && Math.abs(parseFloat(row.slotAngle) - 90) < 1e-6, row && row.slotAngle);

// деталь из кольцевой раскладки: slotAngle уже посчитан радиально самим
// раскладчиком (atan2) — в CSV должен уйти этот же угол без изменений
var orderRing = {
  id: "T2", date: "2026-01-01", customer: { name: "T", org: "" },
  disc: { id: "d", name: "Диск", diameter: 298, thickness: 6 },
  clearances: { pp: 6, pe: 3, pc: 6 },
  controlHoles: [],
  placed: [
    { type: "circle", cx: 30, cy: 40, d: 25.4, seatD: 25.6, apertureCA: 22.6, slotOn: true, slotAngle: Math.atan2(40, 30) * 180 / Math.PI }
  ]
};
var csvRing = HC.buildCSV(orderRing);
var rowRing = parseRow(csvRing, 30);
var expectedRing = Math.atan2(40, 30) * 180 / Math.PI;
check("угол паза кольцевой раскладки в CSV совпадает с радиальным (atan2)",
  rowRing && Math.abs(parseFloat(rowRing.slotAngle) - expectedRing) < 1e-3,
  rowRing && rowRing.slotAngle + " vs " + expectedRing);

// контрольное отверстие: своего slotAngle не хранит — CSV считает радиально
// (как и render.js), запасной путь в slotGeom должен сработать
var orderCtrl = {
  id: "T3", date: "2026-01-01", customer: { name: "T", org: "" },
  disc: { id: "d", name: "Диск", diameter: 298, thickness: 6 },
  clearances: { pp: 6, pe: 3, pc: 6 },
  controlHoles: [{ x: -13.527, y: 110.173, d: 25.4, seatD: 25.6, apertureCA: 22.6, slotOn: true }],
  placed: []
};
var csvCtrl = HC.buildCSV(orderCtrl);
var rowCtrl = parseRow(csvCtrl, -13.527);
var expectedCtrl = Math.atan2(110.173, -13.527) * 180 / Math.PI;
check("угол паза контрольного отверстия — радиально (нет своего slotAngle)",
  rowCtrl && Math.abs(parseFloat(rowCtrl.slotAngle) - expectedCtrl) < 1e-3,
  rowCtrl && rowCtrl.slotAngle + " vs " + expectedCtrl);

// --- метка-ориентир (markX/markY): только у ДЕТАЛЕЙ с пазом, в 2мм от
// посадки и в 2мм от паза; у контрольных отверстий и у деталей без паза —
// пусто (метка не режется) ---
check("метка-ориентир: у детали гекс-сетки задана и ровно в 2мм от посадки",
  row && row.markX !== "" && row.markY !== "" &&
  Math.abs(Math.hypot(parseFloat(row.markX) - (-13.527), parseFloat(row.markY) - 110.173) - (25.6 / 2 + 2)) < 1e-3,
  row && row.markX + "," + row.markY);

check("метка-ориентир: у детали кольцевой раскладки тоже задана",
  rowRing && rowRing.markX !== "" && rowRing.markY !== "",
  rowRing && rowRing.markX + "," + rowRing.markY);

check("метка-ориентир: у контрольного отверстия НЕ ставится (даже если есть паз)",
  rowCtrl && rowCtrl.markX === "" && rowCtrl.markY === "",
  rowCtrl && rowCtrl.markX + "," + rowCtrl.markY);

var orderNoSlot = {
  id: "T4", date: "2026-01-01", customer: { name: "T", org: "" },
  disc: { id: "d", name: "Диск", diameter: 298, thickness: 6 },
  clearances: { pp: 6, pe: 3, pc: 6 },
  controlHoles: [],
  placed: [{ type: "circle", cx: 50, cy: 0, d: 25.4, seatD: 25.6, apertureCA: 22.6, slotOn: false }]
};
var rowNoSlot = parseRow(HC.buildCSV(orderNoSlot), 50);
check("метка-ориентир: у детали без паза — пусто",
  rowNoSlot && rowNoSlot.markX === "" && rowNoSlot.markY === "",
  rowNoSlot && rowNoSlot.markX + "," + rowNoSlot.markY);

// --- markCount = номер разновидности детали (partIndex+1): 1-я деталь в
// заказе — 1 метка, 2-я — 2, 3-я — 3. Контрольные отверстия — всегда 0/пусто. ---
var orderMulti = {
  id: "T5", date: "2026-01-01", customer: { name: "T", org: "" },
  disc: { id: "d", name: "Диск", diameter: 298, thickness: 6 },
  clearances: { pp: 6, pe: 3, pc: 6 },
  controlHoles: [{ x: -13.527, y: 110.173, d: 25.4, seatD: 25.6, apertureCA: 22.6, slotOn: true }],
  placed: [
    { type: "circle", cx: 0, cy: 0, d: 10, seatD: 10.2, apertureCA: 9, slotOn: true, slotAngle: 0, partIndex: 0 },
    { type: "circle", cx: 40, cy: 0, d: 12, seatD: 12.2, apertureCA: 11, slotOn: true, slotAngle: 0, partIndex: 1 },
    { type: "circle", cx: 80, cy: 0, d: 14, seatD: 14.2, apertureCA: 13, slotOn: true, slotAngle: 0, partIndex: 2 }
  ]
};
var csvMulti = HC.buildCSV(orderMulti);
var r1 = parseRow(csvMulti, 0), r2 = parseRow(csvMulti, 40), r3 = parseRow(csvMulti, 80);
var rCtrlMulti = parseRow(csvMulti, -13.527);
check("markCount: 1-я разновидность детали — 1 метка", r1 && r1.markCount === "1", r1 && r1.markCount);
check("markCount: 2-я разновидность детали — 2 метки", r2 && r2.markCount === "2", r2 && r2.markCount);
check("markCount: 3-я разновидность детали — 3 метки", r3 && r3.markCount === "3", r3 && r3.markCount);
check("markCount: у контрольного отверстия — пусто (0)", rCtrlMulti && rCtrlMulti.markCount === "", rCtrlMulti && rCtrlMulti.markCount);

check("строка mark в заголовке несёт шаг между метками (3-е значение)",
  csvMulti.split(/\r?\n/).some(function (l) { return /^mark;[\d.]+;[\d.]+;[\d.]+$/.test(l); }),
  csvMulti.split(/\r?\n/).find(function (l) { return l.indexOf("mark;") === 0; }));

console.log(failures ? "\nПРОВАЛЕНО: " + failures : "\nТест экспорта CSV пройден.");
process.exit(failures ? 1 : 0);
