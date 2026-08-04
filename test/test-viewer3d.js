// Тест 3D-построителя без WebGL: собираем сцену из реальной раскладки
// и проверяем слои, пластины и габариты. Запуск: node test/test-viewer3d.js
"use strict";
const path = require("path");

global.THREE = require(path.join(__dirname, "..", "js", "vendor", "three.min.js"));
require(path.join(__dirname, "..", "js", "catalog.js"));
require(path.join(__dirname, "..", "js", "geometry.js"));
require(path.join(__dirname, "..", "js", "packer.js"));
require(path.join(__dirname, "..", "js", "engraving.js")); // только HC.ENGRAVE_DEPTH — константа, WASM не трогаем
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

// слои: глубины {3 (Reference), 4.5 (детали и свидетели)} + граница метки-
// ориентира (markDepth=1мм, у 8 круглых деталей с slotOn) → 0/1/3/4.5/6 → 4 слоя
const meshes = [];
group.traverse((o) => { if (o.isMesh) meshes.push(o); });
const layers = meshes.filter((m) => m.geometry.type === "ExtrudeGeometry" && m.position.x === 0 && m.position.y === 0 && m.position.z < 0 && m.material.color.getHex() === 0xc9cdd1);
check("диск собран из 4 слоёв (глубины 3 и 4.5 при толщине 6, плюс граница меток-ориентиров на 1мм)", layers.length === 4, String(layers.length));

// цветные поверхности counterbore: стенка посадки у всех 16 элементов
// (3 КО + 13 деталей), стенка CA у 11 (3 КО + 8 кругов; прямоугольники без
// CA), плюс ступенька (дно посадки) у всех 16 → 43, плюс метки-ориентиры
// (зенковка) у 8 круглых деталей с slotOn (partIndex 0 → 1 метка каждая;
// прямоугольники без slotOn меток не имеют, КО — никогда) → 43 + 8 = 51
const walls = meshes.length - layers.length;
check("цветных поверхностей 51 (16 посадок + 11 CA + 16 ступенек + 8 меток)", walls === 51, String(walls));

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

// --- метки-ориентиры (зенковка) деталей с пазом в Lite 3D — конус узнаётся
// по типу геометрии (CylinderGeometry, больше никто её не строит, кроме
// зенковок крепежа болванки, которых в этой модели нет) ---
const markModel = {
  discDiameter: 200,
  thickness: 5,
  controlHoles: [],
  placed: [
    // 2-я разновидность детали (partIndex 1) → markCount=2 меток
    { type: "circle", cx: 50, cy: 0, d: 25.4, seatD: 25.6, slotOn: true, slotAngle: 0, partIndex: 1 },
    // без паза — меток быть не должно
    { type: "circle", cx: -50, cy: 0, d: 10, partIndex: 0 }
  ],
  showNumbers: false
};
const gMark = HC.viewer3d._buildGroup(markModel);
const markMeshes = [];
gMark.traverse((o) => { if (o.isMesh && o.geometry.type === "CylinderGeometry") markMeshes.push(o); });
check("метки-ориентиры: ровно 2 конуса (markCount=2 у детали с пазом, у второй без паза — 0)",
  markMeshes.length === 2, String(markMeshes.length));
const expectedMarks = HC.geom.slotMarkPoints(50, 0, 25.6 / 2, Math.min(9, 25.6 * 0.75) / 2, 0, HC.MARK_OFF, HC.MARK_SIDE, 2, HC.MARK_PITCH);
check("метки-ориентиры: позиции совпадают с HC.geom.slotMarkPoints (та же формула, что в step-export.js)",
  markMeshes.every((m) => expectedMarks.some((e) => Math.abs(m.position.x - e.x) < 1e-6 && Math.abs(m.position.y - e.y) < 1e-6)),
  JSON.stringify(markMeshes.map((m) => [m.position.x, m.position.y])) + " vs " + JSON.stringify(expectedMarks));
check("метки-ориентиры: цвет — цвет детали (PART_COLORS[1], а не серый диска)",
  markMeshes.every((m) => m.material.color.getHex() === 0x2f855a), String(markMeshes.map((m) => m.material.color.getHex().toString(16))));
check("метки-ориентиры: узкий конец конуса уходит вниз, в материал (z < 0)",
  markMeshes.every((m) => m.position.z < 0), String(markMeshes.map((m) => m.position.z)));

// РЕГРЕССИЯ («не вижу метки»): декоративный конус без настоящей дырки в
// самом диске оказывается погребён внутри сплошной ExtrudeGeometry — сверху
// его закрывает непрозрачная крышка слоя. Проверяем, что диск реально разбит
// доп. границей на глубину метки (как у гравировки) — раз слоёв больше 1,
// в верхнем тонком слое ЕСТЬ прорезанное отверстие под конус.
const markLayers = [];
gMark.traverse((o) => { if (o.isMesh && o.geometry.type === "ExtrudeGeometry" && o.position.x === 0 && o.position.y === 0 && o.position.z < 0) markLayers.push(o); });
check("метки-ориентиры: диск разбит доп. слоем на глубину метки (иначе конус скрыт под целой крышкой)",
  markLayers.length >= 2, String(markLayers.length));

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

// --- fixtures.holes с пазом (3-й элемент точки — slotAngle, см.
// js/step-import.js groupKeepoutsByDiameter) — реальный D-образный контур
// (посадка+паз), а не просто круглый кружок; иначе на 3D "Lite" у STEP-болванок
// (реконструкция из уже разобранной геометрии) паз под пинцет терялся бы,
// хотя честный STEP/previewSVG его показывают правильно ---
function maxRadialReach(group, ignoreAbove) {
  let maxReach = 0;
  group.traverse((o) => {
    if (!o.isMesh) return;
    const a = o.geometry.attributes.position.array;
    for (let i = 0; i < a.length; i += 3) {
      const r = Math.hypot(a[i], a[i + 1]);
      if (r > maxReach && r < ignoreAbove) maxReach = r;
    }
  });
  return maxReach;
}
const slotFixtureModel = {
  discDiameter: 200, blankDiameter: 220, thickness: 6,
  fixtures: { holes: [{ d: 25.6, points: [[0, 0, 30]] }] }, // паз на 30°
  controlHoles: [], placed: [], showNumbers: false
};
const reachWithSlot = maxRadialReach(HC.viewer3d._buildGroup(slotFixtureModel), 50);
check("паз в крепеже болванки: контур реально выступает за посадку (Ø25.6/2=12.8)",
  reachWithSlot > 12.8 + 0.5, "reach=" + reachWithSlot);

const noSlotFixtureModel = Object.assign({}, slotFixtureModel, { fixtures: { holes: [{ d: 25.6, points: [[0, 0]] }] } });
const reachNoSlot = maxRadialReach(HC.viewer3d._buildGroup(noSlotFixtureModel), 50);
check("без паза (только [x,y]): контур не выступает — обычный круглый кружок",
  reachNoSlot < 12.8 + 0.5, "reach=" + reachNoSlot);

// --- паз/посадка свидетеля болванки — ГЛУХАЯ, не сквозная (регрессия: сперва
// резалась через всю толщину, как обычный крепёжный болт) ---
const layersSlotFixture = layerMeshes(HC.viewer3d._buildGroup(slotFixtureModel));
check("паз в крепеже болванки: диск разбит на 2 слоя (глубина посадки + сплошной низ) — не сквозной",
  layersSlotFixture.length === 2, String(layersSlotFixture.length));
const layersNoSlotFixture = layerMeshes(HC.viewer3d._buildGroup(noSlotFixtureModel));
check("обычный крепёж без паза остаётся сквозным (1 слой, как раньше)",
  layersNoSlotFixture.length === 1, String(layersNoSlotFixture.length));
// с явной глубиной (4-й элемент точки) — используется она, а не дефолт T-1.5
const slotFixtureExplicitDepth = Object.assign({}, slotFixtureModel, {
  fixtures: { holes: [{ d: 25.6, points: [[0, 0, 30, 2]] }] } // глубина 2мм явно
});
const layersExplicitDepth = layerMeshes(HC.viewer3d._buildGroup(slotFixtureExplicitDepth));
check("явная глубина посадки (4-й элемент) задаёт свою границу слоя (2 слоя, разделены на Z=2)",
  layersExplicitDepth.length === 2, String(layersExplicitDepth.length));

// --- составная посадка свидетеля (5-й элемент — apertureCA): регрессия —
// после того, как посадку сделали глухой (не сквозной, см. выше), зона
// напыления (CA) под ней тихо пропадала — нижний слой оставался СПЛОШНЫМ,
// хотя должен был иметь свою (меньшую) сквозную дырку ---
const slotCAFixtureModel = {
  discDiameter: 200, blankDiameter: 220, thickness: 6,
  fixtures: { holes: [{ d: 25.6, points: [[0, 0, 30, 3, 22.6]] }] }, // паз 30°, глубина 3, CA=22.6
  controlHoles: [], placed: [], showNumbers: false
};
const layersCA = layerMeshes(HC.viewer3d._buildGroup(slotCAFixtureModel)).sort((a, b) => a.position.z - b.position.z);
check("составная посадка (паз+CA): 2 слоя (глухая посадка сверху + сквозная CA снизу)",
  layersCA.length === 2, String(layersCA.length));
if (layersCA.length === 2) {
  const bottomLayer = layersCA[0]; // самый нижний по Z (position.z наиболее отрицательный)
  const a = bottomLayer.geometry.attributes.position.array;
  let hasNearCenterVertex = false;
  for (let i = 0; i < a.length; i += 3) {
    if (Math.hypot(a[i], a[i + 1]) < 15) { hasNearCenterVertex = true; break; }
  }
  check("нижний слой (под посадкой) имеет свою дырку CA — не сплошной (регрессия: CA пропадала)",
    hasNearCenterVertex);
}

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

// --- регрессия: гравировка «висит в воздухе» над занижением по краю (top-
// side edgeRecess) — буква у самого края (радиус 140, ЗА erInnerR=125) не
// должна резаться от глобального верха (Z=0, там материала уже нет — слой
// [0,2] сужен до Ø250), а от ЛОКАЛЬНОЙ поверхности занижения (erT1=2) ---
// contour → команды {cmd,x,y} (M/L — реальный computeLayout отдаёт ещё и Q,
// но для этих тестов достаточно прямых углов, см. HC.geom.parseSVGPathCommands)
function cmdsFromPoly(poly) {
  return poly.map((p, i) => ({ cmd: i === 0 ? "M" : "L", x: p[0], y: p[1] }));
}
function glyphSquare(cx, cy, half) {
  return cmdsFromPoly([[cx - half, cy - half], [cx + half, cy - half], [cx + half, cy + half], [cx - half, cy + half]]);
}
const recessEngraveModel = {
  discDiameter: 298, blankDiameter: 298, thickness: 6, controlHoles: [], placed: [], showNumbers: false,
  edgeRecess: { side: "top", diameter: 250, depth: 2 },
  engraving: { glyphs: [{ outer: glyphSquare(140, 0, 3), holes: [] }] }
};
const gRecessEngrave = HC.viewer3d._buildGroup(recessEngraveModel);
let finiteRecessEngrave = true;
gRecessEngrave.traverse((o) => { if (!o.isMesh) return; const a = o.geometry.attributes.position.array;
  for (let i = 0; i < a.length; i++) if (!Number.isFinite(a[i])) finiteRecessEngrave = false; });
check("гравировка в зоне занижения: все вершины конечны", finiteRecessEngrave);
const recessEngraveLayers = layerMeshes(gRecessEngrave).sort((a, b) => a.position.z - b.position.z);
// без буквы в зоне занижения слоёв было бы 2 (0..2 занижен, 2..6 полный) —
// с ней добавляется ТРЕТИЙ тонкий слой (2..2.15) именно для этой буквы,
// а НЕ лишний слой (0..0.15) поверх узкого Ø250 (буква туда не поместилась бы)
check("гравировка в зоне занижения: добавляет ровно ОДИН новый слой (2..2.15), не у глобального верха",
  recessEngraveLayers.length === 3, String(recessEngraveLayers.length));
if (recessEngraveLayers.length === 3) {
  const engraveLayer = recessEngraveLayers[1]; // средний по Z: между занижением (0..2) и полной толщей (2.15..6)
  check("гравировка в зоне занижения: новый слой начинается ровно на erT1=2 (не на 0)",
    Math.abs(engraveLayer.position.z + 2.15) < 1e-6, String(engraveLayer.position.z));
  check("гравировка в зоне занижения: новый слой — полный радиус Ø298 (не сужен до Ø250 — там уже нет материала)",
    Math.abs(xSpan(engraveLayer) - 298) < 1, String(xSpan(engraveLayer)));
}

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

// --- гравировка (js/engraving.js computeLayout) — неглубокий (ENGRAVE_DEPTH)
// карман сверху, простым квадратом-«буквой» у края, без своих дырок (см.
// viewer3d.js: THREE Shape/ExtrudeGeometry не поддерживают дырку-в-дырке —
// для Lite это ПРИЕМЛЕМОЕ упрощение, буква режется целиком по внешнему
// контуру, реальный STP-экспорт режет через OC .cut() без этого ограничения) ---
const engravingModel = Object.assign({}, model, {
  engraving: { glyphs: [{ outer: cmdsFromPoly([[140, -5], [146, -5], [146, 5], [140, 5]]), holes: [cmdsFromPoly([[142, -2], [144, -2], [144, 2], [142, 2]])] }] }
});
const gEngrave = HC.viewer3d._buildGroup(engravingModel);
let finiteEngrave = true;
gEngrave.traverse((o) => {
  if (!o.isMesh) return;
  const a = o.geometry.attributes.position.array;
  for (let i = 0; i < a.length; i++) if (!Number.isFinite(a[i])) finiteEngrave = false;
});
check("гравировка: все вершины конечны (карман не даёт NaN)", finiteEngrave);
function discLayers(gr) {
  const out = [];
  gr.traverse((o) => { if (o.isMesh && o.geometry.type === "ExtrudeGeometry" && o.position.x === 0 && o.position.y === 0 && o.position.z < 0 && o.material.color.getHex() === 0xc9cdd1) out.push(o); });
  return out;
}
const engraveLayers = discLayers(gEngrave);
check("гравировка: добавляет отдельный тонкий верхний слой (ENGRAVE_DEPTH) — на 1 больше, чем без неё",
  engraveLayers.length === layers.length + 1, String(engraveLayers.length));
// самый верхний слой (ближе всего к 0) должен быть именно ENGRAVE_DEPTH толщиной
const topLayer = engraveLayers.reduce((a, b) => (b.position.z > a.position.z ? b : a));
check("гравировка: верхний слой ровно ENGRAVE_DEPTH толщиной (0.15мм)",
  Math.abs(topLayer.geometry.parameters.options.depth - HC.ENGRAVE_DEPTH) < 1e-6,
  String(topLayer.geometry.parameters.options.depth));
// цветная стенка+дно кармана (ENGRAVE_COLOR) — та же логика, что и у обычных
// цветных карманов (посадка/CA), чтобы гравировка визуально отличалась от
// серого металла диска. Регрессия: первая версия заливки дна не вычитала
// дырку буквы («D»/«0»/«8» и т.п.) — «O» превращалась в сплошной залитый
// круг вместо кольца. outer — квадрат 140..146 × -5..5 (60мм²), holes —
// квадрат 142..144 × -2..2 (8мм²): 2 стенки (внешняя+дырки) + 1 дно.
const ENGRAVE_COLOR = 0x000000;
const engraveColoredMeshesList = [];
gEngrave.traverse((o) => { if (o.isMesh && o.material.color && o.material.color.getHex() === ENGRAVE_COLOR) engraveColoredMeshesList.push(o); });
check("гравировка: 3 цветных меша (внешняя стенка + стенка дырки буквы + дно)",
  engraveColoredMeshesList.length === 3, String(engraveColoredMeshesList.length));
const engraveFloor = engraveColoredMeshesList.filter((o) => o.geometry.type === "ShapeGeometry")[0];
check("гравировка: дно кармана найдено (ShapeGeometry)", !!engraveFloor);
if (engraveFloor) {
  // THREE.ShapeGeometry — индексированная геометрия (треугольники через
  // .index, а не подряд идущими тройками в position)
  const pos = engraveFloor.geometry.attributes.position.array;
  const idx = engraveFloor.geometry.getIndex().array;
  let area = 0;
  for (let i = 0; i < idx.length; i += 3) {
    const a = idx[i] * 3, b = idx[i + 1] * 3, c = idx[i + 2] * 3;
    const ax = pos[a], ay = pos[a + 1], bx = pos[b], by = pos[b + 1], cx = pos[c], cy = pos[c + 1];
    area += Math.abs((bx - ax) * (cy - ay) - (cx - ax) * (by - ay)) / 2;
  }
  check("гравировка: площадь дна буквы с дыркой = 52мм² (60 внешний − 8 дырка), а НЕ 60мм² (регрессия — дырка не вычиталась, дно было сплошным)",
    Math.abs(area - 52) < 0.5, area.toFixed(2));
}
// без гравировки (пустой glyphs) — поведение не меняется (нет лишнего слоя)
const noEngraveModel = Object.assign({}, model, { engraving: { glyphs: [] } });
const gNoEngrave = HC.viewer3d._buildGroup(noEngraveModel);
check("без гравировки (пустой glyphs) — слоёв столько же, сколько без engraving вообще",
  discLayers(gNoEngrave).length === layers.length, String(discLayers(gNoEngrave).length));

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
