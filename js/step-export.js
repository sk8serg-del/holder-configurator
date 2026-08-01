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
        slotOn: !!h.slotOn, slotAngle: null, depth: h.depth > 0 ? h.depth : partDepth,
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

  // Собирает твёрдое тело: диск минус все карманы. warnings — массив, куда
  // складываются сообщения о пропущенных элементах (не бросаем исключение
  // наружу за один плохой элемент — раньше падение ЛЮБОГО одного выреза
  // (напр. овал уже пойманным багом выше) обрывало buildSolid целиком, и
  // экспорт «падал» даже для остальных, ни в чём не повинных деталей).
  function buildSolid(rep, order, warnings) {
    var thickness = order.disc.thickness > 0 ? order.disc.thickness : 6;
    var R = order.disc.diameter / 2;
    var disc = rep.drawCircle(R).sketchOnPlane("XY").extrude(-thickness);

    var cutters = [];
    function blind(draw, depth) { cutters.push(draw.sketchOnPlane("XY", TOP).extrude(-(depth + TOP))); }
    function through(draw) { cutters.push(draw.sketchOnPlane("XY", TOP).extrude(-(thickness + 2 * TOP))); }

    // Коническая зенковка-метка Ø MARK_D под углом MARK_ANGLE (полный), остриём вниз.
    // Строим лофтом от круга у поверхности к почти-точке на глубине; конус выступает
    // на TOP над верхней гранью (чистый рез). tan(полугла) задаёт наклон стенки.
    function countersink(mx, my) {
      var t = Math.tan((HC.MARK_ANGLE / 2) * Math.PI / 180);
      if (!(t > 0)) return;
      var rSurf = HC.MARK_D / 2;
      var rTop = rSurf + TOP * t;              // радиус на уровне z=+TOP
      var zApex = -(rSurf / t);                // где радиус обращается в 0
      var top = rep.drawCircle(rTop).translate([mx, my]).sketchOnPlane("XY", TOP);
      var bot = rep.drawCircle(0.02).translate([mx, my]).sketchOnPlane("XY", zApex);
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

    if (!cutters.length) return disc;
    // ВНИМАНИЕ: optimisation:"sameFace"/"commonFace" (BOPAlgo_GlueFull/GlueShift)
    // здесь пробовались ради скорости на плотных раскладках, но на деле дают
    // ТИХИЙ НЕПРАВИЛЬНЫЙ результат — проверено напрямую (measureVolume): диск
    // остаётся НЕ вырезанным (0 мм³ разницы) при обоих режимах склейки, без
    // единой ошибки/исключения. Дефолтный режим (без optimisation) — единственный,
    // который реально режет; медленнее на больших раскладках («Page
    // Unresponsive» на полусотне+ деталей), но корректность важнее скорости.
    // Если будете оптимизировать дальше — сначала проверяйте объём результата
    // (replicad.measureVolume), а не только число сущностей/время STEP-экспорта.
    var all = null;
    cutters.forEach(function (c, i) {
      if (all === null) { all = c; return; }
      try {
        all = all.fuse(c);
      } catch (e) {
        warnings.push("не удалось объединить вырез #" + (i + 1) + ": " + ((e && e.message) || e));
      }
    });
    if (all === null) return disc;
    try {
      return disc.cut(all);
    } catch (e) {
      warnings.push("не удалось вырезать карманы из диска: " + ((e && e.message) || e));
      return disc;
    }
  }

  // Публичное API: строит и скачивает STEP. order — как в assembleOrder.
  HC.downloadSTEP = function (order, onStatus) {
    onStatus = onStatus || function () {};
    return loadReplicad(onStatus).then(function (rep) {
      onStatus("Строю тело (посадки/пазы/зона напыления)…");
      var warnings = [];
      var solid = buildSolid(rep, order, warnings);
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
  };
})(typeof globalThis !== "undefined" ? globalThis : window);
