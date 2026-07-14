/*
 * packer.js — раскладка деталей на диске.
 *
 * HC.pack(opts) → { placed, perPart }
 *
 * opts = {
 *   discDiameter: мм,
 *   controlHoles: [{x, y, d}],                 — запретные зоны
 *   clearances: { pp, pe, pc },                — деталь–деталь, деталь–край, деталь–КО
 *   parts: [{ type:'circle'|'rect'|'oct', d, w, h, chamfer,
 *             qty: число | null (null = максимум),
 *             orientation: 'fixed' | 'grid' | 'radial-w' | 'radial-h',
 *                 fixed    — без поворота (0°),
 *                 grid     — сетка 0° или 90°, выбирается лучшая,
 *                 radial-w — ширина детали вдоль радиуса диска,
 *                 radial-h — высота детали вдоль радиуса диска,
 *             anchor: { mode:'center'|'edge'|'diameter', d } —
 *                 где размещать при неполном заполнении:
 *                 от центра, от края или вдоль окружности заданного диаметра }]
 * }
 *
 * placed  — [{type, cx, cy, d, w, h, chamfer, rot, partIndex}] в порядке размещения
 * perPart — [{requested: число|null, placed: число}] по индексам opts.parts
 *
 * Подход: кандидатные позиции (гексагональная сетка для кругов, рядная — для
 * прямоугольников/восьмиугольников, концентрические кольца — для радиальной
 * ориентации) с перебором смещений; сортировка кандидатов по anchor задаёт,
 * какие позиции занимать первыми при ограниченном количестве. Разные типы
 * деталей раскладываются последовательно, от крупных к мелким.
 */
(function (g) {
  "use strict";
  var HC = (g.HC = g.HC || {});
  var geom = HC.geom;
  var EPS = 1e-6;

  var OFFSET_STEPS = 5;  // перебор смещений сетки: 5×5 на ориентацию
  var RADIAL_STEPS = 4;  // перебор радиальных смещений колец

  function makePlacement(spec, cx, cy, rot, partIndex) {
    if (spec.type === "circle") {
      return {
        type: "circle", cx: cx, cy: cy, d: spec.d, partIndex: partIndex,
        // посадка/зона напыления/паз — для схемы отображения, на раскладку не влияют;
        // угол паза у каждого экземпляра свой (см. render.js), не общий из формы
        seatD: spec.seatD, apertureCA: spec.apertureCA, slotOn: spec.slotOn
      };
    }
    var p = { type: spec.type, cx: cx, cy: cy, w: spec.w, h: spec.h, rot: rot || 0, partIndex: partIndex };
    if (spec.type === "oct") p.chamfer = spec.chamfer || 0;
    return p;
  }

  // Проверка одного размещения: край диска, контрольные отверстия, уже размещённые детали
  function isValid(pl, ctx) {
    if (geom.edgeDist(pl, ctx.R) < ctx.cl.pe - EPS) return false;
    for (var i = 0; i < ctx.keepouts.length; i++) {
      if (geom.placementDist(pl, ctx.keepouts[i]) < ctx.cl.pc - EPS) return false;
    }
    for (var j = 0; j < ctx.placed.length; j++) {
      if (geom.placementDist(pl, ctx.placed[j]) < ctx.cl.pp - EPS) return false;
    }
    return true;
  }

  // Порядок занятия позиций при неполном заполнении
  function anchorComparator(anchor) {
    var mode = (anchor && anchor.mode) || "center";
    function r2(p) { return p.cx * p.cx + p.cy * p.cy; }
    if (mode === "edge") {
      return function (p, q) { return r2(q) - r2(p); };
    }
    if (mode === "diameter") {
      var t = ((anchor && anchor.d) || 0) / 2;
      return function (p, q) {
        return Math.abs(Math.sqrt(r2(p)) - t) - Math.abs(Math.sqrt(r2(q)) - t);
      };
    }
    return function (p, q) { return r2(p) - r2(q); };
  }

  // Гексагональная сетка центров для кругов
  function circleCandidates(spec, ctx, offX, offY) {
    var pitch = spec.d + ctx.cl.pp;
    var rowH = (pitch * Math.sqrt(3)) / 2;
    var Rc = ctx.R - ctx.cl.pe - spec.d / 2; // максимальный радиус центра
    if (Rc < -EPS) return [];
    var out = [];
    var jMax = Math.ceil((Rc + rowH) / rowH);
    var iMax = Math.ceil((Rc + pitch) / pitch);
    for (var j = -jMax; j <= jMax; j++) {
      var y = j * rowH + offY;
      var xShift = (j % 2 === 0) ? 0 : pitch / 2;
      for (var i = -iMax; i <= iMax; i++) {
        var x = i * pitch + xShift + offX;
        if (x * x + y * y <= (Rc + EPS) * (Rc + EPS)) out.push({ cx: x, cy: y, rot: 0 });
      }
    }
    return out;
  }

  // Рядная сетка для прямоугольников/восьмиугольников (одна ориентация)
  function gridCandidates(spec, ctx, rot, offX, offY) {
    var swap = ((rot % 180) + 180) % 180 === 90;
    var w = swap ? spec.h : spec.w;
    var h = swap ? spec.w : spec.h;
    var px = w + ctx.cl.pp;
    var py = h + ctx.cl.pp;
    var Rc = ctx.R - ctx.cl.pe; // грубая граница; точная проверка в isValid по вершинам
    var out = [];
    var iMax = Math.ceil(Rc / px) + 1;
    var jMax = Math.ceil(Rc / py) + 1;
    for (var j = -jMax; j <= jMax; j++) {
      for (var i = -iMax; i <= iMax; i++) {
        out.push({ cx: i * px + offX, cy: j * py + offY, rot: rot });
      }
    }
    return out;
  }

  // Сеточная раскладка (fixed / grid): перебор ориентаций и смещений.
  // Шаг сетки равен размеру детали + зазор, поэтому позиции одной сетки
  // гарантированно совместимы между собой — самопроверка не нужна.
  function gridLayout(spec, ctx) {
    var rotations;
    if (spec.type === "circle") rotations = [0];
    else if (spec.orientation === "grid") rotations = [0, 90];
    else rotations = [0];

    var best = { count: -1, list: [] };
    for (var r = 0; r < rotations.length; r++) {
      var rot = rotations[r];
      var pitchX, pitchY;
      if (spec.type === "circle") {
        pitchX = spec.d + ctx.cl.pp;
        pitchY = ((spec.d + ctx.cl.pp) * Math.sqrt(3)) / 2;
      } else {
        var swap = rot === 90;
        pitchX = (swap ? spec.h : spec.w) + ctx.cl.pp;
        pitchY = (swap ? spec.w : spec.h) + ctx.cl.pp;
      }
      for (var a = 0; a < OFFSET_STEPS; a++) {
        for (var b = 0; b < OFFSET_STEPS; b++) {
          var offX = (a / OFFSET_STEPS) * pitchX;
          var offY = (b / OFFSET_STEPS) * pitchY;
          var cands = spec.type === "circle"
            ? circleCandidates(spec, ctx, offX, offY)
            : gridCandidates(spec, ctx, rot, offX, offY);
          var valid = [];
          for (var k = 0; k < cands.length; k++) {
            var pl = makePlacement(spec, cands[k].cx, cands[k].cy, cands[k].rot, spec.partIndex);
            if (isValid(pl, ctx)) valid.push(pl);
          }
          if (valid.length > best.count) best = { count: valid.length, list: valid };
        }
      }
    }
    best.list.sort(anchorComparator(spec.anchor));
    return best.list;
  }

  // Радиальная раскладка: концентрические кольца, каждая деталь повёрнута так,
  // что её ось (ширина или высота) идёт вдоль радиуса. Углы поворота у соседних
  // деталей различаются, поэтому совместимость проверяется точной геометрией.
  // Точки на концентрических кольцах с равным угловым шагом на каждом кольце.
  // rFrom — радиус первого кольца, step — шаг между кольцами и (примерно)
  // минимальное расстояние между кольцами; tangStep — тангенциальный шаг
  // (минимальное расстояние между соседними деталями на одном кольце).
  function ringCandidates(rFrom, rMax, step, tangStep, extraRot) {
    var rings = [];
    for (var r = rFrom; r <= rMax + EPS; r += step) {
      var n = Math.max(1, Math.floor((2 * Math.PI * Math.max(r, EPS)) / tangStep));
      var pts = [];
      for (var i = 0; i < n; i++) {
        var th = (2 * Math.PI * i) / n;
        pts.push({ cx: r * Math.cos(th), cy: r * Math.sin(th), rot: (th * 180) / Math.PI + (extraRot || 0) });
      }
      rings.push({ r: r, pts: pts });
    }
    return rings;
  }

  // Равномерная выборка k элементов массива по индексу (не подряд).
  // Нужна, когда на кольце помещается больше деталей, чем требуется: если
  // просто брать первые k, результат зависит от порядка перебора (по сути —
  // от шума плавающей точки при сравнении «одинаковых» радиусов) и детали
  // могут собраться в одном секторе кольца вместо равномерного распределения.
  function pickEven(arr, k) {
    if (k <= 0) return [];
    if (k >= arr.length) return arr.slice();
    var out = [];
    for (var i = 0; i < k; i++) out.push(arr[Math.floor((i * arr.length) / k)]);
    return out;
  }

  // Числовая «стоимость» радиуса кольца для anchor: меньше — приоритетнее.
  function anchorRadiusCost(anchor) {
    var mode = (anchor && anchor.mode) || "center";
    if (mode === "edge") return function (r) { return -r; };
    if (mode === "diameter") {
      var t = ((anchor && anchor.d) || 0) / 2;
      return function (r) { return Math.abs(r - t); };
    }
    return function (r) { return r; };
  }

  // Заполняет кольца в порядке приоритета anchor; при нехватке места на
  // кольце берёт равномерное подмножество (pickEven), а не «первые попавшиеся».
  function fillRings(rings, spec, ctx, makePl) {
    var costOf = anchorRadiusCost(spec.anchor);
    rings = rings.slice().sort(function (a, b) { return costOf(a.r) - costOf(b.r); });
    var acc = [];
    var needed = spec.qty == null ? Infinity : spec.qty;
    for (var ri = 0; ri < rings.length && acc.length < needed; ri++) {
      var validPts = [];
      for (var pi = 0; pi < rings[ri].pts.length; pi++) {
        var pl = makePl(rings[ri].pts[pi]);
        if (!isValid(pl, ctx)) continue;
        var okSelf = true;
        for (var m = 0; m < acc.length; m++) {
          if (geom.placementDist(pl, acc[m]) < ctx.cl.pp - EPS) { okSelf = false; break; }
        }
        // шаг по дуге на кольце — приближение, не гарантия: для длинных
        // деталей у малого радиуса «спицы» могут пересекаться ближе к центру
        // даже при верной тангенциальной раскладке — проверяем и внутри кольца
        if (okSelf) {
          for (var m2 = 0; m2 < validPts.length; m2++) {
            if (geom.placementDist(pl, validPts[m2]) < ctx.cl.pp - EPS) { okSelf = false; break; }
          }
        }
        if (okSelf) validPts.push(pl);
      }
      var remain = needed === Infinity ? validPts.length : needed - acc.length;
      var take = remain >= validPts.length ? validPts : pickEven(validPts, Math.floor(remain));
      for (var t = 0; t < take.length; t++) acc.push(take[t]);
    }
    return acc;
  }

  // Выбор лучшей из нескольких попыток (разных фаз/смещений колец).
  // В приоритете число реально используемых деталей (min(qty, acc.length));
  // при равенстве — насколько хорошо ИМЕННО ИСПОЛЬЗУЕМЫЕ детали соответствуют
  // anchor (средняя «стоимость» их радиуса: без этого критерия, например,
  // «по диаметру» может быть выбрано смещение с кольцом дальше от цели —
  // просто потому что оно даёт чуть больше запасных колец за пределами
  // фактически нужного количества); при полном равенстве — общая ёмкость
  // попытки про запас.
  function pickBestAttempt(attempts, spec) {
    var costOf = anchorRadiusCost(spec.anchor);
    var best = null;
    for (var i = 0; i < attempts.length; i++) {
      var acc = attempts[i];
      var take = spec.qty == null ? acc.length : Math.min(spec.qty, acc.length);
      var avg = 0;
      for (var k = 0; k < take; k++) avg += costOf(Math.hypot(acc[k].cx, acc[k].cy));
      if (take) avg /= take;
      if (best === null ||
          take > best.take ||
          (take === best.take && avg < best.avg - EPS) ||
          (take === best.take && Math.abs(avg - best.avg) <= EPS && acc.length > best.acc.length)) {
        best = { acc: acc, take: take, avg: avg };
      }
    }
    return best ? best.acc : [];
  }

  // Радиальная раскладка прямоугольников/восьмиугольников: концентрические
  // кольца, каждая деталь повёрнута так, что её ширина или высота идёт
  // вдоль радиуса.
  function radialLayout(spec, ctx) {
    var alongWidth = spec.orientation === "radial-w";
    var radExt = alongWidth ? spec.w : spec.h;   // размер вдоль радиуса
    var tangExt = alongWidth ? spec.h : spec.w;  // размер поперёк радиуса
    var step = radExt + ctx.cl.pp;
    var rMax = ctx.R - ctx.cl.pe - radExt / 2;
    if (rMax < -EPS) return [];

    var attempts = [];
    for (var o = 0; o < RADIAL_STEPS; o++) {
      var rFrom = radExt / 2 + (o / RADIAL_STEPS) * step;
      var rings = ringCandidates(rFrom, rMax, step, tangExt + ctx.cl.pp, alongWidth ? 0 : 90);
      attempts.push(fillRings(rings, spec, ctx, function (cand) {
        return makePlacement(spec, cand.cx, cand.cy, cand.rot, spec.partIndex);
      }));
    }
    return pickBestAttempt(attempts, spec);
  }

  // Кольцевая раскладка кругов для расположения «от края» / «по диаметру».
  // Гекс-сетка не имеет кругового распределения по углу: подбор её узлов,
  // ближайших к краю или к заданному диаметру, собирает точки, ближайшие
  // друг к другу в решётке, — они образуют клин в одном секторе, а не кольцо
  // по всей окружности.
  function circleRingLayout(spec, ctx) {
    var step = spec.d + ctx.cl.pp;
    var rMax = ctx.R - ctx.cl.pe - spec.d / 2;
    if (rMax < -EPS) return [];

    var attempts = [];
    for (var o = 0; o < RADIAL_STEPS; o++) {
      var phase = (o / RADIAL_STEPS) * step;
      var rings = ringCandidates(phase, rMax, step, step, 0);
      attempts.push(fillRings(rings, spec, ctx, function (cand) {
        return {
          type: "circle", cx: cand.cx, cy: cand.cy, d: spec.d, partIndex: spec.partIndex,
          seatD: spec.seatD, apertureCA: spec.apertureCA, slotOn: spec.slotOn
        };
      }));
    }
    return pickBestAttempt(attempts, spec);
  }

  function layoutForSpec(spec, ctx) {
    if (spec.type !== "circle" &&
        (spec.orientation === "radial-w" || spec.orientation === "radial-h")) {
      return radialLayout(spec, ctx);
    }
    if (spec.type === "circle" && spec.qty != null && spec.anchor &&
        (spec.anchor.mode === "edge" || spec.anchor.mode === "diameter")) {
      return circleRingLayout(spec, ctx);
    }
    return gridLayout(spec, ctx);
  }

  HC.pack = function (opts) {
    var ctx = {
      R: opts.discDiameter / 2,
      cl: {
        pp: opts.clearances.pp,
        pe: opts.clearances.pe,
        pc: opts.clearances.pc
      },
      keepouts: (opts.controlHoles || []).map(function (h) {
        // занятая зона контрольного отверстия — Ø посадки, если задан
        return { type: "circle", cx: h.x, cy: h.y, d: h.seatD != null ? h.seatD : h.d };
      }),
      placed: []
    };

    // порядок обработки: от крупных к мелким (жадная стратегия)
    var order = opts.parts.map(function (spec, i) {
      var area = spec.type === "circle"
        ? (Math.PI * spec.d * spec.d) / 4
        : spec.w * spec.h;
      return { spec: spec, index: i, area: area };
    });
    order.sort(function (a, b) { return b.area - a.area; });

    var perPart = opts.parts.map(function (spec) {
      return { requested: spec.qty == null ? null : spec.qty, placed: 0 };
    });

    for (var s = 0; s < order.length; s++) {
      var spec = Object.assign({}, order[s].spec, { partIndex: order[s].index });
      // совместимость со старым полем allowRotate
      if (!spec.orientation) {
        spec.orientation = spec.type !== "circle" && spec.allowRotate ? "grid" : "fixed";
      }
      if (!spec.anchor) spec.anchor = { mode: "center" };
      var list = layoutForSpec(spec, ctx);
      var take = spec.qty == null ? list.length : Math.min(spec.qty, list.length);
      for (var k = 0; k < take; k++) ctx.placed.push(list[k]);
      perPart[order[s].index].placed = take;
    }

    // стабильный порядок вывода: по номеру детали в форме, затем от центра
    ctx.placed.sort(function (a, b) {
      if (a.partIndex !== b.partIndex) return a.partIndex - b.partIndex;
      return (a.cx * a.cx + a.cy * a.cy) - (b.cx * b.cx + b.cy * b.cy);
    });

    return { placed: ctx.placed, perPart: perPart };
  };
})(typeof globalThis !== "undefined" ? globalThis : window);
