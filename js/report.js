/*
 * report.js — печатный отчёт (сохранение в PDF через печать браузера).
 * HC.showReport(order, svgMarkup) — заполняет #report и открывает диалог печати.
 */
(function (g) {
  "use strict";
  var HC = (g.HC = g.HC || {});

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  function num(v) {
    return String(Math.round(v * 1000) / 1000);
  }

  function sizeLabel(p) {
    if (p.type === "circle") return "Ø" + num(p.d);
    var s = num(p.w) + " × " + num(p.h);
    if (p.type === "oct") s += ", фаска " + num(p.chamfer || 0);
    return s;
  }

  function typeLabel(t) {
    return { circle: "Круглая", rect: "Прямоугольная", oct: "Прямоугольная с фаской" }[t] || t;
  }

  HC.buildReportHTML = function (order, svgMarkup) {
    var H = [];
    H.push('<div class="rep-header">');
    H.push("<h1>Подложкодержатель — заказ " + esc(order.id) + "</h1>");
    H.push('<table class="rep-meta">');
    H.push("<tr><td>Дата</td><td>" + esc(order.dateHuman) + "</td></tr>");
    H.push("<tr><td>Технолог</td><td>" + esc(order.customer.name) + "</td></tr>");
    H.push("<tr><td>Организация</td><td>" + esc(order.customer.org) + "</td></tr>");
    H.push("<tr><td>Контакт</td><td>" + esc(order.customer.contact) + "</td></tr>");
    H.push("<tr><td>Подложка</td><td>" + esc(order.disc.name) + " (Ø" + num(order.disc.diameter) + " мм)</td></tr>");
    H.push("<tr><td>Контрольные отверстия</td><td>" + esc(order.controlName) + "</td></tr>");
    H.push("<tr><td>Зазоры, мм</td><td>деталь–деталь " + num(order.clearances.pp) +
      "; деталь–край " + num(order.clearances.pe) +
      "; деталь–контр. отв. " + num(order.clearances.pc) + "</td></tr>");
    H.push("</table></div>");

    H.push('<div class="rep-svg">' + svgMarkup + "</div>");

    H.push("<h2>Детали</h2>");
    H.push('<table class="rep-table"><tr><th>№ поз.</th><th>Тип</th><th>Размер, мм</th><th>Заказано</th><th>Размещено</th></tr>');
    order.partsSummary.forEach(function (row, i) {
      H.push("<tr><td>" + (i + 1) + "</td><td>" + esc(typeLabel(row.type)) + "</td><td>" + esc(row.size) +
        "</td><td>" + (row.requested == null ? "максимум" : row.requested) +
        "</td><td>" + row.placed + "</td></tr>");
    });
    H.push("</table>");

    H.push("<h2>Координаты отверстий (центр диска — 0,0; мм)</h2>");
    H.push('<table class="rep-table"><tr><th>№</th><th>Тип</th><th>X</th><th>Y</th><th>Размер</th><th>Поворот, °</th></tr>');
    order.placed.forEach(function (p, i) {
      H.push("<tr><td>" + (i + 1) + "</td><td>" + esc(typeLabel(p.type)) + "</td><td>" + num(p.cx) +
        "</td><td>" + num(p.cy) + "</td><td>" + esc(sizeLabel(p)) +
        "</td><td>" + (p.type === "circle" ? "—" : num(p.rot || 0)) + "</td></tr>");
    });
    H.push("</table>");
    H.push('<p class="rep-note">Сформировано веб-конфигуратором подложкодержателей.</p>');
    return H.join("\n");
  };

  HC.showReport = function (order, svgMarkup) {
    var el = document.getElementById("report");
    el.innerHTML = HC.buildReportHTML(order, svgMarkup);
    window.print();
  };
})(typeof globalThis !== "undefined" ? globalThis : window);
