/*
 * test-packer.js — численная проверка раскладки: все зазоры соблюдены,
 * количества соответствуют режимам. Запуск: node test/test-packer.js
 */
"use strict";
require("../js/geometry.js");
require("../js/packer.js");
var HC = globalThis.HC;

var failures = 0;
function check(name, cond, detail) {
  if (cond) console.log("  ok   " + name);
  else { failures++; console.log("  FAIL " + name + (detail ? " — " + detail : "")); }
}

// проверяем фактические минимальные расстояния в готовой раскладке
function verifyLayout(name, opts, res) {
  var R = opts.discDiameter / 2;
  var cl = opts.clearances;
  var keepouts = (opts.controlHoles || []).map(function (h) {
    // как в самом упаковщике: занятая зона — по Ø посадки, если задан, иначе по d
    // (у некоторых КО, напр. Reference, задан только seatD, без d)
    return { type: "circle", cx: h.x, cy: h.y, d: h.seatD != null ? h.seatD : h.d };
  });
  var placed = res.placed;
  var minPP = Infinity, minPE = Infinity, minPC = Infinity;
  for (var i = 0; i < placed.length; i++) {
    minPE = Math.min(minPE, HC.geom.edgeDist(placed[i], R));
    for (var k = 0; k < keepouts.length; k++) {
      minPC = Math.min(minPC, HC.geom.placementDist(placed[i], keepouts[k]));
    }
    for (var j = i + 1; j < placed.length; j++) {
      minPP = Math.min(minPP, HC.geom.placementDist(placed[i], placed[j]));
    }
  }
  var T = 1e-4; // допуск на плавающую точку
  check(name + ": деталь–деталь ≥ " + cl.pp, placed.length < 2 || minPP >= cl.pp - T, "факт " + minPP);
  check(name + ": деталь–край ≥ " + cl.pe, placed.length === 0 || minPE >= cl.pe - T, "факт " + minPE);
  if (keepouts.length) {
    check(name + ": деталь–контр.отв. ≥ " + cl.pc, placed.length === 0 || minPC >= cl.pc - T, "факт " + minPC);
  }
}

var t0 = Date.now();

// --- 1. Круги Ø10 на диске Ø100, максимум ---
var opts1 = {
  discDiameter: 100,
  controlHoles: [],
  clearances: { pp: 2, pe: 3, pc: 2 },
  parts: [{ type: "circle", d: 10, qty: null }]
};
var res1 = HC.pack(opts1);
console.log("1) круги Ø10 / диск Ø100: размещено " + res1.placed.length);
check("1: разумное количество (30…50)", res1.placed.length >= 30 && res1.placed.length <= 50, String(res1.placed.length));
verifyLayout("1", opts1, res1);
check("1: паз кругов гекс-сетки направлен по высоте треугольника (90°)",
  res1.placed.every(function (p) { return p.slotAngle === 90; }),
  res1.placed.map(function (p) { return p.slotAngle; }).slice(0, 3).join(","));

// --- 1c. Круги с пазом в гекс-сетке: без изотропного запаса, но зазор точен ---
// (раньше добавлялся изотропный запас на все стороны — по факту нужен только
// по диагонали строк, где паз частично «смотрит» на соседа; вдоль ряда паз
// перпендикулярен и не мешает вовсе)
var opts1c = {
  discDiameter: 298, controlHoles: [], clearances: { pp: 6, pe: 3, pc: 6 },
  parts: [{ type: "circle", d: 25.4, seatD: 25.6, slotOn: true, qty: null, orientation: "fixed", anchor: { mode: "center" } }]
};
var res1c = HC.pack(opts1c);
var minPP1c = Infinity;
for (var i1c = 0; i1c < res1c.placed.length; i1c++) {
  for (var j1c = i1c + 1; j1c < res1c.placed.length; j1c++) {
    minPP1c = Math.min(minPP1c, HC.geom.placementDist(res1c.placed[i1c], res1c.placed[j1c]));
  }
}
check("1c: с пазом реальный (точный, по контуру посадка+паз) зазор ≥ 6",
  res1c.placed.length > 1 && minPP1c >= 6 - 1e-3, "мин. факт " + minPP1c);
// сравнение со старой изотропной формулой: (seatD-d)/2 + 2.5 запаса на ВСЕ стороны
var oldPad1c = Math.max(0, (25.6 - 25.4) / 2) + 2.5;
var oldMinPP1c = 25.4 + 2 * oldPad1c; // круг-круг расстояние при старом шаге (d+pp+2·oldPad) минус d
check("1c: зазор заметно меньше старого изотропного (плотнее упаковка)",
  minPP1c < oldMinPP1c - 1, "факт " + minPP1c.toFixed(2) + " vs старое было бы " + oldMinPP1c.toFixed(2));

// --- 1b. Круги по краю (кольца): паз радиальный ---
var opts1b = {
  discDiameter: 298, controlHoles: [], clearances: { pp: 6, pe: 3, pc: 6 },
  parts: [{ type: "circle", d: 25.4, qty: 8, orientation: "fixed", anchor: { mode: "edge" } }]
};
var res1b = HC.pack(opts1b);
check("1b: паз кругов на кольцах — радиальный (slotAngle = atan2)",
  res1b.placed.length > 0 && res1b.placed.every(function (p) {
    return Math.abs(p.slotAngle - Math.atan2(p.cy, p.cx) * 180 / Math.PI) < 1e-6;
  }));

// --- 2. То же + контрольные отверстия 3×Ø4 на R40 ---
var opts2 = {
  discDiameter: 100,
  controlHoles: [
    { x: 40, y: 0, d: 4 },
    { x: -20, y: 34.641, d: 4 },
    { x: -20, y: -34.641, d: 4 }
  ],
  clearances: { pp: 2, pe: 3, pc: 3 },
  parts: [{ type: "circle", d: 10, qty: null }]
};
var res2 = HC.pack(opts2);
console.log("2) с контрольными отверстиями: размещено " + res2.placed.length);
check("2: есть детали и не больше, чем без КО", res2.placed.length > 0 && res2.placed.length <= res1.placed.length);
verifyLayout("2", opts2, res2);

// --- 3. Режим «N штук»: ровно 5 ---
var opts3 = {
  discDiameter: 100,
  controlHoles: [],
  clearances: { pp: 2, pe: 3, pc: 2 },
  parts: [{ type: "circle", d: 10, qty: 5 }]
};
var res3 = HC.pack(opts3);
check("3: ровно 5 из 5", res3.placed.length === 5 && res3.perPart[0].placed === 5, String(res3.placed.length));

// --- 4. Запрошено больше, чем влезает ---
var opts4 = {
  discDiameter: 100,
  controlHoles: [],
  clearances: { pp: 2, pe: 3, pc: 2 },
  parts: [{ type: "circle", d: 10, qty: 500 }]
};
var res4 = HC.pack(opts4);
check("4: влезло меньше 500 и отчёт честный",
  res4.placed.length < 500 &&
  res4.perPart[0].requested === 500 &&
  res4.perPart[0].placed === res4.placed.length,
  res4.perPart[0].placed + " из 500");

// --- 5. Прямоугольники 20×10, поворот разрешён vs запрещён ---
var base5 = {
  discDiameter: 150,
  controlHoles: [],
  clearances: { pp: 2, pe: 5, pc: 2 }
};
var res5fix = HC.pack(Object.assign({}, base5, { parts: [{ type: "rect", w: 20, h: 10, qty: null, allowRotate: false }] }));
var res5rot = HC.pack(Object.assign({}, base5, { parts: [{ type: "rect", w: 20, h: 10, qty: null, allowRotate: true }] }));
console.log("5) прямоугольники 20×10: без поворота " + res5fix.placed.length + ", с поворотом " + res5rot.placed.length);
check("5: размещены (>20)", res5fix.placed.length > 20);
check("5: поворот не ухудшает", res5rot.placed.length >= res5fix.placed.length);
check("5: без поворота все rot=0", res5fix.placed.every(function (p) { return (p.rot || 0) === 0; }));
verifyLayout("5-fix", Object.assign({}, base5, { parts: [] }), res5fix);
verifyLayout("5-rot", Object.assign({}, base5, { parts: [] }), res5rot);

// --- 6. Восьмиугольники 20×12 фаска 3 ---
var opts6 = {
  discDiameter: 150,
  controlHoles: [{ x: 0, y: 0, d: 8 }],
  clearances: { pp: 2, pe: 5, pc: 3 },
  parts: [{ type: "oct", w: 20, h: 12, chamfer: 3, qty: null, allowRotate: true }]
};
var res6 = HC.pack(opts6);
console.log("6) восьмиугольники 20×12×3: размещено " + res6.placed.length);
check("6: размещены (>15)", res6.placed.length > 15, String(res6.placed.length));
verifyLayout("6", opts6, res6);

// --- 7. Смешанный заказ: круги Ø15 (3 шт) + прямоугольники 12×8 (максимум) ---
var opts7 = {
  discDiameter: 100,
  controlHoles: [{ x: 40, y: 0, d: 4 }],
  clearances: { pp: 2, pe: 3, pc: 2 },
  parts: [
    { type: "circle", d: 15, qty: 3 },
    { type: "rect", w: 12, h: 8, qty: null, allowRotate: true }
  ]
};
var res7 = HC.pack(opts7);
console.log("7) смешанный: кругов " + res7.perPart[0].placed + ", прямоугольников " + res7.perPart[1].placed);
check("7: круги ровно 3", res7.perPart[0].placed === 3);
check("7: прямоугольники есть (>5)", res7.perPart[1].placed > 5, String(res7.perPart[1].placed));
check("7: partIndex сохранён", res7.placed.some(function (p) { return p.partIndex === 0; }) &&
  res7.placed.some(function (p) { return p.partIndex === 1; }));
verifyLayout("7", opts7, res7);

// --- 8. Деталь больше диска — не падаем, размещаем 0 ---
var res8 = HC.pack({
  discDiameter: 100,
  controlHoles: [],
  clearances: { pp: 2, pe: 3, pc: 2 },
  parts: [{ type: "circle", d: 120, qty: null }]
});
check("8: слишком большая деталь → 0 без ошибок", res8.placed.length === 0);

// --- 9. Восьмиугольник с фаской 0 совпадает с прямоугольником ---
var octPoly = HC.geom.octPoly(0, 0, 20, 10, 0, 0);
var rectPoly = HC.geom.rectPoly(0, 0, 20, 10, 0);
check("9: oct(фаска 0) эквивалентен rect по расстоянию",
  Math.abs(HC.geom.placementDist(
    { type: "oct", cx: 0, cy: 0, w: 20, h: 10, chamfer: 0, rot: 0 },
    { type: "circle", cx: 30, cy: 0, d: 10 }
  ) - 15) < 1e-6);

// --- 10. Радиальная ориентация: ширина вдоль радиуса, максимум ---
var opts10 = {
  discDiameter: 298,
  controlHoles: [
    { x: 0, y: 0, d: 23 },
    { x: -110.173, y: -13.527, d: 24.7 },
    { x: -43.371, y: -102.176, d: 24.7 }
  ],
  clearances: { pp: 6, pe: 3, pc: 6 },
  parts: [{ type: "rect", w: 20, h: 10, qty: null, orientation: "radial-w" }]
};
var res10 = HC.pack(opts10);
console.log("10) радиально (ширина по R) 20×10 на Ø298: размещено " + res10.placed.length);
check("10: размещено достаточно (>50)", res10.placed.length > 50, String(res10.placed.length));
verifyLayout("10", opts10, res10);
function angDelta(aDeg, bDeg) {
  var d = Math.abs(aDeg - bDeg) % 180;
  return Math.min(d, 180 - d);
}
check("10: ширина каждой детали — вдоль радиуса", res10.placed.every(function (p) {
  var th = (Math.atan2(p.cy, p.cx) * 180) / Math.PI;
  return angDelta(p.rot, th) < 1e-6;
}));

// --- 11. Радиальная: высота вдоль радиуса (восьмиугольники) ---
var opts11 = Object.assign({}, opts10, {
  parts: [{ type: "oct", w: 20, h: 10, chamfer: 2, qty: null, orientation: "radial-h" }]
});
var res11 = HC.pack(opts11);
console.log("11) радиально (высота по R) 20×10×2: размещено " + res11.placed.length);
check("11: размещены (>30)", res11.placed.length > 30, String(res11.placed.length));
verifyLayout("11", opts11, res11);
check("11: высота каждой детали — вдоль радиуса", res11.placed.every(function (p) {
  var th = (Math.atan2(p.cy, p.cx) * 180) / Math.PI;
  return angDelta(p.rot, th + 90) < 1e-6;
}));

// --- 12. Расположение при неполном заполнении: край / центр / диаметр ---
function radii(res) { return res.placed.map(function (p) { return Math.hypot(p.cx, p.cy); }); }
var base12 = { discDiameter: 298, controlHoles: [], clearances: { pp: 6, pe: 3, pc: 6 } };

var resEdge = HC.pack(Object.assign({}, base12, {
  parts: [{ type: "circle", d: 10, qty: 10, anchor: { mode: "edge" } }]
}));
check("12: «от края» — все радиусы > 120",
  resEdge.placed.length === 10 && radii(resEdge).every(function (r) { return r > 120; }),
  JSON.stringify(radii(resEdge).map(Math.round)));

var resCenter = HC.pack(Object.assign({}, base12, {
  parts: [{ type: "circle", d: 10, qty: 7, anchor: { mode: "center" } }]
}));
check("12: «от центра» — все радиусы < 35",
  resCenter.placed.length === 7 && radii(resCenter).every(function (r) { return r < 35; }),
  JSON.stringify(radii(resCenter).map(Math.round)));

var resDia = HC.pack(Object.assign({}, base12, {
  parts: [{ type: "circle", d: 10, qty: 12, anchor: { mode: "diameter", d: 150 } }]
}));
check("12: «по Ø150» — все радиусы 75±16",
  resDia.placed.length === 12 && radii(resDia).every(function (r) { return Math.abs(r - 75) <= 16; }),
  JSON.stringify(radii(resDia).map(Math.round)));
verifyLayout("12-диаметр", base12, resDia);

// --- 13. Радиальная + количество + расположение от края ---
var res13 = HC.pack(Object.assign({}, base12, {
  parts: [{ type: "rect", w: 20, h: 10, qty: 8, orientation: "radial-w", anchor: { mode: "edge" } }]
}));
check("13: радиально от края — 8 из 8, радиусы > 110",
  res13.placed.length === 8 && radii(res13).every(function (r) { return r > 110; }),
  JSON.stringify(radii(res13).map(Math.round)));
verifyLayout("13", Object.assign({}, base12, { parts: [] }), res13);

// --- 14. Круги «от края»/«по диаметру» распределены по всей окружности,
//         а не собраны в один сектор гекс-сетки (regression-тест бага) ---
function angleSpread(res) {
  var angs = res.placed.map(function (p) { return Math.atan2(p.cy, p.cx); }).sort(function (a, b) { return a - b; });
  var maxGap = 0;
  for (var i = 0; i < angs.length; i++) {
    var next = i + 1 < angs.length ? angs[i + 1] : angs[0] + 2 * Math.PI;
    maxGap = Math.max(maxGap, next - angs[i]);
  }
  return maxGap; // радиан; для равномерного кольца << 2π, для «клина» ~ 2π
}

var res14edge = HC.pack(Object.assign({}, base12, {
  parts: [{ type: "circle", d: 15, qty: 6, anchor: { mode: "edge" } }]
}));
check("14: «от края» — круги по всему кольцу (макс. разрыв < 130°)",
  angleSpread(res14edge) < (130 * Math.PI) / 180,
  (angleSpread(res14edge) * 180 / Math.PI).toFixed(0) + "°");
verifyLayout("14-edge", base12, res14edge);

// «от края» должно садиться РОВНО на предел зазора (pe=3), а не с запасом —
// раньше внешнее кольцо могло оказаться на целый шаг решётки (d+pp) дальше
// от края, чем нужно (баг-репорт пользователя)
var edgeGap = 149 - (Math.max.apply(null, radii(res14edge)) + 15 / 2);
check("14: «от края» — деталь у самого края, зазор ≈ pe (не с запасом)",
  Math.abs(edgeGap - 3) < 0.01, "факт зазор " + edgeGap.toFixed(3) + " (нужно ≈ 3)");

var res14dia = HC.pack(Object.assign({}, base12, {
  parts: [{ type: "circle", d: 15, qty: 8, anchor: { mode: "diameter", d: 150 } }]
}));
check("14: «по диаметру» — круги по всему кольцу (макс. разрыв < 100°)",
  angleSpread(res14dia) < (100 * Math.PI) / 180,
  (angleSpread(res14dia) * 180 / Math.PI).toFixed(0) + "°");
check("14: «по диаметру» — радиус близок к цели 75", res14dia.placed.every(function (p) {
  return Math.abs(Math.hypot(p.cx, p.cy) - 75) < 5;
}));
verifyLayout("14-diameter", base12, res14dia);

// --- 15. Крупная деталь «от края» + контрольные отверстия, выбивающие часть
// свободной дуги (баг-репорт: детали скучивались с одной стороны вместо
// равномерного распределения по всей ДОСТУПНОЙ дуге) ---
var opts15 = {
  discDiameter: 298,
  clearances: { pp: 6, pe: 3, pc: 6 },
  controlHoles: [
    { x: 0, y: 0, d: 25.4, seatD: 25.6, apertureCA: 22.6, slotOn: true },
    { x: -13.527, y: 110.173, d: 25.4, seatD: 25.6, apertureCA: 22.6, slotOn: true },
    { x: -102.176, y: 43.371, seatD: 30.1, depth: 3, apertureCA: 24.2, slotOn: false }
  ],
  parts: [{ type: "circle", d: 90, seatD: 90.3, apertureCA: 88.8, qty: 10, anchor: { mode: "edge" } }]
};
var res15 = HC.pack(opts15);
check("15: крупная деталь «от края» — не потеряли деталей (4 из 10, не 3)",
  res15.placed.length === 4, String(res15.placed.length));
var angs15 = res15.placed.map(function (p) { return Math.atan2(p.cy, p.cx); }).sort(function (a, b) { return a - b; });
var gaps15 = angs15.map(function (a, i) {
  var next = i + 1 < angs15.length ? angs15[i + 1] : angs15[0] + 2 * Math.PI;
  return (next - a) * 180 / Math.PI;
});
var smallGaps15 = gaps15.filter(function (g) { return g < 170; }); // все «рабочие» разрывы (не тот, что упирается в КО)
check("15: детали внутри свободной дуги равномерны (все малые разрывы ≈ друг другу, не скучены)",
  smallGaps15.length === 3 && smallGaps15.every(function (g) { return Math.abs(g - smallGaps15[0]) < 1; }),
  JSON.stringify(gaps15.map(function (g) { return g.toFixed(1); })));
verifyLayout("15", opts15, res15);

// --- 16. Узкая дуга между двумя близкими контрольными отверстиями (свидетель
// и reference всего в 60° друг от друга). Баг-репорт: карман считался
// невместимым и оставался пустым (~128° мёртвой зоны), хотя деталь туда
// физически влезает. Второй баг-репорт (после первого фикса): карман
// получал ровно 1 деталь строго по центру с огромным избыточным запасом
// (30+ мм при требуемых 6) — т.к. каждая дуга обсчитывалась НЕЗАВИСИМО
// (свой шаг). Правильно — единый шаг по всему кольцу («сшитые» дуги): тогда
// в карман при более мелких деталях помещается больше одной, тем же шагом,
// что и в остальном кольце ---
var opts16 = {
  discDiameter: 298,
  clearances: { pp: 6, pe: 3, pc: 6 },
  controlHoles: [
    { x: 0, y: 0, d: 25.4, seatD: 25.6, apertureCA: 22.6, slotOn: true },
    { x: -13.527, y: 110.173, d: 25.4, seatD: 25.6, apertureCA: 22.6, slotOn: true },
    { x: -102.176, y: 43.371, seatD: 30.1, depth: 3, apertureCA: 24.2, slotOn: false }
  ],
  parts: [{ type: "circle", d: 25, seatD: 25.2, apertureCA: 23.7, qty: 22, anchor: { mode: "diameter", d: 222 } }]
};
var res16 = HC.pack(opts16);
check("16: карман между свидетелем и reference вмещает 2 детали тем же шагом, что и остальное кольцо (18 из 22, не 17)",
  res16.placed.length === 18, String(res16.placed.length));
check("16: макс. угловой разрыв << прежних ~128°/55° (нет избыточного запаса у контрольных отверстий)",
  angleSpread(res16) < (55 * Math.PI) / 180,
  (angleSpread(res16) * 180 / Math.PI).toFixed(1) + "°");
verifyLayout("16", opts16, res16);

console.log("\nВремя: " + (Date.now() - t0) + " мс");
if (failures) {
  console.log("ПРОВАЛЕНО ПРОВЕРОК: " + failures);
  process.exit(1);
} else {
  console.log("Все проверки пройдены.");
}
