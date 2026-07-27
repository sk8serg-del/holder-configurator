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
    } else if (spec.type === "oval") {
      out.push('<ellipse cx="0" cy="0" rx="' + fmt(spec.w / 2) + '" ry="' + fmt(spec.h / 2) + '" fill="' + col.fill + '" stroke="' + col.stroke + '" stroke-width="' + fmt(sw) + '"/>');
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

  // Отрисовка круглой детали с посадкой/зоной напыления/пазом в локальных
  // координатах (центр — 0,0): посадка (D) и паз — чёрной линией без заливки,
  // деталь (d) — сплошная синяя заливка, зона напыления (CA) — пунктирная
  // линия внутри. Используется и в карточке детали, и в общей раскладке.
  // spec = {d, seatD, apertureCA, slotOn, slotAngle} — d и все поля кроме
  // seatD необязательны (например, у контрольного отверстия без «детали»
  // рисуются только D/CA). spec.fill/spec.stroke переопределяют цвет детали,
  // spec.seatFill — заливку посадки (для серых контрольных отверстий).
  function circleFeatureSVG(spec, sw) {
    var d = spec.d > 0 ? spec.d : null;
    var D = spec.seatD > 0 ? spec.seatD : null;
    var CA = spec.apertureCA > 0 ? spec.apertureCA : null;
    var showSlot = !!spec.slotOn && D != null;
    var out = [];

    if (showSlot) {
      var slotL = D + 2 * 2.5;
      var slotW = slotWidth(D);
      out.push(
        '<g transform="rotate(' + fmt(spec.slotAngle || 0) + ')">' +
        '<path d="' + stadiumPath(slotL, slotW) + '" fill="none" stroke="#000" stroke-width="' + fmt(sw) + '"/>' +
        "</g>"
      );
    }
    if (D != null) {
      out.push('<circle cx="0" cy="0" r="' + fmt(D / 2) + '" fill="' + (spec.seatFill || "none") + '" stroke="#000" stroke-width="' + fmt(sw) + '"/>');
    }
    if (d != null) {
      out.push('<circle cx="0" cy="0" r="' + fmt(d / 2) + '" fill="' + (spec.fill || "#2b6cb0") + '" stroke="' + (spec.stroke || "#1a4971") + '" stroke-width="' + fmt(sw * 0.6) + '"/>');
    }
    if (CA != null) {
      out.push(
        '<circle cx="0" cy="0" r="' + fmt(CA / 2) + '" fill="none" stroke="#000" stroke-width="' + fmt(sw) +
        '" stroke-dasharray="' + fmt(sw * 2.5) + " " + fmt(sw * 1.8) + '"/>'
      );
    }
    return out.join("");
  }

  // Крупная схема отверстия под круглую деталь (или контрольного отверстия)
  // для карточки в форме заказа. spec = {d, seatD, apertureCA, depth, slotOn,
  // slotAngle} — d и depth необязательны (для отверстия без «детали» — только D/CA).
  HC.renderHoleDiagram = function (spec) {
    var d = spec.d > 0 ? spec.d : null;
    var D = spec.seatD > 0 ? spec.seatD : null;
    var CA = spec.apertureCA > 0 ? spec.apertureCA : null;
    if (d == null && D == null) return "";
    var showSlot = !!spec.slotOn && D != null;
    var slotL = showSlot ? D + 2 * 2.5 : 0;
    var outer = Math.max(d || 0, D || 0, slotL);
    var R = outer / 2;
    var sidePad = R * 0.18;
    var textH = R * 0.62;
    var half = R + sidePad;
    var vb = fmt(-half) + " " + fmt(-half) + " " + fmt(2 * half) + " " + fmt(2 * half + textH);
    var sw = outer / 70;
    var out = ['<svg xmlns="http://www.w3.org/2000/svg" viewBox="' + vb + '" font-family="system-ui, Segoe UI, sans-serif">'];

    out.push(circleFeatureSVG(spec, sw));

    var labelParts = [];
    if (D != null) labelParts.push("D" + fmtRu(D));
    if (CA != null) labelParts.push("CA" + fmtRu(CA));
    var label = (d != null ? "d" + fmtRu(d) : "") + (labelParts.length ? (d != null ? " (" : "(") + labelParts.join("/") + ")" : "");
    if (spec.depth > 0) label += " · " + HC.t("глуб.") + " " + fmtRu(spec.depth);
    var fs = Math.min(textH * 0.5, (2 * half * 0.92) / (label.length * 0.56));
    out.push(
      '<text x="0" y="' + fmt(half + textH * 0.58) + '" font-size="' + fmt(fs) +
      '" text-anchor="middle" fill="#1a3550">' + esc(label) + "</text>"
    );
    out.push("</svg>");
    return out.join("");
  };

  HC.renderSVG = function (model) {
    var Ruse = model.discDiameter / 2;                 // полезная зона — граница раскладки
    var R = (model.blankDiameter || model.discDiameter) / 2; // полный диск (для отображения)
    var pad = Math.max(4, R * 0.08);
    var vb = fmt(-R - pad) + " " + fmt(-R - pad) + " " + fmt(2 * (R + pad)) + " " + fmt(2 * (R + pad));
    var sw = Math.max(0.2, R / 200); // толщина линий в мм-координатах
    var out = [];

    out.push(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="' + vb + '" ' +
      'font-family="system-ui, Segoe UI, sans-serif">'
    );
    out.push('<g transform="scale(1,-1)">');

    // болванка (полный физический диск)
    out.push('<circle cx="0" cy="0" r="' + fmt(R) + '" fill="#f1f0ec" stroke="#444" stroke-width="' + fmt(sw * 2) + '"/>');

    // кольцевые канавки маски (декор, вне полезной зоны)
    ((model.fixtures && model.fixtures.grooves) || []).forEach(function (gr) {
      [gr.outer, gr.inner].forEach(function (dia) {
        out.push('<circle cx="0" cy="0" r="' + fmt(dia / 2) + '" fill="none" stroke="#c0beb8" stroke-width="' + fmt(sw) + '" stroke-dasharray="' + fmt(sw * 6) + " " + fmt(sw * 4) + '"/>');
      });
    });

    // полезная зона (граница раскладки деталей) — только если болванка крупнее
    if (model.blankDiameter && model.blankDiameter > model.discDiameter + 0.1) {
      out.push('<circle cx="0" cy="0" r="' + fmt(Ruse) + '" fill="#fdfdfc" stroke="#6f9e6f" stroke-width="' + fmt(sw * 1.5) + '"/>');
    }
    // зона отступа от края полезной зоны
    if (model.edgeClearance > 0) {
      out.push('<circle cx="0" cy="0" r="' + fmt(Ruse - model.edgeClearance) + '" fill="none" stroke="#b8b8b8" stroke-width="' + fmt(sw) + '" stroke-dasharray="' + fmt(sw * 8) + ' ' + fmt(sw * 5) + '"/>');
    }

    // крепёж/штифты/резьба болванки (декор, вне полезной зоны)
    ((model.fixtures && model.fixtures.holes) || []).forEach(function (grp) {
      (grp.points || []).forEach(function (p) {
        out.push('<circle cx="' + fmt(p[0]) + '" cy="' + fmt(p[1]) + '" r="' + fmt(grp.d / 2) + '" fill="#dededa" stroke="#8a8a84" stroke-width="' + fmt(sw) + '"/>');
      });
    });
    // фигурные вырезы болванки (декор): произвольный контур-полигон
    ((model.fixtures && model.fixtures.cutouts) || []).forEach(function (cut) {
      var pts = (cut.points || []).map(function (p) { return fmt(p[0]) + "," + fmt(p[1]); }).join(" ");
      if (pts) out.push('<polygon points="' + pts + '" fill="#dededa" stroke="#8a8a84" stroke-width="' + fmt(sw) + '"/>');
    });

    // центр диска
    var cm = Ruse * 0.03;
    out.push('<path d="M ' + fmt(-cm) + ' 0 H ' + fmt(cm) + ' M 0 ' + fmt(-cm) + ' V ' + fmt(cm) + '" stroke="#999" stroke-width="' + fmt(sw) + '"/>');

    // контрольные отверстия — полная схема (посадка/деталь/CA/паз), как у
    // деталей; серая заливка отличает их от обычных деталей
    (model.controlHoles || []).forEach(function (h) {
      var seat = h.seatD != null ? h.seatD : h.d;
      var slotAngle = (Math.atan2(h.y, h.x) * 180) / Math.PI; // ориентация паза свободная — радиально
      var swC = Math.max(sw * 1.5, (seat || 1) / 70);
      out.push(
        '<g transform="translate(' + fmt(h.x) + "," + fmt(h.y) + ')">' +
        circleFeatureSVG({
          d: h.d, seatD: seat, apertureCA: h.apertureCA, slotOn: h.slotOn, slotAngle: slotAngle,
          fill: "#9aa1a9", stroke: "#5f666e", seatFill: "#dfe2e6"
        }, swC) +
        "</g>"
      );
    });

    // детали
    (model.placed || []).forEach(function (p, idx) {
      var col = PART_COLORS[(p.partIndex || 0) % PART_COLORS.length];
      if (p.type === "circle") {
        // ориентация паза свободная и у каждого экземпляра своя — направляем
        // от центра диска (радиально), а не общим углом из формы
        var slotAngle = (Math.atan2(p.cy, p.cx) * 180) / Math.PI;
        var swC = Math.max(sw * 1.5, (p.seatD || p.d) / 70);
        out.push(
          '<g transform="translate(' + fmt(p.cx) + "," + fmt(p.cy) + ')">' +
          circleFeatureSVG({ d: p.d, seatD: p.seatD, apertureCA: p.apertureCA, slotOn: p.slotOn, slotAngle: slotAngle }, swC) +
          "</g>"
        );
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
