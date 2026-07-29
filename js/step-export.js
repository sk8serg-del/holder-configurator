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
  var REP_VER = "0.19.1";
  var OC_VER = "0.1.20";
  var REP_URL = "https://cdn.jsdelivr.net/npm/replicad@" + REP_VER + "/+esm";
  var OC_JS = "https://cdn.jsdelivr.net/npm/replicad-opencascadejs@" + OC_VER + "/src/replicad_single.js/+esm";
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
    return repPromise;
  }

  // ---- геометрия паза (угол/длина/ширина) — та же логика, что в export-csv ----
  function slotGeom(f) {
    if (!f.slotOn) return null;
    if (f.type === "circle") {
      var D = f.seatD > 0 ? f.seatD : f.d;
      var angle = f.slotAngle != null ? f.slotAngle : Math.atan2(f.cy, f.cx) * 180 / Math.PI;
      return { angle: angle, len: D + 5, wid: Math.min(9, D * 0.75) };
    }
    var gap = f.seatGap > 0 ? f.seatGap : 0;
    var ch = f.type === "oct" ? (f.chamfer || 0) : 0;
    var ang = (f.rot || 0) + (f.slotAngle || 0);
    var ar = ang * Math.PI / 180, ux = Math.cos(ar), uy = Math.sin(ar);
    var seat = HC.geom.shapePoly(f.type, 0, 0, f.w + 2 * gap, f.h + 2 * gap, ch, f.rot || 0);
    var halfExt = 0;
    seat.forEach(function (q) { var pr = Math.abs(q.x * ux + q.y * uy); if (pr > halfExt) halfExt = pr; });
    var minSeat = Math.min(f.w, f.h) + 2 * gap;
    return { angle: ang, len: 2 * halfExt + 5, wid: Math.min(9, minSeat * 0.75) };
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
        slotOn: !!h.slotOn, slotAngle: null, depth: h.depth > 0 ? h.depth : partDepth
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
        slotOn: !!p.slotOn, slotAngle: p.slotAngle, depth: partDepth
      });
    });
    return out;
  }

  // ---- 2D-контуры (replicad Drawing) по центру в (0,0), без поворота ----
  function shapeDrawing(rep, type, w, h, chamfer) {
    if (type === "oval") return rep.drawEllipse(w / 2, h / 2);
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

  // Собирает твёрдое тело: диск минус все карманы.
  function buildSolid(rep, order) {
    var thickness = order.disc.thickness > 0 ? order.disc.thickness : 6;
    var R = order.disc.diameter / 2;
    var disc = rep.drawCircle(R).sketchOnPlane("XY").extrude(-thickness);

    var cutters = [];
    function blind(draw, depth) { cutters.push(draw.sketchOnPlane("XY", TOP).extrude(-(depth + TOP))); }
    function through(draw) { cutters.push(draw.sketchOnPlane("XY", TOP).extrude(-(thickness + 2 * TOP))); }

    features(order).forEach(function (f) {
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
      }
      // зона напыления — насквозь
      if (isC) {
        if (f.caDia > 0) through(place(rep.drawCircle(f.caDia / 2), f.cx, f.cy, 0));
      } else if (f.caInset > 0 && (f.w - 2 * f.caInset) > 0 && (f.h - 2 * f.caInset) > 0) {
        through(place(shapeDrawing(rep, f.type, f.w - 2 * f.caInset, f.h - 2 * f.caInset, f.chamfer), f.cx, f.cy, f.rot));
      }
    });

    if (!cutters.length) return disc;
    var all = cutters[0];
    for (var i = 1; i < cutters.length; i++) all = all.fuse(cutters[i]);
    return disc.cut(all);
  }

  // Публичное API: строит и скачивает STEP. order — как в assembleOrder.
  HC.downloadSTEP = function (order, onStatus) {
    onStatus = onStatus || function () {};
    return loadReplicad(onStatus).then(function (rep) {
      onStatus("Строю тело (посадки/пазы/зона напыления)…");
      var solid = buildSolid(rep, order);
      var blob = solid.blobSTEP();
      var a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = (order.id || "holder") + ".step";
      document.body.appendChild(a);
      a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 0);
      onStatus("STEP готов.");
    });
  };
})(typeof globalThis !== "undefined" ? globalThis : window);
