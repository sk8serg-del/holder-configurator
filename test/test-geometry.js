// Тест геометрических примитивов (js/geometry.js), в первую очередь
// circleMinusCircles — контур диска с выемкой там, где крепёжное/тех.
// отверстие пересекает его край (иначе STEP режет верно, а превью — нет,
// см. обсуждение). Проверка — через площадь (shoelace) против аналитической
// формулы пересечения двух окружностей (лунка). Запуск: node test/test-geometry.js
"use strict";
const path = require("path");
global.HC = {};
require(path.join(__dirname, "..", "js", "geometry.js"));
const HC = globalThis.HC;

let failures = 0;
function check(name, cond, detail) {
  if (cond) console.log("  ok   " + name);
  else { failures++; console.log("  FAIL " + name + (detail ? " — " + detail : "")); }
}

function lensArea(R, r, d) {
  if (d >= R + r) return 0;
  if (d <= Math.abs(R - r)) return Math.PI * Math.min(R, r) * Math.min(R, r);
  var part1 = R * R * Math.acos((d * d + R * R - r * r) / (2 * d * R));
  var part2 = r * r * Math.acos((d * d + r * r - R * R) / (2 * d * r));
  var part3 = 0.5 * Math.sqrt((-d + R + r) * (d + R - r) * (d - R + r) * (d + R + r));
  return part1 + part2 - part3;
}

function shoelaceArea(pts) {
  var s = 0;
  for (var i = 0; i < pts.length; i++) {
    var a = pts[i], b = pts[(i + 1) % pts.length];
    s += a.x * b.y - b.x * a.y;
  }
  return Math.abs(s) / 2;
}

function noDuplicateJumps(pts, maxStep) {
  for (var i = 0; i < pts.length; i++) {
    var a = pts[i], b = pts[(i + 1) % pts.length];
    if (Math.hypot(b.x - a.x, b.y - a.y) > maxStep) return false;
  }
  return true;
}

const R = 150;

// --- отверстие полностью внутри диска — контур не меняется (null) ---
check("отверстие полностью внутри — без изменений (null)",
  HC.geom.circleMinusCircles(R, [{ x: 0, y: 0, r: 20 }]) === null);

// --- отверстие полностью снаружи — без изменений (null) ---
check("отверстие полностью снаружи — без изменений (null)",
  HC.geom.circleMinusCircles(R, [{ x: 200, y: 0, r: 10 }]) === null);

// --- отверстие ровно на краю (центр на радиусе диска) ---
{
  const holeR = 5;
  const poly = HC.geom.circleMinusCircles(R, [{ x: R, y: 0, r: holeR }]);
  check("отверстие на краю: контур построен (не null)", poly !== null);
  const area = shoelaceArea(poly);
  const expected = Math.PI * R * R - lensArea(R, holeR, R);
  check("отверстие на краю: площадь совпадает с (круг − лунка)",
    Math.abs(area - expected) < expected * 0.01, "area=" + area.toFixed(2) + " expected=" + expected.toFixed(2));
  check("отверстие на краю: нет разрывов контура (не самопересекающийся мусор)",
    noDuplicateJumps(poly, R * 0.2));
}

// --- отверстие чуть выступает за край (в основном внутри) ---
{
  const holeR = 8, d = R - 3; // центр внутри диска, но радиус выступает наружу на 5
  const poly = HC.geom.circleMinusCircles(R, [{ x: d, y: 0, r: holeR }]);
  check("отверстие чуть выступает: контур построен", poly !== null);
  const area = shoelaceArea(poly);
  const expected = Math.PI * R * R - lensArea(R, holeR, d);
  check("отверстие чуть выступает: площадь совпадает",
    Math.abs(area - expected) < expected * 0.01, "area=" + area.toFixed(2) + " expected=" + expected.toFixed(2));
}

// --- отверстие в основном снаружи, но чуть задевает край ---
{
  const holeR = 8, d = R + 5;
  const poly = HC.geom.circleMinusCircles(R, [{ x: 0, y: d, r: holeR }]);
  check("отверстие в основном снаружи: контур построен", poly !== null);
  const area = shoelaceArea(poly);
  const expected = Math.PI * R * R - lensArea(R, holeR, d);
  check("отверстие в основном снаружи: площадь совпадает",
    Math.abs(area - expected) < expected * 0.01, "area=" + area.toFixed(2) + " expected=" + expected.toFixed(2));
}

// --- два независимых (неперекрывающихся) выреза по разным углам диска ---
{
  const holeR = 6;
  const holes = [
    { x: R, y: 0, r: holeR },
    { x: -R * Math.cos(Math.PI / 4), y: R * Math.sin(Math.PI / 4), r: holeR }
  ];
  const poly = HC.geom.circleMinusCircles(R, holes);
  check("два выреза: контур построен", poly !== null);
  const area = shoelaceArea(poly);
  const expected = Math.PI * R * R - lensArea(R, holeR, R) - lensArea(R, holeR, R);
  check("два выреза: площадь совпадает с суммой двух вычетов",
    Math.abs(area - expected) < expected * 0.01, "area=" + area.toFixed(2) + " expected=" + expected.toFixed(2));
  check("два выреза: нет разрывов контура", noDuplicateJumps(poly, R * 0.2));
}

// --- отверстие ровно на краю под произвольным углом (не только 0°) ---
{
  const holeR = 10, angle = (137 * Math.PI) / 180;
  const poly = HC.geom.circleMinusCircles(R, [{ x: R * Math.cos(angle), y: R * Math.sin(angle), r: holeR }]);
  const area = shoelaceArea(poly);
  const expected = Math.PI * R * R - lensArea(R, holeR, R);
  check("вырез под произвольным углом (137°): площадь совпадает",
    Math.abs(area - expected) < expected * 0.01, "area=" + area.toFixed(2) + " expected=" + expected.toFixed(2));
}

console.log(failures ? "\nПРОВАЛЕНО: " + failures : "\nТест геометрии пройден.");
process.exit(failures ? 1 : 0);
