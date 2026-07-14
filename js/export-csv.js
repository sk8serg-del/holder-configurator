/*
 * export-csv.js — генерация CSV координат для Inventor (правило HolderFromCSV).
 *
 * Формат (разделитель «;», десятичная точка «.», единицы мм):
 *   holder-csv;1
 *   order;{номер};{дата};{технолог};{организация}
 *   disc;{id};{название};{диаметр}
 *   clearances;{дет-дет};{дет-край};{дет-КО}
 *   columns;type;cx;cy;w;h;chamfer;rotation;diameter
 *   control;x;y;;;;;d          — контрольные отверстия
 *   circle;cx;cy;;;;;d
 *   rect;cx;cy;w;h;;rot;
 *   oct;cx;cy;w;h;chamfer;rot;
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

  HC.buildCSV = function (order) {
    var L = [];
    L.push("holder-csv;1");
    L.push(["order", safe(order.id), safe(order.date), safe(order.customer.name), safe(order.customer.org)].join(";"));
    L.push(["disc", safe(order.disc.id), safe(order.disc.name), num(order.disc.diameter)].join(";"));
    L.push(["clearances", num(order.clearances.pp), num(order.clearances.pe), num(order.clearances.pc)].join(";"));
    L.push("columns;type;cx;cy;w;h;chamfer;rotation;diameter");
    (order.controlHoles || []).forEach(function (h) {
      // диаметр контрольного отверстия в CSV — Ø посадки, если задан
      L.push(["control", num(h.x), num(h.y), "", "", "", "", num(h.seatD != null ? h.seatD : h.d)].join(";"));
    });
    (order.placed || []).forEach(function (p) {
      if (p.type === "circle") {
        L.push(["circle", num(p.cx), num(p.cy), "", "", "", "", num(p.d)].join(";"));
      } else if (p.type === "rect") {
        L.push(["rect", num(p.cx), num(p.cy), num(p.w), num(p.h), "", num(p.rot || 0), ""].join(";"));
      } else {
        L.push(["oct", num(p.cx), num(p.cy), num(p.w), num(p.h), num(p.chamfer || 0), num(p.rot || 0), ""].join(";"));
      }
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
