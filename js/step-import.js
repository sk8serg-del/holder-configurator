/*
 * step-import.js — импорт STEP-болванки диска прямо в браузере (без Inventor).
 *
 * STEP-болванка — уже ГОТОВАЯ деталь: её отверстия/вырезы никто не
 * редактирует по одному, поэтому разбор больше не пытается назвать и
 * классифицировать каждую грань (контрольное/крепёж/паз) — раньше это давало
 * хрупкие эвристики (три раунда фиксов: дубли граней от BREP-шва, канавка
 * маски портит соседнее отверстие, колпачок паза вылезает как фантомное
 * отверстие). Вместо этого разбор даёт только то, что реально нужно:
 *   1. Плоский список ЗАПРЕТНЫХ ЗОН для раскладчика (fixtures.holes,
 *      группировка по диаметру — как и у обычных крепёжных отверстий);
 *   2. Настоящий вид сверху (SVG, реальные дуги — не приближение) для
 *      мгновенного превью;
 * а сама геометрия (исходный STEP) остаётся источником истины для финального
 * экспорта — новые отверстия под детали режутся ПРЯМО В НЕЙ (см.
 * step-export.js buildSolidFromImported), а не пересобираются с нуля.
 *
 * Строит твердотельную модель через тот же CAD-движок (replicad/OpenCascade,
 * см. HC.loadReplicad в step-export.js) и НАХОДИТ отверстия геометрически —
 * по цилиндрическим граням, без разметки. Различить «посадка+зона напыления»
 * (составное, две концентричные грани разного радиуса) от простого отверстия
 * (одна грань) можно по факту двух граней в одной точке (X,Y); различить
 * сквозное от глухого — по тому, достаёт ли грань до противоположной стороны
 * болванки по Z.
 *
 * Паз под пинцет: в реальном STEP из Inventor круглая посадка с пазом рушится
 * на несколько дуговых граней (шов там, где паз врезается в окружность) —
 * они схлопываются в одну посадку по оси, как обычно. Сам паз выдаёт себя
 * маленьким цилиндром-«колпачком» (скруглённый торец паза) на СВОЕЙ, смещённой
 * от центра отверстия оси — радиус колпачка точно равен половине ширины паза
 * (см. HC.geom.slotWidth) для Ø посадки этого отверстия. Такой колпачок
 * поглощается родительским отверстием (не даёт лишней запретной зоны), а не
 * остаётся отдельной фантомной «дырой» (как было раньше).
 *
 * Декоративные канавки маски — две концентричные цилиндрические стенки
 * (наружная/внутренняя) на одной оси, обычно совпадающей с центром диска;
 * распознаются отдельно и попадают в fixtures.grooves (а не портят соседнее
 * отверстие при группировке).
 *
 * Фигурные (НЕ круглые) вырезы по краю болванки STEP-анализ не распознаёт —
 * это отдельная задача (контур-полигон по рёбрам грани, не радиус цилиндра);
 * они уже часть настоящей геометрии исходного файла и попадут в финальный
 * экспорт как есть, просто не показываются отдельной запретной зоной для
 * раскладчика (если такой вырез окажется в полезной зоне — стоит проверить
 * превью глазами перед раскладкой).
 *
 * HC.stepImport.classifyCylinders(cyls, thickness) — чистая логика группировки
 *   цилиндрических граней в отверстия (без WASM, тестируется напрямую).
 * HC.stepImport.analyzeShape(shape) — из готового replicad-Shape3D достаёт
 *   цилиндрические грани и вызывает classifyCylinders.
 * HC.stepImport.buildBlankSummary(shape, opts) — запись диска для
 *   HC.CATALOG.discs (пустые controlVariants, запретные зоны в fixtures.holes).
 * HC.stepImport.fromFile(arrayBufferOrBlob, opts, onStatus) — асинхронно: грузит
 *   движок (если ещё не загружен), парсит STEP, строит запись + SVG-превью.
 */
(function (g) {
  "use strict";
  var HC = (g.HC = g.HC || {});

  var GROUP_TOL = 0.05; // мм — допуск на совпадение осей (X,Y) двух цилиндров одного отверстия
  var THROUGH_TOL = 0.05; // мм — насколько глубина грани может не доставать до низа и всё равно считаться сквозной

  // Группирует «кандидатные» цилиндры (без внешней стенки болванки — её
  // исключает analyzeShape) по оси (x,y) и решает для каждой группы:
  //   1 цилиндр, глубина ≈ толщина болванки → простое сквозное отверстие (d);
  //   1 цилиндр, глубина меньше толщины     → глухая посадка без зоны напыления (seatD/depth);
  //   2 цилиндра на одной оси (посадка ∪ зона напыления) → seatD/depth (больший,
  //     более мелкий) + apertureCA (меньший, продолжается ниже — обычно сквозной).
  // cyls: [{r, x, y, z0, z1}] (z0 < z1, в мм).
  function classifyCylinders(cyls, thickness) {
    var groups = [];
    cyls.forEach(function (c) {
      var gr = null;
      for (var i = 0; i < groups.length; i++) {
        if (Math.abs(groups[i].x - c.x) < GROUP_TOL && Math.abs(groups[i].y - c.y) < GROUP_TOL) { gr = groups[i]; break; }
      }
      if (!gr) { gr = { x: c.x, y: c.y, cyls: [] }; groups.push(gr); }
      gr.cyls.push(c);
    });

    var holes = groups.map(function (gr) {
      // Экспорт STEP из Inventor иногда режет ОДНУ цилиндрическую грань на две
      // одинаковые половины (шов BREP) — если этого не убрать, дубликат
      // занимает место реальной второй грани (зоны напыления) при сортировке
      // по радиусу. Схлопываем грани с совпадающими (r, z0, z1) в одной точке.
      var uniq = [];
      gr.cyls.forEach(function (c) {
        var dup = uniq.some(function (u) {
          return Math.abs(u.r - c.r) < GROUP_TOL && Math.abs(u.z0 - c.z0) < GROUP_TOL && Math.abs(u.z1 - c.z1) < GROUP_TOL;
        });
        if (!dup) uniq.push(c);
      });
      var list = uniq.sort(function (a, b) { return b.r - a.r; }); // от большего радиуса к меньшему
      var top = list[0];
      var depth = Math.abs(top.z1 - top.z0);
      var through = depth > thickness - THROUGH_TOL;
      var h = { x: gr.x, y: gr.y, _z0: Math.min(top.z0, top.z1), _z1: Math.max(top.z0, top.z1) };
      if (list.length > 1) {
        h.seatD = Math.round(top.r * 2 * 1000) / 1000;
        h.depth = Math.round(depth * 1000) / 1000;
        h.apertureCA = Math.round(list[1].r * 2 * 1000) / 1000;
      } else if (through) {
        h.d = Math.round(top.r * 2 * 1000) / 1000;
      } else {
        h.seatD = Math.round(top.r * 2 * 1000) / 1000;
        h.depth = Math.round(depth * 1000) / 1000;
      }
      return h;
    });

    // Паз под пинцет: в реальном STEP из Inventor круглая посадка, если у нevents
    // отверстия есть паз, оказывается РАЗРЕЗАНА на несколько дуговых граней
    // (шов там, где паз врезается в окружность) — это уже покрыто группировкой
    // выше (дуги на той же оси схлопываются в одну посадку). САМ паз выдаёт
    // себя отдельными маленькими цилиндрами-«колпачками» (скруглённый торец
    // паза) на СВОЕЙ оси, смещённой от центра отверстия — поэтому раньше они
    // не попадали в группу отверстия и вылезали как отдельные фантомные
    // «отверстия». Радиус колпачка точно равен половине ширины паза
    // (HC.geom.slotWidth) для Ø ПОСАДКИ этого отверстия — используем это,
    // чтобы найти и присвоить колпачок родительскому отверстию, а не отдельной
    // записи, и определить по нему угол ориентации паза.
    var used = {};
    holes.forEach(function (h, hi) {
      var seat = h.seatD != null ? h.seatD : h.d;
      if (!(seat > 0)) return;
      var halfWidth = Math.min(9, seat * 0.75) / 2;
      var maxReach = seat + 5; // с запасом покрывает длину паза (D+5)/2 от центра
      var angleSet = false;
      groups.forEach(function (g2, gi) {
        if (gi === hi || used[gi] || g2.cyls.length !== 1) return;
        var cap = g2.cyls[0];
        if (Math.abs(cap.r - halfWidth) > GROUP_TOL) return;
        var dist = Math.hypot(g2.x - h.x, g2.y - h.y);
        if (dist > maxReach || dist < 1) return;
        var capZ0 = Math.min(cap.z0, cap.z1), capZ1 = Math.max(cap.z0, cap.z1);
        if (capZ0 > h._z1 + GROUP_TOL || capZ1 < h._z0 - GROUP_TOL) return; // не тот карман по глубине
        used[gi] = true;
        if (!angleSet) {
          h.slotAvailable = true;
          h.slotAngle = Math.round(((Math.atan2(g2.y - h.y, g2.x - h.x) * 180) / Math.PI) * 100) / 100;
          angleSet = true;
        }
      });
    });

    return holes.filter(function (h, hi) { return !used[hi]; }).map(function (h) {
      delete h._z0; delete h._z1;
      return h;
    });
  }

  // Расстояние от точки до отрезка (не до прямой) — используется, чтобы
  // проверить, что кандидат в «борт перемычки» реально лежит между двумя
  // лепестками гантели, а не просто где-то неподалёку от их середины.
  function pointToSegmentDist(px, py, x1, y1, x2, y2) {
    var dx = x2 - x1, dy = y2 - y1;
    var lenSq = dx * dx + dy * dy;
    var t = lenSq > 0 ? ((px - x1) * dx + (py - y1) * dy) / lenSq : 0;
    t = Math.max(0, Math.min(1, t));
    var cx = x1 + t * dx, cy = y1 + t * dy;
    return Math.hypot(px - cx, py - cy);
  }

  // Разбор одного фрагмента SVG-пути проекции replicad (toSVGPaths) —
  // ТОЛЬКО команды M/L/A/Q/Z (дуги всегда окружности, без поворота, это
  // проекция цилиндрических граней сверху) — в полилинию точек. Нужно, чтобы
  // достать РЕАЛЬНЫЙ контур выреза-гантели прямо из геометрии STEP, а не
  // приближать его кружками (см. mergeDogboneHoles/dogboneRealOutline).
  function flattenSVGPath(d, segPerArc) {
    segPerArc = segPerArc || 24;
    var tokens = d.match(/[MLAQZ]|-?\d+\.?\d*(?:e-?\d+)?/gi) || [];
    var pts = [], cur = null, i = 0;
    function num() { return parseFloat(tokens[i++]); }
    while (i < tokens.length) {
      var cmd = tokens[i++];
      if (cmd === "M" || cmd === "L") {
        var x = num(), y = num();
        pts.push({ x: x, y: y });
        cur = { x: x, y: y };
      } else if (cmd === "Q") {
        var qx = num(), qy = num(), x2 = num(), y2 = num();
        for (var s = 1; s <= segPerArc; s++) {
          var t = s / segPerArc, mt = 1 - t;
          pts.push({ x: mt * mt * cur.x + 2 * mt * t * qx + t * t * x2, y: mt * mt * cur.y + 2 * mt * t * qy + t * t * y2 });
        }
        cur = { x: x2, y: y2 };
      } else if (cmd === "A") {
        var rx = num(); num(); num(); // ry, поворот — не нужны (окружность)
        var laf = num(), sf = num(), x3 = num(), y3 = num();
        appendArcPoints(pts, cur.x, cur.y, x3, y3, rx, laf, sf, segPerArc);
        cur = { x: x3, y: y3 };
      } else {
        // Z/z — замыкание, первая точка контура уже добавлена
      }
    }
    return pts;
  }

  // Точки дуги ОКРУЖНОСТИ радиуса r между (x1,y1) и (x2,y2) — стандартное SVG
  // параметрическое преобразование "конечные точки → центр", упрощённое для
  // случая rx=ry=r (наши дуги — всегда проекции цилиндров, без эллипсов/поворота).
  function appendArcPoints(pts, x1, y1, x2, y2, r, largeArc, sweep, seg) {
    var dx2 = (x1 - x2) / 2, dy2 = (y1 - y2) / 2;
    var lenSq = dx2 * dx2 + dy2 * dy2;
    if (lenSq < 1e-12) return;
    var rr = Math.max(r * r, lenSq); // страховка от погрешности (хорда чуть больше 2r)
    var sign = largeArc !== sweep ? 1 : -1;
    var co = sign * Math.sqrt(Math.max(0, rr - lenSq) / lenSq);
    var cx = co * dy2 + (x1 + x2) / 2;
    var cy = -co * dx2 + (y1 + y2) / 2;
    var a1 = Math.atan2(y1 - cy, x1 - cx);
    var a2 = Math.atan2(y2 - cy, x2 - cx);
    var span = a2 - a1;
    if (sweep && span < 0) span += 2 * Math.PI;
    if (!sweep && span > 0) span -= 2 * Math.PI;
    var steps = Math.max(1, Math.round((Math.abs(span) / (2 * Math.PI)) * seg * 4));
    for (var k = 1; k <= steps; k++) {
      var a = a1 + (span * k) / steps;
      pts.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) });
    }
  }

  // Настоящий контур выреза-гантели прямо из вида сверху (а не приближение
  // кружками): собираем точки проекции (visible+hidden), которые реально
  // лежат НА границе этой пары отверстий — у окружности лепестка hi/hj (с
  // запасом CIRC_TOL — сгибы/мелкие галтели на стыке со стенкой) или у
  // отрезка между их центрами (с запасом WALL_TOL — сам борт перемычки), —
  // и берём их выпуклую оболочку. Фильтр «у известной окружности/отрезка»
  // (а не просто «где-то рядом с серединой») нужен, чтобы не подхватить
  // точки СОСЕДНИХ, не относящихся к этой гантели элементов на плотной
  // болванке (проверено на реальном файле технолога — иначе в оболочку
  // попадают лишние точки от других отверстий поблизости).
  var DOGBONE_CIRC_TOL = 1.5, DOGBONE_WALL_TOL = 3;
  function dogboneRealOutline(pathFragments, hi, ri, hj, rj) {
    if (!pathFragments || !pathFragments.length) return null;
    var pts = [];
    pathFragments.forEach(function (d) {
      flattenSVGPath(d).forEach(function (p) {
        var d1 = Math.abs(Math.hypot(p.x - hi.x, p.y - hi.y) - ri);
        var d2 = Math.abs(Math.hypot(p.x - hj.x, p.y - hj.y) - rj);
        var seg = pointToSegmentDist(p.x, p.y, hi.x, hi.y, hj.x, hj.y);
        var onWall = seg < DOGBONE_WALL_TOL;
        if (d1 < DOGBONE_CIRC_TOL || d2 < DOGBONE_CIRC_TOL || onWall) pts.push(p);
      });
    });
    if (pts.length < 3) return null;
    var hull = HC.geom.convexHull(pts);
    return hull.length >= 3 ? hull.map(function (p) { return [Math.round(p.x * 1000) / 1000, Math.round(p.y * 1000) / 1000]; }) : null;
  }

  // Вырезы-«гантели» (dogbone/keyhole): два лепестка (обычные отверстия из
  // classifyCylinders, разного или одинакового Ø) соединены прямой
  // перемычкой — на реальном файле технолога подтверждено: Ø7.5 простое
  // сквозное + составное Ø6/Ø4 в 8.2мм друг от друга, а между ними — две
  // плоские грани НА ВСЮ ТОЛЩИНУ (борта перемычки). Без учёта перемычки два
  // лепестка распознавались бы как ДВА независимых отверстия, а материал
  // между ними (реально вырезанный, сквозной) вообще не попадал бы в
  // запретную зону для раскладчика — деталь могла бы встать прямо в
  // перемычку. wallCandidates — центры кандидатов в «борт перемычки»
  // (полные плоские грани на всю толщину, небольшие в плане — см. analyzeShape).
  // Возвращает { holes: остаток (не гантели), dogboneKeepouts: [{x,y,r},...],
  // dogboneCutouts: [{points:[[x,y],...]}] }. dogboneKeepouts — по два
  // кружка-лепестка плюс несколько промежуточных кружков вдоль перемычки
  // консервативного радиуса (меньший из двух лепестков — не точная ширина
  // перемычки, но заведомо не меньше её) — ЭТО остаётся источником истины
  // для раскладчика (fixtures.holes, см. keepoutsFromHoles), никогда не
  // приближение. dogboneCutouts — НАСТОЯЩИЙ контур этой же пары прямо из
  // вида сверху (см. dogboneRealOutline), только когда есть pathFragments
  // (реальный WASM-разбор, не mock-тесты) — используется ТОЛЬКО для более
  // точной картинки в 3D «Lite» (viewer3d.js уже не рисует кружки, чей центр
  // попал внутрь такого контура, см. fixturePolys/fixtureCircles dedup) —
  // безопасность раскладки не зависит от того, найден он или нет.
  function mergeDogboneHoles(holes, wallCandidates, pathFragments) {
    if (!wallCandidates || !wallCandidates.length) return { holes: holes, dogboneKeepouts: [], dogboneCutouts: [] };
    var used = {};
    var dogboneKeepouts = [];
    var dogboneCutouts = [];
    for (var i = 0; i < holes.length; i++) {
      if (used[i]) continue;
      var hi = holes[i];
      var ri = Math.max(hi.seatD || 0, hi.d || 0, hi.apertureCA || 0) / 2;
      if (!(ri > 0)) continue;
      for (var j = i + 1; j < holes.length; j++) {
        if (used[j]) continue;
        var hj = holes[j];
        var rj = Math.max(hj.seatD || 0, hj.d || 0, hj.apertureCA || 0) / 2;
        if (!(rj > 0)) continue;
        var dist = Math.hypot(hi.x - hj.x, hi.y - hj.y);
        if (dist < 1) continue;
        // лепестки гантели всегда БЛИЗКИ друг к другу относительно своих
        // радиусов (перемычка короче суммы радиусов) — иначе рискуем
        // случайно связать два просто оказавшихся неподалёку отверстия
        // (проверено: без этого условия две мелкие метки-ориентиры в 6.45мм
        // друг от друга ложно попадали в гантель — у них дистанция/радиусы
        // куда больше типичной перемычки)
        if (dist > (ri + rj) * 1.5) continue;
        // борт должен лежать РЯДОМ С ОТРЕЗКОМ между центрами (не просто где-то
        // поблизости) — иначе стенка от совсем другой гантели может случайно
        // подойти по расстоянию до чужой пары
        var hasWall = wallCandidates.some(function (w) {
          return pointToSegmentDist(w.cx, w.cy, hi.x, hi.y, hj.x, hj.y) < 3;
        });
        if (!hasWall) continue;
        var waistR = Math.min(ri, rj);
        dogboneKeepouts.push({ x: hi.x, y: hi.y, r: Math.round(ri * 1000) / 1000 });
        dogboneKeepouts.push({ x: hj.x, y: hj.y, r: Math.round(rj * 1000) / 1000 });
        var steps = Math.max(1, Math.round(dist / Math.max(0.5, waistR)));
        for (var k = 1; k < steps; k++) {
          var t = k / steps;
          dogboneKeepouts.push({
            x: Math.round((hi.x + (hj.x - hi.x) * t) * 1000) / 1000,
            y: Math.round((hi.y + (hj.y - hi.y) * t) * 1000) / 1000,
            r: Math.round(waistR * 1000) / 1000
          });
        }
        var realOutline = dogboneRealOutline(pathFragments, hi, ri, hj, rj);
        if (realOutline) dogboneCutouts.push({ points: realOutline });
        used[i] = true; used[j] = true;
        break;
      }
    }
    var remaining = holes.filter(function (h, idx) { return !used[idx]; });
    return { holes: remaining, dogboneKeepouts: dogboneKeepouts, dogboneCutouts: dogboneCutouts };
  }

  // Достаёт из готового Shape3D (после importSTEP) цилиндрические грани,
  // отделяет внешнюю стенку болванки (наибольший радиус — крупнее любого
  // реального отверстия по построению) и классифицирует остальные.
  // pathFragments — необязательно: плоский список строк SVG-path (visible+
  // hidden вида сверху, см. HC.stepImport.fromFile) для настоящего контура
  // вырезов-гантелей (dogboneRealOutline); без него (как во всех mock-тестах
  // ниже, без реального WASM) гантели по-прежнему безопасны для раскладчика,
  // просто без картинки точного контура в 3D «Lite» — только кружки.
  function analyzeShape(shape, pathFragments) {
    var bb = shape.boundingBox.bounds; // [[xmin,ymin,zmin],[xmax,ymax,zmax]]
    var thickness = bb[1][2] - bb[0][2];

    var cyls = [];
    shape.faces.forEach(function (f) {
      if (f.geomType !== "CYLINDRE") return;
      var cyl = f.surface.wrapped.Cylinder();
      var loc = cyl.Location();
      var fb = f.boundingBox.bounds;
      cyls.push({ r: cyl.Radius(), x: loc.X(), y: loc.Y(), z0: fb[0][2], z1: fb[1][2] });
    });
    if (!cyls.length) return { blankDiameter: null, thickness: thickness, holes: [], grooves: [], dogboneKeepouts: [], dogboneCutouts: [] };

    cyls.sort(function (a, b) { return b.r - a.r; });
    var blankDiameter = Math.round(cyls[0].r * 2 * 1000) / 1000;

    // Декоративные канавки маски (кольцевые — см. fixtures.grooves) — тоже
    // цилиндрические грани, обычно на той же оси (0,0), что и центральное
    // контрольное отверстие; их радиус близок к радиусу самой болванки. Без
    // фильтра они попадают в ТУ ЖЕ группу (x,y), что и реальное отверстие в
    // центре, и «крадут» место посадки/CA при сортировке по радиусу — вплоть
    // до полной потери настоящего отверстия. Порог — половина радиуса
    // болванки: с большим запасом выше любой реальной посадки/крепежа, но
    // ниже канавок, которые всегда идут у самого края.
    var maxHoleR = (blankDiameter / 2) * 0.5;
    var holeCandidates = cyls.slice(1).filter(function (c) { return c.r <= maxHoleR; });
    var holes = classifyCylinders(holeCandidates, thickness);

    // Кандидаты в «борт перемычки» выреза-гантели (см. mergeDogboneHoles) —
    // плоские грани НА ВСЮ ТОЛЩИНУ (это настоящий сквозной борт, а не пол
    // посадки/дно канавки — те почти плоские по Z) и небольшие в плане (не
    // путать с верхом/низом самого диска или полом канавки — те огромные).
    var wallCandidates = [];
    shape.faces.forEach(function (f) {
      if (f.geomType !== "PLANE") return;
      var fb = f.boundingBox.bounds;
      var zSpan = fb[1][2] - fb[0][2];
      var xSpan = fb[1][0] - fb[0][0];
      var ySpan = fb[1][1] - fb[0][1];
      if (zSpan > thickness - GROUP_TOL && xSpan < 15 && ySpan < 15) {
        wallCandidates.push({ cx: (fb[0][0] + fb[1][0]) / 2, cy: (fb[0][1] + fb[1][1]) / 2 });
      }
    });
    var dogboneResult = mergeDogboneHoles(holes, wallCandidates, pathFragments);
    holes = dogboneResult.holes;

    // Сами канавки — две концентричные стенки (снаружи/внутри) на одной оси,
    // отсеянные выше по радиусу. Группируем так же, по (x,y); пара граней на
    // одной оси → одна канавка (наружная/внутренняя стенка, глубина — по Z
    // самой стенки). Одиночная (без пары) грань — не канавка, пропускается.
    var grooveCyls = cyls.slice(1).filter(function (c) { return c.r > maxHoleR; });
    var grooveGroups = [];
    grooveCyls.forEach(function (c) {
      var gr = null;
      for (var i = 0; i < grooveGroups.length; i++) {
        if (Math.abs(grooveGroups[i].x - c.x) < GROUP_TOL && Math.abs(grooveGroups[i].y - c.y) < GROUP_TOL) { gr = grooveGroups[i]; break; }
      }
      if (!gr) { gr = { x: c.x, y: c.y, cyls: [] }; grooveGroups.push(gr); }
      gr.cyls.push(c);
    });
    var grooves = [];
    grooveGroups.forEach(function (gr) {
      var list = gr.cyls.slice().sort(function (a, b) { return b.r - a.r; });
      if (list.length < 2) return; // одна стенка без пары — не канавка (не вырезано), пропускаем
      grooves.push({
        outer: Math.round(list[0].r * 2 * 1000) / 1000,
        inner: Math.round(list[1].r * 2 * 1000) / 1000,
        depth: Math.round(Math.abs(list[0].z1 - list[0].z0) * 1000) / 1000
      });
    });

    return {
      blankDiameter: blankDiameter, thickness: Math.round(thickness * 1000) / 1000,
      holes: holes, grooves: grooves, dogboneKeepouts: dogboneResult.dogboneKeepouts,
      dogboneCutouts: dogboneResult.dogboneCutouts
    };
  }

  // Отверстие → запретная зона (кружок) для раскладчика: радиус — по
  // максимальному реальному размеру этого отверстия (посадка, если есть,
  // иначе сквозное d; зона напыления обычно не больше посадки, но берём
  // максимум на случай нестандартной геометрии). seatD/apertureCA/depth/
  // slotAvailable/slotAngle переносятся дальше как есть — сами по себе не
  // дают отдельной запретной зоны (уже учтены в r через классификацию), но
  // нужны ниже для 3D «Lite» (см. viewer3d.js collectFeatures): простой
  // крепёж (только h.d) — честный сквозной болт, а вот составную/глухую
  // посадку (seatD задан) нельзя резать насквозь на одну и ту же глубину —
  // получится либо сквозная дыра там, где должна быть глухая посадка, либо
  // (после фикса «паз насквозь») пропадает CA. depth есть у любого
  // отверстия с seatD (классификация в обоих таких случаях его задаёт).
  function keepoutsFromHoles(holes) {
    return (holes || []).map(function (h) {
      var seatD = h.seatD || h.d || 0;
      var r = Math.max(seatD, h.apertureCA || 0) / 2;
      return {
        x: h.x, y: h.y, r: Math.round(r * 1000) / 1000,
        seatD: h.seatD > 0 ? Math.round(h.seatD * 1000) / 1000 : undefined,
        apertureCA: h.apertureCA > 0 ? Math.round(h.apertureCA * 1000) / 1000 : undefined,
        depth: h.depth > 0 ? Math.round(h.depth * 1000) / 1000 : undefined,
        slotAvailable: !!h.slotAvailable,
        slotAngle: h.slotAvailable ? Math.round((h.slotAngle || 0) * 100) / 100 : undefined
      };
    }).filter(function (k) { return k.r > 0; });
  }

  // Плоский список {x,y,r,seatD,apertureCA,depth,slotAvailable,slotAngle} →
  // группы fixtures.holes (та же форма, что и у обычного крепежа — см.
  // js/packer.js opts.fixtureHoles). Точки СОСТАВНОЙ/ГЛУХОЙ посадки (seatD
  // задан — то есть это не простой крепёжный болт) получают 5 элементов
  // [x,y,slotAngle,depth,apertureCA] вместо [x,y] — остальной код (packer/
  // render/step-export), читающий только p[0]/p[1], этого просто не
  // замечает; viewer3d.js buildGroup/collectFeatures использует p[2..4]
  // (если есть) и d группы (=seatD), чтобы построить настоящий глухой
  // карман (+ паз, + сквозную CA) вместо одного сквозного кружка. Вынесено
  // отдельно от buildBlankSummary, чтобы этой же группировкой могла
  // воспользоваться миграция старых STEP-записей (app.js migrateOldStepDiscs) —
  // там источник уже классифицированные holes старого формата, а не свежий Shape3D.
  function groupKeepoutsByDiameter(keepouts) {
    var fixtureGroups = {}, fixtureOrder = [];
    (keepouts || []).forEach(function (k) {
      var dia = Math.round(k.r * 2 * 1000) / 1000;
      var key = String(Math.round(dia * 100));
      if (!fixtureGroups[key]) { fixtureGroups[key] = { d: dia, label: "Существующее Ø" + dia, points: [] }; fixtureOrder.push(key); }
      fixtureGroups[key].points.push(k.seatD
        ? [k.x, k.y, k.slotAvailable ? k.slotAngle : null, k.depth || 0, k.apertureCA || 0]
        : [k.x, k.y]);
    });
    return fixtureOrder.map(function (key) { return fixtureGroups[key]; });
  }

  // Запись диска для HC.CATALOG.discs — БЕЗ именованных контрольных
  // отверстий (нечего называть, править по одному их всё равно не будут):
  // controlVariants пуст, все найденные отверстия — плоские запретные зоны
  // в fixtures.holes. opts.previewSVG — готовый вид сверху (см.
  // HC.stepImport.fromFile — считает через rep.drawProjection, сюда приходит
  // уже готовой строкой, эта функция WASM не трогает).
  function buildBlankSummary(shape, opts) {
    opts = opts || {};
    var res = analyzeShape(shape, opts.pathFragments);
    // dogboneKeepouts — уже готовые {x,y,r} (см. mergeDogboneHoles), не через
    // keepoutsFromHoles (у них нет seatD/apertureCA — просто безопасные
    // кружки вдоль перемычки выреза-гантели). Это остаётся ЕДИНСТВЕННЫМ
    // источником безопасности для раскладчика — dogboneCutouts (настоящий
    // контур) ниже только для картинки в 3D «Lite», раскладку не затрагивает.
    var keepouts = keepoutsFromHoles(res.holes).concat(res.dogboneKeepouts || []);

    return {
      id: opts.id || ("disc-" + Date.now()),
      name: opts.name || "Болванка из STEP",
      installation: opts.installation || "",
      description: opts.description || "",
      diameter: opts.discDiameter || res.blankDiameter || 300,
      blankDiameter: res.blankDiameter || undefined,
      thickness: opts.thickness || res.thickness || 6,
      coatingZoneDiameter: opts.coatingZoneDiameter || undefined,
      previewSVG: opts.previewSVG || "",
      fileName: opts.fileName || undefined,
      fixtures: { holes: groupKeepoutsByDiameter(keepouts), cutouts: res.dogboneCutouts || [], grooves: res.grooves || [] },
      controlVariants: [{ id: "none", name: "Без контрольных отверстий", holes: [] }],
      defaults: { partPart: 6, partEdge: 3, partControl: 6 }
    };
  }

  // Проекция сверху (drawProjection(shape,"top")) отдаёт ДВА независимых
  // набора рёбер: .visible и .hidden. На вложенных карманах (посадка + паз
  // под пинцет, составное отверстие посадка+CA, занижение с обратной
  // стороны) значимая часть контура у replicad/OCC классифицируется как
  // "скрытая" (алгоритм удаления невидимых линий по правилам технического
  // черчения — деталь с обратной стороны реально закрыта материалом сверху),
  // а не "видимая". Проверено на реальном файле (см. scratchpad
  // diag-slot-projection.cjs): паз под пинцет и занижение с обратной стороны
  // оба попадают только в .hidden.
  //
  // Строгую конвенцию «видимое сплошным, скрытое пунктиром» здесь НЕ
  // используем: наши схематичные 2D (CSV/конструктор) везде рисуют контуры
  // одной сплошной линией независимо от стороны — смешивать с пунктиром
  // только для STEP делало картинку внешне похожей на вид СНИЗУ/зеркальный
  // (путало, а не поясняло). Поэтому оба набора рёбер просто объединяются в
  // ОДНУ сплошную картинку — единообразно с остальными источниками болванок.
  function combineProjectionSVG(visibleSVG, hiddenSVG) {
    if (!hiddenSVG) return visibleSVG;
    var hiddenBody = hiddenSVG.replace(/^[\s\S]*?<svg[^>]*>/, "").replace(/<\/svg>\s*$/, "");
    if (!hiddenBody.trim()) return visibleSVG;
    return visibleSVG.replace(/<\/svg>\s*$/, hiddenBody + "</svg>");
  }

  // Публичное API: грузит движок (если ещё не загружен), парсит STEP-файл,
  // строит настоящий вид сверху и запись диска. arrayBufferOrBlob —
  // File/Blob/ArrayBuffer из <input type=file> или файла из подключённой папки.
  function fromFile(arrayBufferOrBlob, opts, onStatus) {
    onStatus = onStatus || function () {};
    if (!HC.loadReplicad) return Promise.reject(new Error("STEP-движок недоступен (step-export.js не подключён)"));
    return HC.loadReplicad(onStatus).then(function (rep) {
      onStatus("Разбираю STEP…");
      var blob = (typeof Blob !== "undefined" && arrayBufferOrBlob instanceof Blob)
        ? arrayBufferOrBlob
        : new Blob([arrayBufferOrBlob]);
      return rep.importSTEP(blob).then(function (shape) {
        var previewSVG = "";
        var pathFragments = [];
        try {
          var proj = rep.drawProjection(shape, "top");
          var visibleSVG = proj.visible.toSVG();
          var hiddenSVG = proj.hidden ? proj.hidden.toSVG() : null;
          previewSVG = combineProjectionSVG(visibleSVG, hiddenSVG);
          // тот же проход (visible+hidden) — ещё и как сырые строки контуров
          // (не SVG-документ, а команды пути), для настоящего контура
          // вырезов-гантели (см. mergeDogboneHoles/dogboneRealOutline).
          (proj.visible.toSVGPaths() || []).forEach(function (arr) {
            (arr || []).forEach(function (d) { pathFragments.push(d); });
          });
          if (proj.hidden) {
            (proj.hidden.toSVGPaths() || []).forEach(function (arr) {
              (arr || []).forEach(function (d) { pathFragments.push(d); });
            });
          }
        } catch (e) { /* превью/контур — необязательное удобство, отсутствие не критично */ }
        var entryOpts = {};
        for (var k in opts) if (Object.prototype.hasOwnProperty.call(opts, k)) entryOpts[k] = opts[k];
        entryOpts.previewSVG = previewSVG;
        entryOpts.pathFragments = pathFragments;
        var entry = buildBlankSummary(shape, entryOpts);
        onStatus("Готово.");
        return entry;
      });
    });
  }

  HC.stepImport = {
    classifyCylinders: classifyCylinders,
    analyzeShape: analyzeShape,
    mergeDogboneHoles: mergeDogboneHoles,
    flattenSVGPath: flattenSVGPath,
    dogboneRealOutline: dogboneRealOutline,
    keepoutsFromHoles: keepoutsFromHoles,
    groupKeepoutsByDiameter: groupKeepoutsByDiameter,
    combineProjectionSVG: combineProjectionSVG,
    buildBlankSummary: buildBlankSummary,
    fromFile: fromFile
  };
})(typeof globalThis !== "undefined" ? globalThis : window);
