// Тест гравировки номера/названия подложкодержателя (js/engraving.js).
// classifyLoops/collectObstacles/findFreeArc/computeLayout — чистая логика,
// без WASM: рёплика rep.drawText().toSVGPaths() подставлена мок-объектом
// (та же идея, что и мок-Shape3D в test-step-import.js). Сама загрузка
// шрифта/replicad (HC.engraving.loadFont) не трогает WASM/сеть в этом
// файле — не тестируется в Node (как и весь остальной WASM-код проекта).
// Запуск: node test/test-engraving.js
"use strict";
require("../js/geometry.js");
require("../js/engraving.js");
var HC = globalThis.HC;
var eng = HC.engraving;

var failures = 0;
function check(name, cond, detail) {
  if (cond) console.log("  ok   " + name);
  else { failures++; console.log("  FAIL " + name + (detail ? " — " + detail : "")); }
}

// --- classifyLoops: один сплошной контур + один (внешний+дырка) ---
var solidSquare = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }];
var outerSquare = [{ x: 20, y: 0 }, { x: 30, y: 0 }, { x: 30, y: 10 }, { x: 20, y: 10 }];
var innerHole = [{ x: 22, y: 2 }, { x: 28, y: 2 }, { x: 28, y: 8 }, { x: 22, y: 8 }];
var classified = eng.classifyLoops([solidSquare, outerSquare, innerHole]);
check("classifyLoops: два внешних контура (сплошной квадрат + квадрат-рамка)", classified.length === 2, classified.length);
var frameOuter = classified.filter(function (o) { return o.points === outerSquare; })[0];
check("classifyLoops: дырка приписана контуру-рамке", frameOuter && frameOuter.holes.length === 1 && frameOuter.holes[0] === innerHole);
var solidOuter = classified.filter(function (o) { return o.points === solidSquare; })[0];
check("classifyLoops: у сплошного квадрата дырок нет", solidOuter && solidOuter.holes.length === 0);

// --- collectObstacles: круглая деталь, крепёж, контрольное отверстие с пазом, вырез-полигон ---
var model1 = {
  discDiameter: 200,
  placed: [{ type: "circle", cx: 50, cy: 0, d: 10 }],
  controlHoles: [{ x: 0, y: 60, d: 6, slotOn: true }],
  fixtures: {
    holes: [{ d: 4, points: [[70, 70]] }],
    cutouts: [{ points: [[90, 0], [95, 5]] }]
  }
};
var obs = eng.collectObstacles(model1);
check("collectObstacles: круглая деталь — r=d/2", obs.some(function (o) { return o.x === 50 && o.y === 0 && Math.abs(o.r - 5) < 1e-9; }), JSON.stringify(obs));
check("collectObstacles: контрольное отверстие с пазом — запас 2.5мм", obs.some(function (o) { return o.x === 0 && o.y === 60 && Math.abs(o.r - (3 + 2.5)) < 1e-9; }), JSON.stringify(obs));
check("collectObstacles: крепёж болванки — r=d/2", obs.some(function (o) { return o.x === 70 && o.y === 70 && Math.abs(o.r - 2) < 1e-9; }), JSON.stringify(obs));
check("collectObstacles: точки фигурного выреза — r=0 (просто точки контура)", obs.some(function (o) { return o.x === 90 && o.y === 0 && o.r === 0; }) && obs.some(function (o) { return o.x === 95 && o.y === 5 && o.r === 0; }));

// --- регрессия: гравировка налезала на реальный вырез под деталь — охват
// детали считался по «просто d»/базовым w×h, без посадки (seatD/seatGap) и
// паза (+2.5мм торчит за посадку, см. packer.js slotPad) ---
var model2 = {
  discDiameter: 200,
  placed: [
    { type: "circle", cx: 50, cy: 0, d: 10, seatD: 16, apertureCA: 12, slotOn: true }, // посадка 16 > d=10, плюс паз
    { type: "rect", cx: 0, cy: -50, w: 10, h: 6, chamfer: 0, rot: 0, seatGap: 3, slotOn: false } // посадка шире базовых w×h на 3мм с каждой стороны
  ],
  controlHoles: [], fixtures: { holes: [], cutouts: [] }
};
var obs2 = eng.collectObstacles(model2);
check("collectObstacles: круглая деталь — охват по max(d,seatD,apertureCA)=16 + паз 2.5, не по d=10",
  obs2.some(function (o) { return o.x === 50 && o.y === 0 && Math.abs(o.r - (8 + 2.5)) < 1e-6; }), JSON.stringify(obs2));
check("collectObstacles: прямоугольная деталь — охват учитывает seatGap (посадка шире базовых w×h)",
  obs2.some(function (o) { return o.x === 0 && o.y === -50 && o.r > Math.hypot(5, 3) + 1e-6; }), JSON.stringify(obs2));

// --- регрессия: фигурный вырез с редкими вершинами (простой прямоугольный
// фланец, всего 4 угла) — рёбра между вершинами не должны оставаться
// «невидимыми» для поиска свободной дуги (досэмплированы через ~2мм) ---
var model3 = { discDiameter: 200, placed: [], controlHoles: [],
  fixtures: { holes: [], cutouts: [{ points: [[80, -10], [80, 10], [100, 10], [100, -10]] }] } };
var obs3 = eng.collectObstacles(model3);
check("collectObstacles: длинное ребро фигурного выреза (20мм) досэмплировано, не только 4 вершины",
  obs3.length > 4, String(obs3.length));
check("collectObstacles: досэмплированная точка есть на середине длинного ребра (80,0)",
  obs3.some(function (o) { return Math.abs(o.x - 80) < 1e-6 && Math.abs(o.y) < 1e-6; }), JSON.stringify(obs3));

// --- findFreeArc: препятствие на 0°, полоса 90..100 — дуга должна найтись в стороне ---
var modelBlock0 = { discDiameter: 200, placed: [{ type: "circle", cx: 95, cy: 0, d: 6 }], controlHoles: [], fixtures: { holes: [], cutouts: [] } };
var arc1 = eng.findFreeArc(modelBlock0, 90, 100, 0.3, 1);
check("findFreeArc: свободная дуга найдена (не полностью занято)", !!arc1);
check("findFreeArc: свободная дуга вмещает требуемую ширину (fits=true)", arc1 && arc1.fits === true, JSON.stringify(arc1));
check("findFreeArc: центр найденной дуги НЕ у препятствия (не рядом с 0°)", arc1 && Math.abs(((arc1.center + Math.PI) % (2 * Math.PI)) - Math.PI) > 0.2, arc1 && arc1.center);

// --- findFreeArc: препятствия ПОЛНОСТЬЮ окружают полосу — дуги нет вообще ---
var modelFullyBlocked = { discDiameter: 200, placed: [], controlHoles: [], fixtures: { holes: [{ d: 6, points: (function () {
  // шаг 2° — с запасом перекрывает угловое покрытие каждого препятствия
  // (r=3+clearance=1=4мм на радиусе 95 -> ~4.8° ширины, шаг 5° оставлял бы щели)
  var pts = []; for (var a = 0; a < 360; a += 2) pts.push([95 * Math.cos(a * Math.PI / 180), 95 * Math.sin(a * Math.PI / 180)]); return pts;
})() }], cutouts: [] } };
var arc2 = eng.findFreeArc(modelFullyBlocked, 90, 100, 0.3, 1);
check("findFreeArc: полностью занятая полоса — дуги нет (null)", arc2 === null, arc2);

// --- computeLayout: мок rep.drawText — 2 "символа" (простой квадрат + квадрат с дыркой),
// чтобы проверить масштаб, порядок чтения (первый символ — БОЛЬШИЙ угол, см. вывод в engraving.js)
// и что дырка реально попадает в holes выходного глифа.
var mockRep = {
  drawText: function () {
    return {
      toSVGPaths: function () {
        return [
          ["M 0 0 L 10 0 L 10 10 L 0 10 Z"],
          ["M 20 0 L 30 0 L 30 10 L 20 10 Z", "M 22 2 L 28 2 L 28 8 L 22 8 Z"]
        ];
      }
    };
  }
};
var modelOpen = { discDiameter: 200, placed: [], controlHoles: [], fixtures: { holes: [], cutouts: [] } };
var layout = eng.computeLayout(mockRep, modelOpen, "AB");
check("computeLayout: непустой текст на открытом диске — есть результат", !!layout);
check("computeLayout: 2 символа — 2 глифа", layout && layout.glyphs.length === 2, layout && layout.glyphs.length);
check("computeLayout: второй глиф (с дыркой в моке) имеет ровно 1 дырку", layout && layout.glyphs[1].holes.length === 1, layout && JSON.stringify(layout.glyphs[1].holes.length));
check("computeLayout: первый глиф дырок не имеет", layout && layout.glyphs[0].holes.length === 0);
check("computeLayout: fits=true на пустом диске", layout && layout.fits === true);

// poly — массив команд контура {cmd,x,y[,cx,cy]}, см. HC.geom.parseSVGPathCommands
function avgAngle(poly) {
  var ax = 0, ay = 0;
  poly.forEach(function (p) { ax += p.x; ay += p.y; });
  return Math.atan2(ay / poly.length, ax / poly.length);
}
// сравнение углов с учётом переноса через ±π (по умолчанию, без препятствий,
// findFreeArc центрирует текст ровно на 180° — угол первой буквы может
// оказаться чуть БОЛЬШЕ π и обернуться в отрицательный через atan2)
function angleDiff(a, b) {
  var d = a - b;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return d;
}
check("computeLayout: первый символ (мельше x в исходнике) — БОЛЬШИЙ угол, чем второй (порядок чтения слева направо не зеркалит)",
  layout && angleDiff(avgAngle(layout.glyphs[0].outer), avgAngle(layout.glyphs[1].outer)) > 0,
  layout && [avgAngle(layout.glyphs[0].outer), avgAngle(layout.glyphs[1].outer)]);

// все точки — в разумном радиусе от центра (внутри диска, за пределами отступа)
if (layout) {
  var R = modelOpen.discDiameter / 2;
  var allPts = [];
  layout.glyphs.forEach(function (gl) { allPts = allPts.concat(gl.outer); gl.holes.forEach(function (h) { allPts = allPts.concat(h); }); });
  var okRadius = allPts.every(function (p) { var r = Math.hypot(p.x, p.y); return r > 0 && r < R - HC.ENGRAVE_OFFSET + 0.5; });
  check("computeLayout: все точки внутри диска, за пределами отступа от края", okRadius);
}

// --- регрессия: текст, который целиком НЕ влезает ни в один промежуток между
// частым крепежом у края (реальный случай — диск Ø300, 12 отверстий на
// Ø290мм, номер+название длиннее свободного зазора между соседними
// отверстиями) — раньше он всё равно впихивался в самый широкий промежуток
// «как есть», реально накладываясь на соседние отверстия. Теперь высота букв
// уменьшается (не ниже ENGRAVE_MIN_TEXT_HEIGHT), пока не найдётся дуга, куда
// текст влезает ЦЕЛИКОМ. ---
function mockRepWideText(charCount) {
  return {
    drawText: function () {
      var arr = [];
      for (var i = 0; i < charCount; i++) {
        var x0 = i * 10;
        arr.push(["M " + x0 + " 0 L " + (x0 + 8) + " 0 L " + (x0 + 8) + " 10 L " + x0 + " 10 Z"]);
      }
      return { toSVGPaths: function () { return arr; } };
    }
  };
}
var modelTightHoles = { discDiameter: 300, blankDiameter: 300, placed: [], controlHoles: [],
  fixtures: { holes: [{ d: 4, points: (function () {
    var pts = []; for (var a = 0; a < 360; a += 30) pts.push([145 * Math.cos(a * Math.PI / 180), 145 * Math.sin(a * Math.PI / 180)]); return pts;
  })() }], cutouts: [] } };
// при полной высоте (ENGRAVE_TEXT_HEIGHT) 40 "символов" шириной ~10мм каждый
// (после масштабирования к высоте 3мм) гарантированно шире 30°-промежутка
var layoutWide = eng.computeLayout(mockRepWideText(40), modelTightHoles, "widetext");
check("computeLayout: длинный текст на частом крепеже — результат есть (не null)", !!layoutWide);
if (layoutWide) {
  check("computeLayout: длинный текст — влезло ЦЕЛИКОМ (fits=true), не best-effort с наложением",
    layoutWide.fits === true, JSON.stringify({ fits: layoutWide.fits, height: layoutWide.textHeight }));
  check("computeLayout: высота уменьшена ниже максимума (не влезал в 3мм ни в один промежуток)",
    layoutWide.textHeight < HC.ENGRAVE_TEXT_HEIGHT, layoutWide.textHeight);
  check("computeLayout: высота не мельче минимума (HC.ENGRAVE_MIN_TEXT_HEIGHT)",
    layoutWide.textHeight >= HC.ENGRAVE_MIN_TEXT_HEIGHT - 1e-9, layoutWide.textHeight);
  // реальная проверка: ни одна точка контура не ближе 1мм (clearance) к любому отверстию
  var holes = modelTightHoles.fixtures.holes[0].points, hr = modelTightHoles.fixtures.holes[0].d / 2;
  var allPtsWide = [];
  layoutWide.glyphs.forEach(function (gl) { allPtsWide = allPtsWide.concat(gl.outer); });
  var minGap = Infinity;
  holes.forEach(function (h) {
    allPtsWide.forEach(function (p) { var d = Math.hypot(p.x - h[0], p.y - h[1]) - hr; if (d < minGap) minGap = d; });
  });
  check("computeLayout: реальный зазор до ближайшего отверстия крепежа положительный (нет наложения)",
    minGap > 0, minGap.toFixed(2));
}

// --- computeOrderEngraving: номер+название одной строкой не влезают НИ В
// ОДИН промежуток (даже с уменьшением высоты), но КАЖДЫЙ по отдельности —
// влезает: разбивается на два фрагмента в разных промежутках, вместо ещё
// большего сжатия одной длинной строки ---
function mockRepByTextLength(text) {
  var n = text.length, arr = [];
  for (var i = 0; i < n; i++) {
    var x0 = i * 10;
    arr.push(["M " + x0 + " 0 L " + (x0 + 8) + " 0 L " + (x0 + 8) + " 10 L " + x0 + " 10 Z"]);
  }
  return { toSVGPaths: function () { return arr; } };
}
var mockRepSplit = { drawText: function (text) { return mockRepByTextLength(text); } };
var modelManyHoles = { discDiameter: 200, blankDiameter: 200, placed: [], controlHoles: [],
  fixtures: { holes: [{ d: 1, points: (function () {
    var pts = []; for (var a = 0; a < 360; a += 18) pts.push([95.5 * Math.cos(a * Math.PI / 180), 95.5 * Math.sin(a * Math.PI / 180)]); return pts;
  })() }], cutouts: [] } };
var wholeCombined = eng.computeLayout(mockRepSplit, modelManyHoles, "123456789 ABCDEFGHIJ");
check("computeOrderEngraving: контрольная проверка — одной строкой это НЕ влезает целиком (иначе сценарий теста не тот)",
  wholeCombined && wholeCombined.fits === false, wholeCombined && wholeCombined.fits);
var orderSplit = eng.computeOrderEngraving(mockRepSplit, modelManyHoles, "123456789", "ABCDEFGHIJ");
check("computeOrderEngraving: результат есть", !!orderSplit);
if (orderSplit) {
  check("computeOrderEngraving: разбилось на номер+название — 19 глифов (9+10 символов)",
    orderSplit.glyphs.length === 19, orderSplit.glyphs.length);
  check("computeOrderEngraving: оба фрагмента влезли целиком (fits=true)", orderSplit.fits === true, orderSplit.fits);
}
// оба фрагмента пустые/только один задан — не пытаемся разбивать (нечего)
var orderNoOnly = eng.computeOrderEngraving(mockRepSplit, modelManyHoles, "12345", "");
check("computeOrderEngraving: только номер (без названия) — не разбивается, просто один фрагмент",
  orderNoOnly && orderNoOnly.glyphs.length === 5, orderNoOnly && orderNoOnly.glyphs.length);
check("computeOrderEngraving: оба поля пустые — null", eng.computeOrderEngraving(mockRepSplit, modelManyHoles, "", "") === null);

// --- регрессия: приоритет "разбить, а не сжать" — если одной строкой
// СТАНДАРТНЫЙ размер не влезает, но влез бы после уменьшения (старое
// поведение) — теперь СРАЗУ разбивается на два фрагмента, а не ужимается в
// одну мелкую строку. Здесь: 13 отверстий по кругу — стандартный размер
// одной строкой не влезает НИ В ОДИН промежуток, но с уменьшением влез бы
// (высотой ~2.17мм); после разбиения оба фрагмента влезают СТАНДАРТНЫМ (3мм)
// размером — разбиение даёт более читаемый результат, чем сжатие. ---
var modelPrioritySplit = { discDiameter: 200, blankDiameter: 200, placed: [], controlHoles: [],
  fixtures: { holes: [{ d: 1, points: (function () {
    var pts = []; for (var a = 0; a < 360; a += 360 / 13) pts.push([95.5 * Math.cos(a * Math.PI / 180), 95.5 * Math.sin(a * Math.PI / 180)]); return pts;
  })() }], cutouts: [] } };
var stdWhole = eng.computeLayout(mockRepSplit, modelPrioritySplit, "123456789 ABCDEFGHIJ", [HC.ENGRAVE_TEXT_HEIGHT]);
var shrinkWhole = eng.computeLayout(mockRepSplit, modelPrioritySplit, "123456789 ABCDEFGHIJ");
check("контрольная проверка сценария: стандартным размером одной строкой НЕ влезает",
  stdWhole && stdWhole.fits === false, stdWhole && stdWhole.fits);
check("контрольная проверка сценария: но С УМЕНЬШЕНИЕМ одной строкой влезло бы (иначе сценарий теста не тот)",
  shrinkWhole && shrinkWhole.fits === true && shrinkWhole.textHeight < HC.ENGRAVE_TEXT_HEIGHT, shrinkWhole);
var orderPriority = eng.computeOrderEngraving(mockRepSplit, modelPrioritySplit, "123456789", "ABCDEFGHIJ");
check("computeOrderEngraving: разбилось на два фрагмента (19 глифов), а НЕ сжалось в одну строку",
  orderPriority && orderPriority.glyphs.length === 19, orderPriority && orderPriority.glyphs.length);
check("computeOrderEngraving: после разбиения — СТАНДАРТНАЯ высота (3мм), лучше читаемость, чем при сжатии одной строки",
  orderPriority && orderPriority.textHeight === HC.ENGRAVE_TEXT_HEIGHT, orderPriority && orderPriority.textHeight);

// --- computeLayout: символ с настоящей квадратичной кривой (Q) — контрольная
// точка должна тоже развернуться вдоль дуги (не остаться в исходных
// координатах), а команда должна остаться "Q" (не превратиться в полигон) ---
var mockRepWithCurve = {
  drawText: function () {
    return { toSVGPaths: function () { return [["M 0 0 Q 5 10 10 0 L 10 -5 L 0 -5 Z"]]; } };
  }
};
var layoutCurve = eng.computeLayout(mockRepWithCurve, modelOpen, "C");
check("computeLayout: символ с Q-кривой — результат есть", !!layoutCurve);
if (layoutCurve) {
  var outerCurve = layoutCurve.glyphs[0].outer;
  var qCmd = outerCurve.filter(function (c) { return c.cmd === "Q"; })[0];
  check("computeLayout: команда Q сохранена (не тесселирована в полигон)", !!qCmd, JSON.stringify(outerCurve));
  if (qCmd) {
    check("computeLayout: у команды Q есть развёрнутая контрольная точка (cx/cy — числа, не NaN)",
      Number.isFinite(qCmd.cx) && Number.isFinite(qCmd.cy), JSON.stringify(qCmd));
    // контрольная точка НЕ должна совпадать с исходной (5,10) — значит, она
    // реально развёрнута вдоль дуги, а не просто скопирована как есть
    check("computeLayout: контрольная точка Q реально развёрнута (не исходные координаты 5,10)",
      Math.abs(qCmd.cx - 5) > 0.01 || Math.abs(qCmd.cy - 10) > 0.01, JSON.stringify(qCmd));
  }
}

// --- computeLayout: top-side занижение по краю — гравировка отступает от
// ГРАНИЦЫ занижения (erInnerR), а не от физического края диска — не должна
// садиться на пониженную поверхность самого занижения ---
var modelTopRecess = { discDiameter: 200, placed: [], controlHoles: [],
  fixtures: { holes: [], cutouts: [] }, edgeRecess: { side: "top", diameter: 160, depth: 2 } };
var layoutRecess = eng.computeLayout(mockRep, modelTopRecess, "AB");
check("computeLayout: top-side занижение — результат есть", !!layoutRecess);
if (layoutRecess) {
  var erInnerR = modelTopRecess.edgeRecess.diameter / 2; // 80
  var ptsRecess = [];
  layoutRecess.glyphs.forEach(function (gl) { ptsRecess = ptsRecess.concat(gl.outer); gl.holes.forEach(function (h) { ptsRecess = ptsRecess.concat(h); }); });
  var withinRecessBoundary = ptsRecess.every(function (p) { return Math.hypot(p.x, p.y) < erInnerR - HC.ENGRAVE_OFFSET + 0.5; });
  check("computeLayout: top-side занижение — гравировка НЕ заходит за границу занижения (erInnerR=80) минус отступ",
    withinRecessBoundary, JSON.stringify(ptsRecess.map(function (p) { return Math.hypot(p.x, p.y).toFixed(1); })));
}
// bottom-side занижение верхнюю грань не трогает — поведение как без занижения вообще
var modelBottomRecess = { discDiameter: 200, placed: [], controlHoles: [],
  fixtures: { holes: [], cutouts: [] }, edgeRecess: { side: "bottom", diameter: 160, depth: 2 } };
var layoutBottomRecess = eng.computeLayout(mockRep, modelBottomRecess, "AB");
check("computeLayout: bottom-side занижение — не влияет на гравировку (та же полоса, что и без занижения)",
  layoutBottomRecess && Math.abs(avgAngle(layoutBottomRecess.glyphs[0].outer) - avgAngle(layout.glyphs[0].outer)) < 1e-9);

// --- computeLayout: пустой текст / диск без диаметра — null ---
check("computeLayout: пустой текст — null", eng.computeLayout(mockRep, modelOpen, "") === null);
check("computeLayout: пустой текст (только пробелы) — null", eng.computeLayout(mockRep, modelOpen, "   ") === null);
check("computeLayout: диск без discDiameter — null", eng.computeLayout(mockRep, { discDiameter: 0 }, "AB") === null);

// --- computeLayout: полностью занятая полоса у края — best-effort, fits=false, но результат есть ---
var layoutBlocked = eng.computeLayout(mockRep, modelFullyBlocked, "AB");
check("computeLayout: занятая полоса — дуги вообще нет -> null (крепёж модели окружает ВСЮ полосу [90,100], а текст туда же метится)",
  layoutBlocked === null || layoutBlocked.fits === false, layoutBlocked);

if (failures) {
  console.log("\n" + failures + " провал(ов).");
  process.exit(1);
}
console.log("\nТест гравировки пройден.");
