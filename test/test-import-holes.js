// Тест конвертера DumpHoles → каталог: слияние посадка+апертура, маршрутизация
// (контрольные внутри зоны / крепёж на фланце / фигурные контуры), Ø болванки,
// резьбовые без диаметра. Запуск: node test/test-import-holes.js
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const { build } = require(path.join(__dirname, "..", "tools", "import-holes-csv.js"));

let failures = 0;
function check(name, cond, detail) {
  if (cond) console.log("  ok   " + name);
  else { failures++; console.log("  FAIL " + name + (detail ? " — " + detail : "")); }
}

// фрагмент реальной выгрузки Blank_320NEW + фигурный контур Mountings
const csv = [
  "﻿holes-dump;1",
  "part;Blank_320NEW.ipt",
  "columns;name;x;y;diameter;depth;type;extra1;extra2;tapped",
  // фланцевый крепёж (вне полезной зоны, R>149)
  "Mounting2-1;4.1;156.446;6;through;drilled;;;no",
  "Mounting2-2;133.436;-81.774;6;through;drilled;;;no",
  "Mounting2-3;-137.536;-74.672;6;through;drilled;;;no",
  "Pins-1;-135.533;78.25;6.6;through;drilled;;;no",
  "Pins-2;119.886;100.596;6.6;through;drilled;;;no",
  "TechnologicaPins-2;40.635;151.65;4;10;drilled;;;no",
  "MaskThread-1;-157.5;0;0;through;drilled;;;yes",
  "MaskThread-2;157.5;0;0;through;drilled;;;yes",
  // технологические у центра (внутри зоны)
  "TechnologicalHoles1;0;0;3.3;through;drilled;;;no",
  "TechnologicalHoles2-1;-19;0;3.3;through;drilled;;;no",
  "TechnologicalHoles2-2;9.5;-16.454;3.3;through;drilled;;;no",
  "TechnologicalHoles2-3;9.5;16.454;3.3;through;drilled;;;no",
  // шум-границы (Ø>0.9·298) — дают blankDiameter, но не отверстия
  "MaskGroove-2;0;0;297.5;2;drilled;;;no",
  "Mountings-2;0;0;324.5;through;drilled;;;no",
  // свидетели/Reference (посадка+апертура) внутри зоны
  "WitnesCounterbore-2;-13.527;110.173;25.6;4.5;drilled;;;no",
  "WitnesClearAperture;-13.527;110.173;22.6;through;drilled;;;no",
  "ReferenceCounterbore-3;-102.176;43.371;30.1;4;drilled;;;no",
  "ReferenceClearAperture-2;-102.176;43.371;24.2;through;drilled;;;no",
  "WitnesCenterCounterbore-2;0;0;25.6;4.5;drilled;;;no",
  "WitnesCenterClearAperture-2;0;0;22.6;through;drilled;;;no",
  // фигурный вырез (контур) на фланце — реальный вырез, оставляем
  "contour;Mountings;through;-140;60;-120;70;-125;90;-145;82",
  // контур внутри полезной зоны — обводка посадки свидетеля (паз), отбрасываем
  "contour;WitnesCounterbore;4.5;-16.6;98.9;-3.3;115.9;-10.4;121.5;-23.7;104.4"
].join("\n");

const tmp = path.join(os.tmpdir(), "hc-test-holes-" + process.pid + ".csv");
fs.writeFileSync(tmp, csv);

try {
  const res = build(tmp, 298);
  const at = function (arr, x, y) {
    return arr.find(function (h) { return Math.abs(h.x - x) < 0.2 && Math.abs(h.y - y) < 0.2; });
  };

  check("blankDiameter = 324.5 (самая большая окружность)", res.blankDiameter === 324.5, String(res.blankDiameter));

  // --- контрольные отверстия (внутри полезной зоны) ---
  const center = at(res.holes, 0, 0);
  check("центральный свидетель: посадка 25.6 / апертура 22.6 (не 3.3) / глубина 4.5",
    center && center.seatD === 25.6 && center.apertureCA === 22.6 && center.depth === 4.5,
    center && JSON.stringify(center));
  check("Reference: посадка 30.1 / апертура 24.2 / глубина 4",
    (function () { const r = at(res.holes, -102.176, 43.371); return r && r.seatD === 30.1 && r.apertureCA === 24.2 && r.depth === 4; })());
  check("3 технологических Ø3.3 внутри зоны (центральный поглощён свидетелем)",
    res.holes.filter(function (h) { return h.d === 3.3; }).length === 3);
  check("фланцевого крепежа НЕТ в контрольных отверстиях",
    !res.holes.some(function (h) { return Math.sqrt(h.x * h.x + h.y * h.y) > 149; }));

  // --- fixtures: фланцевый крепёж по группам Ø ---
  const byD = {};
  res.fixtures.holes.forEach(function (g) { byD[g.d] = g.points.length; });
  check("крепёж сгруппирован по Ø: 3×Ø6, 2×Ø6.6, 1×Ø4",
    byD[6] === 3 && byD[6.6] === 2 && byD[4] === 1, JSON.stringify(byD));
  check("крепёж вынесен из полезной зоны в fixtures (центры за R149)",
    res.fixtures.holes.every(function (g) { return g.points.every(function (p) { return Math.sqrt(p[0] * p[0] + p[1] * p[1]) > 149; }); }));

  // --- fixtures: фигурный вырез ---
  check("фланцевый контур Mountings → fixtures.cutouts; внутризонная обводка свидетеля отброшена",
    res.fixtures.cutouts.length === 1 && res.fixtures.cutouts[0].label === "Mountings" && res.fixtures.cutouts[0].points.length === 4,
    JSON.stringify(res.fixtures.cutouts));

  // --- резьбовые без Ø ---
  check("резьбовые (Ø0) вынесены в threadPoints для ручного ввода (2 шт.)",
    res.threadPoints.length === 2, String(res.threadPoints.length));
  check("резьбовых НЕТ среди крепежа с Ø (Инвентор не дал их диаметр)",
    !res.fixtures.holes.some(function (g) { return g.d === 0; }));
} finally {
  fs.unlinkSync(tmp);
}

console.log(failures ? "\nПРОВАЛЕНО: " + failures : "\nТест импорта отверстий пройден.");
process.exit(failures ? 1 : 0);
