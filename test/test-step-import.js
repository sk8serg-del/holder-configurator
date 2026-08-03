// Тест распознавания отверстий в STEP-болванке (js/step-import.js).
// Логика классификации (classifyCylinders/keepoutsFromHoles/buildBlankSummary)
// не трогает WASM/replicad — тестируется через мок-объект Shape3D, без реального
// CAD-движка (сеть/скачивание тут не нужны, как и в остальных тестах проекта).
// Сам geomType==="CYLINDRE"/Cylinder().Radius()/Location() и разбиение
// одиночных vs составных (посадка+CA) отверстий проверялись вручную на
// реальном replicad+OpenCascade (round-trip: собрать диск в step-export.js,
// импортировать обратно, сверить объём/число отверстий) — здесь фиксируется
// сама логика группировки/классификации.
// Запуск: node test/test-step-import.js
"use strict";
require("../js/geometry.js");
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

// --- регрессия: Inventor иногда режет ОДНУ цилиндрическую грань на две
// одинаковые половины (шов BREP) — дубликат раньше занимал место реальной
// CA-грани при сортировке по радиусу, и apertureCA получался равным seatD ---
var seatDup = stepImport.classifyCylinders(
  [
    { r: 6, x: -20, y: -10, z0: -3, z1: 0 },   // посадка Ø12, глубина 3
    { r: 6, x: -20, y: -10, z0: -3, z1: 0 },   // ТА ЖЕ посадка — дубликат-половинка
    { r: 2.5, x: -20, y: -10, z0: -6, z1: -3 } // настоящая CA Ø5
  ],
  thickness
);
check("дубликат грани посадки не крадёт место у настоящей CA",
  seatDup.length === 1 && seatDup[0].seatD === 12 && seatDup[0].apertureCA === 5,
  JSON.stringify(seatDup));

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

// --- регрессия (реальный STEP из Inventor): паз под пинцет рушит круглую
// посадку на дуги (уже схлопывается группировкой по оси — см. выше), а сам
// паз выдаёт себя маленьким цилиндром-«колпачком» на СВОЕЙ, смещённой оси —
// радиус колпачка = половина ширины паза (HC.geom.slotWidth) для Ø посадки.
// Раньше колпачок вылезал как отдельное фантомное «отверстие» ---
var seatD = 25.6; // Ø посадки — как «Свидетель Центр» в реальном файле
var capR = Math.min(9, seatD * 0.75) / 2; // 4.5 — половина ширины паза
var capX = 9.353, capY = 5.4; // офсет колпачка от центра посадки (30°, r≈10.8)
var withSlotCap = stepImport.classifyCylinders(
  [
    { r: seatD / 2, x: 0, y: 0, z0: 1.5, z1: 6 },      // посадка Ø25.6
    { r: 22.6 / 2, x: 0, y: 0, z0: 0, z1: 1.5 },        // зона напыления Ø22.6
    { r: capR, x: capX, y: capY, z0: 1.5, z1: 6 }       // колпачок паза (своя ось!)
  ],
  6
);
check("колпачок паза не остаётся отдельным фантомным отверстием — найдена ровно 1 группа",
  withSlotCap.length === 1, JSON.stringify(withSlotCap));
check("паз присвоен родительскому отверстию: slotAvailable=true, угол ≈30°",
  withSlotCap[0].slotAvailable === true && Math.abs(withSlotCap[0].slotAngle - 30) < 0.1,
  JSON.stringify(withSlotCap[0]));

// --- без паза (например, Reference) — колпачка нет, лишних отверстий тоже нет ---
var noSlotCap = stepImport.classifyCylinders(
  [
    { r: 30.1 / 2, x: -102.176, y: 43.371, z0: 3, z1: 6 },
    { r: 24.2 / 2, x: -102.176, y: 43.371, z0: 0, z1: 3 }
  ],
  6
);
check("без паза: одна группа, slotAvailable не выставлен",
  noSlotCap.length === 1 && !noSlotCap[0].slotAvailable, JSON.stringify(noSlotCap));

// --- маленький цилиндр рядом, но НЕ подходящего радиуса — настоящий сосед
// (напр. крепёж), а не колпачок паза; не должен ни поглощаться, ни путать паз ---
var unrelatedNeighbor = stepImport.classifyCylinders(
  [
    { r: seatD / 2, x: 0, y: 0, z0: 1.5, z1: 6 },
    { r: 22.6 / 2, x: 0, y: 0, z0: 0, z1: 1.5 },
    { r: 1.65, x: 9, y: 5, z0: 0, z1: 6 } // Ø3.3 сквозное — случайно рядом, но радиус не совпадает с колпачком (4.5)
  ],
  6
);
check("сосед с несовпадающим радиусом — отдельное настоящее отверстие, паз не выставлен",
  unrelatedNeighbor.length === 2 && !unrelatedNeighbor.some(function (h) { return h.slotAvailable; }),
  JSON.stringify(unrelatedNeighbor));

// --- keepoutsFromHoles: отверстие → плоская запретная зона (кружок),
// радиус — по максимальному реальному размеру (посадка/сквозное/CA) ---
var keepouts = stepImport.keepoutsFromHoles([
  { x: 0, y: 0, d: 6 },                                  // простое сквозное
  { x: 100, y: 0, seatD: 25.6, apertureCA: 22.6 },        // составное — берём большее (посадку)
  { x: 50, y: 50, seatD: 0, d: 0, apertureCA: 0 }         // вырожденное — отфильтровывается
]);
check("keepoutsFromHoles: 2 зоны (вырожденная без размера отброшена)", keepouts.length === 2, JSON.stringify(keepouts));
check("keepoutsFromHoles: r = d/2 для простого сквозного", keepouts[0].r === 3, JSON.stringify(keepouts[0]));
check("keepoutsFromHoles: r = seatD/2 (больше apertureCA) для составного", keepouts[1].r === 12.8, JSON.stringify(keepouts[1]));

// --- keepoutsFromHoles + groupKeepoutsByDiameter: составная/глухая посадка
// (seatD/apertureCA/depth/паз) должна пережить упрощение до плоской
// запретной зоны — иначе 3D «Lite» (реконструкция из уже разобранной
// болванки, viewer3d.js buildGroup/collectFeatures) режет её то насквозь
// целиком (посадка без глубины), то глухим карманом без CA под ним (глубина
// без CA) — обе регрессии уже были и исправлены здесь. Простой крепёж
// (только h.d, ни seatD ни apertureCA) — как был плоским [x,y], так и остаётся. ---
var slottedKeepouts = stepImport.keepoutsFromHoles([
  { x: 0, y: 0, seatD: 25.6, apertureCA: 22.6, depth: 3, slotAvailable: true, slotAngle: 30 }, // составная + паз
  { x: 100, y: 0, seatD: 30.1, apertureCA: 24.2, depth: 3, slotAvailable: false },              // составная, без паза (Reference)
  { x: -100, y: 0, d: 6 }                                                                       // простой крепёжный болт
]);
check("keepoutsFromHoles: slotAvailable/slotAngle/seatD/apertureCA/depth перенесены для отверстия с пазом",
  slottedKeepouts[0].slotAvailable === true && slottedKeepouts[0].slotAngle === 30 &&
  slottedKeepouts[0].seatD === 25.6 && slottedKeepouts[0].apertureCA === 22.6 && slottedKeepouts[0].depth === 3,
  JSON.stringify(slottedKeepouts[0]));
check("keepoutsFromHoles: составная без паза — seatD/apertureCA/depth есть, slotAvailable=false",
  slottedKeepouts[1].slotAvailable === false && slottedKeepouts[1].seatD === 30.1 && slottedKeepouts[1].apertureCA === 24.2,
  JSON.stringify(slottedKeepouts[1]));
check("keepoutsFromHoles: простой болт — seatD/apertureCA/depth не заданы",
  slottedKeepouts[2].seatD === undefined && slottedKeepouts[2].apertureCA === undefined && slottedKeepouts[2].depth === undefined,
  JSON.stringify(slottedKeepouts[2]));

var slottedGroups = stepImport.groupKeepoutsByDiameter(slottedKeepouts);
var seatGroup = slottedGroups.filter(function (g) { return g.d === 25.6; })[0];
var refGroup = slottedGroups.filter(function (g) { return g.d === 30.1; })[0];
var boltGroup = slottedGroups.filter(function (g) { return g.d === 6; })[0];
check("groupKeepoutsByDiameter: составная с пазом — [x,y,slotAngle,depth,apertureCA] (5 элементов), ГЛУХАЯ, не сквозная",
  seatGroup && seatGroup.points[0].length === 5 && seatGroup.points[0][2] === 30 && seatGroup.points[0][3] === 3 && seatGroup.points[0][4] === 22.6,
  JSON.stringify(seatGroup));
check("groupKeepoutsByDiameter: составная без паза — тоже 5 элементов (slotAngle=null), CA сохранена",
  refGroup && refGroup.points[0].length === 5 && refGroup.points[0][2] === null && refGroup.points[0][4] === 24.2,
  JSON.stringify(refGroup));
check("groupKeepoutsByDiameter: простой крепёжный болт — [x,y] (2 элемента), как и раньше",
  boltGroup && boltGroup.points[0].length === 2, JSON.stringify(boltGroup));

// --- mergeDogboneHoles: вырез-«гантель» (два лепестка + прямая перемычка) —
// найден на реальном файле технолога (Ø7.5 простое + Ø6/Ø4 составное, 8.2мм
// друг от друга, между ними — две плоские грани на всю толщину). Без учёта
// перемычки лепестки распознавались бы как два независимых отверстия, а
// материал между ними (реально вырезанный) не попадал в запретную зону —
// деталь могла бы встать прямо в перемычку. Числа — из реального файла. ---
var dogboneHoles = [
  { x: 137.536456887764, y: -74.6724382001832, d: 7.5 },                              // лепесток 1 — простое Ø7.5
  { x: 133.436456887764, y: -81.7738465112155, seatD: 6, apertureCA: 4, depth: 2.5 }  // лепесток 2 — составное Ø6/Ø4
];
var dogboneWalls = [
  { cx: 136.435, cy: -80.809 }, // реальные координаты бортов перемычки (PLANE #50/#56)
  { cx: 132.773, cy: -78.695 }
];
var dogboneResult = stepImport.mergeDogboneHoles(dogboneHoles, dogboneWalls);
check("mergeDogboneHoles: оба лепестка поглощены (holes пуст)",
  dogboneResult.holes.length === 0, JSON.stringify(dogboneResult.holes));
check("mergeDogboneHoles: keepouts включают оба лепестка (r=3.75 и r=3) плюс промежуточные кружки перемычки",
  dogboneResult.dogboneKeepouts.some(function (k) { return Math.abs(k.r - 3.75) < 0.01; }) &&
  dogboneResult.dogboneKeepouts.some(function (k) { return Math.abs(k.r - 3) < 0.01; }) &&
  dogboneResult.dogboneKeepouts.length > 2,
  JSON.stringify(dogboneResult.dogboneKeepouts));

// --- регрессия: две МЕЛКИЕ метки-ориентиры (r=1 каждая), случайно оказавшиеся
// в 6.45мм друг от друга рядом с той же стенкой, — гантелью считаться НЕ
// должны (перемычка длиннее суммы их радиусов в разы — не похоже на
// настоящую гантель, где лепестки почти соприкасаются через узкую перемычку) ---
var markHoles = [
  { x: 138.592401732196, y: -79.3035806602591, d: 2 },
  { x: 132.997797446578, y: -76.0735343699482, d: 2 }
];
var markResult = stepImport.mergeDogboneHoles(markHoles, dogboneWalls);
check("mergeDogboneHoles: далёкие мелкие метки НЕ объединяются в гантель (ложное срабатывание)",
  markResult.holes.length === 2 && markResult.dogboneKeepouts.length === 0,
  JSON.stringify(markResult));

// --- dogboneRealOutline/pathFragments: НАСТОЯЩИЙ контур гантели прямо из
// вида сверху (а не приближение кружками) — см. вживую проверено на реальном
// файле (scratchpad, replicad+WASM): 3 гантели дали чистые контуры без
// самопересечений, площадь 91.8-96.8мм². Здесь — только проверка МОНТАЖА
// (pathFragments доходят до mergeDogboneHoles и дают fixtures.cutouts),
// без WASM — простые окружности-моки вместо настоящих кривых со скруглениями.
function circlePathD(cx, cy, r) {
  return "M " + (cx - r) + " " + cy +
    " A " + r + " " + r + " 0 1 0 " + (cx + r) + " " + cy +
    " A " + r + " " + r + " 0 1 0 " + (cx - r) + " " + cy + " Z";
}
var dogbonePathFragments = [
  circlePathD(137.536456887764, -74.6724382001832, 3.75), // лепесток 1
  circlePathD(133.436456887764, -81.7738465112155, 3)     // лепесток 2 (посадка, не апертура — max(seatD,apertureCA))
];
var dogboneWithOutline = stepImport.mergeDogboneHoles(dogboneHoles, dogboneWalls, dogbonePathFragments);
check("mergeDogboneHoles+pathFragments: dogboneCutouts — ровно один контур на пару лепестков",
  dogboneWithOutline.dogboneCutouts.length === 1, JSON.stringify(dogboneWithOutline.dogboneCutouts.map(function (c) { return c.points.length; })));
check("mergeDogboneHoles+pathFragments: контур — многоугольник (не вырожденный), достаточно точек",
  dogboneWithOutline.dogboneCutouts[0].points.length >= 8, dogboneWithOutline.dogboneCutouts[0].points.length);
check("mergeDogboneHoles+pathFragments: без pathFragments (как раньше) — dogboneCutouts пуст, keepouts не меняются",
  dogboneResult.dogboneCutouts.length === 0 && dogboneResult.dogboneKeepouts.length === dogboneWithOutline.dogboneKeepouts.length,
  JSON.stringify(dogboneResult.dogboneCutouts));

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
    { geomType: "PLANE", boundingBox: { bounds: [[-125, -125, 0], [125, 125, 0]] } }, // верх диска — не борт перемычки (zSpan=0), игнорируется
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

// --- регрессия: декоративная канавка маски (кольцевая, та же ось 0,0, что и
// центральное контрольное отверстие) не должна поглощать реальное отверстие —
// раньше канавка (больший радиус) занимала место seatD/apertureCA, и
// настоящее отверстие в центре терялось целиком ---
var mockShapeGroove = {
  boundingBox: { bounds: [[-162, -162, -6], [162, 162, 0]] },
  faces: [
    mockCylFace(162, 0, 0, -6, 0),        // внешняя стенка болванки Ø324
    mockCylFace(151.75, 0, 0, -2, 0),     // канавка — внешняя стенка (Ø303.5), та же ось
    mockCylFace(148.75, 0, 0, -2, 0),     // канавка — внутренняя стенка (Ø297.5)
    mockCylFace(12.8, 0, 0, -4.5, 0),     // настоящее контрольное отверстие: посадка Ø25.6
    mockCylFace(11.3, 0, 0, -6, -4.5)     // настоящее контрольное отверстие: CA Ø22.6
  ]
};
var analyzedGroove = stepImport.analyzeShape(mockShapeGroove);
check("канавка не попадает в отверстия — найдено ровно одно (реальное, в центре)",
  analyzedGroove.holes.length === 1, JSON.stringify(analyzedGroove.holes));
check("реальное центральное отверстие не искажено канавкой (seatD=25.6, apertureCA=22.6)",
  analyzedGroove.holes[0] && analyzedGroove.holes[0].seatD === 25.6 && analyzedGroove.holes[0].apertureCA === 22.6,
  JSON.stringify(analyzedGroove.holes[0]));
check("канавка распознана отдельно (outer=303.5, inner=297.5, depth=2)",
  analyzedGroove.grooves.length === 1 && analyzedGroove.grooves[0].outer === 303.5 &&
  analyzedGroove.grooves[0].inner === 297.5 && analyzedGroove.grooves[0].depth === 2,
  JSON.stringify(analyzedGroove.grooves));

// одиночная (без пары) отсеянная по радиусу грань — не канавка (ничего не
// вырезано, просто крупная одиночная стенка), пропускается
var mockShapeSingleWall = {
  boundingBox: { bounds: [[-162, -162, -6], [162, 162, 0]] },
  faces: [
    mockCylFace(162, 0, 0, -6, 0),
    mockCylFace(151.75, 0, 0, -2, 0), // одна крупная стенка без пары
    mockCylFace(12.8, 0, 0, -4.5, 0),
    mockCylFace(11.3, 0, 0, -6, -4.5)
  ]
};
var analyzedSingleWall = stepImport.analyzeShape(mockShapeSingleWall);
check("одиночная отсеянная стенка без пары — канавка не создаётся", analyzedSingleWall.grooves.length === 0, JSON.stringify(analyzedSingleWall.grooves));

// --- buildBlankSummary: полная запись диска — БЕЗ именованных контрольных
// отверстий, все найденные отверстия (и в центре, и на фланце) — плоские
// запретные зоны в fixtures.holes ---
var mockShapeWithFlange = {
  boundingBox: { bounds: [[-162, -162, -6], [162, 162, 0]] },
  faces: [
    mockCylFace(162, 0, 0, -6, 0),        // внешняя стенка (полный диск с фланцем)
    mockCylFace(12.7, 0, 0, -4.5, 0),     // отверстие в центре (внутри зоны Ø298) — Ø25.4
    mockCylFace(3, 156, 4, -2.5, 0)       // крепёж на фланце (далеко за Ø298/2=149) — Ø6
  ]
};
var entry = stepImport.buildBlankSummary(mockShapeWithFlange, {
  id: "user-test", name: "Тестовая болванка", installation: "Ortus 900", discDiameter: 298, thickness: 6, previewSVG: "<svg/>"
});
check("buildBlankSummary: controlVariants пуст (нечего называть)",
  entry.controlVariants.length === 1 && entry.controlVariants[0].id === "none" && entry.controlVariants[0].holes.length === 0,
  JSON.stringify(entry.controlVariants));
check("buildBlankSummary: оба отверстия — запретные зоны в fixtures.holes (2 группы, по 1 точке)",
  entry.fixtures.holes.length === 2 && entry.fixtures.holes.every(function (g) { return g.points.length === 1; }),
  JSON.stringify(entry.fixtures.holes));
check("buildBlankSummary: центральное отверстие Ø25.4 среди запретных зон",
  entry.fixtures.holes.some(function (g) { return g.d === 25.4 && g.points[0][0] === 0 && g.points[0][1] === 0; }),
  JSON.stringify(entry.fixtures.holes));
check("buildBlankSummary: blankDiameter = 324 (внешняя стенка)", entry.blankDiameter === 324, entry.blankDiameter);
check("buildBlankSummary: installation/previewSVG сохранены", entry.installation === "Ortus 900" && entry.previewSVG === "<svg/>",
  JSON.stringify([entry.installation, entry.previewSVG]));

// --- buildBlankSummary: паз/канавка не портят список запретных зон (паз
// поглощён, не даёт лишней зоны; канавка не попадает в fixtures.holes вовсе,
// только в fixtures.grooves) ---
var mockShapeFull = {
  boundingBox: { bounds: [[-162, -162, -6], [162, 162, 0]] },
  faces: [
    mockCylFace(162, 0, 0, -6, 0),         // внешняя стенка
    mockCylFace(151.75, 0, 0, -2, 0),      // канавка — наружная стенка
    mockCylFace(148.75, 0, 0, -2, 0),      // канавка — внутренняя стенка
    mockCylFace(12.8, 0, 0, -4.5, 0),      // посадка Ø25.6 в центре
    mockCylFace(11.3, 0, 0, -6, -4.5),     // CA Ø22.6
    mockCylFace(4.5, 9.353, 5.4, -4.5, 0)  // колпачок паза (своя ось, угол 30°) — не своя запретная зона
  ]
};
var entryFull = stepImport.buildBlankSummary(mockShapeFull, { id: "user-test2", name: "Диск с пазом", discDiameter: 298, thickness: 6 });
check("buildBlankSummary: ровно одна запретная зона в центре (колпачок паза не создал вторую)",
  entryFull.fixtures.holes.length === 1 && entryFull.fixtures.holes[0].points.length === 1 && entryFull.fixtures.holes[0].d === 25.6,
  JSON.stringify(entryFull.fixtures.holes));
check("buildBlankSummary: канавка доходит до fixtures.grooves",
  entryFull.fixtures.grooves.length === 1 && entryFull.fixtures.grooves[0].outer === 303.5,
  JSON.stringify(entryFull.fixtures.grooves));

// --- combineProjectionSVG: паз под пинцет и занижение с обратной стороны у
// реальных STEP-файлов из Inventor попадают в .hidden, а не .visible (OCC
// помечает их скрытыми по правилам техчерчения) — проверено на реальном
// файле технолога (см. scratchpad diag-slot-projection.cjs). Оба набора
// объединяются ОДНОЙ сплошной линией (без пунктира для .hidden) — иначе
// картинка внешне похожа на вид снизу/зеркальный (только STEP-болванки
// рисовались бы иначе, чем CSV/конструктор — те везде сплошным). ---
var visibleSVG = '<svg version="1.1" xmlns="http://www.w3.org/2000/svg" viewBox="-10 -10 20 20" fill="none" stroke="black"><path d="M 9 0 A 9 9 0 1 1 -9 0 Z"/></svg>';
var hiddenSVG = '<svg version="1.1" xmlns="http://www.w3.org/2000/svg" viewBox="-10 -10 20 20" fill="none" stroke="black"><path d="M 8 0 A 8 8 0 1 1 -8 0 Z"/></svg>';
var combined = stepImport.combineProjectionSVG(visibleSVG, hiddenSVG);
check("combineProjectionSVG: видимый контур сохранён", combined.indexOf("A 9 9") !== -1, combined);
check("combineProjectionSVG: скрытый контур (паз/занижение с обратной стороны) добавлен", combined.indexOf("A 8 8") !== -1, combined);
check("combineProjectionSVG: скрытый контур — той же сплошной линией, БЕЗ пунктира (единообразно с CSV/конструктором)",
  combined.indexOf("stroke-dasharray") === -1, combined);
check("combineProjectionSVG: без .hidden просто возвращает .visible как есть", stepImport.combineProjectionSVG(visibleSVG, null) === visibleSVG);
check("combineProjectionSVG: пустой .hidden (нет скрытых рёбер) — тоже просто .visible", stepImport.combineProjectionSVG(visibleSVG, '<svg viewBox="0 0 1 1"></svg>') === visibleSVG);

console.log(failures ? "\nПРОВАЛЕНО: " + failures : "\nТест импорта STEP пройден.");
process.exit(failures ? 1 : 0);
