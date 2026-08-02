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

// слои: глубины {3 (Reference), 4.5 (детали и свидетели)} → границы 0/3/4.5/6 → 3 слоя
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

// --- полный диск: болванка крупнее полезной зоны + крепёж сквозной ---
const fullModel = Object.assign({}, model, {
  blankDiameter: 324.5,
  fixtures: {
    holes: [{ d: 6, points: [[4.1, 156.446], [133.436, -81.774], [-137.536, -74.672]] }],
    grooves: [{ inner: 297.5, outer: 303.5, depth: 2 }],
    // фигурный вырез (полигон) на фланце
    cutouts: [{ label: "Mountings", points: [[-140, 60], [-120, 70], [-125, 90], [-145, 82]] }]
  }
});
const g2 = HC.viewer3d._buildGroup(fullModel);
const box2 = new THREE.Box3().setFromObject(g2);
check("габарит по X ≈ 324.5 (полная болванка, не полезная зона)",
  Math.abs(box2.max.x - box2.min.x - 324.5) < 1, String(box2.max.x - box2.min.x));
let finite2 = true;
g2.traverse((o) => {
  if (!o.isMesh) return;
  const a = o.geometry.attributes.position.array;
  for (let i = 0; i < a.length; i++) if (!Number.isFinite(a[i])) { finite2 = false; break; }
});
check("полный диск: все вершины конечны (крепёж + канавка не дали NaN)", finite2);

// --- реальный диск disc-298: крепёж Mounting2 лежит внутри вырезов Mountings ---
require(path.join(__dirname, "..", "js", "catalog.js"));
const disc = HC.CATALOG.discs[0];
const realModel = {
  discDiameter: disc.diameter, blankDiameter: disc.blankDiameter, thickness: disc.thickness,
  fixtures: disc.fixtures, controlHoles: [], placed: [], showNumbers: false
};
const gReal = HC.viewer3d._buildGroup(realModel);
let finiteReal = true, meshesReal = 0;
gReal.traverse((o) => {
  if (!o.isMesh) return;
  meshesReal++;
  const a = o.geometry.attributes.position.array;
  for (let i = 0; i < a.length; i++) if (!Number.isFinite(a[i])) { finiteReal = false; break; }
});
check("реальный disc-298 (крепёж внутри вырезов Mountings) собирается без NaN", finiteReal && meshesReal > 0,
  "finite=" + finiteReal + " meshes=" + meshesReal);

// --- занижение по краю болванки (edgeRecess): реальная ступенька в 3D ---
function layerMeshes(g) {
  const ms = [];
  g.traverse((o) => {
    if (o.isMesh && o.geometry.type === "ExtrudeGeometry" && o.position.x === 0 && o.position.y === 0 &&
      o.position.z < 0 && o.material.color.getHex() === 0xc9cdd1) ms.push(o);
  });
  return ms;
}
function xSpan(mesh) {
  const box = new THREE.Box3().setFromObject(mesh);
  return box.max.x - box.min.x;
}

const recessModelTop = { discDiameter: 298, thickness: 6, controlHoles: [], placed: [], showNumbers: false,
  edgeRecess: { side: "top", diameter: 250, depth: 2 } };
const gTop = HC.viewer3d._buildGroup(recessModelTop);
const layersTop = layerMeshes(gTop).sort((a, b) => a.position.z - b.position.z);
check("edgeRecess top: диск разбит на 2 слоя (0..2 занижен, 2..6 полный)", layersTop.length === 2, String(layersTop.length));
if (layersTop.length === 2) {
  check("edgeRecess top: верхний (ближний к 0) слой сужен до Ø250", Math.abs(xSpan(layersTop[1]) - 250) < 1, String(xSpan(layersTop[1])));
  check("edgeRecess top: нижний слой остаётся Ø298", Math.abs(xSpan(layersTop[0]) - 298) < 1, String(xSpan(layersTop[0])));
}
let finiteTop = true;
gTop.traverse((o) => { if (!o.isMesh) return; const a = o.geometry.attributes.position.array;
  for (let i = 0; i < a.length; i++) if (!Number.isFinite(a[i])) { finiteTop = false; break; } });
check("edgeRecess top: все вершины конечны", finiteTop);

const recessModelBottom = { discDiameter: 298, thickness: 6, controlHoles: [], placed: [], showNumbers: false,
  edgeRecess: { side: "bottom", diameter: 250, depth: 2 } };
const gBottom = HC.viewer3d._buildGroup(recessModelBottom);
const layersBottom = layerMeshes(gBottom).sort((a, b) => a.position.z - b.position.z);
check("edgeRecess bottom: диск разбит на 2 слоя (0..4 полный, 4..6 занижен)", layersBottom.length === 2, String(layersBottom.length));
if (layersBottom.length === 2) {
  check("edgeRecess bottom: нижний (дальний, ближе к -6) слой сужен до Ø250", Math.abs(xSpan(layersBottom[0]) - 250) < 1, String(xSpan(layersBottom[0])));
  check("edgeRecess bottom: верхний слой остаётся Ø298", Math.abs(xSpan(layersBottom[1]) - 298) < 1, String(xSpan(layersBottom[1])));
}
let finiteBottom = true;
gBottom.traverse((o) => { if (!o.isMesh) return; const a = o.geometry.attributes.position.array;
  for (let i = 0; i < a.length; i++) if (!Number.isFinite(a[i])) { finiteBottom = false; break; } });
check("edgeRecess bottom: все вершины конечны", finiteBottom);

// diameter >= discDiameter — некорректное занижение, должно тихо игнорироваться (1 слой, без NaN)
const recessModelInvalid = { discDiameter: 298, thickness: 6, controlHoles: [], placed: [], showNumbers: false,
  edgeRecess: { side: "top", diameter: 298, depth: 2 } };
const gInvalid = HC.viewer3d._buildGroup(recessModelInvalid);
const layersInvalid = layerMeshes(gInvalid);
check("edgeRecess некорректный диаметр (>= Ø диска) игнорируется (1 слой)", layersInvalid.length === 1, String(layersInvalid.length));

// --- крепёжное отверстие РОВНО на краю болванки: контур получает реальную
// выемку (не просто декоративный сквозной кружок поверх целого диска) ---
const edgeHoleModel = {
  discDiameter: 300, blankDiameter: 300, thickness: 6, controlHoles: [], placed: [], showNumbers: false,
  fixtures: { holes: [{ d: 10, label: "вырез", points: [[150, 0]] }] }
};
const gEdge = HC.viewer3d._buildGroup(edgeHoleModel);
let finiteEdge = true;
gEdge.traverse((o) => { if (!o.isMesh) return; const a = o.geometry.attributes.position.array;
  for (let i = 0; i < a.length; i++) if (!Number.isFinite(a[i])) { finiteEdge = false; break; } });
check("отверстие на краю: все вершины конечны (контур клипован без NaN)", finiteEdge);
const boxEdge = new THREE.Box3().setFromObject(gEdge);
// вершины контура на границе выреза лежат ровно на пересечении окружностей
// (R=150, отверстие r=5 в (150,0)) — угол пересечения ≈1.91°, max X ≈150·cos(1.91°)≈149.92
check("отверстие на краю: контур реально выедает кромку (max X заметно < R=150)", boxEdge.max.x < 149.95, String(boxEdge.max.x));

// то же отверстие полностью внутри — контур не меняется, max X остаётся ≈150
const innerHoleModel = {
  discDiameter: 300, blankDiameter: 300, thickness: 6, controlHoles: [], placed: [], showNumbers: false,
  fixtures: { holes: [{ d: 10, label: "вырез", points: [[50, 0]] }] }
};
const gInner = HC.viewer3d._buildGroup(innerHoleModel);
const boxInner = new THREE.Box3().setFromObject(gInner);
check("отверстие внутри болванки: контур не меняется (max X ≈ R=150)", Math.abs(boxInner.max.x - 150) < 0.5, String(boxInner.max.x));

// --- buildGroupFromMesh: настоящий меш STEP (см. shape.mesh() в replicad) —
// плоский квадрат 20×20, 2 треугольника, без явных нормалей (должны
// досчитаться автоматически, а не упасть на пустом атрибуте) ---
const meshData = {
  vertices: [-10, -10, 0, 10, -10, 0, 10, 10, 0, -10, 10, 0],
  triangles: [0, 1, 2, 0, 2, 3],
  normals: []
};
const gMesh = HC.viewer3d._buildGroupFromMesh(meshData);
let meshCountFromMesh = 0;
gMesh.traverse((o) => { if (o.isMesh) meshCountFromMesh++; });
check("buildGroupFromMesh: ровно один меш (одна геометрия, один материал)", meshCountFromMesh === 1, String(meshCountFromMesh));
const boxMesh = new THREE.Box3().setFromObject(gMesh);
check("buildGroupFromMesh: габарит по X = 20", Math.abs(boxMesh.max.x - boxMesh.min.x - 20) < 1e-6, String(boxMesh.max.x - boxMesh.min.x));
check("buildGroupFromMesh: габарит по Y = 20", Math.abs(boxMesh.max.y - boxMesh.min.y - 20) < 1e-6, String(boxMesh.max.y - boxMesh.min.y));
let indexOk = false, normalsFinite = true;
gMesh.traverse((o) => {
  if (!o.isMesh) return;
  indexOk = o.geometry.getIndex() && o.geometry.getIndex().count === 6;
  const n = o.geometry.attributes.normal.array;
  for (let i = 0; i < n.length; i++) if (!Number.isFinite(n[i])) normalsFinite = false;
});
check("buildGroupFromMesh: индекс на 2 треугольника (6 индексов)", indexOk);
check("buildGroupFromMesh: нормали досчитаны автоматически (без NaN)", normalsFinite);

console.log(failures ? "\nПРОВАЛЕНО: " + failures : "\nТест 3D-построителя пройден.");
process.exit(failures ? 1 : 0);
