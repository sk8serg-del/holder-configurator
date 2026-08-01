// Тест конструктора болванки (js/blank-builder.js): координаты свидетелей
// (полярные/декартовы), точки крепежа (по диаметру+количеству / точный список),
// итоговая запись каталога. Чистая логика, без DOM. Запуск: node test/test-blank-builder.js
"use strict";
const path = require("path");
global.HC = {};
require(path.join(__dirname, "..", "js", "blank-builder.js"));
const HC = globalThis.HC;

let failures = 0;
function check(name, cond, detail) {
  if (cond) console.log("  ok   " + name);
  else { failures++; console.log("  FAIL " + name + (detail ? " — " + detail : "")); }
}

// --- координаты свидетеля: полярные (диаметр расположения → радиус, угол) ---
const xyPolar = HC.blankBuilder.witnessXY({ mode: "polar", r: 150, angle: 90 });
check("полярные координаты: угол 90° → (0, r)", Math.abs(xyPolar[0]) < 1e-6 && Math.abs(xyPolar[1] - 150) < 1e-6, xyPolar.join(","));
const xyPolar0 = HC.blankBuilder.witnessXY({ mode: "polar", r: 100, angle: 0 });
check("полярные координаты: угол 0° → (r, 0)", Math.abs(xyPolar0[0] - 100) < 1e-6 && Math.abs(xyPolar0[1]) < 1e-6, xyPolar0.join(","));

// --- координаты свидетеля: декартовы (точные X,Y) ---
const xyExact = HC.blankBuilder.witnessXY({ mode: "xy", x: -12.5, y: 33.25 });
check("декартовы координаты — как есть", xyExact[0] === -12.5 && xyExact[1] === 33.25, xyExact.join(","));

// --- точки крепёжной группы: по диаметру расположения + количеству (равномерно) ---
const ptsDiam = HC.blankBuilder.fixtureGroupPoints({ mode: "diameter", r: 100, count: 4 });
check("fixtureGroupPoints (диаметр+кол-во): 4 точки", ptsDiam.length === 4, String(ptsDiam.length));
check("fixtureGroupPoints: первая точка на (r,0)", Math.abs(ptsDiam[0][0] - 100) < 1e-6 && Math.abs(ptsDiam[0][1]) < 1e-6, ptsDiam[0].join(","));
check("fixtureGroupPoints: третья точка на (-r,0) (180°)", Math.abs(ptsDiam[2][0] + 100) < 1e-6 && Math.abs(ptsDiam[2][1]) < 1e-6, ptsDiam[2].join(","));

// --- поворот (rotation) сдвигает начальную точку по кругу ---
const ptsRot = HC.blankBuilder.fixtureGroupPoints({ mode: "diameter", r: 100, count: 4, rotation: 90 });
check("fixtureGroupPoints: поворот 90° — первая точка на (0,r)", Math.abs(ptsRot[0][0]) < 1e-6 && Math.abs(ptsRot[0][1] - 100) < 1e-6, ptsRot[0].join(","));

// --- точные координаты крепежа: одна точка на группу (как у свидетеля) ---
const ptsXY = HC.blankBuilder.fixtureGroupPoints({ mode: "xy", x: 12.5, y: -30 });
check("fixtureGroupPoints (точные координаты): ровно одна точка", ptsXY.length === 1 && ptsXY[0][0] === 12.5 && ptsXY[0][1] === -30, JSON.stringify(ptsXY));

// --- итоговая запись каталога: свидетели + крепёж + занижение по краю ---
const entry = HC.blankBuilder.buildManualDiscEntry({
  id: "user-test", name: "Тестовая болванка", installation: "Ortus 900", description: "тестовая запись",
  diameter: 300, thickness: 6,
  edgeRecess: { side: "top", diameter: 260, depth: 1.5 },
  witnesses: [
    { name: "Свидетель Центр", mode: "xy", x: 0, y: 0, d: 25.4, seatD: 25.6, apertureCA: 22.6, depth: 4.5, slotAvailable: true, slotAngle: 45 },
    { name: "Reference", mode: "polar", r: 110, angle: 180, seatD: 30.1, apertureCA: 24.2, depth: 3, slotAvailable: false }
  ],
  fixtureGroups: [
    { label: "Крепёж", d: 3.3, mode: "diameter", r: 160, count: 3, rotation: 30 }
  ]
});
check("запись: диаметр/толщина сохранены", entry.diameter === 300 && entry.thickness === 6);
check("запись: installation/description сохранены", entry.installation === "Ortus 900" && entry.description === "тестовая запись",
  JSON.stringify([entry.installation, entry.description]));
check("запись: edgeRecess перенесён как есть", entry.edgeRecess.side === "top" && entry.edgeRecess.diameter === 260 && entry.edgeRecess.depth === 1.5, JSON.stringify(entry.edgeRecess));
check("запись: 2 варианта контрольных отверстий (std + none)", entry.controlVariants.length === 2);
check("запись: в std — 2 свидетеля/reference", entry.controlVariants[0].holes.length === 2, String(entry.controlVariants[0].holes.length));
check("запись: Reference на (-110, 0) (угол 180°)", Math.abs(entry.controlVariants[0].holes[1].x + 110) < 1e-6 && Math.abs(entry.controlVariants[0].holes[1].y) < 1e-6);
check("запись: в none — пусто", entry.controlVariants[1].holes.length === 0);
check("запись: fixtures.holes — 1 группа, 3 точки", entry.fixtures.holes.length === 1 && entry.fixtures.holes[0].points.length === 3);
check("запись: fixtures.holes диаметр 3.3 по умолчанию", entry.fixtures.holes[0].d === 3.3);
check("запись: поворот крепежа (30°) сместил первую точку", Math.abs(entry.fixtures.holes[0].points[0][0] - 160 * Math.cos(Math.PI / 6)) < 0.01,
  JSON.stringify(entry.fixtures.holes[0].points[0]));
check("запись: паз/ориентация свидетеля сохранены (slotAvailable+slotAngle=45)",
  entry.controlVariants[0].holes[0].slotAvailable === true && entry.controlVariants[0].holes[0].slotAngle === 45,
  JSON.stringify(entry.controlVariants[0].holes[0]));
check("запись: без паза (slotAvailable=false) — slotAngle не пишется",
  entry.controlVariants[0].holes[1].slotAvailable === false && entry.controlVariants[0].holes[1].slotAngle === undefined,
  JSON.stringify(entry.controlVariants[0].holes[1]));

// --- пустое занижение по краю (не задано) не попадает в запись ---
const entryNoRecess = HC.blankBuilder.buildManualDiscEntry({ id: "x", name: "N", diameter: 200, thickness: 6, edgeRecess: null, witnesses: [], fixtureGroups: [] });
check("запись без edgeRecess: поле отсутствует", entryNoRecess.edgeRecess === undefined);
check("запись без крепежа: fixtures.holes пуст", entryNoRecess.fixtures.holes.length === 0);

// --- крепёжная группа в режиме точных координат без заданных X/Y — точка по умолчанию (0,0) ---
const entryDefaultXY = HC.blankBuilder.buildManualDiscEntry({
  id: "x", name: "N", diameter: 200, thickness: 6, witnesses: [],
  fixtureGroups: [{ label: "Без координат", d: 3.3, mode: "xy" }]
});
check("запись: крепёж xy без явных координат — точка (0,0)",
  entryDefaultXY.fixtures.holes.length === 1 && entryDefaultXY.fixtures.holes[0].points[0][0] === 0 && entryDefaultXY.fixtures.holes[0].points[0][1] === 0,
  JSON.stringify(entryDefaultXY.fixtures.holes));

console.log(failures ? "\nПРОВАЛЕНО: " + failures : "\nТест конструктора болванки пройден.");
process.exit(failures ? 1 : 0);
