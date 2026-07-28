/*
 * export-csv.js — генерация CSV координат для Inventor (правило HolderFromCSV, v2).
 *
 * Экспортируются РЕАЛЬНЫЕ карманы: посадка (глухой вырез на глубину),
 * зона напыления CA (сквозной вырез) и паз под пинцет (глухой, на глубину посадки).
 * По каждой детали и контрольному отверстию — одна строка со всеми параметрами.
 *
 * Формат (разделитель «;», десятичная точка «.», единицы мм; углы — градусы):
 *   holder-csv;2
 *   order;{номер};{дата};{технолог};{организация}
 *   disc;{id};{название};{диаметр};{толщина}
 *   holder;{номер};{название}
 *   clearances;{дет-дет};{дет-край};{дет-КО}
 *   columns;kind;type;cx;cy;d;w;h;chamfer;rot;seatD;caDia;seatGap;caInset;slot;slotAngle;slotL;slotW;depth
 *   {kind=part|control};{type=circle|rect|oct|oval};…
 *
 * Поля по типам:
 *   circle:  d, seatD (Ø посадки), caDia (Ø зоны напыления)
 *   rect/oct/oval: w, h, chamfer(oct), rot, seatGap (припуск посадки/сторону),
 *                  caInset (отступ CA/сторону)
 *   общие:  slot (1/0), slotAngle (абс. угол), slotL, slotW (габариты паза), depth (глубина посадки)
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

  // Геометрия паза (абс. угол, длина, ширина) — та же логика, что в render.js.
  function slotGeom(f) {
    if (!f.slotOn) return { angle: "", len: "", wid: "" };
    if (f.type === "circle") {
      var D = f.seatD > 0 ? f.seatD : f.d;
      return {
        angle: Math.atan2(f.cy, f.cx) * 180 / Math.PI,
        len: D + 5,
        wid: Math.min(9, D * 0.75)
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
    return { angle: ang, len: 2 * halfExt + 5, wid: Math.min(9, minSeat * 0.75) };
  }

  function featRow(f) {
    var s = slotGeom(f);
    return [
      f.kind, f.type, num(f.cx), num(f.cy), num(f.d), num(f.w), num(f.h), num(f.chamfer),
      num(f.rot), num(f.seatD), num(f.caDia), num(f.seatGap), num(f.caInset),
      f.slotOn ? "1" : "0", num(s.angle), num(s.len), num(s.wid), num(f.depth)
    ].join(";");
  }

  HC.buildCSV = function (order) {
    var thickness = order.disc.thickness > 0 ? order.disc.thickness : 6;
    var partDepth = Math.max(0.5, Math.round((thickness - 1.5) * 1000) / 1000);

    var L = [];
    L.push("holder-csv;2");
    L.push(["order", safe(order.id), safe(order.date), safe(order.customer.name), safe(order.customer.org)].join(";"));
    L.push(["disc", safe(order.disc.id), safe(order.disc.name), num(order.disc.diameter), num(thickness)].join(";"));
    L.push(["holder", safe(order.holderNo || ""), safe(order.holderName || "")].join(";"));
    L.push(["clearances", num(order.clearances.pp), num(order.clearances.pe), num(order.clearances.pc)].join(";"));
    L.push("columns;kind;type;cx;cy;d;w;h;chamfer;rot;seatD;caDia;seatGap;caInset;slot;slotAngle;slotL;slotW;depth");

    (order.controlHoles || []).forEach(function (h) {
      L.push(featRow({
        kind: "control", type: "circle", cx: h.x, cy: h.y,
        d: h.d, seatD: h.seatD != null ? h.seatD : h.d, caDia: h.apertureCA,
        slotOn: !!h.slotOn, depth: h.depth > 0 ? h.depth : partDepth
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
        slotOn: !!p.slotOn, slotAngle: p.slotAngle, depth: partDepth
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
