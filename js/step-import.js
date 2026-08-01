/*
 * step-import.js — импорт STEP-болванки диска прямо в браузере (без Inventor).
 *
 * По загруженному .step/.stp: строит твердотельную модель через тот же
 * CAD-движок (replicad/OpenCascade, см. HC.loadReplicad в step-export.js) и
 * НАХОДИТ отверстия геометрически — по цилиндрическим граням, без разметки.
 * Различить «посадка+зона напыления» (составное, две концентричные грани
 * разного радиуса) от простого отверстия (одна грань) можно по факту двух
 * граней в одной точке (X,Y); различить сквозное от глухого — по тому,
 * достаёт ли грань до противоположной стороны болванки по Z.
 *
 * Ограничение (как и у выгрузки DumpHoles через Inventor, см. holder-import.js):
 * различить «контрольное отверстие» от «крепежа на фланце» геометрия сама по
 * себе не может — только по расстоянию от центра (Ø полезной зоны, которую
 * указывает технолог). Фигурные (не круглые) вырезы и канавки STEP-анализ не
 * распознаёт вообще — such случаи вносятся в js/catalog.js вручную.
 *
 * HC.stepImport.classifyCylinders(cyls, thickness) — чистая логика группировки
 *   цилиндрических граней в отверстия (без WASM, тестируется напрямую).
 * HC.stepImport.analyzeShape(shape) — из готового replicad-Shape3D достаёт
 *   цилиндрические грани и вызывает classifyCylinders.
 * HC.stepImport.buildDiscEntry(shape, opts) — запись диска для HC.CATALOG.discs.
 * HC.stepImport.fromFile(arrayBufferOrBlob, opts, onStatus) — асинхронно: грузит
 *   движок (если ещё не загружен), парсит STEP, строит запись диска.
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

    return groups.map(function (gr) {
      var list = gr.cyls.slice().sort(function (a, b) { return b.r - a.r; }); // от большего радиуса к меньшему
      var top = list[0];
      var depth = Math.abs(top.z1 - top.z0);
      var through = depth > thickness - THROUGH_TOL;
      var h = { x: gr.x, y: gr.y };
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
    var holes = classifyCylinders(cyls.slice(1), thickness);
    return { blankDiameter: blankDiameter, thickness: Math.round(thickness * 1000) / 1000, holes: holes };
  }

  // Маршрутизация найденных отверстий: внутри полезной зоны (discDia) —
  // контрольные, снаружи — крепёж (fixtures). Так же, как в holder-import.js
  // для CSV-выгрузки — по одной геометрии роль отверстия не определить.
  function routeHoles(holes, discDia) {
    if (!(discDia > 0)) return { controlHoles: holes.slice(), fixtureHoles: [] };
    var maxR = discDia / 2, TOL = 0.15;
    var control = [], fixture = [];
    holes.forEach(function (h) {
      var R = Math.sqrt(h.x * h.x + h.y * h.y);
      if (R <= maxR + TOL) control.push(h); else fixture.push(h);
    });
    return { controlHoles: control, fixtureHoles: fixture };
  }

  // Полная запись диска для HC.CATALOG.discs — та же форма, что и
  // holder-import.js: buildDiscEntry.
  function buildDiscEntry(shape, opts) {
    opts = opts || {};
    var res = analyzeShape(shape);
    var routed = routeHoles(res.holes, opts.discDiameter);

    var fixtureGroups = {}, fixtureOrder = [];
    routed.fixtureHoles.forEach(function (h) {
      var dia = h.seatD != null ? h.seatD : h.d;
      if (dia == null) return;
      var key = String(Math.round(dia * 100));
      if (!fixtureGroups[key]) { fixtureGroups[key] = { d: dia, label: "Крепёж Ø" + dia, points: [] }; fixtureOrder.push(key); }
      fixtureGroups[key].points.push([h.x, h.y]);
    });

    var holes = routed.controlHoles.map(function (h, i) {
      var o = { x: h.x, y: h.y, name: "Отверстие " + (i + 1), slotAvailable: false };
      if (h.d != null) o.d = h.d;
      if (h.seatD != null) o.seatD = h.seatD;
      if (h.apertureCA != null) o.apertureCA = h.apertureCA;
      if (h.depth != null) o.depth = h.depth;
      return o;
    });

    return {
      id: opts.id || ("disc-" + Date.now()),
      name: opts.name || "Подложка из STEP",
      diameter: opts.discDiameter || res.blankDiameter || 300,
      blankDiameter: res.blankDiameter || undefined,
      thickness: opts.thickness || res.thickness || 6,
      fixtures: { holes: fixtureOrder.map(function (k) { return fixtureGroups[k]; }), cutouts: [] },
      controlVariants: [
        { id: "std", name: "Из STEP", holes: holes },
        { id: "none", name: "Без контрольных отверстий", holes: [] }
      ],
      defaults: { partPart: 6, partEdge: 3, partControl: 6 }
    };
  }

  // Публичное API: грузит движок (если ещё не загружен), парсит STEP-файл,
  // строит запись диска. arrayBufferOrBlob — File/Blob/ArrayBuffer из <input type=file>.
  function fromFile(arrayBufferOrBlob, opts, onStatus) {
    onStatus = onStatus || function () {};
    if (!HC.loadReplicad) return Promise.reject(new Error("STEP-движок недоступен (step-export.js не подключён)"));
    return HC.loadReplicad(onStatus).then(function (rep) {
      onStatus("Разбираю STEP…");
      var blob = (typeof Blob !== "undefined" && arrayBufferOrBlob instanceof Blob)
        ? arrayBufferOrBlob
        : new Blob([arrayBufferOrBlob]);
      return rep.importSTEP(blob);
    }).then(function (shape) {
      var entry = buildDiscEntry(shape, opts);
      onStatus("Готово.");
      return entry;
    });
  }

  HC.stepImport = {
    classifyCylinders: classifyCylinders,
    analyzeShape: analyzeShape,
    routeHoles: routeHoles,
    buildDiscEntry: buildDiscEntry,
    fromFile: fromFile
  };
})(typeof globalThis !== "undefined" ? globalThis : window);
