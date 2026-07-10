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
    return { type: "circle", cx: h.x, cy: h.y, d: h.d };
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

console.log("\nВремя: " + (Date.now() - t0) + " мс");
if (failures) {
  console.log("ПРОВАЛЕНО ПРОВЕРОК: " + failures);
  process.exit(1);
} else {
  console.log("Все проверки пройдены.");
}
