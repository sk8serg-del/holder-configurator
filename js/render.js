/*
 * render.js — SVG-отрисовка раскладки.
 *
 * HC.renderSVG(model) → строка <svg …>…</svg>
 * model = {
 *   discDiameter, edgeClearance,
 *   controlHoles: [{x, y, d}],
 *   placed: [placement...],
 *   showNumbers: bool
 * }
 * Координаты CAD (Y вверх) — группа перевёрнута scale(1,-1), подписи возвращаются обратно.
 */
(function (g) {
  "use strict";
  var HC = (g.HC = g.HC || {});

  var PART_COLORS = [
    { fill: "#cfe3f7", stroke: "#2b6cb0" },
    { fill: "#d7f0d7", stroke: "#2f855a" },
    { fill: "#fde8cd", stroke: "#c05621" },
    { fill: "#e9d8fd", stroke: "#6b46c1" },
    { fill: "#fed7d7", stroke: "#c53030" }
  ];

  function fmt(v) {
    return (Math.round(v * 1000) / 1000).toString();
  }

  function esc(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  // Число с запятой вместо точки (десятичный разделитель по месту, как в чертежах)
  function fmtRu(v) {
    return (Math.round(v * 100) / 100).toString().replace(".", ",");
  }

  // Мини-предпросмотр формы детали для карточки в форме заказа.
  // spec = {type:'circle'|'rect'|'oct', d, w, h, chamfer}
  HC.renderPartPreview = function (spec) {
    var w = spec.type === "circle" ? spec.d : spec.w;
    var h = spec.type === "circle" ? spec.d : spec.h;
    if (!(w > 0) || !(h > 0)) return "";
    var pad = Math.max(w, h) * 0.14;
    var vb = fmt(-w / 2 - pad) + " " + fmt(-h / 2 - pad) + " " + fmt(w + 2 * pad) + " " + fmt(h + 2 * pad);
    var sw = Math.max(w, h) / 50;
    var col = PART_COLORS[0];
    var out = ['<svg xmlns="http://www.w3.org/2000/svg" viewBox="' + vb + '" font-family="system-ui, Segoe UI, sans-serif">'];
    if (spec.type === "circle") {
      out.push('<circle cx="0" cy="0" r="' + fmt(spec.d / 2) + '" fill="' + col.fill + '" stroke="' + col.stroke + '" stroke-width="' + fmt(sw) + '"/>');
    } else {
      var poly = spec.type === "rect"
        ? HC.geom.rectPoly(0, 0, spec.w, spec.h, 0)
        : HC.geom.octPoly(0, 0, spec.w, spec.h, spec.chamfer || 0, 0);
      var pts = poly.map(function (q) { return fmt(q.x) + "," + fmt(q.y); }).join(" ");
      out.push('<polygon points="' + pts + '" fill="' + col.fill + '" stroke="' + col.stroke + '" stroke-width="' + fmt(sw) + '"/>');
    }
    var label = spec.type === "circle" ? "Ø" + fmt(spec.d) : fmt(spec.w) + "×" + fmt(spec.h);
    var fs = Math.min(h * 0.45, (w * 1.5) / label.length);
    out.push('<text x="0" y="0" font-size="' + fmt(fs) + '" text-anchor="middle" dominant-baseline="central" fill="#1a3550">' + esc(label) + "</text>");
    out.push("</svg>");
    return out.join("");
  };

  // Ширина паза под пинцет: стандарт 9 мм, но не больше 0.75 диаметра посадки
  function slotWidth(D) {
    return Math.min(9, D * 0.75);
  }

  // Контур «стадиона» (паза с круглыми торцами) вдоль оси X с центром в (0,0):
  // прямая часть длиной (L-W), торцы — полукруги радиусом W/2.
  function stadiumPath(L, W) {
    var r = W / 2;
    var hs = Math.max(0, L / 2 - r);
    return (
      "M " + fmt(-hs) + " " + fmt(-r) +
      " L " + fmt(hs) + " " + fmt(-r) +
      " A " + fmt(r) + " " + fmt(r) + " 0 0 1 " + fmt(hs) + " " + fmt(r) +
      " L " + fmt(-hs) + " " + fmt(r) +
      " A " + fmt(r) + " " + fmt(r) + " 0 0 1 " + fmt(-hs) + " " + fmt(-r) +
      " Z"
    );
  }

  // Крупная схема отверстия под круглую деталь: посадка (D, зенковка,
  // пунктир) + деталь (d, сплошная) + зона напыления (CA, сквозное отверстие)
  // + паз под пинцет (slotOn/slotAngle) — длина D+2×2.5, ширина min(9, 0.75×D),
  // проходит через центр симметрично, торчит на 2.5 мм за посадку с двух сторон.
  // spec = {d, seatD, apertureCA, slotOn, slotAngle} — необязательные поля не рисуются.
  HC.renderHoleDiagram = function (spec) {
    var d = spec.d;
    if (!(d > 0)) return "";
    var D = spec.seatD > 0 ? spec.seatD : null;
    var CA = spec.apertureCA > 0 ? spec.apertureCA : null;
    var showSlot = !!spec.slotOn && D != null;
    var slotL = showSlot ? D + 2 * 2.5 : 0;
    var slotW = showSlot ? slotWidth(D) : 0;
    var outer = Math.max(d, D || 0, slotL);
    var R = outer / 2;
    var sidePad = R * 0.18;
    var textH = R * 0.62;
    var half = R + sidePad;
    var vb = fmt(-half) + " " + fmt(-half) + " " + fmt(2 * half) + " " + fmt(2 * half + textH);
    var sw = outer / 70;
    var col = PART_COLORS[0];
    var out = ['<svg xmlns="http://www.w3.org/2000/svg" viewBox="' + vb + '" font-family="system-ui, Segoe UI, sans-serif">'];

    if (showSlot) {
      out.push(
        '<g transform="rotate(' + fmt(spec.slotAngle || 0) + ')">' +
        '<path d="' + stadiumPath(slotL, slotW) + '" fill="#fdfdfc" stroke="#c05621" stroke-width="' + fmt(sw) + '"/>' +
        "</g>"
      );
    }
    if (D != null) {
      out.push(
        '<circle cx="0" cy="0" r="' + fmt(D / 2) + '" fill="none" stroke="' + col.stroke +
        '" stroke-width="' + fmt(sw) + '" stroke-dasharray="' + fmt(sw * 3) + " " + fmt(sw * 2) + '"/>'
      );
    }
    out.push('<circle cx="0" cy="0" r="' + fmt(d / 2) + '" fill="' + col.fill + '" stroke="' + col.stroke + '" stroke-width="' + fmt(sw) + '"/>');
    if (CA != null) {
      // сквозное отверстие — «пробивает» деталь насквозь, поэтому светлее заливки
      out.push('<circle cx="0" cy="0" r="' + fmt(CA / 2) + '" fill="#fdfdfc" stroke="' + col.stroke + '" stroke-width="' + fmt(sw) + '"/>');
    }

    var labelParts = [];
    if (D != null) labelParts.push("D" + fmtRu(D));
    if (CA != null) labelParts.push("CA" + fmtRu(CA));
    var label = "d" + fmtRu(d) + (labelParts.length ? " (" + labelParts.join("/") + ")" : "");
    if (showSlot) label += " · паз " + fmtRu(slotW) + "×" + fmtRu(slotL) + ", " + fmtRu(spec.slotAngle || 0) + "°";
    var fs = Math.min(textH * 0.5, (2 * half * 0.92) / (label.length * 0.56));
    out.push(
      '<text x="0" y="' + fmt(half + textH * 0.58) + '" font-size="' + fmt(fs) +
      '" text-anchor="middle" fill="#1a3550">' + esc(label) + "</text>"
    );
    out.push("</svg>");
    return out.join("");
  };

  HC.renderSVG = function (model) {
    var R = model.discDiameter / 2;
    var pad = Math.max(4, R * 0.08);
    var vb = fmt(-R - pad) + " " + fmt(-R - pad) + " " + fmt(2 * (R + pad)) + " " + fmt(2 * (R + pad));
    var sw = Math.max(0.2, R / 200); // толщина линий в мм-координатах
    var out = [];

    out.push(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="' + vb + '" ' +
      'font-family="system-ui, Segoe UI, sans-serif">'
    );
    out.push('<g transform="scale(1,-1)">');

    // диск
    out.push('<circle cx="0" cy="0" r="' + fmt(R) + '" fill="#fdfdfc" stroke="#444" stroke-width="' + fmt(sw * 2) + '"/>');
    // зона отступа от края
    if (model.edgeClearance > 0) {
      out.push('<circle cx="0" cy="0" r="' + fmt(R - model.edgeClearance) + '" fill="none" stroke="#b8b8b8" stroke-width="' + fmt(sw) + '" stroke-dasharray="' + fmt(sw * 8) + ' ' + fmt(sw * 5) + '"/>');
    }
    // центр диска
    var cm = R * 0.03;
    out.push('<path d="M ' + fmt(-cm) + ' 0 H ' + fmt(cm) + ' M 0 ' + fmt(-cm) + ' V ' + fmt(cm) + '" stroke="#999" stroke-width="' + fmt(sw) + '"/>');

    // контрольные отверстия — красные, с перекрестием
    (model.controlHoles || []).forEach(function (h) {
      var r = h.d / 2, c = r * 1.6;
      out.push('<circle cx="' + fmt(h.x) + '" cy="' + fmt(h.y) + '" r="' + fmt(r) + '" fill="#fff5f5" stroke="#c53030" stroke-width="' + fmt(sw * 1.5) + '"/>');
      out.push('<path d="M ' + fmt(h.x - c) + ' ' + fmt(h.y) + ' H ' + fmt(h.x + c) + ' M ' + fmt(h.x) + ' ' + fmt(h.y - c) + ' V ' + fmt(h.y + c) + '" stroke="#c53030" stroke-width="' + fmt(sw * 0.8) + '"/>');
    });

    // детали
    (model.placed || []).forEach(function (p, idx) {
      var col = PART_COLORS[(p.partIndex || 0) % PART_COLORS.length];
      if (p.type === "circle") {
        out.push('<circle cx="' + fmt(p.cx) + '" cy="' + fmt(p.cy) + '" r="' + fmt(p.d / 2) + '" fill="' + col.fill + '" stroke="' + col.stroke + '" stroke-width="' + fmt(sw * 1.5) + '"/>');
      } else {
        var poly = HC.geom.placementPoly(p);
        var pts = poly.map(function (q) { return fmt(q.x) + "," + fmt(q.y); }).join(" ");
        out.push('<polygon points="' + pts + '" fill="' + col.fill + '" stroke="' + col.stroke + '" stroke-width="' + fmt(sw * 1.5) + '"/>');
      }
      if (model.showNumbers) {
        var fs = Math.max(2, Math.min(R / 18, (p.type === "circle" ? p.d : Math.min(p.w, p.h)) * 0.55));
        out.push(
          '<text x="' + fmt(p.cx) + '" y="' + fmt(-p.cy) + '" transform="scale(1,-1)" ' +
          'font-size="' + fmt(fs) + '" text-anchor="middle" dominant-baseline="central" fill="#1a3550">' +
          esc(idx + 1) + "</text>"
        );
      }
    });

    out.push("</g></svg>");
    return out.join("");
  };
})(typeof globalThis !== "undefined" ? globalThis : window);
