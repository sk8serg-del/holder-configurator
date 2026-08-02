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

  // Достаёт из готового Shape3D (после importSTEP) цилиндрические грани,
  // отделяет внешнюю стенку болванки (наибольший радиус — крупнее любого
  // реального отверстия по построению) и классифицирует остальные.
  function analyzeShape(shape) {
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
    if (!cyls.length) return { blankDiameter: null, thickness: thickness, holes: [] };

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

    return { blankDiameter: blankDiameter, thickness: Math.round(thickness * 1000) / 1000, holes: holes, grooves: grooves };
  }

  // Отверстие → запретная зона (кружок) для раскладчика: радиус — по
  // максимальному реальному размеру этого отверстия (посадка, если есть,
  // иначе сквозное d; зона напыления обычно не больше посадки, но берём
  // максимум на случай нестандартной геометрии).
  function keepoutsFromHoles(holes) {
    return (holes || []).map(function (h) {
      var r = Math.max(h.seatD || 0, h.d || 0, h.apertureCA || 0) / 2;
      return { x: h.x, y: h.y, r: Math.round(r * 1000) / 1000 };
    }).filter(function (k) { return k.r > 0; });
  }

  // Плоский список {x,y,r} → группы fixtures.holes (та же форма, что и у
  // обычного крепежа — см. js/packer.js opts.fixtureHoles). Вынесено отдельно
  // от buildBlankSummary, чтобы этой же группировкой могла воспользоваться
  // миграция старых STEP-записей (app.js migrateOldStepDiscs) — там источник
  // уже классифицированные holes старого формата, а не свежий Shape3D.
  function groupKeepoutsByDiameter(keepouts) {
    var fixtureGroups = {}, fixtureOrder = [];
    (keepouts || []).forEach(function (k) {
      var dia = Math.round(k.r * 2 * 1000) / 1000;
      var key = String(Math.round(dia * 100));
      if (!fixtureGroups[key]) { fixtureGroups[key] = { d: dia, label: "Существующее Ø" + dia, points: [] }; fixtureOrder.push(key); }
      fixtureGroups[key].points.push([k.x, k.y]);
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
    var res = analyzeShape(shape);
    var keepouts = keepoutsFromHoles(res.holes);

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
      fixtures: { holes: groupKeepoutsByDiameter(keepouts), cutouts: [], grooves: res.grooves || [] },
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
        try {
          var proj = rep.drawProjection(shape, "top");
          var visibleSVG = proj.visible.toSVG();
          var hiddenSVG = proj.hidden ? proj.hidden.toSVG() : null;
          previewSVG = combineProjectionSVG(visibleSVG, hiddenSVG);
        } catch (e) { /* превью — необязательное удобство, отсутствие не критично */ }
        var entryOpts = {};
        for (var k in opts) if (Object.prototype.hasOwnProperty.call(opts, k)) entryOpts[k] = opts[k];
        entryOpts.previewSVG = previewSVG;
        var entry = buildBlankSummary(shape, entryOpts);
        onStatus("Готово.");
        return entry;
      });
    });
  }

  HC.stepImport = {
    classifyCylinders: classifyCylinders,
    analyzeShape: analyzeShape,
    keepoutsFromHoles: keepoutsFromHoles,
    groupKeepoutsByDiameter: groupKeepoutsByDiameter,
    combineProjectionSVG: combineProjectionSVG,
    buildBlankSummary: buildBlankSummary,
    fromFile: fromFile
  };
})(typeof globalThis !== "undefined" ? globalThis : window);
