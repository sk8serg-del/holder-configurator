/*
 * engraving.js — гравировка номера/названия подложкодержателя (order.holderNo
 * + order.holderName) дугой вдоль края диска.
 *
 * HC.engraving.loadFont(onStatus) — ленивая фоновая загрузка шрифта (как
 *   HC.loadReplicad для WASM-движка) — грузит движок + шрифт по CDN один раз.
 * HC.engraving.isReady() — синхронно: шрифт уже загружен?
 * HC.engraving.computeLayout(rep, model, text) — контуры букв, изогнутые
 *   вдоль свободной дуги у края диска (координаты диска, мм), НАСТОЯЩИМИ
 *   кривыми (не приближены полигоном — см. ниже):
 *   { glyphs: [{outer:[cmd,...], holes:[[cmd,...],...]}, ...],
 *     textHeight, offset, fits } или null (пустой текст/не влезло вообще).
 *   cmd — {cmd:"M"|"L", x, y} или {cmd:"Q", cx, cy, x, y} (квадратичная
 *   кривая, контрольная точка cx/cy) — каждый контур начинается с "M",
 *   дальше "L"/"Q" до неявного замыкания в исходную точку. Потребители
 *   строят из этого настоящую кривую своими средствами: render.js — SVG
 *   "Q"-команда, viewer3d.js — THREE.Path.quadraticCurveTo, step-export.js —
 *   replicad Pen.quadraticBezierCurveTo.
 *   model — та же форма, что у HC.renderSVG: discDiameter, placed,
 *   controlHoles, fixtures.{holes,cutouts}.
 *
 * Отступ от края и глубина реза в STEP-экспорте (js/step-export.js) —
 * константы ниже, высота символов тоже (подобраны разумно по умолчанию,
 * не завязаны на что-то ещё в проекте).
 *
 * НАПРАВЛЕНИЕ развёртки текста по дуге (выведено аналитически, проверено на
 * реальном шрифте — см. scratchpad diag-engrave-v2.cjs, самопроверка углов
 * первой/последней буквы): «верх» буквы (ascender) — радиально НАРУЖУ от
 * центра диска; направление чтения (+x строки) — тангенциальное, полученное
 * поворотом наружного вектора на −90°. Это даёт angle(x) = start − x/baseR
 * (плюс вместо минуса развернул бы текст зеркально — проверено).
 *
 * ВАЖНО: Drawing.toSVGPaths() для drawText() отдаёт Y в ПРОТИВОПОЛОЖНОМ
 * знаке относительно drawing.boundingBox.bounds (разные внутренние геттеры
 * replicad, не совпадают) — поэтому bbox текста считаем САМИ по тем же
 * точкам, что тесселируем (см. computeLayout), а не через .boundingBox.
 */
(function (g) {
  "use strict";
  var HC = (g.HC = g.HC || {});

  // Шрифт — открытый гуманистический sans-serif, похожий на Tahoma/Verdana
  // (саму Tahoma нельзя распространять — лицензия Microsoft не разрешает
  // встраивать файл шрифта в веб-страницу). Проверен вживую (replicad+
  // opentype.js грузит и парсит woff по этому URL). Сменить — один раз здесь.
  var FONT_URL = "https://cdn.jsdelivr.net/npm/@fontsource/dejavu-sans@5/files/dejavu-sans-latin-400-normal.woff";
  HC.ENGRAVE_DEPTH = 0.15; // мм — глубина реза в STEP-экспорте
  HC.ENGRAVE_OFFSET = 3; // мм — отступ от внешнего контура болванки
  HC.ENGRAVE_TEXT_HEIGHT = 3; // мм — высота символов (максимум, см. computeLayout: уменьшается, если целиком не влезает)
  HC.ENGRAVE_MIN_TEXT_HEIGHT = 1.5; // мм — не мельчить дальше (нечитаемо), даже если целиком всё равно не влезает
  HC.ENGRAVE_CLEARANCE = 1; // мм — зазор до отверстий/деталей при поиске свободной дуги

  var fontPromise = null, fontReady = false;

  // Ленивая, кэширующая (как HC.loadReplicad) загрузка шрифта — грузит WASM-
  // движок (если ещё не загружен) и один раз шрифт поверх него.
  function loadFont(onStatus) {
    if (fontPromise) return fontPromise;
    if (!HC.loadReplicad) return Promise.reject(new Error("STEP-движок недоступен (step-export.js не подключён)"));
    fontPromise = HC.loadReplicad(onStatus).then(function (rep) {
      return rep.loadFont(FONT_URL).then(function () {
        fontReady = true;
        return rep;
      });
    });
    // при неудаче (сеть/CDN) не кэшируем отказ навсегда — та же причина, что
    // и у HC.loadReplicad (см. step-export.js)
    fontPromise.catch(function () { fontPromise = null; });
    return fontPromise;
  }

  function isReady() { return fontReady; }

  // Вложенность контуров ОДНОГО символа (M/L/Q-петли одного top-level
  // элемента toSVGPaths — replicad уже группирует их по символу): чётная
  // глубина вложенности — внешний контур, нечётная — дырка (буквы «D», «0»,
  // «8», «A» и т.п.); дырка приписывается БЛИЖАЙШЕМУ (самому глубокому)
  // контуру, что её содержит. У знаков с несколькими несвязанными частями
  // («i», «%», «÷») получится несколько независимых внешних контуров — тоже
  // корректно обрабатывается (каждый — свой элемент в fixtures/features).
  function classifyLoops(loops) {
    var depth = loops.map(function (loop, i) {
      var c = 0;
      loops.forEach(function (other, j) { if (i !== j && HC.geom.pointInPoly(loop[0].x, loop[0].y, other)) c++; });
      return c;
    });
    var outers = [];
    loops.forEach(function (loop, i) { if (depth[i] % 2 === 0) outers.push({ points: loop, holes: [] }); });
    loops.forEach(function (loop, i) {
      if (depth[i] % 2 !== 1) return;
      var bestJ = -1, bestDepth = -1;
      loops.forEach(function (other, j) {
        if (depth[j] % 2 !== 0 || !HC.geom.pointInPoly(loop[0].x, loop[0].y, other)) return;
        if (depth[j] > bestDepth) { bestDepth = depth[j]; bestJ = j; }
      });
      if (bestJ >= 0) {
        var target = outers.filter(function (o) { return o.points === loops[bestJ]; })[0];
        if (target) target.holes.push(loop);
      }
    });
    return outers;
  }

  // Занятые зоны у края (детали раскладки, крепёж болванки, контрольные
  // отверстия, фигурные вырезы) — приближённо кружками (реальный полигон
  // детали/выреза → кружок по максимальному охвату от своего центра;
  // консервативно — может отвергнуть чуть больше места, чем нужно на самом
  // деле для сильно вытянутых непрямоугольных деталей, но безопасно и просто).
  function collectObstacles(model) {
    var obs = [];
    (model.placed || []).forEach(function (p) {
      // Реальный физический охват — не просто «отверстие» (p.d/базовые w×h):
      // посадка (seatD у круга, seatGap у прямоугольных форм) обычно ШИРЕ
      // самого отверстия, а паз торчит за неё ещё на 2.5мм (та же надбавка,
      // что и в packer.js slotPad) — без этого гравировка налезала на
      // реальный вырез под деталь, хотя формально «мимо» одного лишь d.
      var r;
      if (p.type === "circle") {
        r = Math.max(p.d || 0, p.seatD || 0, p.apertureCA || 0) / 2;
      } else {
        var gap = p.seatGap > 0 ? p.seatGap : 0;
        var poly = HC.geom.shapePoly(p.type, p.cx, p.cy, p.w + 2 * gap, p.h + 2 * gap, p.chamfer, p.rot);
        r = 0;
        poly.forEach(function (v) { r = Math.max(r, Math.hypot(v.x - p.cx, v.y - p.cy)); });
      }
      if (p.slotOn) r += 2.5;
      obs.push({ x: p.cx, y: p.cy, r: r });
    });
    (model.controlHoles || []).forEach(function (h) {
      var r = Math.max(h.seatD || 0, h.d || 0, h.apertureCA || 0) / 2;
      if (r > 0) obs.push({ x: h.x, y: h.y, r: r + (h.slotOn ? 2.5 : 0) });
    });
    ((model.fixtures && model.fixtures.holes) || []).forEach(function (grp) {
      if (!(grp.d > 0)) return;
      (grp.points || []).forEach(function (p) { obs.push({ x: p[0], y: p[1], r: grp.d / 2 }); });
    });
    ((model.fixtures && model.fixtures.cutouts) || []).forEach(function (cut) {
      // Точки-вершины — не только они: у простых фигурных вырезов (мало
      // углов, например прямоугольный фланец) между далёкими вершинами
      // остался бы незамеченный промежуток (проверка ниже — только по
      // расстоянию до КОНКРЕТНЫХ obstacle-точек). Досэмплированы рёбра, чтобы
      // соседние точки были не реже 2мм — весь контур гарантированно учтён.
      var pts = cut.points || [];
      for (var i = 0; i < pts.length; i++) {
        var a = pts[i], b = pts[(i + 1) % pts.length];
        var segLen = Math.hypot(b[0] - a[0], b[1] - a[1]);
        var steps = Math.max(1, Math.ceil(segLen / 2));
        for (var k = 0; k < steps; k++) {
          var t = k / steps;
          obs.push({ x: a[0] + (b[0] - a[0]) * t, y: a[1] + (b[1] - a[1]) * t, r: 0 });
        }
      }
    });
    return obs;
  }

  // Схлопывает булев массив free[0..N) в список непрерывных дуг (перенос
  // через 0°/360° учтён — начинаем обход с «восхода», как в packer.js freeArcs).
  function contiguousFreeArcs(free, N) {
    if (free.every(function (v) { return v; })) return [{ a0: 0, a1: 2 * Math.PI }];
    if (free.every(function (v) { return !v; })) return [];
    var i0 = 0;
    while (!(!free[(i0 - 1 + N) % N] && free[i0])) i0++;
    var arcs = [], i = i0, seen = 0;
    while (seen < N) {
      if (free[i % N]) {
        var start = i;
        while (seen < N && free[i % N]) { i++; seen++; }
        arcs.push({ a0: (start / N) * 2 * Math.PI, a1: (i / N) * 2 * Math.PI });
      } else { i++; seen++; }
    }
    return arcs;
  }

  // Свободная дуга нужной угловой ширины в кольцевой полосе [bandInnerR,
  // bandOuterR] — сэмплирование углов (шаг 0.5°, тот же приём, что и
  // packer.js freeArcs), для каждого угла проверка зазора от препятствий по
  // отрезку через полосу (HC.geom.distPointSeg). Если ни одна дуга не
  // вмещает текст целиком — берём САМУЮ ШИРОКУЮ (best-effort, без
  // авто-уменьшения шрифта); .fits=false предупреждает вызывающий код.
  function findFreeArc(model, bandInnerR, bandOuterR, requiredWidth, clearance) {
    var obstacles = collectObstacles(model);
    var N = 720;
    var free = new Array(N);
    for (var i = 0; i < N; i++) {
      var th = (i / N) * 2 * Math.PI;
      var ax = bandInnerR * Math.cos(th), ay = bandInnerR * Math.sin(th);
      var bx = bandOuterR * Math.cos(th), by = bandOuterR * Math.sin(th);
      free[i] = !obstacles.some(function (o) { return HC.geom.distPointSeg(o.x, o.y, ax, ay, bx, by) < o.r + clearance; });
    }
    var arcs = contiguousFreeArcs(free, N);
    if (!arcs.length) return null;
    var fitting = arcs.filter(function (a) { return a.a1 - a.a0 >= requiredWidth; });
    var pool = fitting.length ? fitting : arcs;
    var best = pool.reduce(function (a, b) { return (b.a1 - b.a0) > (a.a1 - a.a0) ? b : a; });
    return { center: (best.a0 + best.a1) / 2, width: best.a1 - best.a0, fits: fitting.length > 0 };
  }

  // Лесенка высот для попытки уместить текст ЦЕЛИКОМ: сперва стандартный
  // (максимальный, читаемый) размер, дальше — шагами вниз до
  // HC.ENGRAVE_MIN_TEXT_HEIGHT (мельче не имеет смысла — нечитаемо).
  function shrinkLadder() {
    var heights = [HC.ENGRAVE_TEXT_HEIGHT];
    var h = HC.ENGRAVE_TEXT_HEIGHT;
    while (h > HC.ENGRAVE_MIN_TEXT_HEIGHT + 1e-6) {
      h = Math.max(h * 0.85, HC.ENGRAVE_MIN_TEXT_HEIGHT);
      heights.push(h);
    }
    return heights;
  }

  // model — как у HC.renderSVG (discDiameter, placed, controlHoles,
  // fixtures.{holes,cutouts}). rep — уже загруженный replicad (см. loadFont).
  // heights — список высот для попытки (по порядку, до первой влезшей
  // целиком); по умолчанию — полная лесенка от стандартного размера вниз
  // (см. shrinkLadder); computeOrderEngraving передаёт [ENGRAVE_TEXT_HEIGHT]
  // — только ОДНУ попытку стандартным размером, без сжатия (чтобы сразу
  // решить «влезло/не влезло» и при отказе перейти к разбиению на два
  // фрагмента, а не сжимать одну длинную строку).
  //
  // Кривые букв (Q — квадратичные, TrueType) разворачиваются вдоль дуги КАК
  // НАСТОЯЩИЕ КРИВЫЕ (контрольная точка тоже разворачивается), а не
  // приближаются полигоном — иначе на маленьких дисках/крупном шрифте видны
  // гранёные буквы. Тесселяция (HC.geom.flattenSVGPath) используется ТОЛЬКО
  // для вспомогательных задач, где нужны точки, а не кривая: определение
  // вложенности дырок (classifyLoops) и bbox/масштаб — сама warp-геометрия,
  // которую отдаёт эта функция, строится из НЕтесселированных команд
  // (parseSVGPathCommands), см. warpCommand. Погрешность такого приближения
  // (развернуть контрольную точку квадратичной кривой напрямую, а не
  // тесселировать-потом-развернуть) проверена численно: на диске R=30мм и
  // резкой дуге высотой 6мм — макс. отклонение ~0.08мм, на R=100+ — на
  // порядок меньше; для гравировки глубиной 0.15мм это пренебрежимо.
  function computeLayout(rep, model, text, heights) {
    text = (text || "").trim();
    if (!text || !((model.blankDiameter || model.discDiameter) > 0)) return null;

    var drawing = rep.drawText(text, { fontSize: 10 }); // масштаб считаем сами (см. ниже) — fontSize тут произволен
    var svgPaths = drawing.toSVGPaths(); // один top-level элемент на символ
    if (!svgPaths || !svgPaths.length) return null;

    // НЕтесселированные команды (M/L/Q с контрольными точками) — основа
    // итоговой геометрии.
    var perGlyphCommands = svgPaths.map(function (dArr) {
      return dArr.map(function (d) { return HC.geom.parseSVGPathCommands(d); });
    });
    // Грубая тесселяция ТЕХ ЖЕ контуров — только для вложенности/bbox (см. выше).
    var perGlyphPoints = svgPaths.map(function (dArr) {
      return dArr.map(function (d) { return HC.geom.flattenSVGPath(d, 4); });
    });

    var minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    perGlyphPoints.forEach(function (loops) {
      loops.forEach(function (loop) {
        loop.forEach(function (p) {
          if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
          if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
        });
      });
    });
    if (!(maxX > minX)) return null;

    // нормализация знака Y — см. предупреждение в шапке файла. Применяется
    // как множитель flip к обеим представлениям контура (команды — ниже, в
    // warpXY; точки — тут же, раз уже понадобился для bbox/классификации).
    var flip = Math.abs(minY) > Math.abs(maxY) ? -1 : 1;
    if (flip < 0) {
      perGlyphPoints.forEach(function (loops) { loops.forEach(function (loop) { loop.forEach(function (p) { p.y = -p.y; }); }); });
      var t = minY; minY = -maxY; maxY = -t;
    }
    // Масштаб — по ВЫСОТЕ БУКВ (от базовой линии y=0 до верха, capHeight), а
    // НЕ по всему размаху minY..maxY: строка почти всегда содержит запятую
    // (десятичный разделитель — см. fmtRuShort в app.js, "D25,6" и т.п.),
    // у которой есть маленький спуск ПОД базовую линию. Если бы 3мм тянулись
    // на весь размах (буквы + спуск запятой), сами буквы получались бы
    // заметно МЕНЬШЕ 3мм (наблюдалось: 2.45мм вместо 3 — спуск съедал часть
    // высоты). Спуск при этом никуда не делся — просто не участвует в
    // калибровке, буквы ровно 3мм, а textBottomMm/bandInnerR ниже всё равно
    // учитывают его настоящую (получившуюся после масштабирования) глубину.
    var capHeight = maxY;
    if (!(capHeight > 0)) return null;

    // отступ — от РЕАЛЬНОГО физического края болванки (blankDiameter), а не
    // от границы полезной зоны раскладки (discDiameter, может быть меньше) —
    // то же различие, что и в render.js (var R = (model.blankDiameter ||
    // model.discDiameter) / 2), иначе гравировка садится слишком близко к
    // краю на болванках крупнее полезной зоны.
    var R = (model.blankDiameter || model.discDiameter) / 2;

    // Пробует разместить текст ЦЕЛИКОМ при заданной высоте букв (capHeight
    // -> targetHeight); возвращает {scale, baseR, startAngle, arc} или null,
    // если геометрия не сходится (диск слишком мал даже для этой высоты).
    function attempt(targetHeight) {
      var scale = targetHeight / capHeight;
      var textWidthMm = (maxX - minX) * scale;
      var textTopMm = maxY * scale; // от базовой линии (y=0) до верха символов — ровно targetHeight
      var textBottomMm = minY * scale; // обычно чуть отрицательно (спуск/hang у запятой и т.п.)

      var bandOuterR = R - HC.ENGRAVE_OFFSET;
      // занижение по краю сверху (top-side edgeRecess) — гравировка НЕ должна
      // садиться в само занижение (там другая, более низкая поверхность):
      // отступ считаем от границы занижения (erInnerR), а не от физического
      // края диска. Bottom-side занижение верхнюю грань не трогает — игнорируем.
      if (model.edgeRecess && model.edgeRecess.diameter > 0 && model.edgeRecess.depth > 0 && model.edgeRecess.side !== "bottom") {
        var erInnerR = model.edgeRecess.diameter / 2;
        if (erInnerR < R) bandOuterR = Math.min(bandOuterR, erInnerR - HC.ENGRAVE_OFFSET);
      }
      var baseR = bandOuterR - textTopMm; // радиус базовой линии
      var bandInnerR = baseR + textBottomMm;
      if (!(baseR > 0) || !(bandInnerR > 0)) return null;

      var angularWidth = textWidthMm / baseR;
      var arc = findFreeArc(model, bandInnerR, bandOuterR, angularWidth, HC.ENGRAVE_CLEARANCE);
      if (!arc) return null;
      var startAngle = arc.center + angularWidth / 2; // левый край строки (x=0) — на БОЛЬШЕМ угле (см. вывод знака выше)
      return { scale: scale, baseR: baseR, startAngle: startAngle, arc: arc, height: targetHeight };
    }

    // Если целая строка не влезает НИ В ОДНУ свободную дугу целиком (частый
    // случай на болванках с частым крепежом у края — длинный номер+название
    // просто шире любого промежутка между отверстиями) — раньше текст всё
    // равно впихивался в самую широкую дугу «как есть», реально накладываясь
    // на соседний крепёж/вырез. Теперь вместо этого уменьшаем высоту буквы
    // (уже буду меньше ENGRAVE_TEXT_HEIGHT, но целиком в свободном месте) —
    // до HC.ENGRAVE_MIN_TEXT_HEIGHT, дальше не мельчим (нечитаемо).
    heights = heights || shrinkLadder();
    var found = null;
    for (var hi = 0; hi < heights.length; hi++) {
      var attemptResult = attempt(heights[hi]);
      if (!attemptResult) continue;
      found = attemptResult; // последняя валидная попытка — запасной вариант, если ни одна не влезла целиком
      if (attemptResult.arc.fits) break;
    }
    if (!found) return null;

    var scale = found.scale, baseR = found.baseR, startAngle = found.startAngle, arc = found.arc;

    // (x,y) в исходных координатах шрифта (до нормализации знака/масштаба) ->
    // точка на дуге в координатах диска (мм).
    function warpXY(x, y) {
      var X = x * scale, Y = y * flip * scale;
      var r = baseR + Y;
      var a = startAngle - X / baseR;
      return [r * Math.cos(a), r * Math.sin(a)];
    }
    function warpCommand(c) {
      if (c.cmd === "Q") {
        var cp = warpXY(c.cx, c.cy), end = warpXY(c.x, c.y);
        return { cmd: "Q", cx: cp[0], cy: cp[1], x: end[0], y: end[1] };
      }
      var p = warpXY(c.x, c.y);
      return { cmd: c.cmd, x: p[0], y: p[1] };
    }
    function warpSubpath(cmds) { return cmds.map(warpCommand); }

    var glyphs = [];
    perGlyphPoints.forEach(function (loops, gi) {
      var commands = perGlyphCommands[gi];
      classifyLoops(loops).forEach(function (gl) {
        var outerIdx = loops.indexOf(gl.points);
        var holeIdx = gl.holes.map(function (h) { return loops.indexOf(h); });
        glyphs.push({
          outer: warpSubpath(commands[outerIdx]),
          holes: holeIdx.map(function (idx) { return warpSubpath(commands[idx]); })
        });
      });
    });
    if (!glyphs.length) return null;

    return { glyphs: glyphs, textHeight: found.height, offset: HC.ENGRAVE_OFFSET, fits: arc.fits };
  }

  // Модель с ДОПОЛНИТЕЛЬНЫМ «вырезом» (тот же путь, что и обычные фигурные
  // вырезы болванки, включая досэмплирование рёбер — см. collectObstacles) —
  // чтобы второй фрагмент текста не сел на уже размещённый первый.
  function withReservedGlyphs(model, glyphs) {
    if (!glyphs || !glyphs.length) return model;
    var extraCutouts = glyphs.map(function (gl) {
      return { points: gl.outer.map(function (c) { return [c.x, c.y]; }) };
    });
    var fx = model.fixtures || {};
    return {
      discDiameter: model.discDiameter, blankDiameter: model.blankDiameter,
      placed: model.placed, controlHoles: model.controlHoles, edgeRecess: model.edgeRecess,
      fixtures: { holes: fx.holes, cutouts: (fx.cutouts || []).concat(extraCutouts) }
    };
  }

  // Номер и название подложкодержателя. Сначала пробуется ОДНА строка
  // (номер + пробел + название) СТАНДАРТНЫМ (максимальным, читаемым)
  // размером — БЕЗ уменьшения: если сразу влезает целиком, используется она
  // (одна аккуратная строка). Если нет — сразу разбивается на два отдельных
  // фрагмента в РАЗНЫХ промежутках у края (не сжимается ещё сильнее одной
  // длинной строкой): более длинный из двух фрагментов ставится ПЕРВЫМ — он
  // получает самый широкий из свободных промежутков (findFreeArc всегда
  // выбирает самый широкий подходящий), а более короткому проще найти место
  // среди того, что осталось. Второй фрагмент избегает уже размещённого
  // первого (см. withReservedGlyphs). Каждый фрагмент — со своим
  // уменьшением высоты при необходимости (см. computeLayout), но реже
  // требуется, чем для одной длинной строки целиком.
  function computeOrderEngraving(rep, model, holderNo, holderName) {
    var no = (holderNo || "").trim(), name = (holderName || "").trim();
    var combined = [no, name].filter(function (s) { return s; }).join(" ");
    if (!combined) return null;

    var whole = computeLayout(rep, model, combined, [HC.ENGRAVE_TEXT_HEIGHT]);
    if (whole && whole.fits) return whole;

    if (!no || !name) return computeLayout(rep, model, combined); // разбивать нечего — один фрагмент, со своим уменьшением при необходимости

    var longer = no.length >= name.length ? no : name;
    var shorter = longer === no ? name : no;

    var layout1 = computeLayout(rep, model, longer);
    var layout2 = computeLayout(rep, withReservedGlyphs(model, layout1 && layout1.glyphs), shorter);

    var glyphs = (layout1 ? layout1.glyphs : []).concat(layout2 ? layout2.glyphs : []);
    if (!glyphs.length) return whole; // ничего не вышло разбить — вернуть лучшее из цельной попытки (может быть null)

    return {
      glyphs: glyphs,
      textHeight: Math.min(layout1 ? layout1.textHeight : HC.ENGRAVE_TEXT_HEIGHT, layout2 ? layout2.textHeight : HC.ENGRAVE_TEXT_HEIGHT),
      offset: HC.ENGRAVE_OFFSET,
      fits: !!(layout1 && layout1.fits) && !!(layout2 && layout2.fits)
    };
  }

  HC.engraving = {
    loadFont: loadFont,
    isReady: isReady,
    classifyLoops: classifyLoops,
    collectObstacles: collectObstacles,
    findFreeArc: findFreeArc,
    computeLayout: computeLayout,
    computeOrderEngraving: computeOrderEngraving
  };
})(typeof globalThis !== "undefined" ? globalThis : window);
