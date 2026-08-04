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

  // Метка-ориентир: маленькая зенковка Ø2мм угол 90° у детали с пазом — чтобы
  // отличать похожие по размеру детали и метить ориентацию у форм, где это
  // важно (сама метка везде одна и та же, важны факт и место). MARK_OFF —
  // отступ (мм) и от посадки, и от паза; MARK_SIDE — какая из двух
  // симметричных сторон паза используется (всегда одна и та же).
  HC.MARK_D = 2;
  HC.MARK_ANGLE = 90;
  HC.MARK_OFF = 2;
  HC.MARK_SIDE = 1;
  // Шаг между несколькими метками на одной детали (см. slotMarkPoints) — метки
  // считаются по разновидности детали (1-я — одна метка, 2-я — две, и т.д.),
  // раскладываются в ряд вдоль паза, чтобы количество читалось с одного взгляда.
  HC.MARK_PITCH = 4;

  // Точка метки в МЕСТНЫХ координатах (до поворота/переноса детали): всегда с
  // ОДНОЙ и той же стороны от оси паза (side), на пересечении двух офсетных
  // кривых — offset+off от посадки (halfExt — её проекция на ось паза; для
  // круга это просто радиус, для rect/oct/oval — та же проекция, что
  // используется для длины паза, см. export-csv.js: slotGeom) и offset+off от
  // торца паза (halfW — половина его ширины). Точка — на пересечении
  // окружности радиуса halfExt+off (посадка) и либо прямой y=halfW+off (если
  // пересечение приходится на прямой участок паза, |x|<=hs), либо окружности
  // радиуса halfW+off с центром в торце паза (если пересечение — на
  // скруглении). Для rect/oct/oval посадка не окружность — приближение (по
  // проекции) достаточно точное для вспомогательной, не несущей метки.
  function slotMarkLocal(halfExt, halfW, off) {
    var hs = Math.max(0, halfExt + 2.5 - halfW);
    var r1 = halfExt + off, r2 = halfW + off;
    var lx, ly;
    var yLine = halfW + off;
    var xLineSq = r1 * r1 - yLine * yLine;
    if (xLineSq >= 0 && Math.sqrt(xLineSq) <= hs + EPS) {
      lx = Math.sqrt(xLineSq); ly = yLine;
    } else {
      var a = hs > EPS ? (hs * hs + r1 * r1 - r2 * r2) / (2 * hs) : 0;
      lx = a; ly = Math.sqrt(Math.max(0, r1 * r1 - a * a));
    }
    return { lx: lx, ly: ly };
  }

  function slotMarkPoint(cx, cy, halfExt, halfW, angleRad, off, side) {
    var p = slotMarkLocal(halfExt, halfW, off);
    var ly = p.ly * (side < 0 ? -1 : 1);
    var cosA = Math.cos(angleRad), sinA = Math.sin(angleRad);
    return { x: cx + p.lx * cosA - ly * sinA, y: cy + p.lx * sinA + ly * cosA };
  }

  // count меток в ряд вдоль паза (шаг pitch, местное +x — «наружу» от центра
  // детали), начиная с той же точки, что и slotMarkPoint. Используется, когда
  // одной метки мало (для разновидностей деталей 2, 3, …) — считаем один раз
  // базовую точку (offset от посадки/паза), дальше просто идём вдоль паза.
  function slotMarkPoints(cx, cy, halfExt, halfW, angleRad, off, side, count, pitch) {
    var base = slotMarkLocal(halfExt, halfW, off);
    var ly = base.ly * (side < 0 ? -1 : 1);
    var cosA = Math.cos(angleRad), sinA = Math.sin(angleRad);
    var out = [];
    for (var k = 0; k < count; k++) {
      var lx = base.lx + k * pitch;
      out.push({ x: cx + lx * cosA - ly * sinA, y: cy + lx * sinA + ly * cosA });
    }
    return out;
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

  function norm2pi(a) {
    a = a % (2 * Math.PI);
    return a < 0 ? a + 2 * Math.PI : a;
  }

  // span может быть отрицательным (дуга по часовой стрелке — см. circleMinusCircles,
  // где направление дуги отверстия выбирается по тому, что остаётся внутри диска)
  function appendArc(pts, r, cx, cy, startAngle, span) {
    var steps = Math.max(1, Math.round((Math.abs(span) / (2 * Math.PI)) * 256));
    for (var i = 0; i < steps; i++) {
      var a = startAngle + (span * i) / steps;
      pts.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) });
    }
  }

  // Контур окружности радиуса R (центр 0,0) МИНУС пересечения со списком
  // окружностей holes=[{x,y,r}], которые ЧАСТИЧНО выступают за её границу —
  // нужно, чтобы крепёжное/тех. отверстие у самого края болванки реально
  // выедало кромку в 2D/3D-превью, а не просто рисовалось декоративным
  // кружком поверх целого диска (STEP это всегда резал верно — см.
  // step-export.js, здесь речь только о превью). Отверстия полностью внутри
  // или полностью снаружи диска сюда не попадают — они не меняют контур.
  // Численно: по каждому пересечению находим обе точки пересечения окружностей,
  // вырезаем из базового контура дугу, накрытую отверстием, и вставляем вместо
  // неё дугу отверстия (ту её часть, что лежит внутри базового круга).
  // Пересекает ли окружность (x,y,r) границу базового круга радиуса R
  // (частично — не целиком внутри и не целиком снаружи). Общий тест для
  // circleMinusCircles и для вызывающего кода: такие отверстия нужно вырезать
  // из контура ОДИН раз (либо здесь, либо как обычное внутреннее отверстие —
  // не и то, и другое).
  function circleEdgeOverlap(R, x, y, r) {
    var d = Math.hypot(x, y);
    return r > 0 && d >= EPS && d < R + r - EPS && d + r > R + EPS;
  }

  function circleMinusCircles(R, holes) {
    var cuts = [];
    (holes || []).forEach(function (h) {
      var hx = h.x, hy = h.y, r = h.r;
      if (!circleEdgeOverlap(R, hx, hy, r)) return;
      var d = Math.hypot(hx, hy);

      var a = (d * d + R * R - r * r) / (2 * d);
      var hh = Math.sqrt(Math.max(0, R * R - a * a));
      var ux = hx / d, uy = hy / d;
      var mx = a * ux, my = a * uy;
      var perpx = -uy, perpy = ux;
      var p1 = { x: mx + hh * perpx, y: my + hh * perpy };
      var p2 = { x: mx - hh * perpx, y: my - hh * perpy };
      var b1 = norm2pi(Math.atan2(p1.y, p1.x)), b2 = norm2pi(Math.atan2(p2.y, p2.x));
      var h1 = norm2pi(Math.atan2(p1.y - hy, p1.x - hx)), h2 = norm2pi(Math.atan2(p2.y - hy, p2.x - hx));

      function insideHole(theta) {
        var px = R * Math.cos(theta), py = R * Math.sin(theta);
        return Math.hypot(px - hx, py - hy) < r;
      }
      function insideBase(theta) {
        var px = hx + r * Math.cos(theta), py = hy + r * Math.sin(theta);
        return Math.hypot(px, py) < R;
      }

      // вырезаемая дуга БАЗОВОГО круга: идём вперёд (CCW) от b1 к b2 (rawSpan) —
      // если середина этого пути лежит внутри отверстия, это и есть вырез;
      // иначе вырез — оставшаяся часть круга (от b2 к b1)
      var rawSpan = norm2pi(b2 - b1);
      var rStart, rEnd;
      if (insideHole(norm2pi(b1 + rawSpan / 2))) { rStart = b1; rEnd = b2; }
      else { rStart = b2; rEnd = b1; }
      var rSpan = norm2pi(rEnd - rStart);

      // дуга ОТВЕРСТИЯ, которой заменяем вырез — начинается в той же физической
      // точке, что и rStart, заканчивается в точке rEnd; направление (CCW/CW
      // вокруг центра отверстия) — то, что остаётся внутри базового круга
      var hFrom = rStart === b1 ? h1 : h2;
      var hTo = rStart === b1 ? h2 : h1;
      var rawHoleSpan = norm2pi(hTo - hFrom);
      var holeSpan = insideBase(norm2pi(hFrom + rawHoleSpan / 2)) ? rawHoleSpan : rawHoleSpan - 2 * Math.PI;

      cuts.push({ rStart: rStart, rEnd: rEnd, rSpan: rSpan, hx: hx, hy: hy, r: r, hFrom: hFrom, holeSpan: holeSpan });
    });

    if (!cuts.length) return null; // нет частичных пересечений — обычный круг, ничего готовить не надо

    // Начинаем обход с угла ПЕРВОГО выреза (а не с 0): иначе если ровно этот
    // вырез лежит рядом со швом 0°/360°, «дуга от 0 до rStart» и «дуга от
    // rEnd до 2π» превращаются в два огромных перекрывающихся куска (почти
    // весь круг дважды) — обходим только ЗАЗОРЫ между соседними вырезами
    // (посл.rEnd → след.rStart), это всегда корректно оборачивается через 0.
    cuts.sort(function (a, b) { return a.rStart - b.rStart; });
    var pts = [];
    var angle = cuts[0].rStart;
    cuts.forEach(function (cut, i) {
      appendArc(pts, cut.r, cut.hx, cut.hy, cut.hFrom, cut.holeSpan);
      angle = cut.rEnd;
      var next = cuts[(i + 1) % cuts.length];
      appendArc(pts, R, 0, 0, angle, norm2pi(next.rStart - angle));
      angle = next.rStart;
    });
    return pts;
  }

  // Выпуклая оболочка набора точек (монотонная цепочка Эндрю) — используется
  // и для 3D (viewer3d.js — схлопнуть налегающие кружки крепежа в один
  // контур), и для реального контура выреза-гантели из STEP-проекции
  // (step-import.js) — общий геометрический примитив, без побочных эффектов.
  function convexHull(points) {
    points = points.slice().sort(function (a, b) { return a.x - b.x || a.y - b.y; });
    var n = points.length;
    if (n < 3) return points;
    function cross(o, a, b) { return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x); }
    var lower = [];
    for (var i = 0; i < n; i++) {
      while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], points[i]) <= 0) lower.pop();
      lower.push(points[i]);
    }
    var upper = [];
    for (var i2 = n - 1; i2 >= 0; i2--) {
      while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], points[i2]) <= 0) upper.pop();
      upper.push(points[i2]);
    }
    upper.pop(); lower.pop();
    return lower.concat(upper);
  }

  // Точки дуги ОКРУЖНОСТИ радиуса r между (x1,y1) и (x2,y2) — стандартное SVG
  // параметрическое преобразование "конечные точки → центр", упрощённое для
  // случая rx=ry=r (наши дуги — всегда проекции цилиндров, без эллипсов/поворота).
  function appendArcPoints(pts, x1, y1, x2, y2, r, largeArc, sweep, seg) {
    var dx2 = (x1 - x2) / 2, dy2 = (y1 - y2) / 2;
    var lenSq = dx2 * dx2 + dy2 * dy2;
    if (lenSq < 1e-12) return;
    var rr = Math.max(r * r, lenSq); // страховка от погрешности (хорда чуть больше 2r)
    var sign = largeArc !== sweep ? 1 : -1;
    var co = sign * Math.sqrt(Math.max(0, rr - lenSq) / lenSq);
    var cx = co * dy2 + (x1 + x2) / 2;
    var cy = -co * dx2 + (y1 + y2) / 2;
    var a1 = Math.atan2(y1 - cy, x1 - cx);
    var a2 = Math.atan2(y2 - cy, x2 - cx);
    var span = a2 - a1;
    if (sweep && span < 0) span += 2 * Math.PI;
    if (!sweep && span > 0) span -= 2 * Math.PI;
    var steps = Math.max(1, Math.round((Math.abs(span) / (2 * Math.PI)) * seg * 4));
    for (var k = 1; k <= steps; k++) {
      var a = a1 + (span * k) / steps;
      pts.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) });
    }
  }

  // Разбор одного фрагмента SVG-пути (M/L/A/Q/Z — команды, которые реально
  // встречаются в выходе replicad: Drawing.toSVGPaths() у проекций (дуги —
  // окружности, без поворота) и у контуров букв (drawText — квадратичные
  // кривые, TrueType)) в полилинию точек. Общий примитив: используется и для
  // настоящего контура выреза-гантели из STEP-проекции (step-import.js), и
  // для контуров букв гравировки (engraving.js).
  function flattenSVGPath(d, segPerArc) {
    segPerArc = segPerArc || 24;
    var tokens = d.match(/[MLAQZ]|-?\d+\.?\d*(?:e-?\d+)?/gi) || [];
    var pts = [], cur = null, i = 0;
    function num() { return parseFloat(tokens[i++]); }
    while (i < tokens.length) {
      var cmd = tokens[i++];
      if (cmd === "M" || cmd === "L") {
        var x = num(), y = num();
        pts.push({ x: x, y: y });
        cur = { x: x, y: y };
      } else if (cmd === "Q") {
        var qx = num(), qy = num(), x2 = num(), y2 = num();
        for (var s = 1; s <= segPerArc; s++) {
          var t = s / segPerArc, mt = 1 - t;
          pts.push({ x: mt * mt * cur.x + 2 * mt * t * qx + t * t * x2, y: mt * mt * cur.y + 2 * mt * t * qy + t * t * y2 });
        }
        cur = { x: x2, y: y2 };
      } else if (cmd === "A") {
        var rx = num(); num(); num(); // ry, поворот — не нужны (окружность)
        var laf = num(), sf = num(), x3 = num(), y3 = num();
        appendArcPoints(pts, cur.x, cur.y, x3, y3, rx, laf, sf, segPerArc);
        cur = { x: x3, y: y3 };
      } else {
        // Z/z — замыкание, первая точка контура уже добавлена
      }
    }
    return pts;
  }

  // Разбор SVG-пути в СИМВОЛЬНЫЕ команды (M/L/Q — с сохранением контрольной
  // точки кривой, БЕЗ тесселяции в полилинию). Нужно там, где дальше кривую
  // разворачивают (например, вдоль дуги — см. engraving.js) и передают как
  // НАСТОЯЩУЮ кривую конечному потребителю (SVG "Q", THREE.Path.
  // quadraticCurveTo, replicad Pen.quadraticBezierCurveTo) — так гладкая
  // кривая шрифта остаётся гладкой (одна кривая), а не приближается ломаной
  // из многих отрезков. Используются только команды M/L/Q — ровно то, что
  // реально встречается в контурах букв (replicad drawText, TrueType).
  function parseSVGPathCommands(d) {
    var tokens = d.match(/[MLQZ]|-?\d+\.?\d*(?:e-?\d+)?/gi) || [];
    var out = [], i = 0;
    function num() { return parseFloat(tokens[i++]); }
    while (i < tokens.length) {
      var cmd = tokens[i++];
      if (cmd === "M") out.push({ cmd: "M", x: num(), y: num() });
      else if (cmd === "L") out.push({ cmd: "L", x: num(), y: num() });
      else if (cmd === "Q") out.push({ cmd: "Q", cx: num(), cy: num(), x: num(), y: num() });
      // Z/z — замыкание, отдельной командой не нужно (первая M уже есть)
    }
    return out;
  }

  HC.geom = {
    EPS: EPS,
    rectPoly: rectPoly,
    octPoly: octPoly,
    slotWidth: slotWidth,
    seatOutline: seatOutline,
    slotMarkPoint: slotMarkPoint,
    slotMarkPoints: slotMarkPoints,
    ellipsePoly: ellipsePoly,
    shapePoly: shapePoly,
    placementPoly: placementPoly,
    placementDist: placementDist,
    polyPolyDist: polyPolyDist,
    edgeDist: edgeDist,
    pointInPoly: pointInPoly,
    circleEdgeOverlap: circleEdgeOverlap,
    circleMinusCircles: circleMinusCircles,
    convexHull: convexHull,
    flattenSVGPath: flattenSVGPath,
    distPointSeg: distPointSeg,
    parseSVGPathCommands: parseSVGPathCommands
  };
})(typeof globalThis !== "undefined" ? globalThis : window);
