// Тест 3D-построителя без WebGL: собираем сцену из реальной раскладки
// и проверяем слои, пластины и габариты. Запуск: node test/test-viewer3d.js
"use strict";
const path = require("path");

global.THREE = require(path.join(__dirname, "..", "js", "vendor", "three.min.js"));
require(path.join(__dirname, "..", "js", "catalog.js"));
require(path.join(__dirname, "..", "js", "geometry.js"));
require(path.join(__dirname, "..", "js", "packer.js"));
require(path.join(__dirname, "..", "js", "viewer3d.js"));
const HC = globalThis.HC;

let failures = 0;
function check(name, cond, detail) {
  if (cond) console.log("  ok   " + name);
  else { failures++; console.log("  FAIL " + name + (detail ? " — " + detail : "")); }
}

// раскладка как на реальном диске: круги с пазами + прямоугольники, контрольные отверстия
const controlHoles = [
  { x: 0, y: 0, d: 25.4, seatD: 25.6, apertureCA: 23.9, slotOn: true },
  { x: -110.173, y: -13.527, d: 25.4, seatD: 25.6, apertureCA: 23.9, slotOn: true },
  { x: -43.371, y: -102.176, seatD: 30.1, depth: 3, apertureCA: 24.1, slotOn: false }
];
const res = HC.pack({
  discDiameter: 298,
  controlHoles: controlHoles,
  clearances: { pp: 6, pe: 3, pc: 6 },
  parts: [
    { type: "circle", d: 25.4, seatD: 25.6, apertureCA: 23.9, slotOn: true, qty: 8, orientation: "fixed", anchor: { mode: "edge" } },
    { type: "rect", w: 20, h: 10, chamfer: 0, qty: 5, orientation: "grid", anchor: { mode: "center" } }
  ]
});
check("раскладка дала детали обоих типов", res.placed.length === 13, String(res.placed.length));

const model = {
  discDiameter: 298,
  thickness: 6,
  controlHoles: controlHoles,
  placed: res.placed,
  showNumbers: false
};

const group = HC.viewer3d._buildGroup(model);

// слои: глубины {3 (Контроль), 4.5 (детали и свидетели)} → границы 0/3/4.5/6 → 3 слоя
const meshes = [];
group.traverse((o) => { if (o.isMesh) meshes.push(o); });
const layers = meshes.filter((m) => m.geometry.type === "ExtrudeGeometry" && m.position.x === 0 && m.position.y === 0 && m.position.z < 0 && m.material.color.getHex() === 0xc9cdd1);
check("диск собран из 3 слоёв (глубины 3 и 4.5 при толщине 6)", layers.length === 3, String(layers.length));

// цветные поверхности counterbore: стенка посадки у всех 16 элементов
// (3 КО + 13 деталей), стенка CA у 11 (3 КО + 8 кругов; прямоугольники без
// CA), плюс ступенька (дно посадки) у всех 16 → 43
const walls = meshes.length - layers.length;
check("цветных поверхностей 43 (16 посадок + 11 CA + 16 ступенек)", walls === 43, String(walls));

// габариты: диаметр ~298, толщина 6, стенки не выше верха диска
const box = new THREE.Box3().setFromObject(group);
check("габарит по X ≈ 298", Math.abs(box.max.x - box.min.x - 298) < 1, String(box.max.x - box.min.x));
check("низ на -6, верх не выше 0", Math.abs(box.min.z + 6) < 1e-6 && box.max.z <= 0 + 1e-6,
  box.min.z + " … " + box.max.z);

// все вершины конечны (нет NaN из объединения паза с посадкой)
let finite = true;
meshes.forEach((m) => {
  const a = m.geometry.attributes.position.array;
  for (let i = 0; i < a.length; i++) if (!Number.isFinite(a[i])) { finite = false; break; }
});
check("все координаты вершин конечны", finite);

// с номерами: добавляются спрайты по числу деталей — но в node нет canvas,
// поэтому только проверяем, что без номеров спрайтов нет
let sprites = 0;
group.traverse((o) => { if (o.isSprite) sprites++; });
check("без номеров спрайтов нет", sprites === 0);

console.log(failures ? "\nПРОВАЛЕНО: " + failures : "\nТест 3D-построителя пройден.");
process.exit(failures ? 1 : 0);
