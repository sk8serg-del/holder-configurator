// Тест конвертера DumpHoles → каталог: слияние посадка+апертура по центру,
// отсев шума (границы, фланец) по --disc, устойчивость к концентрическому
// «съедаемому» отверстию. Запуск: node test/test-import-holes.js
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

// фрагмент реальной выгрузки Blank_320NEW: свидетели/Reference (посадка+апертура
// разными строками), 3 тех. отверстия, шум (границы Ø297.5/324.5, фланец R>149),
// а также тех. отверстие 3.3 строго в центре центрального свидетеля.
const csv = [
  "﻿holes-dump;1",
  "part;Blank_320NEW.ipt",
  "columns;name;x;y;diameter;depth;type;extra1;extra2;tapped",
  "Mounting2-1;4.1;156.446;6;through;drilled;;;no",
  "MaskThread-1;-157.5;0;0;through;drilled;;;yes",
  "TechnologicalHoles1;0;0;3.3;through;drilled;;;no",
  "TechnologicalHoles2-1;-19;0;3.3;through;drilled;;;no",
  "TechnologicalHoles2-2;9.5;-16.454;3.3;through;drilled;;;no",
  "TechnologicalHoles2-3;9.5;16.454;3.3;through;drilled;;;no",
  "Mountings-2;0;0;324.5;through;drilled;;;no",
  "MaskGroove-2;0;0;297.5;2;drilled;;;no",
  "WitnesCounterbore-1;0;0;297.5;4.5;drilled;;;no",
  "WitnesCounterbore-2;-13.527;110.173;25.6;4.5;drilled;;;no",
  "WitnesClearAperture;-13.527;110.173;22.6;through;drilled;;;no",
  "ReferenceCounterbore-3;-102.176;43.371;30.1;4;drilled;;;no",
  "ReferenceClearAperture-1;-102.176;43.371;30.1;through;drilled;;;no",
  "ReferenceClearAperture-2;-102.176;43.371;24.2;through;drilled;;;no",
  "WitnesCenterCounterbore-2;0;0;25.6;4.5;drilled;;;no",
  "WitnesCenterClearAperture-2;0;0;22.6;through;drilled;;;no"
].join("\n");

const tmp = path.join(os.tmpdir(), "hc-test-holes-" + process.pid + ".csv");
fs.writeFileSync(tmp, csv);

try {
  const holes = build(tmp, 298);
  const at = function (x, y) {
    return holes.find(function (h) { return Math.abs(h.x - x) < 0.2 && Math.abs(h.y - y) < 0.2; });
  };

  check("шум и фланец отброшены — ровно 6 отверстий", holes.length === 6, String(holes.length));
  check("фланцевые Mounting/MaskThread вне зоны отсутствуют",
    !at(4.1, 156.446) && !at(-157.5, 0));

  const center = at(0, 0);
  check("центральный свидетель: посадка 25.6, апертура 22.6 (не 3.3!), глубина 4.5",
    center && center.seatD === 25.6 && center.apertureCA === 22.6 && center.depth === 4.5,
    center && JSON.stringify(center));

  const wit = at(-13.527, 110.173);
  check("свидетель на R111: посадка 25.6 / апертура 22.6 / глубина 4.5",
    wit && wit.seatD === 25.6 && wit.apertureCA === 22.6 && wit.depth === 4.5,
    wit && JSON.stringify(wit));

  const ref = at(-102.176, 43.371);
  check("Reference: посадка 30.1 / апертура 24.2 (не равная посадке) / глубина 4",
    ref && ref.seatD === 30.1 && ref.apertureCA === 24.2 && ref.depth === 4,
    ref && JSON.stringify(ref));

  const tech = holes.filter(function (h) { return h.d === 3.3; });
  check("3 технологических отверстия Ø3.3 (тот, что в центре, поглощён свидетелем)",
    tech.length === 3, String(tech.length));
} finally {
  fs.unlinkSync(tmp);
}

console.log(failures ? "\nПРОВАЛЕНО: " + failures : "\nТест импорта отверстий пройден.");
process.exit(failures ? 1 : 0);
