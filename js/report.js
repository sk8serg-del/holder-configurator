/*
 * report.js — печатный отчёт (сохранение в PDF через печать браузера).
 * HC.showReport(order, svgMarkup):
 *   • обычная страница/файл — заполняет #report и вызывает печать на месте;
 *   • внутри iframe (песочница артефакта, где window.print() заблокирован) —
 *     формирует автономный HTML-отчёт и открывает его в новой вкладке
 *     (при заблокированных попапах — скачивает файлом), там печать/PDF работает.
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
    if (p.type === "oct") s += ", " + HC.t("фаска") + " " + num(p.chamfer || 0);
    return s;
  }

  function typeLabel(t) {
    var map = { circle: "Круглая", rect: "Прямоугольная", oct: "Прямоугольная с фаской", oval: "Овальная" };
    return HC.t(map[t] || t);
  }

  HC.buildReportHTML = function (order, svgMarkup) {
    var H = [];
    H.push('<div class="rep-header">');
    H.push("<h1>" + esc(HC.t("Подложкодержатель — заказ {0}", order.id)) + "</h1>");
    H.push('<table class="rep-meta">');
    H.push("<tr><td>" + esc(HC.t("Дата")) + "</td><td>" + esc(order.dateHuman) + "</td></tr>");
    H.push("<tr><td>" + esc(HC.t("Технолог")) + "</td><td>" + esc(order.customer.name) + "</td></tr>");
    H.push("<tr><td>" + esc(HC.t("Организация")) + "</td><td>" + esc(order.customer.org) + "</td></tr>");
    H.push("<tr><td>" + esc(HC.t("Контакт")) + "</td><td>" + esc(order.customer.contact) + "</td></tr>");
    if (order.holderNo) H.push("<tr><td>" + esc(HC.t("Номер подложкодержателя")) + "</td><td>" + esc(order.holderNo) + "</td></tr>");
    if (order.holderName) H.push("<tr><td>" + esc(HC.t("Название подложкодержателя")) + "</td><td>" + esc(order.holderName) + "</td></tr>");
    H.push("<tr><td>" + esc(HC.t("Подложкодержатель")) + "</td><td>" + esc(HC.t(order.disc.name)) + " (Ø" + num(order.disc.diameter) + " мм)</td></tr>");
    H.push("<tr><td>" + esc(HC.t("Контрольные отверстия")) + "</td><td>" + esc(order.controlName) + "</td></tr>");
    H.push("<tr><td>" + esc(HC.t("Зазоры, мм")) + "</td><td>" +
      esc(HC.t("деталь–деталь {0}; деталь–край {1}; деталь–контр. отв. {2}",
        num(order.clearances.pp), num(order.clearances.pe), num(order.clearances.pc))) + "</td></tr>");
    H.push("</table></div>");

    H.push('<div class="rep-svg">' + svgMarkup + "</div>");

    H.push("<h2>" + esc(HC.t("Детали")) + "</h2>");
    H.push('<table class="rep-table"><tr><th>' + esc(HC.t("№ поз.")) + "</th><th>" + esc(HC.t("Тип")) +
      "</th><th>" + esc(HC.t("Размер, мм")) + "</th><th>" + esc(HC.t("Заказано")) + "</th><th>" + esc(HC.t("Размещено")) + "</th></tr>");
    order.partsSummary.forEach(function (row, i) {
      H.push("<tr><td>" + (i + 1) + "</td><td>" + esc(typeLabel(row.type)) + "</td><td>" + esc(row.size) +
        "</td><td>" + (row.requested == null ? esc(HC.t("максимум")) : row.requested) +
        "</td><td>" + row.placed + "</td></tr>");
    });
    H.push("</table>");

    H.push("<h2>" + esc(HC.t("Координаты отверстий (центр диска — 0,0; мм)")) + "</h2>");
    H.push('<table class="rep-table"><tr><th>' + esc(HC.t("№")) + "</th><th>" + esc(HC.t("Тип")) +
      "</th><th>X</th><th>Y</th><th>" + esc(HC.t("Размер")) + "</th><th>" + esc(HC.t("Поворот, °")) + "</th></tr>");
    order.placed.forEach(function (p, i) {
      H.push("<tr><td>" + (i + 1) + "</td><td>" + esc(typeLabel(p.type)) + "</td><td>" + num(p.cx) +
        "</td><td>" + num(p.cy) + "</td><td>" + esc(sizeLabel(p)) +
        "</td><td>" + (p.type === "circle" ? "—" : num(p.rot || 0)) + "</td></tr>");
    });
    H.push("</table>");
    H.push('<p class="rep-note">' + esc(HC.t("Сформировано веб-конфигуратором подложкодержателей.")) + "</p>");
    return H.join("\n");
  };

  // CSS автономного отчёта (тот же вид, что #report на странице; body — белый лист)
  var REPORT_CSS =
    'body{margin:24px;color:#000;background:#fff;font-family:system-ui,"Segoe UI",sans-serif;}' +
    "h1{font-size:18px;margin:0 0 10px;}h2{font-size:14px;margin:16px 0 6px;color:#000;}" +
    ".rep-meta td{padding:2px 12px 2px 0;font-size:12px;vertical-align:top;}" +
    ".rep-meta td:first-child{color:#555;white-space:nowrap;}" +
    ".rep-svg{text-align:center;margin:10px 0;}.rep-svg svg{width:62%;max-width:560px;height:auto;}" +
    ".rep-table{border-collapse:collapse;font-size:12px;width:100%;}" +
    ".rep-table th,.rep-table td{border:1px solid #999;padding:3px 8px;text-align:center;}" +
    ".rep-table th{background:#f0f0f0;}.rep-note{font-size:10px;color:#777;margin-top:12px;}" +
    ".print-bar{margin:0 0 14px;}.print-bar button{font:inherit;padding:6px 14px;cursor:pointer;}" +
    "@media print{.noprint{display:none!important;}body{margin:0;}.rep-table tr{break-inside:avoid;}}";

  // Автономный HTML-документ отчёта: сам себя печатает при открытии, плюс кнопка.
  function reportDocument(order, svgMarkup) {
    var lang = HC.i18n ? HC.i18n.get() : "ru";
    var title = HC.t("Подложкодержатель — заказ {0}", order.id);
    var btn = HC.t("Печать / Сохранить в PDF");
    // ВАЖНО: закрывающий тег скрипта пишем как <\/script>, иначе при инлайне
    // report.js внутрь одного <script> (сборка dist) он оборвёт этот тег.
    var autoPrint = "<scr" + 'ipt>window.addEventListener("load",function(){setTimeout(function(){try{window.print();}catch(e){}},300);});</scr' + "ipt>";
    return '<!doctype html><html lang="' + esc(lang) + '"><head><meta charset="utf-8">' +
      '<meta name="viewport" content="width=device-width, initial-scale=1"><title>' + esc(title) + "</title>" +
      "<style>" + REPORT_CSS + "</style></head><body>" +
      '<div class="print-bar noprint"><button type="button" onclick="window.print()">' + esc(btn) + "</button></div>" +
      HC.buildReportHTML(order, svgMarkup) +
      autoPrint + "</body></html>";
  }

  // Скачивание автономного отчёта отдельным файлом (работает и в песочнице,
  // если разрешены загрузки; тот же механизм, что у кнопки CSV).
  function downloadReport(order, svgMarkup) {
    var blob = new Blob([reportDocument(order, svgMarkup)], { type: "text/html;charset=utf-8" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = (order.id || "report") + ".html";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 60000);
  }

  HC.showReport = function (order, svgMarkup) {
    var el = document.getElementById("report");
    var inIframe;
    try { inIframe = window.self !== window.top; } catch (e) { inIframe = true; }

    if (!inIframe) {
      // обычная страница/файл — печать на месте (диалог печати доступен)
      if (el) el.innerHTML = HC.buildReportHTML(order, svgMarkup);
      window.print();
      return;
    }

    // Внутри iframe (песочница артефакта) печать и попапы могут быть заблокированы.
    // Показываем отчёт оверлеем прямо на странице — это обычный DOM, работает всегда;
    // кнопки «Печать» и «Скачать» срабатывают там, где песочница их разрешает.
    if (!el) return;
    var bar = '<div class="report-toolbar noprint">' +
      '<button type="button" class="ro-download primary">' + esc(HC.t("Скачать отчёт (HTML)")) + "</button>" +
      '<button type="button" class="ro-print">' + esc(HC.t("Печать / Сохранить в PDF")) + "</button>" +
      '<button type="button" class="ro-close">' + esc(HC.t("Закрыть")) + "</button>" +
      '<span class="ro-hint">' + esc(HC.t("Если печать в этом окне не открывается — нажмите «Скачать», откройте файл и сохраните в PDF.")) + "</span>" +
      "</div>";
    el.innerHTML = bar + HC.buildReportHTML(order, svgMarkup);
    el.classList.add("report-overlay-on");
    el.querySelector(".ro-print").addEventListener("click", function () { window.print(); });
    el.querySelector(".ro-download").addEventListener("click", function () { downloadReport(order, svgMarkup); });
    el.querySelector(".ro-close").addEventListener("click", function () {
      el.classList.remove("report-overlay-on");
      el.innerHTML = "";
    });
  };
})(typeof globalThis !== "undefined" ? globalThis : window);
