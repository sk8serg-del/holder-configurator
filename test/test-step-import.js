// Тест распознавания отверстий в STEP-болванке (js/step-import.js).
// Логика классификации (classifyCylinders/routeHoles/buildDiscEntry) не
// трогает WASM/replicad — тестируется через мок-объект Shape3D, без реального
// CAD-движка (сеть/скачивание тут не нужны, как и в остальных тестах проекта).
// Сам geomType==="CYLINDRE"/Cylinder().Radius()/Location() и разбиение
// одиночных vs составных (посадка+CA) отверстий проверялись вручную на
// реальном replicad+OpenCascade (round-trip: собрать диск в step-export.js,
// импортировать обратно, сверить объём/число отверстий) — здесь фиксируется
// сама логика группировки/классификации.
// Запуск: node test/test-step-import.js
"use strict";
require("../js/step-import.js");
var HC = globalThis.HC;
var stepImport = HC.stepImport;

var failures = 0;
function check(name, cond, detail) {
  if (cond) console.log("  ok   " + name);
  else { failures++; console.log("  FAIL " + name + (detail ? " — " + detail : "")); }
}

// --- classifyCylinders: простое сквозное отверстие (глубина = толщина) ---
var thickness = 6;
var throughHole = stepImport.classifyCylinders(
  [{ r: 3, x: 20, y: 10, z0: -6, z1: 0 }], thickness
);
check("простое сквозное: d = 2r, без seatD/apertureCA",
  throughHole.length === 1 && throughHole[0].d === 6 && throughHole[0].seatD == null,
  JSON.stringify(throughHole));

// --- глухая посадка без зоны напыления (глубина < толщины, один цилиндр) ---
var blindOnly = stepImport.classifyCylinders(
  [{ r: 6, x: -20, y: -10, z0: -3, z1: 0 }], thickness
);
check("глухая посадка без CA: seatD/depth, без d/apertureCA",
  blindOnly.length === 1 && blindOnly[0].seatD === 12 && blindOnly[0].depth === 3 &&
  blindOnly[0].d == null && blindOnly[0].apertureCA == null,
  JSON.stringify(blindOnly));

// --- составное отверстие: посадка (глубже, больше радиус) + сквозная зона напыления ---
var seatPlusAperture = stepImport.classifyCylinders(
  [
    { r: 6, x: -20, y: -10, z0: -3, z1: 0 },   // посадка Ø12, глубина 3
    { r: 2.5, x: -20, y: -10, z0: -6, z1: -3 } // CA Ø5, продолжается до дна
  ],
  thickness
);
check("посадка+CA: seatD=12, depth=3, apertureCA=5",
  seatPlusAperture.length === 1 &&
  seatPlusAperture[0].seatD === 12 && seatPlusAperture[0].depth === 3 && seatPlusAperture[0].apertureCA === 5,
  JSON.stringify(seatPlusAperture));

// --- две независимые оси группируются раздельно (не путаются друг с другом) ---
var twoHoles = stepImport.classifyCylinders(
  [
    { r: 3, x: 20, y: 10, z0: -6, z1: 0 },
    { r: 6, x: -20, y: -10, z0: -3, z1: 0 },
    { r: 2.5, x: -20, y: -10, z0: -6, z1: -3 }
  ],
  thickness
);
check("два отверстия на разных осях — две отдельные группы", twoHoles.length === 2, JSON.stringify(twoHoles));

// --- routeHoles: маршрутизация по Ø полезной зоны (контрольные vs крепёж) ---
var holes = [
  { x: 0, y: 0, d: 6 },          // R=0 — внутри
  { x: 100, y: 0, seatD: 8 },    // R=100 — внутри (discDia/2=150)
  { x: 0, y: 149, d: 4 }         // R=149 — почти на границе, но <150 => внутри
];
var routedInside = stepImport.routeHoles(holes, 298); // R_max = 149
check("routeHoles: без параметра discDia — все в контрольные",
  stepImport.routeHoles(holes, 0).controlHoles.length === 3);

var farHoles = [
  { x: 0, y: 0, d: 6 },      // внутри
  { x: 200, y: 0, d: 4 }     // далеко за пределами полезной зоны Ø298 (R_max=149)
];
var routedMixed = stepImport.routeHoles(farHoles, 298);
check("routeHoles: дальнее отверстие — в fixtures, ближнее — в контрольные",
  routedMixed.controlHoles.length === 1 && routedMixed.fixtureHoles.length === 1 &&
  routedMixed.controlHoles[0].x === 0 && routedMixed.fixtureHoles[0].x === 200,
  JSON.stringify(routedMixed));

// --- analyzeShape: мок Shape3D (без WASM) — внешняя стенка исключается,
// найденные цилиндры классифицируются ---
function mockCylFace(r, x, y, z0, z1) {
  return {
    geomType: "CYLINDRE",
    surface: { wrapped: { Cylinder: function () {
      return { Radius: function () { return r; }, Location: function () { return { X: function () { return x; }, Y: function () { return y; } }; } };
    } } },
    boundingBox: { bounds: [[0, 0, z0], [0, 0, z1]] }
  };
}
var mockShape = {
  boundingBox: { bounds: [[-125, -125, -6], [125, 125, 0]] },
  faces: [
    mockCylFace(125, 0, 0, -6, 0),      // внешняя стенка болванки Ø250
    { geomType: "PLANE" },              // не цилиндр — игнорируется
    mockCylFace(3, 20, 10, -6, 0),      // простое сквозное Ø6
    mockCylFace(6, -20, -10, -3, 0),    // посадка Ø12 глубиной 3
    mockCylFace(2.5, -20, -10, -6, -3)  // CA Ø5 (та же ось, что и посадка)
  ]
};
var analyzed = stepImport.analyzeShape(mockShape);
check("analyzeShape: Ø болванки = 250 (внешняя стенка, не отверстие)",
  analyzed.blankDiameter === 250, analyzed.blankDiameter);
check("analyzeShape: толщина = 6", analyzed.thickness === 6, analyzed.thickness);
check("analyzeShape: найдено ровно 2 отверстия (простое + составное)",
  analyzed.holes.length === 2, JSON.stringify(analyzed.holes));

// --- buildDiscEntry: полная запись диска, роутинг фланцевого крепежа ---
var mockShapeWithFlange = {
  boundingBox: { bounds: [[-162, -162, -6], [162, 162, 0]] },
  faces: [
    mockCylFace(162, 0, 0, -6, 0),        // внешняя стенка (полный диск с фланцем)
    mockCylFace(12.7, 0, 0, -4.5, 0),     // контрольное отверстие в центре (внутри зоны Ø298)
    mockCylFace(3, 156, 4, -2.5, 0)       // крепёж на фланце (далеко за Ø298/2=149)
  ]
};
var entry = stepImport.buildDiscEntry(mockShapeWithFlange, { id: "user-test", name: "Тестовый диск", discDiameter: 298, thickness: 6 });
check("buildDiscEntry: контрольное отверстие в центре попало в controlVariants.std",
  entry.controlVariants[0].holes.length === 1 && entry.controlVariants[0].holes[0].seatD === 25.4,
  JSON.stringify(entry.controlVariants[0].holes));
check("buildDiscEntry: дальний крепёж попал в fixtures.holes, не в контрольные",
  entry.fixtures.holes.length === 1 && entry.fixtures.holes[0].points.length === 1,
  JSON.stringify(entry.fixtures));
check("buildDiscEntry: blankDiameter = 324 (внешняя стенка)", entry.blankDiameter === 324, entry.blankDiameter);
check("buildDiscEntry: второй вариант «без контрольных» есть и пуст",
  entry.controlVariants[1].id === "none" && entry.controlVariants[1].holes.length === 0);

console.log(failures ? "\nПРОВАЛЕНО: " + failures : "\nТест импорта STEP пройден.");
process.exit(failures ? 1 : 0);
