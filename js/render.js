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
