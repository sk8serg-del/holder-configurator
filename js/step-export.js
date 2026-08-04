/*
 * step-export.js — экспорт готового твердотельного STEP прямо из браузера.
 *
 * По кнопке «Скачать STEP» строит диск (цилиндр) и вырезает в нём карманы из
 * текущей раскладки: посадка (глухой вырез на глубину), паз под пинцет (глухой,
 * НАСТОЯЩИЕ дуги торцов) и зона напыления CA (сквозной вырез). На выходе — .step.
 *
 * Использует CAD-ядро OpenCascade через replicad (WASM), которое грузится с CDN
 * ПО ТРЕБОВАНИЮ (при первом клике), чтобы не утяжелять страницу. Всё считается
 * в браузере, без сервера. Единицы — мм (как во всей раскладке).
 *
 * ВНИМАНИЕ: это первый прототип. Точные CDN-URL / версия движка могут потребовать
 * правки при первом запуске — при ошибке загрузки смотрите консоль.
 */
(function (g) {
  "use strict";
  var HC = (g.HC = g.HC || {});

  // --- версия и адреса движка (правится в одном месте) ---
  // replicad — через jsdelivr /+esm; OpenCascade (Emscripten-модуль, CJS) — через
  // esm.sh (конвертит в ESM с default-экспортом фабрики); сам wasm — с jsdelivr.
  var REP_VER = "0.19.1";
  var OC_VER = "0.19.0"; // соответствует replicad-opencascadejs, требуемому replicad@0.19.x
  var REP_URL = "https://cdn.jsdelivr.net/npm/replicad@" + REP_VER + "/+esm";
  var OC_JS = "https://esm.sh/replicad-opencascadejs@" + OC_VER + "/src/replicad_single.js";
  var OC_WASM = "https://cdn.jsdelivr.net/npm/replicad-opencascadejs@" + OC_VER + "/src/replicad_single.wasm";

  var TOP = 0.5; // насколько резак выступает над верхней гранью (чистый рез)

  var repPromise = null;
  function loadReplicad(onStatus) {
    if (repPromise) return repPromise;
    repPromise = (async function () {
      if (onStatus) onStatus("Загрузка 3D-движка (WASM)…");
      var replicad = await import(REP_URL);
      var ocFactory = (await import(OC_JS)).default;
      var OC = await ocFactory({ locateFile: function () { return OC_WASM; } });
      replicad.setOC(OC);
      return replicad;
    })();
    // при неудаче (сеть/CDN) не кэшируем отказ навсегда — иначе реальный клик
    // на «Скачать STEP» после неудачной фоновой подгрузки (см. HC.preloadSTEP)
    // сразу получит тот же отклонённый промис без повторной попытки
    repPromise.catch(function () { repPromise = null; });
    return repPromise;
  }

  // Тихая фоновая подгрузка движка — вызывается ДО клика по «Скачать STEP»
  // (как только есть готовая раскладка, см. app.js: doPack), чтобы к моменту
  // реального клика WASM уже был в кэше браузера. Ошибку не показываем здесь —
  // она проявится (и будет обработана) при настоящем HC.downloadSTEP.
  HC.preloadSTEP = function () {
    loadReplicad().catch(function () {});
  };

  // Общий доступ к движку — нужен и step-import.js (импорт STEP-болванки),
  // чтобы не грузить WASM дважды и не дублировать REP_URL/OC_JS/OC_WASM.
  HC.loadReplicad = loadReplicad;

  // ---- геометрия паза (угол/длина/ширина/точки меток) — как в export-csv.
  // f.markCount — сколько меток (0/undefined — нет; разновидность детали
  // в заказе: 1-я — одна метка, 2-я — две, и т.д., см. features()) ----
  function slotGeom(f) {
    if (!f.slotOn) return null;
    if (f.type === "circle") {
      var D = f.seatD > 0 ? f.seatD : f.d;
      var angle = f.slotAngle != null ? f.slotAngle : Math.atan2(f.cy, f.cx) * 180 / Math.PI;
      var halfW = Math.min(9, D * 0.75) / 2;
      var marks = f.markCount > 0
        ? HC.geom.slotMarkPoints(f.cx, f.cy, D / 2, halfW, angle * Math.PI / 180, HC.MARK_OFF, HC.MARK_SIDE, f.markCount, HC.MARK_PITCH)
        : [];
      return { angle: angle, len: D + 5, wid: Math.min(9, D * 0.75), marks: marks };
    }
    var gap = f.seatGap > 0 ? f.seatGap : 0;
    var ch = f.type === "oct" ? (f.chamfer || 0) : 0;
    var ang = (f.rot || 0) + (f.slotAngle || 0);
    var ar = ang * Math.PI / 180, ux = Math.cos(ar), uy = Math.sin(ar);
    var seat = HC.geom.shapePoly(f.type, 0, 0, f.w + 2 * gap, f.h + 2 * gap, ch, f.rot || 0);
    var halfExt = 0;
    seat.forEach(function (q) { var pr = Math.abs(q.x * ux + q.y * uy); if (pr > halfExt) halfExt = pr; });
    var wid = Math.min(9, (Math.min(f.w, f.h) + 2 * gap) * 0.75);
    var marks2 = f.markCount > 0
      ? HC.geom.slotMarkPoints(f.cx, f.cy, halfExt, wid / 2, ar, HC.MARK_OFF, HC.MARK_SIDE, f.markCount, HC.MARK_PITCH)
      : [];
    return { angle: ang, len: 2 * halfExt + 5, wid: wid, marks: marks2 };
  }

  // Список элементов (деталь/КО) с посадкой/CA/пазом и глубиной.
  function features(order) {
    var thickness = order.disc.thickness > 0 ? order.disc.thickness : 6;
    var partDepth = Math.max(0.5, thickness - 1.5);
    var out = [];
    (order.controlHoles || []).forEach(function (h) {
      out.push({
        type: "circle", cx: h.x, cy: h.y, d: h.d,
        seatD: h.seatD != null ? h.seatD : h.d, caDia: h.apertureCA,
        slotOn: !!h.slotOn, slotAngle: h.slotAngle, depth: h.depth > 0 ? h.depth : partDepth,
        markCount: 0 // метки-ориентиры — только у деталей, не у контрольных отверстий
      });
    });
    (order.placed || []).forEach(function (p) {
      var isC = p.type === "circle";
      out.push({
        type: p.type, cx: p.cx, cy: p.cy, d: isC ? p.d : 0,
        w: isC ? 0 : p.w, h: isC ? 0 : p.h,
        chamfer: p.type === "oct" ? (p.chamfer || 0) : 0, rot: isC ? 0 : (p.rot || 0),
        seatD: isC ? p.seatD : 0, caDia: isC ? p.apertureCA : 0,
        seatGap: isC ? 0 : p.seatGap, caInset: isC ? 0 : p.caInset,
        slotOn: !!p.slotOn, slotAngle: p.slotAngle, depth: partDepth,
        // разновидность детали (индекс в списке деталей) + 1 меток
        markCount: (p.partIndex || 0) + 1
      });
    });
    return out;
  }

  // ---- 2D-контуры (replicad Drawing) по центру в (0,0), без поворота ----
  function shapeDrawing(rep, type, w, h, chamfer) {
    if (type === "oval") {
      // drawEllipse(majorRadius, minorRadius) требует majorRadius >= minorRadius
      // (это ограничение OpenCascade, gp_Elips бросает исключение иначе) — при
      // w<h (овал «стоя») w/2 оказывался МЕНЬШЕ h/2, и построение падало.
      // Тот же приём, что и в Inventor-правиле (AddShape/oval): большая ось —
      // всегда majorRadius, а если она пришлась на h, довернуть на 90°, чтобы
      // после применения реального поворота детали (place()) эллипс встал
      // как надо.
      var maj = Math.max(w, h) / 2, min = Math.min(w, h) / 2;
      var ell = rep.drawEllipse(maj, min);
      return h > w ? ell.rotate(90) : ell;
    }
    if (type === "oct") {
      var c = Math.min(chamfer || 0, Math.min(w, h) / 2 - 1e-4);
      if (c > 0) {
        var x = w / 2, y = h / 2;
        return rep.draw([-x + c, -y])
          .lineTo([x - c, -y]).lineTo([x, -y + c]).lineTo([x, y - c])
          .lineTo([x - c, y]).lineTo([-x + c, y]).lineTo([-x, y - c]).lineTo([-x, -y + c])
          .close();
      }
    }
    return rep.drawRoundedRectangle(w, h, 0); // rect и oct без фаски
  }

  function place(draw, cx, cy, rotDeg) {
    if (rotDeg) draw = draw.rotate(rotDeg);
    return draw.translate([cx, cy]);
  }

  // Вырезает в готовом теле (baseSolid) только карманы ДЕТАЛЕЙ ЗАКАЗА
  // (посадка/паз/зона напыления каждого контрольного отверстия и размещённой
  // детали, см. features()) — общая часть между buildSolid (диск строится с
  // нуля) и buildSolidFromImported (тело — уже настоящая STEP-геометрия
  // болванки, в ней НЕ нужно повторно резать занижение/крепёж/канавки — они
  // уже часть исходного файла). warnings — массив, куда складываются
  // сообщения о пропущенных элементах (не бросаем исключение наружу за один
  // плохой элемент — падение ЛЮБОГО одного выреза не должно обрывать
  // экспорт целиком для остальных, ни в чём не повинных деталей).
  //
  // topZ — Z верхней грани, ОТ КОТОРОЙ реально режутся карманы. У buildSolid
  // диск строится этой же функцией с нуля (extrude(-thickness) от Z=0) —
  // top=0 гарантирован по построению. У buildSolidFromImported тело — из
  // РЕАЛЬНОГО STEP-файла: его Z=0 может вообще не совпадать с верхней гранью
  // (зависит от того, как деталь была смоделирована в Inventor — например,
  // выдавлена от 0 ВВЕРХ, а не вниз) — резать «от нуля» в этом случае резало
  // бы не с той стороны/не с той высоты. thicknessOverride аналогично: для
  // импортированного тела берём РЕАЛЬНУЮ толщину по его bounding box, а не
  // сохранённое в каталоге число (могло разойтись).
  function cutPartFeatures(rep, order, baseSolid, warnings, topZ, thicknessOverride) {
    topZ = topZ || 0;
    var thickness = thicknessOverride > 0 ? thicknessOverride : (order.disc.thickness > 0 ? order.disc.thickness : 6);

    var cutters = [];
    function blind(draw, depth) { cutters.push(draw.sketchOnPlane("XY", topZ + TOP).extrude(-(depth + TOP))); }
    function through(draw) { cutters.push(draw.sketchOnPlane("XY", topZ + TOP).extrude(-(thickness + 2 * TOP))); }

    // Коническая зенковка-метка Ø MARK_D под углом MARK_ANGLE (полный), остриём вниз.
    // Строим лофтом от круга у поверхности к почти-точке на глубине; конус выступает
    // на TOP над верхней гранью (чистый рез). tan(полугла) задаёт наклон стенки.
    function countersink(mx, my) {
      var t = Math.tan((HC.MARK_ANGLE / 2) * Math.PI / 180);
      if (!(t > 0)) return;
      var rSurf = HC.MARK_D / 2;
      var rTop = rSurf + TOP * t;              // радиус на уровне z=+TOP (от верхней грани)
      var zApex = -(rSurf / t);                // где радиус обращается в 0 (от верхней грани)
      var top = rep.drawCircle(rTop).translate([mx, my]).sketchOnPlane("XY", topZ + TOP);
      var bot = rep.drawCircle(0.02).translate([mx, my]).sketchOnPlane("XY", topZ + zApex);
      cutters.push(top.loftWith(bot, { ruled: true }));
    }

    features(order).forEach(function (f, idx) {
      try {
        var isC = f.type === "circle";
        // посадка
        if (isC) {
          if (f.seatD > 0) blind(place(rep.drawCircle(f.seatD / 2), f.cx, f.cy, 0), f.depth);
        } else {
          blind(place(shapeDrawing(rep, f.type, f.w + 2 * f.seatGap, f.h + 2 * f.seatGap, f.chamfer), f.cx, f.cy, f.rot), f.depth);
        }
        // паз (rounded rectangle с радиусом = половина ширины = настоящий «стадион»)
        var s = slotGeom(f);
        if (s && s.len > 0 && s.wid > 0) {
          blind(place(rep.drawRoundedRectangle(s.len, s.wid, s.wid / 2), f.cx, f.cy, s.angle), f.depth);
          if (s.marks) s.marks.forEach(function (m) { countersink(m.x, m.y); }); // метки-ориентиры
        }
        // зона напыления — насквозь
        if (isC) {
          if (f.caDia > 0) through(place(rep.drawCircle(f.caDia / 2), f.cx, f.cy, 0));
        } else if (f.caInset > 0 && (f.w - 2 * f.caInset) > 0 && (f.h - 2 * f.caInset) > 0) {
          through(place(shapeDrawing(rep, f.type, f.w - 2 * f.caInset, f.h - 2 * f.caInset, f.chamfer), f.cx, f.cy, f.rot));
        }
      } catch (e) {
        warnings.push("элемент #" + (idx + 1) + " (" + f.type + " @ " + f.cx.toFixed(1) + "," + f.cy.toFixed(1) + "): " + ((e && e.message) || e));
      }
    });

    // Гравировка номера/названия подложкодержателя (см. js/engraving.js
    // computeLayout — контур уже изогнут вдоль свободной дуги у края,
    // координаты диска). Неглубокий вырез — тем же надёжным способом (fuse
    // всех карманов, потом одно вычитание), что и всё остальное выше; дырки
    // самой буквы («D», «0», «8» и т.п.) — через Drawing.cut(), реальная
    // булева операция (в отличие от Lite 3D — там дырка-в-дырке теряется,
    // см. viewer3d.js, здесь такого ограничения нет).
    //
    // Занижение по краю (order.disc.edgeRecess, top-side): буквы у самого
    // края обычно попадают ИМЕННО в занижённое кольцо (радиус > erInnerR) —
    // там реальная поверхность уже НИЖЕ на edgeRecess.depth, чем номинальный
    // верх (topZ). Резать от topZ, как обычно, означало бы резать «в воздухе»
    // (материала там ещё нет на глубину depth) — карман физически не
    // появился бы (см. регрессия пользователя). Считаем локальный верх для
    // каждой буквы по её среднему радиусу — та же логика, что и в
    // viewer3d.js buildGroup (erIsTop/erInnerR/glyphsInRecessRing).
    var edgeRecess = order.disc.edgeRecess;
    var erIsTop = !!(edgeRecess && edgeRecess.diameter > 0 && edgeRecess.depth > 0 && edgeRecess.side !== "bottom");
    var erInnerR = erIsTop ? edgeRecess.diameter / 2 : 0;
    var erDepth = erIsTop ? edgeRecess.depth : 0;
    function glyphAvgRadius(cmds) {
      var sx = 0, sy = 0;
      cmds.forEach(function (c) { sx += c.x; sy += c.y; });
      return Math.hypot(sx / cmds.length, sy / cmds.length);
    }
    // Команды контура (M/L/Q — Q настоящая квадратичная кривая, контрольная
    // точка cx/cy) — строим НАСТОЯЩУЮ кривую через quadraticBezierCurveTo
    // (порядок аргументов у replicad — (конец, контрольная точка), проверено
    // вживую), а не приближаем полигоном по тесселированным точкам.
    function drawFromCommands(cmds) {
      var d = rep.draw([cmds[0].x, cmds[0].y]);
      for (var i = 1; i < cmds.length; i++) {
        var c = cmds[i];
        d = c.cmd === "Q" ? d.quadraticBezierCurveTo([c.x, c.y], [c.cx, c.cy]) : d.lineTo([c.x, c.y]);
      }
      return d.close();
    }
    ((order.engraving && order.engraving.glyphs) || []).forEach(function (gl, gi) {
      try {
        var outer = drawFromCommands(gl.outer);
        (gl.holes || []).forEach(function (hole) { outer = outer.cut(drawFromCommands(hole)); });
        var localTopZ = (erIsTop && glyphAvgRadius(gl.outer) > erInnerR) ? topZ - erDepth : topZ;
        cutters.push(outer.sketchOnPlane("XY", localTopZ + TOP).extrude(-(HC.ENGRAVE_DEPTH + TOP)));
      } catch (e) {
        warnings.push("гравировка, символ #" + (gi + 1) + ": " + ((e && e.message) || e));
      }
    });

    if (!cutters.length) return baseSolid;

    // ВНИМАНИЕ: два способа ускорить это уже пробовались и ОБА тихо портят
    // результат — не включать без прямой проверки объёма (replicad.measureVolume)
    // до и после:
    //  1. optimisation:"sameFace"/"commonFace" (BOPAlgo_GlueFull/GlueShift) —
    //     диск оставался НЕвырезанным (0 мм³ разницы), без единой ошибки.
    //  2. rep.makeCompound(cutters) (сгруппировать все вырезы БЕЗ склейки,
    //     потом один cut) — в разы быстрее, но если вырезы одной детали
    //     перекрываются между собой (посадка+паз, посадка+CA+паз — САМЫЙ
    //     обычный случай в этом проекте, у любой детали с включённым пазом),
    //     результат либо падает сырым исключением WASM, либо — хуже —
    //     тихо получается НЕПРАВИЛЬНЫЙ объём (без единой ошибки, проверено
    //     прямым сравнением с надёжным путём на паре простых случаев:
    //     расхождение 600-1100 мм³). Единственный доказанный корректным путь —
    //     ниже: сначала явно склеить (fuse) все вырезы друг с другом, потом
    //     ОДНО вычитание из диска. Медленнее на плотных раскладках
    //     («Page Unresponsive» на полусотне+ деталей), но корректность важнее.
    var all = null;
    cutters.forEach(function (c, i) {
      if (all === null) { all = c; return; }
      try {
        all = all.fuse(c);
      } catch (e) {
        warnings.push("не удалось объединить вырез #" + (i + 1) + ": " + ((e && e.message) || e));
      }
    });
    if (all === null) return baseSolid;
    try {
      return baseSolid.cut(all);
    } catch (e) {
      warnings.push("не удалось вырезать карманы из диска: " + ((e && e.message) || e));
      return baseSolid;
    }
  }

  // Строит ТОЛЬКО саму болванку: диск (цилиндр) минус занижение по краю и
  // крепёж болванки (order.disc.fixtures.holes) — без деталей заказа. Общая
  // часть для buildSolid (с нуля, режет ещё и заказ) и buildBlankOnlySolid
  // (для реальной 2D-проекции превью — см. HC.computeBlankPreviewSVG).
  function buildBlankBase(rep, disc, warnings) {
    var thickness = disc.thickness > 0 ? disc.thickness : 6;
    var R = disc.diameter / 2;
    var base = rep.drawCircle(R).sketchOnPlane("XY").extrude(-thickness);

    var blankCutters = [];
    // Занижение по краю болванки (disc.edgeRecess): кольцо СНАРУЖИ
    // edgeRecess.diameter (до самого края диска R) занижено на depth от
    // указанной грани (top — по умолчанию, или bottom). Внутри diameter —
    // полная толщина, без изменений.
    if (disc.edgeRecess && disc.edgeRecess.diameter > 0 && disc.edgeRecess.depth > 0) {
      try {
        var er = disc.edgeRecess;
        var erInnerR = er.diameter / 2;
        if (erInnerR < R) {
          var erRing = rep.drawCircle(R).cut(rep.drawCircle(erInnerR));
          if (er.side === "bottom") {
            blankCutters.push(erRing.sketchOnPlane("XY", -thickness - TOP).extrude(er.depth + TOP));
          } else {
            blankCutters.push(erRing.sketchOnPlane("XY", TOP).extrude(-(er.depth + TOP)));
          }
        }
      } catch (e) {
        warnings.push("занижение по краю: " + ((e && e.message) || e));
      }
    }

    // Крепёжные/технологические отверстия болванки (disc.fixtures.holes) —
    // простые сквозные вырезы; раньше только рисовались в 2D/3D, в STEP не резались.
    ((disc.fixtures && disc.fixtures.holes) || []).forEach(function (grp, gi) {
      if (!(grp.d > 0)) return;
      (grp.points || []).forEach(function (p, pi) {
        try {
          blankCutters.push(place(rep.drawCircle(grp.d / 2), p[0], p[1], 0).sketchOnPlane("XY", TOP).extrude(-(thickness + 2 * TOP)));
        } catch (e) {
          warnings.push("крепёж «" + (grp.label || gi) + "» #" + (pi + 1) + ": " + ((e && e.message) || e));
        }
      });
    });

    if (blankCutters.length) {
      var allBlank = blankCutters[0];
      for (var i = 1; i < blankCutters.length; i++) {
        try { allBlank = allBlank.fuse(blankCutters[i]); } catch (e) { warnings.push("не удалось объединить вырез болванки #" + (i + 1) + ": " + ((e && e.message) || e)); }
      }
      try { base = base.cut(allBlank); } catch (e) { warnings.push("не удалось вырезать элементы болванки: " + ((e && e.message) || e)); }
    }

    return base;
  }

  // Собирает твёрдое тело С НУЛЯ: болванка (buildBlankBase) + карманы деталей
  // заказа. Путь для болванок БЕЗ настоящего исходного STEP-файла (ручные/из
  // каталога/CSV/мигрированные без файла — см. buildSolidFromImported для
  // противоположного случая).
  function buildSolid(rep, order, warnings) {
    var base = buildBlankBase(rep, order.disc, warnings);
    return cutPartFeatures(rep, order, base, warnings);
  }

  // Болванка САМА ПО СЕБЕ (без заказа), но со всеми свидетелями/Reference
  // (controlVariants[0].holes) — паз включён везде, где доступен (та же
  // логика, что у app.js addBlankPreviewHoles: показываем физический вид
  // болванки, а не конкретный заказ). Используется только для реальной
  // 2D-проекции превью (см. HC.computeBlankPreviewSVG) — единообразно с
  // STEP-импортом, вместо приближённой схемы из параметров.
  function buildBlankOnlySolid(rep, disc, warnings) {
    var base = buildBlankBase(rep, disc, warnings);
    var rawHoles = (disc.controlVariants && disc.controlVariants[0] && disc.controlVariants[0].holes) || [];
    var holes = rawHoles.map(function (h) {
      if (!h.slotAvailable) return h;
      var h2 = {};
      for (var k in h) if (Object.prototype.hasOwnProperty.call(h, k)) h2[k] = h[k];
      h2.slotOn = true;
      h2.slotAngle = h.slotAngle || 0;
      return h2;
    });
    var fakeOrder = { disc: { thickness: disc.thickness }, controlHoles: holes, placed: [] };
    return cutPartFeatures(rep, fakeOrder, base, warnings);
  }

  // Собирает твёрдое тело ИЗ НАСТОЯЩЕГО STEP-файла болванки (arrayBuffer —
  // байты .stp, см. js/blank-storage.js readStepFile): занижение/крепёж/
  // канавки/фигурные вырезы уже часть этой геометрии, второй раз резать их
  // не нужно (в отличие от buildSolid) — только карманы деталей заказа.
  function buildSolidFromImported(rep, order, arrayBuffer, warnings) {
    var blob = (typeof Blob !== "undefined" && arrayBuffer instanceof Blob) ? arrayBuffer : new Blob([arrayBuffer]);
    return rep.importSTEP(blob).then(function (shape) {
      // Верхняя грань и толщина — по РЕАЛЬНОМУ bounding box импортированного
      // тела (та же договорённость «верх = максимальный Z», что и в
      // js/step-import.js analyzeShape), а не по нулю/сохранённому в каталоге
      // числу: у реального STEP из Inventor Z=0 не обязан быть верхней гранью
      // (например, если деталь была выдавлена от 0 ВВЕРХ, а не вниз) — резать
      // «от нуля» в этом случае резало бы не с той стороны/не на ту глубину.
      var bb = shape.boundingBox.bounds; // [[xmin,ymin,zmin],[xmax,ymax,zmax]]
      var topZ = bb[1][2];
      var realThickness = bb[1][2] - bb[0][2];
      return cutPartFeatures(rep, order, shape, warnings, topZ, realThickness);
    });
  }

  HC._buildSolid = buildSolid; // для тестов (node + replicad, реальный WASM — см. scratchpad)
  HC._buildSolidFromImported = buildSolidFromImported;
  HC._buildBlankOnlySolid = buildBlankOnlySolid;

  // Настоящая 2D-проекция (вид сверху) ЛЮБОЙ болванки БЕЗ исходного STEP-файла
  // (CSV/конструктор/каталожная — см. buildBlankOnlySolid) — то же единообразие,
  // что и у STEP-импорта (js/step-import.js combineProjectionSVG): видимые и
  // скрытые рёбра объединяются одной сплошной линией, без пунктира. Используется
  // для того, чтобы 2D выглядело одинаково независимо от способа создания
  // болванки (см. app.js computeBlankPreviewSVG/ensureBlankPreviewSVG).
  HC.computeBlankPreviewSVG = function (disc) {
    return loadReplicad().then(function (rep) {
      var warnings = [];
      var solid = buildBlankOnlySolid(rep, disc, warnings);
      var proj = rep.drawProjection(solid, "top");
      var visibleSVG = proj.visible.toSVG();
      var hiddenSVG = proj.hidden ? proj.hidden.toSVG() : null;
      return (HC.stepImport && HC.stepImport.combineProjectionSVG)
        ? HC.stepImport.combineProjectionSVG(visibleSVG, hiddenSVG)
        : visibleSVG;
    });
  };

  // Публичное API: настоящий меш болванки С УЖЕ ВЫРЕЗАННЫМИ карманами деталей
  // заказа (без скачивания) — для 3D-превью в Конфигураторе (см. app.js
  // refresh3DFromMesh), чтобы там было видно РЕАЛЬНЫЕ карманы, а не плоскую
  // декаль поверх нетронутой геометрии. arrayBuffer — байты .stp (см.
  // js/blank-storage.js readStepFile). ВНИМАНИЕ: та же булева вырезка, что и
  // при экспорте — на плотных раскладках (полусотня+ деталей) может занять
  // заметное время (WASM в том же потоке — вкладка может подвиснуть на это
  // время, см. предупреждение в cutPartFeatures про buildSolid).
  HC.buildOrderMeshFromImported = function (order, arrayBuffer, onStatus) {
    onStatus = onStatus || function () {};
    return loadReplicad(onStatus).then(function (rep) {
      onStatus("Режу карманы в STEP…");
      var warnings = [];
      return buildSolidFromImported(rep, order, arrayBuffer, warnings).then(function (shape) {
        if (warnings.length && g.console) warnings.forEach(function (w) { console.warn("3D:", w); });
        return shape.mesh();
      });
    });
  };

  // Публичное API: строит и скачивает STEP. order — как в assembleOrder.
  // Болванка с настоящим исходным файлом (order.disc.fileName) и подключённой
  // папкой (см. js/blank-storage.js) режется ПРЯМО В НЕЙ (buildSolidFromImported) —
  // занижение/крепёж/канавки/фигурные вырезы уже настоящие, не пересобираются
  // приближённо. Остальные болванки (ручные/из каталога/CSV/мигрированные без
  // файла) — как раньше, buildSolid строит диск с нуля по параметрам.
  HC.downloadSTEP = function (order, onStatus) {
    onStatus = onStatus || function () {};
    return loadReplicad(onStatus).then(function (rep) {
      var warnings = [];
      var solidPromise;
      if (order.disc.fileName && HC.blankStorage && HC.blankStorage.isConnected()) {
        onStatus("Читаю исходный STEP болванки…");
        solidPromise = HC.blankStorage.readStepFile(order.disc.fileName).then(function (buf) {
          onStatus("Режу отверстия под детали в исходном теле…");
          return buildSolidFromImported(rep, order, buf, warnings);
        });
      } else {
        onStatus("Строю тело (посадки/пазы/зона напыления)…");
        solidPromise = Promise.resolve(buildSolid(rep, order, warnings));
      }
      return solidPromise.then(function (solid) {
        var blob = solid.blobSTEP();
        var a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = (order.id || "holder") + ".step";
        document.body.appendChild(a);
        a.click();
        setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 0);
        if (warnings.length) {
          if (g.console) warnings.forEach(function (w) { console.warn("STEP:", w); });
          onStatus("STEP готов, но часть элементов пропущена (" + warnings.length + "): " + warnings.join("; "));
        } else {
          onStatus("STEP готов.");
        }
      });
    });
  };
})(typeof globalThis !== "undefined" ? globalThis : window);
