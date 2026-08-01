/*
 * export-csv.js — генерация CSV координат для Inventor (правило HolderFromCSV, v4).
 *
 * Экспортируются РЕАЛЬНЫЕ карманы: посадка (глухой вырез на глубину),
 * зона напыления CA (сквозной вырез) и паз под пинцет (глухой, на глубину посадки).
 * По каждой детали и контрольному отверстию — одна строка со всеми параметрами.
 *
 * Формат (разделитель «;», десятичная точка «.», единицы мм; углы — градусы):
 *   holder-csv;4
 *   order;{номер};{дата};{технолог};{организация}
 *   disc;{id};{название};{диаметр};{толщина}
 *   holder;{номер};{название}
 *   clearances;{дет-дет};{дет-край};{дет-КО}
 *   mark;{Ø зенковки-метки};{угол зенковки};{шаг между метками}
 *   columns;kind;type;cx;cy;d;w;h;chamfer;rot;seatD;caDia;seatGap;caInset;slot;slotAngle;slotL;slotW;depth;markX;markY;markCount
 *   {kind=part|control};{type=circle|rect|oct|oval};…
 *
 * Поля по типам:
 *   circle:  d, seatD (Ø посадки), caDia (Ø зоны напыления)
 *   rect/oct/oval: w, h, chamfer(oct), rot, seatGap (припуск посадки/сторону),
 *                  caInset (отступ CA/сторону)
 *   общие:  slot (1/0), slotAngle (абс. угол), slotL, slotW (габариты паза), depth (глубина посадки),
 *           markX, markY, markCount — метки-ориентиры (маленькие зенковки, см.
 *               HC.MARK_D/MARK_ANGLE/HC.MARK_PITCH): только у ДЕТАЛЕЙ (не у
 *               контрольных отверстий) с пазом; markCount = номер разновидности
 *               детали в заказе (1, 2, 3…) — нужно, чтобы отличать похожие по
 *               размеру детали по числу меток и метить ориентацию у форм, где
 *               это важно. markX/markY — первая метка (в 2мм от посадки и в
 *               2мм от паза), остальные markCount−1 идут дальше вдоль паза
 *               с шагом из строки mark. Пусто/0, если паза нет или метки не
 *               применимы (контрольные отверстия).
 */
(function (g) {
  "use strict";
  var HC = (g.HC = g.HC || {});

  function num(v) {
    if (v == null || v === "") return "";
    return String(Math.round(v * 1000) / 1000);
  }

  function safe(s) {
    return String(s == null ? "" : s).replace(/[;\r\n]/g, ",");
  }

  // Геометрия паза (абс. угол, длина, ширина, первая точка метки) — та же
  // логика, что в render.js. f.markCount — сколько меток нужно (0 — нет).
  function slotGeom(f) {
    if (!f.slotOn) return { angle: "", len: "", wid: "", markX: "", markY: "" };
    if (f.type === "circle") {
      var D = f.seatD > 0 ? f.seatD : f.d;
      // Угол берём из фактической раскладки (f.slotAngle) — в гекс-сетке он
      // фиксированный (90°, по высоте треугольника), не радиальный. Радиально
      // (atan2) — только запасной вариант для контрольных отверстий, у которых
      // угол в самой раскладке не хранится (см. render.js). Раньше здесь всегда
      // пересчитывался atan2, из-за чего Inventor резал пазы не туда же, куда
      // показывала страница для деталей гекс-сетки.
      var angle = f.slotAngle != null ? f.slotAngle : Math.atan2(f.cy, f.cx) * 180 / Math.PI;
      var halfW = Math.min(9, D * 0.75) / 2;
      var mark = f.markCount > 0
        ? HC.geom.slotMarkPoint(f.cx, f.cy, D / 2, halfW, angle * Math.PI / 180, HC.MARK_OFF, HC.MARK_SIDE)
        : null;
      return {
        angle: angle, len: D + 5, wid: Math.min(9, D * 0.75),
        markX: mark ? mark.x : "", markY: mark ? mark.y : ""
      };
    }
    var gap = f.seatGap > 0 ? f.seatGap : 0;
    var ch = f.type === "oct" ? (f.chamfer || 0) : 0;
    var ang = (f.rot || 0) + (f.slotAngle || 0);
    var ar = ang * Math.PI / 180, ux = Math.cos(ar), uy = Math.sin(ar);
    var seat = HC.geom.shapePoly(f.type, 0, 0, f.w + 2 * gap, f.h + 2 * gap, ch, f.rot || 0);
    var halfExt = 0;
    seat.forEach(function (q) { var pr = Math.abs(q.x * ux + q.y * uy); if (pr > halfExt) halfExt = pr; });
    var minSeat = Math.min(f.w, f.h) + 2 * gap;
    var wid2 = Math.min(9, minSeat * 0.75);
    var mark2 = f.markCount > 0
      ? HC.geom.slotMarkPoint(f.cx, f.cy, halfExt, wid2 / 2, ar, HC.MARK_OFF, HC.MARK_SIDE)
      : null;
    return {
      angle: ang, len: 2 * halfExt + 5, wid: wid2,
      markX: mark2 ? mark2.x : "", markY: mark2 ? mark2.y : ""
    };
  }

  function featRow(f) {
    var s = slotGeom(f);
    return [
      f.kind, f.type, num(f.cx), num(f.cy), num(f.d), num(f.w), num(f.h), num(f.chamfer),
      num(f.rot), num(f.seatD), num(f.caDia), num(f.seatGap), num(f.caInset),
      f.slotOn ? "1" : "0", num(s.angle), num(s.len), num(s.wid), num(f.depth),
      num(s.markX), num(s.markY), num(f.markCount > 0 ? f.markCount : "")
    ].join(";");
  }

  HC.buildCSV = function (order) {
    var thickness = order.disc.thickness > 0 ? order.disc.thickness : 6;
    var partDepth = Math.max(0.5, Math.round((thickness - 1.5) * 1000) / 1000);

    var L = [];
    L.push("holder-csv;4");
    L.push(["order", safe(order.id), safe(order.date), safe(order.customer.name), safe(order.customer.org)].join(";"));
    L.push(["disc", safe(order.disc.id), safe(order.disc.name), num(order.disc.diameter), num(thickness)].join(";"));
    L.push(["holder", safe(order.holderNo || ""), safe(order.holderName || "")].join(";"));
    L.push(["clearances", num(order.clearances.pp), num(order.clearances.pe), num(order.clearances.pc)].join(";"));
    L.push(["mark", num(HC.MARK_D), num(HC.MARK_ANGLE), num(HC.MARK_PITCH)].join(";"));
    L.push("columns;kind;type;cx;cy;d;w;h;chamfer;rot;seatD;caDia;seatGap;caInset;slot;slotAngle;slotL;slotW;depth;markX;markY;markCount");

    (order.controlHoles || []).forEach(function (h) {
      L.push(featRow({
        kind: "control", type: "circle", cx: h.x, cy: h.y,
        d: h.d, seatD: h.seatD != null ? h.seatD : h.d, caDia: h.apertureCA,
        slotOn: !!h.slotOn, depth: h.depth > 0 ? h.depth : partDepth,
        markCount: 0 // метки-ориентиры — только у деталей, не у контрольных отверстий
      }));
    });

    (order.placed || []).forEach(function (p) {
      var isC = p.type === "circle";
      L.push(featRow({
        kind: "part", type: p.type, cx: p.cx, cy: p.cy,
        d: isC ? p.d : "",
        w: isC ? "" : p.w, h: isC ? "" : p.h,
        chamfer: p.type === "oct" ? (p.chamfer || 0) : "",
        rot: isC ? "" : (p.rot || 0),
        seatD: isC ? p.seatD : "",
        caDia: isC ? p.apertureCA : "",
        seatGap: isC ? "" : p.seatGap,
        caInset: isC ? "" : p.caInset,
        slotOn: !!p.slotOn, slotAngle: p.slotAngle, depth: partDepth,
        // разновидность детали (индекс в списке деталей заказа) + 1 — первая
        // разновидность метится одной зенковкой, вторая — двумя, и т.д.
        markCount: (p.partIndex || 0) + 1
      }));
    });

    return L.join("\r\n") + "\r\n";
  };

  HC.downloadCSV = function (order) {
    var text = HC.buildCSV(order);
    // BOM — чтобы Excel корректно открывал UTF-8
    var blob = new Blob(["﻿" + text], { type: "text/csv;charset=utf-8" });
    var a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = order.id + ".csv";
    document.body.appendChild(a);
    a.click();
    setTimeout(function () {
      URL.revokeObjectURL(a.href);
      a.remove();
    }, 0);
  };
})(typeof globalThis !== "undefined" ? globalThis : window);
