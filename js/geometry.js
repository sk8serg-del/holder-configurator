/*
 * geometry.js — геометрические примитивы и расстояния кромка–кромка.
 *
 * Все размеры в мм. Система координат CAD: X вправо, Y вверх, центр диска (0,0).
 *
 * Размещение (placement):
 *   { type:'circle', cx, cy, d }
 *   { type:'rect',   cx, cy, w, h, rot }          rot — градусы, против часовой
 *   { type:'oct',    cx, cy, w, h, chamfer, rot } прямоугольник с фаской углов 45°
 *   { type:'oval',   cx, cy, w, h, rot }          эллипс с полуосями w/2 (X) и h/2 (Y)
 */
(function (g) {
  "use strict";
  var HC = (g.HC = g.HC || {});
  var EPS = 1e-6;

  function transform(pts, cx, cy, rot) {
    var a = ((rot || 0) * Math.PI) / 180;
    var cosA = Math.cos(a), sinA = Math.sin(a);
    return pts.map(function (p) {
      return { x: cx + p[0] * cosA - p[1] * sinA, y: cy + p[0] * sinA + p[1] * cosA };
    });
  }

  function rectPoly(cx, cy, w, h, rot) {
    var x = w / 2, y = h / 2;
    return transform([[-x, -y], [x, -y], [x, y], [-x, y]], cx, cy, rot);
  }

  function octPoly(cx, cy, w, h, chamfer, rot) {
    var x = w / 2, y = h / 2;
    var c = Math.max(0, Math.min(chamfer || 0, Math.min(w, h) / 2 - EPS));
    return transform(
      [
        [-x + c, -y], [x - c, -y], [x, -y + c], [x, y - c],
        [x - c, y], [-x + c, y], [-x, y - c], [-x, -y + c]
      ],
      cx, cy, rot
    );
  }

  // Эллипс с полуосями w/2 (вдоль X) и h/2 (вдоль Y), заданный полигоном.
  // Вершины лежат НА эллипсе; при seg=48 хорда отступает от дуги на доли мм —
  // для расчёта зазоров и триангуляции 3D этого достаточно.
  function ellipsePoly(cx, cy, w, h, rot, seg) {
    seg = seg || 48;
    var a = w / 2, b = h / 2, pts = [];
    for (var i = 0; i < seg; i++) {
      var th = (2 * Math.PI * i) / seg;
      pts.push([a * Math.cos(th), b * Math.sin(th)]);
    }
    return transform(pts, cx, cy, rot);
  }

  // Ширина паза под пинцет: стандарт 9 мм, но не больше 0.75 диаметра посадки D
  function slotWidth(D) { return Math.min(9, D * 0.75); }

  // Дальность луча из центра по направлению (ux,uy) до края капсулы (паза)
  // длиной L=2·(hs+halfW), шириной 2·halfW, лежащей вдоль своей продольной оси.
  function capsuleRadial(ux, uy, hs, halfW) {
    var uc = Math.abs(ux), us = Math.abs(uy);
    if (us > 1e-9 && (halfW / us) * uc <= hs) return halfW / us; // боковая прямая
    var disc = halfW * halfW - hs * hs * us * us;                 // торцевая дуга
    return uc * hs + Math.sqrt(Math.max(0, disc));
  }

  // Точный контур «посадка ∪ паз» — звёздный многоугольник относительно центра
  // (cx,cy): посадка Ø D, паз-стадион (см. slotWidth) повёрнут на slotAngleRad
  // (радианы). Без паза — просто окружность. Используется и для клиренса
  // круглых деталей в гекс-раскладке (packer.js), и для 3D-вида (viewer3d.js) —
  // одна и та же реальная форма.
  function seatOutline(cx, cy, D, slotOn, slotAngleRad, n) {
    n = n || 96;
    var R = D / 2, pts = [];
    if (!slotOn) {
      for (var i = 0; i < n; i++) {
        var a = (i / n) * Math.PI * 2;
        pts.push({ x: cx + R * Math.cos(a), y: cy + R * Math.sin(a) });
      }
      return pts;
    }
    var L = D + 2 * 2.5, W = slotWidth(D);
    var hs = Math.max(0, L / 2 - W / 2);
    for (var i2 = 0; i2 < n; i2++) {
      var a2 = (i2 / n) * Math.PI * 2;
      var la = a2 - slotAngleRad;
      var r = Math.max(R, capsuleRadial(Math.cos(la), Math.sin(la), hs, W / 2));
      pts.push({ x: cx + r * Math.cos(a2), y: cy + r * Math.sin(a2) });
    }
    return pts;
  }

  // Контур фигуры заданного типа по габаритам w×h (для посадки/зоны напыления —
  // тот же тип, но увеличенный/уменьшенный габарит). Круг здесь не обрабатывается.
  function shapePoly(type, cx, cy, w, h, chamfer, rot) {
    if (type === "rect") return rectPoly(cx, cy, w, h, rot);
    if (type === "oval") return ellipsePoly(cx, cy, w, h, rot);
    return octPoly(cx, cy, w, h, chamfer, rot); // oct
  }

  // Контур размещения. Для круга — null (аналитическая проверка по d/2), КРОМЕ
  // случая, когда заранее посчитан точный контур «посадка+паз» (p._outline —
  // ставит packer.js для гекс-раскладки с известным углом паза): тогда именно
  // он и есть реальная занятая зона, проверяется как обычный полигон.
  function placementPoly(p) {
    if (p.type === "circle") return p._outline || null;
    return shapePoly(p.type, p.cx, p.cy, p.w, p.h, p.chamfer, p.rot);
  }

  function dist(ax, ay, bx, by) {
    var dx = bx - ax, dy = by - ay;
    return Math.sqrt(dx * dx + dy * dy);
  }

  function distPointSeg(px, py, ax, ay, bx, by) {
    var dx = bx - ax, dy = by - ay;
    var L2 = dx * dx + dy * dy;
    if (L2 < EPS * EPS) return dist(px, py, ax, ay);
    var t = ((px - ax) * dx + (py - ay) * dy) / L2;
    t = Math.max(0, Math.min(1, t));
    return dist(px, py, ax + t * dx, ay + t * dy);
  }

  function orient(ax, ay, bx, by, cx, cy) {
    var v = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
    if (v > EPS) return 1;
    if (v < -EPS) return -1;
    return 0;
  }

  function onSeg(ax, ay, bx, by, px, py) {
    return (
      Math.min(ax, bx) - EPS <= px && px <= Math.max(ax, bx) + EPS &&
      Math.min(ay, by) - EPS <= py && py <= Math.max(ay, by) + EPS
    );
  }

  function segsIntersect(a, b, c, d) {
    var o1 = orient(a.x, a.y, b.x, b.y, c.x, c.y);
    var o2 = orient(a.x, a.y, b.x, b.y, d.x, d.y);
    var o3 = orient(c.x, c.y, d.x, d.y, a.x, a.y);
    var o4 = orient(c.x, c.y, d.x, d.y, b.x, b.y);
    if (o1 !== o2 && o3 !== o4) return true;
    if (o1 === 0 && onSeg(a.x, a.y, b.x, b.y, c.x, c.y)) return true;
    if (o2 === 0 && onSeg(a.x, a.y, b.x, b.y, d.x, d.y)) return true;
    if (o3 === 0 && onSeg(c.x, c.y, d.x, d.y, a.x, a.y)) return true;
    if (o4 === 0 && onSeg(c.x, c.y, d.x, d.y, b.x, b.y)) return true;
    return false;
  }

  function distSegSeg(a, b, c, d) {
    if (segsIntersect(a, b, c, d)) return 0;
    return Math.min(
      distPointSeg(a.x, a.y, c.x, c.y, d.x, d.y),
      distPointSeg(b.x, b.y, c.x, c.y, d.x, d.y),
      distPointSeg(c.x, c.y, a.x, a.y, b.x, b.y),
      distPointSeg(d.x, d.y, a.x, a.y, b.x, b.y)
    );
  }

  function pointInPoly(px, py, poly) {
    var inside = false;
    for (var i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      var xi = poly[i].x, yi = poly[i].y, xj = poly[j].x, yj = poly[j].y;
      if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }

  // Минимальное расстояние между контурами полигонов; -1 при наложении
  function polyPolyDist(P, Q) {
    if (pointInPoly(P[0].x, P[0].y, Q) || pointInPoly(Q[0].x, Q[0].y, P)) return -1;
    var best = Infinity;
    for (var i = 0; i < P.length; i++) {
      var a = P[i], b = P[(i + 1) % P.length];
      for (var j = 0; j < Q.length; j++) {
        var v = distSegSeg(a, b, Q[j], Q[(j + 1) % Q.length]);
        if (v === 0) return 0;
        if (v < best) best = v;
      }
    }
    return best;
  }

  // Расстояние от кромки круга до контура полигона; отрицательное при наложении
  function circlePolyDist(cx, cy, r, poly) {
    if (pointInPoly(cx, cy, poly)) return -1;
    var best = Infinity;
    for (var i = 0; i < poly.length; i++) {
      var a = poly[i], b = poly[(i + 1) % poly.length];
      best = Math.min(best, distPointSeg(cx, cy, a.x, a.y, b.x, b.y));
    }
    return best - r;
  }

  // Расстояние кромка–кромка между двумя размещениями; <= 0 при касании/наложении
  function placementDist(A, B) {
    var pa = placementPoly(A), pb = placementPoly(B);
    if (!pa && !pb) return dist(A.cx, A.cy, B.cx, B.cy) - A.d / 2 - B.d / 2;
    if (!pa) return circlePolyDist(A.cx, A.cy, A.d / 2, pb);
    if (!pb) return circlePolyDist(B.cx, B.cy, B.d / 2, pa);
    return polyPolyDist(pa, pb);
  }

  // Запас до кромки диска радиуса R (центр диска в 0,0); >= 0 — деталь внутри.
  // Круг без точного контура (p._outline) — аналитически по d/2; иначе (в т.ч.
  // круг с посадкой+пазом) — по вершинам реального контура, как полигон.
  function edgeDist(A, R) {
    var poly = placementPoly(A);
    if (!poly) return R - (dist(0, 0, A.cx, A.cy) + A.d / 2);
    var best = Infinity;
    for (var i = 0; i < poly.length; i++) {
      best = Math.min(best, R - dist(0, 0, poly[i].x, poly[i].y));
    }
    return best;
  }

  HC.geom = {
    EPS: EPS,
    rectPoly: rectPoly,
    octPoly: octPoly,
    slotWidth: slotWidth,
    seatOutline: seatOutline,
    ellipsePoly: ellipsePoly,
    shapePoly: shapePoly,
    placementPoly: placementPoly,
    placementDist: placementDist,
    polyPolyDist: polyPolyDist,
    edgeDist: edgeDist,
    pointInPoly: pointInPoly
  };
})(typeof globalThis !== "undefined" ? globalThis : window);
