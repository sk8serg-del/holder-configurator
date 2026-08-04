/*
 * viewer3d.js — 3D-просмотр раскладки (Three.js, js/vendor/three.min.js).
 *
 * HC.viewer3d.available()      — загружена ли библиотека Three.js;
 * HC.viewer3d.update(host, model) — построить/обновить вид в контейнере;
 *   возвращает false, если WebGL недоступен.
 * model — как у HC.renderSVG, плюс thickness (толщина диска, мм).
 * HC.viewer3d.updateMesh(host, {vertices,triangles,normals}) — то же самое,
 *   но из настоящего меша STEP-геометрии (shape.mesh() из replicad, см.
 *   app.js refreshBlanks3DFromMesh) — для папочных болванок с реальным
 *   файлом, вместо приближённой реконструкции слоями.
 *
 * Диск строится «слоями» без CSG: толщина делится по всем встречающимся
 * глубинам посадок; в каждом слое отверстия — контуры (посадка + паз) тех
 * элементов, что прорезают слой, либо их сквозные зоны CA. Сложенные слои
 * выглядят как настоящие ступенчатые отверстия. Принадлежность отверстия
 * показана цветом внутренних стенок counterbore (посадка + стенка CA),
 * контрольные отверстия — серыми стенками; дно и поверхность — алюминий.
 */
(function (g) {
  "use strict";
  var HC = (g.HC = g.HC || {});

  var PART_COLORS = [0x2b6cb0, 0x2f855a, 0xc05621, 0x6b46c1, 0xc53030];
  var CTRL_COLOR = 0x9b111e; // контрольные отверстия — рубиновые стенки counterbore
  var BLANK_FEATURE_COLOR = 0x8a8a84; // составная/глухая посадка САМОЙ болванки (свидетель/паз) — тот же серый, что и у простого декоративного крепежа, не рубиновый (это не КО заказа)
  var ENGRAVE_COLOR = 0x000000; // гравировка — чёрная (заливка), чтобы отличаться от серого металла диска

  var st = null; // единственный экземпляр: {renderer, scene, camera, group, host, sph, ...}

  // ---------- геометрия контуров ----------

  function circlePoly(cx, cy, r, n) {
    var pts = [];
    for (var i = 0; i < n; i++) {
      var a = (i / n) * Math.PI * 2;
      pts.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) });
    }
    return pts;
  }

  // Контур «посадка ∪ паз» — общая реализация в geometry.js (используется и
  // здесь для 3D, и в packer.js для точного клиренса в гекс-раскладке).
  function seatOutline(cx, cy, D, slotOn, slotAngleRad) {
    return HC.geom.seatOutline(cx, cy, D, slotOn, slotAngleRad, 96);
  }

  // Группировка ПЕРЕСЕКАЮЩИХСЯ кружков (union-find по перекрытию окружностей)
  // — цепочка отверстий "гантели"/keyhole (см. step-import.js mergeDogboneHoles)
  // приходит сюда как несколько налегающих друг на друга кружков разного
  // диаметра; если пробить их как N независимых отверстий, рёбра контуров
  // пересекаются и ExtrudeGeometry триангулирует эту кашу в мусор
  // (самопересекающиеся осколки — видно на скриншоте пользователя).
  function groupOverlappingCircles(circles) {
    var n = circles.length;
    var parent = [];
    for (var i = 0; i < n; i++) parent.push(i);
    function find(i) { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; }
    function union(a, b) { var ra = find(a), rb = find(b); if (ra !== rb) parent[ra] = rb; }
    for (var i = 0; i < n; i++) {
      for (var j = i + 1; j < n; j++) {
        var dist = Math.hypot(circles[i].cx - circles[j].cx, circles[i].cy - circles[j].cy);
        if (dist < circles[i].r + circles[j].r + 0.02) union(i, j);
      }
    }
    var groups = {};
    circles.forEach(function (c, i) {
      var root = find(i);
      (groups[root] = groups[root] || []).push(c);
    });
    return Object.keys(groups).map(function (k) { return groups[k]; });
  }

  // Контур объединения группы пересекающихся кружков — выпуклая оболочка их
  // насэмплированных границ (не точная булева уния, но гладкий контур без
  // самопересечений; для цепочки кружков одного "гантельного" выреза
  // визуально практически неотличимо от настоящей формы).
  function hullOfCircles(circles, seg) {
    var pts = [];
    circles.forEach(function (c) {
      for (var i = 0; i < seg; i++) {
        var a = (i / seg) * Math.PI * 2;
        pts.push({ x: c.cx + c.r * Math.cos(a), y: c.cy + c.r * Math.sin(a) });
      }
    });
    return HC.geom.convexHull(pts);
  }

  function toShape(pts) {
    var s = new g.THREE.Shape();
    s.moveTo(pts[0].x, pts[0].y);
    for (var i = 1; i < pts.length; i++) s.lineTo(pts[i].x, pts[i].y);
    s.closePath();
    return s;
  }

  function toPath(pts) {
    var p = new g.THREE.Path();
    p.moveTo(pts[0].x, pts[0].y);
    for (var i = 1; i < pts.length; i++) p.lineTo(pts[i].x, pts[i].y);
    p.closePath();
    return p;
  }

  // Строит THREE.Shape/Path из команд контура гравировки (см. js/engraving.js
  // computeLayout) — M/L/Q, Q — quadraticCurveTo НАПРЯМУЮ (настоящая кривая,
  // не приближение полигоном точек).
  function applyCommands(target, cmds) {
    cmds.forEach(function (c) {
      if (c.cmd === "M") target.moveTo(c.x, c.y);
      else if (c.cmd === "L") target.lineTo(c.x, c.y);
      else if (c.cmd === "Q") target.quadraticCurveTo(c.cx, c.cy, c.x, c.y);
    });
    target.closePath();
    return target;
  }
  function pathFromCommands(cmds) { return applyCommands(new g.THREE.Path(), cmds); }

  // Контур зоны напыления: полигон (некруглые детали) или круг (круглые/КО).
  function caPolyOf(ca) {
    return ca.poly ? ca.poly : circlePoly(ca.cx, ca.cy, ca.r, 64);
  }

  // Дальность выхода луча из точки (cx,cy) по направлению (ux,uy) до границы
  // полигона (наибольшее t пересечения с рёбрами).
  function rayExitDist(cx, cy, ux, uy, poly) {
    var maxT = 0;
    for (var i = 0; i < poly.length; i++) {
      var a = poly[i], b = poly[(i + 1) % poly.length];
      var dx = b.x - a.x, dy = b.y - a.y;
      var den = ux * dy - uy * dx;
      if (Math.abs(den) < 1e-12) continue;
      var t = ((a.x - cx) * dy - (a.y - cy) * dx) / den;
      var s = ((a.x - cx) * uy - (a.y - cy) * ux) / den;
      if (t >= 0 && s >= -1e-9 && s <= 1 + 1e-9 && t > maxT) maxT = t;
    }
    return maxT;
  }

  // Объединение круга (cx,cy,r) с полигоном, звёздным относительно центра круга
  // (центр внутри полигона): по каждому лучу r = max(радиус круга, до границы).
  function unionCirclePoly(cx, cy, r, poly) {
    var n = 120, out = [];
    for (var i = 0; i < n; i++) {
      var th = (i / n) * Math.PI * 2, ux = Math.cos(th), uy = Math.sin(th);
      var ru = Math.max(r, rayExitDist(cx, cy, ux, uy, poly));
      out.push({ x: cx + ru * ux, y: cy + ru * uy });
    }
    return out;
  }

  // ---------- элементы (детали + контрольные отверстия) → карманы ----------

  // Каждый элемент: {outline, depth, ca: {cx,cy,r}|null, color}
  function collectFeatures(model) {
    var T = model.thickness;
    var defDepth = Math.max(0.5, T - 1.5); // стандартная глубина посадки
    var fs = [];

    (model.controlHoles || []).forEach(function (h) {
      var seat = h.seatD > 0 ? h.seatD : h.d;
      if (!(seat > 0)) return;
      // явно заданная ориентация паза (свидетель из конструктора болванки) —
      // приоритет; иначе, как раньше, радиально от центра диска
      var ang = h.slotAngle != null ? (h.slotAngle * Math.PI) / 180 : Math.atan2(h.y, h.x);
      fs.push({
        outline: seatOutline(h.x, h.y, seat, !!h.slotOn, ang),
        depth: h.depth > 0 ? h.depth : defDepth,
        ca: h.apertureCA > 0 ? { cx: h.x, cy: h.y, r: h.apertureCA / 2 } : null,
        color: CTRL_COLOR
      });
    });

    (model.placed || []).forEach(function (p) {
      var color = PART_COLORS[(p.partIndex || 0) % PART_COLORS.length];
      // метки-ориентиры (см. js/geometry.js MARK_D/MARK_ANGLE) — только у
      // деталей с пазом (markCount = разновидность детали, 1-я — одна метка
      // и т.д., та же формула, что в export-csv.js/step-export.js features());
      // геометрия позиций — 1 в 1 как в step-export.js slotGeom, иначе метки
      // в Lite 3D оказались бы не там, где реальный STEP их вырезает.
      var markCount = (p.partIndex || 0) + 1;
      if (p.type === "circle") {
        var seat = p.seatD > 0 ? p.seatD : p.d;
        // угол паза от раскладчика (гекс — по высоте треугольника); запас — радиально
        var ang = p.slotAngle != null ? p.slotAngle * Math.PI / 180 : Math.atan2(p.cy, p.cx);
        var marks = [];
        if (p.slotOn) {
          var halfW = Math.min(9, seat * 0.75) / 2;
          marks = HC.geom.slotMarkPoints(p.cx, p.cy, seat / 2, halfW, ang, HC.MARK_OFF, HC.MARK_SIDE, markCount, HC.MARK_PITCH);
        }
        fs.push({
          outline: seatOutline(p.cx, p.cy, seat, !!p.slotOn, ang),
          depth: defDepth,
          ca: p.apertureCA > 0 ? { cx: p.cx, cy: p.cy, r: p.apertureCA / 2 } : null,
          color: color,
          marks: marks
        });
      } else {
        // некруглая деталь: карман = контур посадки (габарит + припуск),
        // зона напыления — сквозной вырез уменьшенного контура. Паз в 3D для
        // некруглых пока не вырезаем (сложное объединение полигонов) — он виден на 2D-схеме.
        var g2 = p.seatGap > 0 ? p.seatGap : 0;
        var ci = p.caInset > 0 ? p.caInset : 0;
        var caShape = (ci > 0 && p.w - 2 * ci > 0 && p.h - 2 * ci > 0)
          ? HC.geom.shapePoly(p.type, p.cx, p.cy, p.w - 2 * ci, p.h - 2 * ci, p.chamfer || 0, p.rot)
          : null;
        var marksNc = [];
        if (p.slotOn) {
          var ang2 = ((p.rot || 0) + (p.slotAngle || 0)) * Math.PI / 180;
          var ux = Math.cos(ang2), uy = Math.sin(ang2);
          var seatPoly = HC.geom.shapePoly(p.type, 0, 0, p.w + 2 * g2, p.h + 2 * g2, p.chamfer || 0, p.rot || 0);
          var halfExt = 0;
          seatPoly.forEach(function (q) { var pr = Math.abs(q.x * ux + q.y * uy); if (pr > halfExt) halfExt = pr; });
          var widNc = Math.min(9, (Math.min(p.w, p.h) + 2 * g2) * 0.75);
          marksNc = HC.geom.slotMarkPoints(p.cx, p.cy, halfExt, widNc / 2, ang2, HC.MARK_OFF, HC.MARK_SIDE, markCount, HC.MARK_PITCH);
        }
        fs.push({
          outline: HC.geom.shapePoly(p.type, p.cx, p.cy, p.w + 2 * g2, p.h + 2 * g2, p.chamfer || 0, p.rot),
          depth: defDepth,
          ca: caShape ? { poly: caShape } : null,
          color: color,
          marks: marksNc
        });
      }
    });

    // Свидетели/составные посадки САМОЙ болванки (STEP-разбор — см.
    // js/step-import.js groupKeepoutsByDiameter): точка с 5 элементами
    // [x,y,slotAngle,depth,apertureCA] вместо простого [x,y] — та же логика,
    // что и у контрольных отверстий заказа: глухой карман (+паз, если есть)
    // + отдельная сквозная CA, а не один сплошной сквозной кружок (иначе
    // после фикса «паз насквозь» CA просто пропадала — резать было некуда).
    // Обычный простой крепёж (болт, точка [x,y]) сюда не попадает — остаётся
    // в fixtureCircles (buildGroup), он честно сквозной.
    ((model.fixtures && model.fixtures.holes) || []).forEach(function (grp) {
      if (grp.countersink) return;
      (grp.points || []).forEach(function (p) {
        if (p.length <= 2) return;
        var slotAngleDeg = p[2], depth = p[3] > 0 ? p[3] : defDepth, apertureCA = p[4] > 0 ? p[4] : 0;
        var ang = slotAngleDeg != null ? (slotAngleDeg * Math.PI) / 180 : Math.atan2(p[1], p[0]);
        fs.push({
          outline: seatOutline(p[0], p[1], grp.d, slotAngleDeg != null, ang),
          depth: depth,
          ca: apertureCA > 0 ? { cx: p[0], cy: p[1], r: apertureCA / 2 } : null,
          color: BLANK_FEATURE_COLOR
        });
      });
    });
    return fs;
  }

  // Боковая поверхность контура от z0 до z1, слегка втянутая внутрь (inset),
  // чтобы цветная стенка не мерцала поверх серой стенки слоя диска.
  function wallGeometry(pts, z0, z1, inset) {
    var cx = 0, cy = 0;
    pts.forEach(function (p) { cx += p.x; cy += p.y; });
    cx /= pts.length; cy /= pts.length;
    var q = pts.map(function (p) {
      var dx = cx - p.x, dy = cy - p.y;
      var len = Math.sqrt(dx * dx + dy * dy) || 1;
      var k = Math.min(1, inset / len);
      return { x: p.x + dx * k, y: p.y + dy * k };
    });
    var pos = [];
    for (var i = 0; i < q.length; i++) {
      var a = q[i], b = q[(i + 1) % q.length];
      pos.push(a.x, a.y, z0, b.x, b.y, z0, b.x, b.y, z1);
      pos.push(a.x, a.y, z0, b.x, b.y, z1, a.x, a.y, z1);
    }
    var geo = new g.THREE.BufferGeometry();
    geo.setAttribute("position", new g.THREE.Float32BufferAttribute(pos, 3));
    geo.computeVertexNormals();
    return geo;
  }

  // Команды контура гравировки (M/L/Q, см. js/engraving.js computeLayout) →
  // полилиния точек — только для цветной стенки/дна кармана (wallGeometry/
  // ShapeGeometry ожидают точки, не кривые); сама верхняя грань кармана
  // режется настоящей кривой через pathFromCommands, тут просто нужно
  // разумно плотно провести стенку вдоль той же кривой.
  function commandsToPoints(cmds, segPerCurve) {
    segPerCurve = segPerCurve || 8;
    var pts = [], cur = null;
    cmds.forEach(function (c) {
      if (c.cmd === "Q" && cur) {
        for (var s = 1; s <= segPerCurve; s++) {
          var t = s / segPerCurve, mt = 1 - t;
          pts.push({
            x: mt * mt * cur.x + 2 * mt * t * c.cx + t * t * c.x,
            y: mt * mt * cur.y + 2 * mt * t * c.cy + t * t * c.y
          });
        }
      } else {
        pts.push({ x: c.x, y: c.y });
      }
      cur = { x: c.x, y: c.y };
    });
    return pts;
  }

  // ---------- сборка сцены ----------

  function buildGroup(model) {
    var THREE = g.THREE;
    var T = model.thickness > 0 ? model.thickness : 6;
    var R = (model.blankDiameter || model.discDiameter) / 2; // полный диск
    var eps = 1e-6;
    var group = new THREE.Group();

    // крепёж/штифты/резьба болванки — простые сквозные отверстия (декор,
    // серые стенки). Группы с countersink рисуются отдельно конусом (см.
    // ниже), не насквозь. Точки составной/глухой посадки (5 элементов —
    // [x,y,slotAngle,depth,apertureCA], см. js/step-import.js
    // groupKeepoutsByDiameter) сюда НЕ попадают — это настоящая посадка
    // свидетеля, а не крепёжный болт насквозь, обрабатывается ниже как
    // полноценный «карман» через collectFeatures (глухая глубина + паз +
    // отдельная сквозная CA), см. BLANK_FEATURE_COLOR.
    // гравировка номера/названия подложкодержателя (см. js/engraving.js
    // computeLayout) — контуры букв уже изогнуты вдоль дуги у края, в
    // координатах диска, командами M/L/Q (Q — настоящая квадратичная кривая,
    // не приближение полигоном — см. pathFromCommands); здесь только
    // неглубокий (HC.ENGRAVE_DEPTH) карман сверху, обычные непересекающиеся
    // контуры (не путать с гантелью — там налегающие кружки ломали
    // триангуляцию, тут дырки — часть буквы).
    function avgRadius(cmds) {
      var sx = 0, sy = 0;
      cmds.forEach(function (c) { sx += c.x; sy += c.y; });
      return Math.hypot(sx / cmds.length, sy / cmds.length);
    }
    var engravingGlyphs = ((model.engraving && model.engraving.glyphs) || []).map(function (gl) {
      return { outer: gl.outer, holes: gl.holes || [] };
    });

    var fixtureCircles = [];
    if (model.fixtures && model.fixtures.holes) {
      model.fixtures.holes.forEach(function (grp) {
        if (grp.countersink) return;
        (grp.points || []).forEach(function (p) {
          if (p.length > 2) return; // составная/глухая посадка — уже в features
          fixtureCircles.push({ cx: p[0], cy: p[1], r: grp.d / 2 });
        });
      });
    }
    // фигурные вырезы болванки — сквозные полигоны (декор). Прореживаем
    // слишком близкие точки (дуги насэмплированы часто) — иначе вырожденные
    // треугольники стенок дают артефакты.
    var fixturePolys = [];
    if (model.fixtures && model.fixtures.cutouts) {
      model.fixtures.cutouts.forEach(function (cut) {
        if (!cut.points || cut.points.length < 3) return;
        var poly = [];
        cut.points.forEach(function (p) {
          var last = poly[poly.length - 1];
          if (!last || Math.hypot(p[0] - last.x, p[1] - last.y) > 0.1) poly.push({ x: p[0], y: p[1] });
        });
        // замыкающая точка, совпавшая с первой, — убрать
        if (poly.length > 3 && Math.hypot(poly[0].x - poly[poly.length - 1].x, poly[0].y - poly[poly.length - 1].y) < 0.1) poly.pop();
        if (poly.length >= 3) fixturePolys.push(poly);
      });
    }
    // крепёж, попадающий внутрь фигурного выреза (болт сквозь «ушко»), отдельно
    // не режем: вырез уже убирает материал, а два налегающих контура в одном
    // ExtrudeGeometry ломают триангуляцию (артефакты, пропажа отверстий)
    if (fixturePolys.length && HC.geom && HC.geom.pointInPoly) {
      fixtureCircles = fixtureCircles.filter(function (fc) {
        return !fixturePolys.some(function (poly) { return HC.geom.pointInPoly(fc.cx, fc.cy, poly); });
      });
    }

    // зенковочные отверстия крепежа (Mounting2 Ø6 с обратной стороны): чтобы тело
    // реально прорезалось, ВРЕЗАЕМ круг в перекрывающий вырез (union) — один
    // контур вместо двух налегающих. Отдельностоящую зенковку режем как отверстие.
    (model.fixtures && model.fixtures.holes || []).forEach(function (grp) {
      if (!grp.countersink) return;
      (grp.points || []).forEach(function (p) {
        var r = grp.d / 2, idx = -1;
        for (var i = 0; i < fixturePolys.length; i++) {
          if (HC.geom.pointInPoly(p[0], p[1], fixturePolys[i])) { idx = i; break; }
        }
        if (idx >= 0) fixturePolys[idx] = unionCirclePoly(p[0], p[1], r, fixturePolys[idx]);
        else fixtureCircles.push({ cx: p[0], cy: p[1], r: r });
      });
    });

    // цепочки пересекающихся кружков (гантельный/keyhole вырез) — схлопнуть
    // в один контур ДО раскладки по слоям (см. groupOverlappingCircles/hullOfCircles).
    var mergedCircles = [];
    groupOverlappingCircles(fixtureCircles).forEach(function (group) {
      if (group.length === 1) mergedCircles.push(group[0]);
      else fixturePolys.push(hullOfCircles(group, 48));
    });
    fixtureCircles = mergedCircles;

    var features = collectFeatures(model).map(function (f) {
      f.depth = Math.min(Math.max(f.depth, 0.3), T);
      f.through = f.depth >= T - eps;
      return f;
    });

    // метки-ориентиры — та же коническая зенковка, что и в STEP-экспорте
    // (см. step-export.js countersink). Сама метка сидит в НЕтронутом
    // материале рядом с посадкой (не внутри её кармана), поэтому декоративный
    // конус-меш ниже (после features.forEach) без РЕАЛЬНОГО отверстия в самом
    // диске был бы полностью скрыт внутри сплошной геометрии — регрессия,
    // пойманная пользователем («не вижу»). Пробиваем настоящую (цилиндрическую,
    // Lite-приближение конуса) дырку в верхнем слое диска, как гравировка.
    var markHalfAngle = (HC.MARK_ANGLE / 2) * Math.PI / 180;
    var markT = Math.tan(markHalfAngle);
    var markRSurf = HC.MARK_D / 2;
    var markDepth = markT > 0 ? markRSurf / markT : 0.5;
    var allMarks = [];
    features.forEach(function (f) { (f.marks || []).forEach(function (m) { allMarks.push(m); }); });

    // Занижение по краю (model.edgeRecess: {side, diameter, depth}) — кольцо
    // снаружи diameter занижено на depth от указанной грани. "Глубина от
    // верха" диапазон занижения: top -> [0, depth], bottom -> [T-depth, T].
    // Реализовано как ЕЩЁ ОДНА граница слоя, у которой радиус диска меньше
    // (innerR вместо R) — соседний слой ниже/выше сохраняет полный R, и его
    // собственная (уже существующая) торцевая крышка ExtrudeGeometry сама
    // становится видимой ступенькой, без отдельной геометрии для неё.
    var edgeRecess = model.edgeRecess && model.edgeRecess.diameter > 0 && model.edgeRecess.depth > 0 ? model.edgeRecess : null;
    var erInnerR = edgeRecess ? edgeRecess.diameter / 2 : 0;
    var erT0 = 0, erT1 = 0;
    if (edgeRecess && erInnerR < R) {
      if (edgeRecess.side === "bottom") { erT0 = Math.max(0, T - edgeRecess.depth); erT1 = T; }
      else { erT0 = 0; erT1 = Math.min(T, edgeRecess.depth); }
    } else {
      edgeRecess = null; // диаметр занижения не меньше диска — некорректно, не строим
    }

    // Гравировка попадает под занижение по краю (top-side edgeRecess) — если
    // буква сидит на радиусе БОЛЬШЕ erInnerR, там уже нет материала в слое
    // [0,erT1] (тот слой урезан до layerR=erInnerR, см. ниже) — вырезать
    // карман от глобального верха (Z=0) означало бы резать «в воздухе» (там,
    // где уже занижено), карман физически не появился бы. Такие буквы режем
    // от ЛОКАЛЬНОЙ поверхности (erT1), а не от Z=0. Отдельно от boundary-side
    // "bottom" — тот низа диска не трогает верхнюю грань, где сидит гравировка.
    var erIsTop = !!(edgeRecess && edgeRecess.side !== "bottom");
    var glyphsAtGlobalTop = [], glyphsInRecessRing = [];
    engravingGlyphs.forEach(function (gl) {
      if (erIsTop && avgRadius(gl.outer) > erInnerR + eps) glyphsInRecessRing.push(gl);
      else glyphsAtGlobalTop.push(gl);
    });

    // границы слоёв: 0, все глубины посадок (включая составные/глухие посадки
    // болванки — они теперь тоже часть features, см. collectFeatures),
    // границы занижения, толщина
    var bounds = [0, T];
    features.forEach(function (f) { if (!f.through) bounds.push(f.depth); });
    if (edgeRecess) { bounds.push(erT0); bounds.push(erT1); }
    if (glyphsAtGlobalTop.length) bounds.push(Math.min(HC.ENGRAVE_DEPTH, T));
    if (glyphsInRecessRing.length) bounds.push(Math.min(erT1 + HC.ENGRAVE_DEPTH, T));
    if (allMarks.length) bounds.push(Math.min(markDepth, T));
    bounds.sort(function (a, b) { return a - b; });
    bounds = bounds.filter(function (v, i, arr) { return i === 0 || v - arr[i - 1] > eps; });

    // DoubleSide — чтобы стенки сквозных отверстий/вырезов были видны и с изнанки
    var discMat = new THREE.MeshStandardMaterial({ color: 0xc9cdd1, metalness: 0.55, roughness: 0.5, side: THREE.DoubleSide });

    for (var i = 0; i + 1 < bounds.length; i++) {
      var t0 = bounds[i], t1 = bounds[i + 1];
      var layerInRecess = edgeRecess && t0 >= erT0 - eps && t1 <= erT1 + eps;
      var layerR = layerInRecess ? erInnerR : R;

      // крепёж, ЧАСТИЧНО пересекающий край именно этого слоя, — реальная
      // выемка в самом контуре (не отдельное "внутреннее" отверстие: полигон,
      // выходящий за границу формы, ломает триангуляцию ExtrudeGeometry —
      // видимого выреза не получается вообще, диск остаётся целым)
      var edgeCircles = fixtureCircles.filter(function (fc) {
        return HC.geom && HC.geom.circleEdgeOverlap && HC.geom.circleEdgeOverlap(layerR, fc.cx, fc.cy, fc.r);
      });
      var interiorCircles = fixtureCircles.filter(function (fc) { return edgeCircles.indexOf(fc) === -1; });
      var clippedBoundary = edgeCircles.length && HC.geom && HC.geom.circleMinusCircles
        ? HC.geom.circleMinusCircles(layerR, edgeCircles.map(function (fc) { return { x: fc.cx, y: fc.cy, r: fc.r }; }))
        : null;
      var shape = toShape(clippedBoundary || circlePoly(0, 0, layerR, 128));

      features.forEach(function (f) {
        if (f.through || f.depth >= t1 - eps) {
          shape.holes.push(toPath(f.outline));            // слой внутри кармана
        } else if (f.ca) {
          shape.holes.push(toPath(caPolyOf(f.ca))); // сквозная CA
        }
      });
      interiorCircles.forEach(function (fc) {
        shape.holes.push(toPath(circlePoly(fc.cx, fc.cy, fc.r, 28))); // крепёж — насквозь
      });
      fixturePolys.forEach(function (poly) {
        shape.holes.push(toPath(poly)); // фигурный вырез — насквозь
      });
      // гравировка — только в неглубоком верхнем слое (0..ENGRAVE_DEPTH).
      // ТОЛЬКО внешний контур буквы, без её собственных дырок («D», «0», «8»
      // и т.п.) — проверено вживую: ExtrudeGeometry/Shape в three.js не
      // поддерживают вложенные дырки-в-дырке (Shape со своими holes,
      // вложенный в holes другого Shape, триангулируется как СПЛОШНОЙ по
      // внешнему контуру — внутренний «остров» буквы теряется, 0 вершин
      // внутри контрольной проверки). Для Lite-приближения это приемлемо
      // (буква без острова-перемычки выглядит чуть иначе, но Lite и так
      // приближение) — настоящий STP-экспорт режет через OC .cut(), там
      // вложенность работает корректно (проверено в scratchpad).
      if (t0 < HC.ENGRAVE_DEPTH - eps) {
        glyphsAtGlobalTop.forEach(function (gl) {
          shape.holes.push(pathFromCommands(gl.outer));
        });
      }
      if (erIsTop && t0 >= erT1 - eps && t0 < erT1 + HC.ENGRAVE_DEPTH - eps) {
        glyphsInRecessRing.forEach(function (gl) {
          shape.holes.push(pathFromCommands(gl.outer));
        });
      }
      // метка-ориентир — маленькая круглая дырка (Lite-приближение конуса
      // цилиндром) в самом верхнем слое, только там, где реально сидит конус
      if (t0 < markDepth - eps) {
        allMarks.forEach(function (m) {
          shape.holes.push(toPath(circlePoly(m.x, m.y, markRSurf, 16)));
        });
      }
      // curveSegments: раньше не имело значения (все контуры — точки через
      // lineTo, без настоящих кривых); теперь буквы гравировки используют
      // quadraticCurveTo (см. pathFromCommands) — увеличено, чтобы дуги букв
      // не тесселировались обратно в гранёные при рендере (на сам диск и его
      // круглые контуры не влияет — они самплированы вручную, lineTo).
      var geo = new THREE.ExtrudeGeometry(shape, { depth: t1 - t0, bevelEnabled: false, curveSegments: 16 });
      var mesh = new THREE.Mesh(geo, discMat);
      mesh.position.z = -t1;
      group.add(mesh);
    }

    // принадлежность отверстия — цветом внутренних стенок counterbore:
    // стенка посадки (с пазом) на глубину, ниже неё — стенка сквозной CA
    var wallMats = {};
    function matFor(color) {
      if (!wallMats[color]) {
        wallMats[color] = new THREE.MeshStandardMaterial({
          color: color, metalness: 0.15, roughness: 0.55, side: THREE.DoubleSide
        });
      }
      return wallMats[color];
    }
    var inset = 0.05; // втягивание цветной стенки внутрь, мм
    features.forEach(function (f) {
      var zSeat = -Math.min(f.depth, T);
      group.add(new THREE.Mesh(wallGeometry(f.outline, 0, zSeat, inset), matFor(f.color)));
      if (!f.through && f.ca) {
        group.add(new THREE.Mesh(
          wallGeometry(caPolyOf(f.ca), zSeat, -T, inset),
          matFor(f.color)
        ));
      }
      if (!f.through) {
        // ступенька — дно посадки: контур посадки с вырезом CA, чуть выше
        // серого дна слоя, чтобы не мерцать
        var floor = toShape(f.outline);
        if (f.ca) floor.holes.push(toPath(caPolyOf(f.ca)));
        var mesh = new THREE.Mesh(new THREE.ShapeGeometry(floor), matFor(f.color));
        mesh.position.z = zSeat + 0.02;
        group.add(mesh);
      }
    });

    // метки-ориентиры деталей (зенковка Ø2мм/90°, см. js/geometry.js
    // HC.MARK_*, константы markHalfAngle/markT/markRSurf/markDepth уже
    // посчитаны выше — там же, где пробита сама дырка) — конус-меш КЛАДЁМ
    // ВНУТРЬ уже пробитой дырки: широкий конец у верхней грани z=0, сужается
    // до точки на глубину markDepth, узкий конец — к −Z (вглубь материала).
    features.forEach(function (f) {
      (f.marks || []).forEach(function (m) {
        var cone = new THREE.CylinderGeometry(markRSurf, 0.02, markDepth, 16, 1, true);
        cone.rotateX(Math.PI / 2); // ось Y → Z: широкий конец (markRSurf) к +Z
        var mesh = new THREE.Mesh(cone, matFor(f.color));
        mesh.position.set(m.x, m.y, -markDepth / 2);
        group.add(mesh);
      });
    });

    // гравировка — цветные стенка+дно кармана (тёмное золото, ENGRAVE_COLOR).
    // Верхняя грань кармана (вырезанная В САМОМ ДИСКЕ, shape.holes.push
    // выше) — ТОЛЬКО внешний контур буквы, без дырок «D»/«0»/«8» (см.
    // пояснение у glyphsAtGlobalTop/glyphsInRecessRing: THREE Shape не
    // поддерживает дырку-в-дырке, когда контур с дыркой сам вкладывается
    // КАК дырка в другой Shape). Но дно/стенка кармана — СВОЙ, ОТДЕЛЬНЫЙ
    // ShapeGeometry (не вложен ни в какой другой Shape) — тут дырка-в-нём
    // самом РАБОТАЕТ нормально (проверено), поэтому здесь дырки буквы
    // ПРАВИЛЬНО вычтены: «O»/«D»/«0»/«8» дно/стенки — кольцом, а не сплошным
    // залитым кругом (регрессия, которую поймал пользователь после первой
    // версии окраски — сплошная заливка «съедала» контррельеф буквы).
    var engraveMat = matFor(ENGRAVE_COLOR);
    function engraveWallAndFloor(gl, topZ) {
      var pts = commandsToPoints(gl.outer);
      if (pts.length < 3) return;
      var botZ = topZ - HC.ENGRAVE_DEPTH;
      group.add(new THREE.Mesh(wallGeometry(pts, topZ, botZ, inset), engraveMat));
      var floorShape = toShape(pts);
      (gl.holes || []).forEach(function (h) {
        var holePts = commandsToPoints(h);
        if (holePts.length < 3) return;
        floorShape.holes.push(toPath(holePts));
        group.add(new THREE.Mesh(wallGeometry(holePts, topZ, botZ, inset), engraveMat));
      });
      var floorMesh = new THREE.Mesh(new THREE.ShapeGeometry(floorShape), engraveMat);
      floorMesh.position.z = botZ + 0.02;
      group.add(floorMesh);
    }
    glyphsAtGlobalTop.forEach(function (gl) { engraveWallAndFloor(gl, 0); });
    if (erIsTop) glyphsInRecessRing.forEach(function (gl) { engraveWallAndFloor(gl, -erT1); });

    // кольцевые канавки маски — тёмная полоса на поверхности (декор). polygonOffset
    // прижимает её к верхней грани без z-файтинга (иначе на большом диске пропадает).
    if (model.fixtures && model.fixtures.grooves) {
      var grMat = new THREE.MeshStandardMaterial({
        color: 0x5f5b54, metalness: 0.4, roughness: 0.85, side: THREE.DoubleSide,
        polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2
      });
      model.fixtures.grooves.forEach(function (gr) {
        var ring = toShape(circlePoly(0, 0, gr.outer / 2, 96));
        ring.holes.push(toPath(circlePoly(0, 0, gr.inner / 2, 96)));
        var m = new THREE.Mesh(new THREE.ShapeGeometry(ring), grMat);
        m.position.z = 0;
        m.renderOrder = 1;
        group.add(m);
      });
    }

    // граница полезной зоны — тонкое зелёное кольцо на поверхности
    if (model.blankDiameter && model.blankDiameter > model.discDiameter + 0.1) {
      var zw = Math.max(0.5, R * 0.004);
      var rz = model.discDiameter / 2;
      var zone = toShape(circlePoly(0, 0, rz + zw, 160));
      zone.holes.push(toPath(circlePoly(0, 0, rz - zw, 160)));
      var zm = new THREE.Mesh(new THREE.ShapeGeometry(zone), new THREE.MeshStandardMaterial({
        color: 0x6f9e6f, metalness: 0.1, roughness: 0.8,
        polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3
      }));
      zm.position.z = 0;
      zm.renderOrder = 2;
      group.add(zm);
    }

    // зенковки крепежа с обратной стороны (напр. Mounting2 Ø6 × 2.5 × 90°) —
    // конус-раструб отдельным мешем: широкий у задней грани (z=-T), сужается
    // внутрь. Отдельный меш не участвует в триангуляции диска (не ломает вырезы).
    if (model.fixtures && model.fixtures.holes) {
      model.fixtures.holes.forEach(function (grp) {
        if (!grp.countersink) return;
        var cs = grp.countersink;
        var rTop = grp.d / 2;
        var half = ((cs.angle || 90) / 2) * Math.PI / 180;
        var rBot = Math.max(0.2, rTop - cs.depth * Math.tan(half)); // 90° → tan45=1
        (grp.points || []).forEach(function (p) {
          var cone = new THREE.CylinderGeometry(rBot, rTop, cs.depth, 28, 1, true);
          cone.rotateX(Math.PI / 2); // ось Y → Z: узкий конец к +Z (вглубь), широкий к задней грани
          var m = new THREE.Mesh(cone, discMat);
          m.position.set(p[0], p[1], -T + cs.depth / 2);
          group.add(m);
        });
      });
    }

    // номера позиций — спрайты над деталями (повёрнуты к камере всегда)
    if (model.showNumbers) {
      (model.placed || []).forEach(function (p, idx) {
        var size = p.type === "circle" ? p.d : Math.min(p.w, p.h);
        var fs2 = Math.max(4, Math.min(R / 9, size * 0.8));
        var spr = numberSprite(String(idx + 1));
        spr.position.set(p.cx, p.cy, 2);
        spr.scale.set(fs2, fs2, 1);
        group.add(spr);
      });
    }
    return group;
  }

  function numberSprite(text) {
    var THREE = g.THREE;
    var c = document.createElement("canvas");
    c.width = c.height = 96;
    var ctx = c.getContext("2d");
    ctx.beginPath();
    ctx.arc(48, 48, 44, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(255,255,255,0.88)";
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = "#5a6470";
    ctx.stroke();
    ctx.fillStyle = "#1a3550";
    ctx.font = "bold " + (text.length > 2 ? 34 : 44) + "px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, 48, 50);
    var tex = new THREE.CanvasTexture(c);
    tex.encoding = THREE.sRGBEncoding;
    return new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false }));
  }

  // Настоящий меш из STEP (см. shape.mesh() в replicad — {vertices, triangles,
  // normals}, тот же формат, что и THREE.BufferGeometry) — для папочных болванок
  // с реальным файлом (app.js refreshBlanks3DFromMesh), вместо приближённой
  // реконструкции слоями (buildGroup). Один меш, один материал — сама STEP-
  // геометрия уже несёт всю форму (посадки/пазы/канавки/фаски), раскрашивать
  // отдельные карманы по принадлежности (как в buildGroup) тут не из чего.
  function buildGroupFromMesh(meshData) {
    var THREE = g.THREE;
    var group = new THREE.Group();
    var geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(meshData.vertices, 3));
    geo.setIndex(Array.prototype.slice.call(meshData.triangles));
    if (meshData.normals && meshData.normals.length) {
      geo.setAttribute("normal", new THREE.Float32BufferAttribute(meshData.normals, 3));
    } else {
      geo.computeVertexNormals();
    }
    var mat = new THREE.MeshStandardMaterial({ color: 0xc9cdd1, metalness: 0.55, roughness: 0.5, side: THREE.DoubleSide });
    group.add(new THREE.Mesh(geo, mat));
    return group;
  }

  // ---------- рендерер, камера, управление ----------

  function initOnce(host) {
    var THREE = g.THREE;
    var renderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    } catch (e) {
      return null; // WebGL недоступен
    }
    renderer.setPixelRatio(Math.min(2, g.devicePixelRatio || 1));
    renderer.outputEncoding = THREE.sRGBEncoding;
    host.appendChild(renderer.domElement);

    var scene = new THREE.Scene();
    scene.add(new THREE.HemisphereLight(0xffffff, 0x50555c, 0.9));
    var sun = new THREE.DirectionalLight(0xffffff, 0.9);
    sun.position.set(150, -220, 320);
    scene.add(sun);
    var back = new THREE.DirectionalLight(0xffffff, 0.25);
    back.position.set(-180, 200, -120);
    scene.add(back);

    var camera = new THREE.PerspectiveCamera(40, 1, 1, 5000);
    camera.up.set(0, 0, 1);

    var s = {
      renderer: renderer, scene: scene, camera: camera, host: host,
      group: null, pending: false,
      // сферические координаты камеры вокруг точки-цели target
      sph: { r: 500, theta: -Math.PI / 2, phi: Math.PI / 4 },
      target: new THREE.Vector3(0, 0, 0),
      rMin: 50, rMax: 2000
    };

    function applyCamera() {
      var q = s.sph, t = s.target;
      camera.position.set(
        t.x + q.r * Math.sin(q.phi) * Math.cos(q.theta),
        t.y + q.r * Math.sin(q.phi) * Math.sin(q.theta),
        t.z + q.r * Math.cos(q.phi)
      );
      camera.lookAt(t.x, t.y, t.z);
    }

    // сдвиг цели в плоскости экрана (панорамирование), dx/dy — в пикселях
    var _r = new THREE.Vector3(), _u = new THREE.Vector3(), _d = new THREE.Vector3();
    function pan(dx, dy) {
      camera.updateMatrixWorld();
      camera.matrixWorld.extractBasis(_r, _u, _d);
      var wpp = 2 * s.sph.r * Math.tan((camera.fov * Math.PI / 180) / 2) / Math.max(1, host.clientHeight);
      s.target.addScaledVector(_r, -dx * wpp);
      s.target.addScaledVector(_u, dy * wpp);
    }
    function requestRender() {
      if (s.pending) return;
      s.pending = true;
      g.requestAnimationFrame(function () {
        s.pending = false;
        applyCamera();
        renderer.render(scene, camera);
      });
    }
    s.requestRender = requestRender;

    function resize() {
      var w = host.clientWidth, h = host.clientHeight;
      if (!w || !h) return;
      renderer.setSize(w, h, false);
      renderer.domElement.style.width = "100%";
      renderer.domElement.style.height = "100%";
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      requestRender();
    }
    s.resize = resize;
    g.addEventListener("resize", resize);

    // управление: левая кнопка — вращение; правая / средняя / Shift+левая —
    // панорамирование; колесо — масштаб; на тач: 1 палец — вращение,
    // 2 пальца — масштаб (пинч) + панорамирование (сдвиг центра пары).
    var el = renderer.domElement;
    el.style.touchAction = "none";
    var drag = null, dragMode = "rotate", pinch = null, panCenter = null, pointers = {};

    function centroid(ids) {
      var sx = 0, sy = 0;
      ids.forEach(function (id) { sx += pointers[id].x; sy += pointers[id].y; });
      return { x: sx / ids.length, y: sy / ids.length };
    }

    el.addEventListener("contextmenu", function (e) { e.preventDefault(); });
    el.addEventListener("pointerdown", function (e) {
      pointers[e.pointerId] = { x: e.clientX, y: e.clientY };
      var ids = Object.keys(pointers);
      if (ids.length === 1) {
        drag = { x: e.clientX, y: e.clientY };
        // правая (2) / средняя (1) кнопка или Shift — панорамирование
        dragMode = (e.button === 2 || e.button === 1 || e.shiftKey) ? "pan" : "rotate";
      } else if (ids.length === 2) {
        drag = null;
        var a = pointers[ids[0]], b = pointers[ids[1]];
        pinch = Math.hypot(a.x - b.x, a.y - b.y);
        panCenter = centroid(ids);
      }
      el.setPointerCapture(e.pointerId);
    });
    el.addEventListener("pointermove", function (e) {
      if (!pointers[e.pointerId]) return;
      pointers[e.pointerId] = { x: e.clientX, y: e.clientY };
      var ids = Object.keys(pointers);
      if (ids.length === 2 && pinch != null) {
        var a = pointers[ids[0]], b = pointers[ids[1]];
        var d2 = Math.hypot(a.x - b.x, a.y - b.y);
        if (d2 > 0) {
          s.sph.r = Math.min(s.rMax, Math.max(s.rMin, s.sph.r * (pinch / d2)));
          pinch = d2;
        }
        var ctr = centroid(ids);
        if (panCenter) pan(ctr.x - panCenter.x, ctr.y - panCenter.y);
        panCenter = ctr;
        requestRender();
      } else if (drag) {
        var dx = e.clientX - drag.x, dy = e.clientY - drag.y;
        if (dragMode === "pan") {
          pan(dx, dy);
        } else {
          s.sph.theta -= dx * 0.008;
          s.sph.phi = Math.min(Math.PI - 0.08, Math.max(0.08, s.sph.phi - dy * 0.008));
        }
        drag = { x: e.clientX, y: e.clientY };
        requestRender();
      }
    });
    function up(e) {
      delete pointers[e.pointerId];
      var ids = Object.keys(pointers);
      pinch = null;
      panCenter = ids.length === 2 ? centroid(ids) : null;
      drag = ids.length === 1 ? { x: pointers[ids[0]].x, y: pointers[ids[0]].y } : null;
    }
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
    el.addEventListener("wheel", function (e) {
      e.preventDefault();
      s.sph.r = Math.min(s.rMax, Math.max(s.rMin, s.sph.r * Math.exp(e.deltaY * 0.001)));
      requestRender();
    }, { passive: false });
    // двойной клик — вернуть центр (сбросить панорамирование)
    el.addEventListener("dblclick", function () {
      s.target.set(0, 0, 0);
      requestRender();
    });

    return s;
  }

  function disposeGroup(group) {
    group.traverse(function (o) {
      if (o.geometry) o.geometry.dispose();
      if (o.material) {
        if (o.material.map) o.material.map.dispose();
        o.material.dispose();
      }
    });
  }

  // Полный снос экземпляра (рендерер + канвас + обработчик resize) — нужен,
  // когда переключаемся на ДРУГОЙ host (другая вкладка со своей 3D-панелью):
  // одиночный `st` был жёстко привязан к самому первому host, куда бы потом
  // ни звали update() — из-за этого во всех вкладках, кроме первой открытой,
  // 3D-панель оставалась пустой (канвас как был приклеен к первому host).
  function disposeInstance(s) {
    g.removeEventListener("resize", s.resize);
    if (s.group) disposeGroup(s.group);
    if (s.renderer.domElement.parentNode) s.renderer.domElement.parentNode.removeChild(s.renderer.domElement);
    s.renderer.dispose();
  }

  HC.viewer3d = {
    available: function () { return typeof g.THREE !== "undefined"; },
    _buildGroup: buildGroup, // для тестов (node, без WebGL)
    _buildGroupFromMesh: buildGroupFromMesh, // для тестов (node, без WebGL)

    // Построить/обновить 3D-вид. host должен быть видим (нужны его размеры).
    update: function (host, model) {
      if (!this.available()) return false;
      if (!st || st.host !== host) {
        if (st) disposeInstance(st);
        st = initOnce(host);
        if (!st) return false;
        // стартовая дистанция — по полному диаметру болванки
        var dia = model.blankDiameter || model.discDiameter;
        st.sph.r = dia * 1.5;
        st.rMin = dia * 0.25;
        st.rMax = dia * 5;
      }
      if (st.group) {
        st.scene.remove(st.group);
        disposeGroup(st.group);
      }
      st.group = buildGroup(model);
      st.scene.add(st.group);
      st.resize();
      st.requestRender();
      return true;
    },

    // То же самое, но из настоящего меша STEP-геометрии (см. buildGroupFromMesh) —
    // стартовая дистанция камеры берётся из bounding-сферы самого меша (диаметр
    // болванки заранее неизвестен, в отличие от model.blankDiameter у update()).
    // Карманы деталей заказа (если есть) уже должны быть вырезаны В САМОМ
    // meshData (см. app.js refresh3DFromMesh/HC.buildOrderMeshFromImported) —
    // здесь просто отображается готовый меш, без декалей поверх.
    updateMesh: function (host, meshData) {
      if (!this.available()) return false;
      var THREE = g.THREE;
      var isNew = !st || st.host !== host;
      if (isNew) {
        if (st) disposeInstance(st);
        st = initOnce(host);
        if (!st) return false;
      }
      if (st.group) {
        st.scene.remove(st.group);
        disposeGroup(st.group);
      }
      st.group = buildGroupFromMesh(meshData);
      st.scene.add(st.group);
      if (isNew) {
        var box = new THREE.Box3().setFromObject(st.group);
        var sphere = box.getBoundingSphere(new THREE.Sphere());
        var dia = sphere && sphere.radius > 0 ? sphere.radius * 2 : 300;
        st.sph.r = dia * 1.5;
        st.rMin = dia * 0.25;
        st.rMax = dia * 5;
      }
      st.resize();
      st.requestRender();
      return true;
    }
  };
})(typeof globalThis !== "undefined" ? globalThis : window);
