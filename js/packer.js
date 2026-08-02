/*
 * packer.js — раскладка деталей на диске.
 *
 * HC.pack(opts) → { placed, perPart }
 *
 * opts = {
 *   discDiameter: мм,
 *   controlHoles: [{x, y, d}],                 — запретные зоны
 *   fixtureHoles: [{x, y, d}],                  — крепёжные/тех. отверстия болванки — тоже запретные зоны
 *   clearances: { pp, pe, pc },                — деталь–деталь, деталь–край, деталь–КО
 *   parts: [{ type:'circle'|'rect'|'oct'|'oval', d, w, h, chamfer,
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

  // Запас на паз под пинцет: насколько его торец выступает за контур ДЕТАЛИ
  // (паз считается от посадки и торчит на 2.5 мм за неё). Учитывается в раскладке
  // изотропно (в любую сторону) — так гарантируется зазор между пазами соседей.
  // Не используется для круглых деталей в обычной гекс-сетке (см. ниже) — там
  // угол паза известен заранее, и вместо запаса берётся точная геометрия.
  function slotPad(spec) {
    if (!spec.slotOn) return 0;
    if (spec.type === "circle") {
      var seat = spec.seatD > 0 ? spec.seatD : spec.d;
      return Math.max(0, (seat - spec.d) / 2) + 2.5;
    }
    return (spec.seatGap > 0 ? spec.seatGap : 0) + 2.5;
  }

  // Точный шаг гекс-сетки для круглых деталей с пазом: угол паза у всех
  // экземпляров одинаков (вертикаль — высота равностороннего треугольника
  // сетки, см. makePlacement), поэтому вместо изотропного запаса на все
  // стороны считаем минимальный шаг, при котором зазор pp выдержан по всем
  // 6 направлениям соседей. По симметрии контура «посадка+паз» различны
  // только 2 направления: вдоль ряда (0° — паз перпендикулярен, не влияет,
  // шаг = seatD+pp точно) и по диагонали между рядами (60° — паз частично
  // выступает навстречу) — решается бинарным поиском по настоящему контуру
  // (приближённая формула «сумма радиусов» на этой форме на диагонали слегка
  // занижает реальный зазор — проверено численно, отсюда точный поиск + запас
  // 0.03 мм на дискретизацию контура при переборе).
  // Мемоизация: один и тот же (seatD, pp) запрашивается по многу раз за один
  // HC.pack() (на каждую из 5×5 фаз смещения сетки) — бинарный поиск считаем
  // один раз, а не на каждую фазу.
  var hexPitchCache = {};
  function hexSlotPitch(seatD, pp) {
    var key = seatD + "|" + pp;
    if (hexPitchCache[key] != null) return hexPitchCache[key];
    var n = 192, target = pp + 0.03;
    var A = geom.seatOutline(0, 0, seatD, true, Math.PI / 2, n); // неподвижный контур — считаем один раз
    function gapAt(pitch) {
      var B = geom.seatOutline(pitch * Math.cos(Math.PI / 3), pitch * Math.sin(Math.PI / 3), seatD, true, Math.PI / 2, n);
      return geom.polyPolyDist(A, B);
    }
    var lo = seatD * 0.3, hi = seatD * 3;
    for (var it = 0; it < 40; it++) {
      var mid = (lo + hi) / 2;
      if (gapAt(mid) < target) lo = mid; else hi = mid;
    }
    var pitch = Math.max(seatD + pp, hi); // hi — диагональ; seatD+pp — вдоль ряда (точно, паз туда не тянется)
    hexPitchCache[key] = pitch;
    return pitch;
  }

  function makePlacement(spec, cx, cy, rot, partIndex) {
    if (spec.type === "circle") {
      var pl = {
        type: "circle", cx: cx, cy: cy, d: spec.d, partIndex: partIndex, pad: spec._pad || 0,
        // посадка/зона напыления/паз — для схемы отображения, на раскладку не влияют.
        // Паз направлен по высоте равностороннего треугольника гекс-сетки: ряды
        // горизонтальные, значит высота — вертикаль (90°), пазы у всех параллельны.
        seatD: spec.seatD, apertureCA: spec.apertureCA, slotOn: spec.slotOn, slotAngle: 90
      };
      if (spec.slotOn) {
        // точный контур «посадка+паз» при известном угле — реальная занятая
        // зона для проверки зазоров (заменяет изотропный запас, см. выше)
        var seat = spec.seatD > 0 ? spec.seatD : spec.d;
        pl._outline = geom.seatOutline(cx, cy, seat, true, Math.PI / 2, 64);
      }
      return pl;
    }
    var p = { type: spec.type, cx: cx, cy: cy, w: spec.w, h: spec.h, rot: rot || 0, partIndex: partIndex, pad: spec._pad || 0 };
    if (spec.type === "oct") p.chamfer = spec.chamfer || 0;
    // посадка/зона напыления/паз — только для схемы отображения (2D/3D), на раскладку
    // не влияют; угол паза у каждого экземпляра берётся из формы (+ поворот детали)
    p.seatGap = spec.seatGap;
    p.caInset = spec.caInset;
    p.slotOn = spec.slotOn;
    p.slotAngle = spec.slotAngle;
    return p;
  }

  // Проверка одного размещения: край диска, контрольные отверстия, уже размещённые детали
  function isValid(pl, ctx) {
    var pad = pl.pad || 0;
    if (geom.edgeDist(pl, ctx.R) < ctx.cl.pe + pad - EPS) return false;
    for (var i = 0; i < ctx.keepouts.length; i++) {
      if (geom.placementDist(pl, ctx.keepouts[i]) < ctx.cl.pc + pad + (ctx.keepouts[i].pad || 0) - EPS) return false;
    }
    for (var j = 0; j < ctx.placed.length; j++) {
      if (geom.placementDist(pl, ctx.placed[j]) < ctx.cl.pp + pad + (ctx.placed[j].pad || 0) - EPS) return false;
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
    var pad = spec._pad || 0;
    var seat = spec.seatD > 0 ? spec.seatD : spec.d;
    var pitch = spec.slotOn ? hexSlotPitch(seat, ctx.cl.pp) : (spec.d + ctx.cl.pp + 2 * pad);
    var rowH = (pitch * Math.sqrt(3)) / 2;
    var Rc = ctx.R - ctx.cl.pe - spec.d / 2 - pad; // максимальный радиус центра
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
    var pad = spec._pad || 0;
    var px = w + ctx.cl.pp + 2 * pad;
    var py = h + ctx.cl.pp + 2 * pad;
    var Rc = ctx.R - ctx.cl.pe - pad; // грубая граница; точная проверка в isValid по вершинам
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
      var pad = spec._pad || 0;
      var pitchX, pitchY;
      if (spec.type === "circle") {
        var seat = spec.seatD > 0 ? spec.seatD : spec.d;
        pitchX = spec.slotOn ? hexSlotPitch(seat, ctx.cl.pp) : (spec.d + ctx.cl.pp + 2 * pad);
        pitchY = (pitchX * Math.sqrt(3)) / 2;
      } else {
        var swap = rot === 90;
        pitchX = (swap ? spec.h : spec.w) + ctx.cl.pp + 2 * pad;
        pitchY = (swap ? spec.w : spec.h) + ctx.cl.pp + 2 * pad;
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
        var padPl = pl.pad || 0;
        for (var m = 0; m < acc.length; m++) {
          if (geom.placementDist(pl, acc[m]) < ctx.cl.pp + padPl + (acc[m].pad || 0) - EPS) { okSelf = false; break; }
        }
        // шаг по дуге на кольце — приближение, не гарантия: для длинных
        // деталей у малого радиуса «спицы» могут пересекаться ближе к центру
        // даже при верной тангенциальной раскладке — проверяем и внутри кольца
        if (okSelf) {
          for (var m2 = 0; m2 < validPts.length; m2++) {
            if (geom.placementDist(pl, validPts[m2]) < ctx.cl.pp + padPl + (validPts[m2].pad || 0) - EPS) { okSelf = false; break; }
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

  // Наибольший угловой разрыв между соседними деталями (по углу их центров
  // от центра диска), радианы. Метрика равномерности распределения по кольцу:
  // маленький разрыв — детали идут равномерно по всей окружности; большой —
  // скучены с одной стороны (напр., там, где не мешают контрольные отверстия).
  function angleSpread(acc) {
    if (acc.length < 2) return 0;
    var angs = acc.map(function (p) { return Math.atan2(p.cy, p.cx); }).sort(function (a, b) { return a - b; });
    var maxGap = 0;
    for (var i = 0; i < angs.length; i++) {
      var next = i + 1 < angs.length ? angs[i + 1] : angs[0] + 2 * Math.PI;
      maxGap = Math.max(maxGap, next - angs[i]);
    }
    return maxGap;
  }

  // Выбор лучшей из нескольких попыток (разных фаз/смещений/поворотов колец).
  // В приоритете число реально используемых деталей (min(qty, acc.length));
  // при равенстве — насколько хорошо ИМЕННО ИСПОЛЬЗУЕМЫЕ детали соответствуют
  // anchor (средняя «стоимость» их радиуса: без этого критерия, например,
  // «по диаметру» может быть выбрано смещение с кольцом дальше от цели —
  // просто потому что оно даёт чуть больше запасных колец за пределами
  // фактически нужного количества); при равенстве и этого — равномерность
  // углового распределения (меньше максимальный разрыв между соседями:
  // иначе при неполном заполнении, когда часть узлов решётки выбивают
  // контрольные отверстия, оставшиеся детали могут скучиться на одной
  // стороне вместо равномерного разброса по свободной дуге); при полном
  // равенстве — общая ёмкость попытки про запас.
  function pickBestAttempt(attempts, spec) {
    var costOf = anchorRadiusCost(spec.anchor);
    var best = null;
    for (var i = 0; i < attempts.length; i++) {
      var acc = attempts[i];
      var take = spec.qty == null ? acc.length : Math.min(spec.qty, acc.length);
      var used = take < acc.length ? acc.slice(0, take) : acc;
      var avg = 0;
      for (var k = 0; k < take; k++) avg += costOf(Math.hypot(acc[k].cx, acc[k].cy));
      if (take) avg /= take;
      var spread = angleSpread(used);
      if (best === null ||
          take > best.take ||
          (take === best.take && avg < best.avg - EPS) ||
          (take === best.take && Math.abs(avg - best.avg) <= EPS && spread < best.spread - EPS) ||
          (take === best.take && Math.abs(avg - best.avg) <= EPS && Math.abs(spread - best.spread) <= EPS && acc.length > best.acc.length)) {
        best = { acc: acc, take: take, avg: avg, spread: spread };
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
    var pad = spec._pad || 0;
    var step = radExt + ctx.cl.pp + 2 * pad;
    var rMax = ctx.R - ctx.cl.pe - radExt / 2 - pad;
    if (rMax < -EPS) return [];

    var attempts = [];
    for (var o = 0; o < RADIAL_STEPS; o++) {
      var rFrom = radExt / 2 + pad + (o / RADIAL_STEPS) * step;
      var rings = ringCandidates(rFrom, rMax, step, tangExt + ctx.cl.pp + 2 * pad, alongWidth ? 0 : 90);
      attempts.push(fillRings(rings, spec, ctx, function (cand) {
        return makePlacement(spec, cand.cx, cand.cy, cand.rot, spec.partIndex);
      }));
    }
    return pickBestAttempt(attempts, spec);
  }

  // Кольцевая раскладка кругов для расположения «от края» / «по диаметру».
  // Гекс-сетка не имеет кругового распределения по углу. Вместо жёсткой
  // угловой решётки (её узлы может выбить контрольное отверстие целиком —
  // соседние точки решётки скучиваются на одной стороне, оставляя большой
  // разрыв там, где решётку «съело») ищем на целевом радиусе реально
  // свободные дуги (сэмплированием по краю диска и контрольным отверстиям)
  // и распределяем детали РАВНОМЕРНО именно по ним.
  function circleRingLayout(spec, ctx) {
    var pad = spec._pad || 0;
    var tangStep = spec.d + ctx.cl.pp + 2 * pad; // мин. хорда между соседями на кольце
    var rMax = ctx.R - ctx.cl.pe - spec.d / 2 - pad;
    if (rMax < -EPS) return [];

    function makePl(cx, cy) {
      return {
        type: "circle", cx: cx, cy: cy, d: spec.d, partIndex: spec.partIndex, pad: pad,
        // на кольцах паз направлен радиально (от центра диска)
        seatD: spec.seatD, apertureCA: spec.apertureCA, slotOn: spec.slotOn,
        slotAngle: (Math.atan2(cy, cx) * 180) / Math.PI
      };
    }

    // Свободные (по краю + контрольным отверстиям, БЕЗ учёта других деталей
    // этого же кольца — та проверка отдельно, при расстановке) угловые дуги
    // на кольце радиуса r; сэмплирование, т.к. форма запретных зон произвольна.
    function freeArcs(r) {
      var N = 720; // шаг 0.5°
      var free = new Array(N);
      for (var i = 0; i < N; i++) {
        var th = (i / N) * 2 * Math.PI;
        var pl = makePl(r * Math.cos(th), r * Math.sin(th));
        var ok = geom.edgeDist(pl, ctx.R) >= ctx.cl.pe + pad - EPS;
        if (ok) {
          for (var k = 0; k < ctx.keepouts.length; k++) {
            if (geom.placementDist(pl, ctx.keepouts[k]) < ctx.cl.pc + pad + (ctx.keepouts[k].pad || 0) - EPS) { ok = false; break; }
          }
        }
        free[i] = ok;
      }
      if (free.every(function (v) { return v; })) return [{ a0: 0, a1: 2 * Math.PI }];
      if (free.every(function (v) { return !v; })) return [];
      var i0 = 0; // ищем «восход» (был занят — стал свободен), чтобы не резать дугу через 0°
      while (!(!free[(i0 - 1 + N) % N] && free[i0])) i0++;
      var arcs = [], i = i0, seen = 0;
      while (seen < N) {
        if (free[i % N]) {
          var start = i;
          while (seen < N && free[i % N]) { i++; seen++; }
          arcs.push({ a0: (start / N) * 2 * Math.PI, a1: (i / N) * 2 * Math.PI });
        } else { i++; seen++; }
      }
      return arcs;
    }

    // Каждая свободная дуга упаковывается НА МАКСИМУМ независимо: k точек с
    // шагом РОВНО minStep (k = floor(w/minStep)+1 — «плюс один», т.к. k точек
    // образуют k-1 шагов, а не k), излишек (w−(k−1)·minStep) — поровну на оба
    // края дуги, чтобы результат был симметричным, а не только с одного края.
    // Раньше применялся ОБЩИЙ на всё кольцо шаг («сшитые» дуги делятся на n
    // равных частей) — это давало ровный вид, но заведомо меньше реальной
    // ёмкости: узкая дуга получала на 1 деталь меньше, чем в неё физически
    // влезает (напр. карман 25° при шаге 16.2° реально вмещает 2, а не 1 —
    // подтверждено сравнением с раскладкой в Inventor).
    function packRegion(a, minStep) {
      var w = a.a1 - a.a0;
      if (w <= EPS) return [];
      var k = Math.floor(w / minStep) + 1;
      var span = (k - 1) * minStep;
      var margin = Math.max(0, (w - span) / 2);
      var pts = [];
      for (var i = 0; i < k; i++) pts.push(a.a0 + margin + i * minStep);
      return pts;
    }

    var mode = (spec.anchor && spec.anchor.mode) || "center";
    var r = mode === "edge"
      ? rMax // «от края» — однозначно предел минимального зазора
      : Math.min(Math.max(((spec.anchor && spec.anchor.d) || 0) / 2, spec.d / 2 + pad), rMax); // «по диаметру»

    var arcs = freeArcs(r);
    // угол, дающий ровно хорду tangStep: chord = 2r·sin(θ/2) ⇒ θ = 2·asin(tangStep/2r).
    // (tangStep/r — приближение для малых углов — даёт хорду МЕНЬШЕ требуемой при
    // больших шагах, из-за чего каждая вторая точка отбраковывалась самопроверкой.)
    var minStep = 2 * Math.asin(Math.min(1, tangStep / (2 * Math.max(r, EPS))));
    var perRegion = arcs.map(function (a) { return packRegion(a, minStep); });
    var totalCap = perRegion.reduce(function (s, p) { return s + p.length; }, 0);

    var angles;
    if (spec.qty == null || totalCap <= spec.qty) {
      // мест не больше, чем нужно (обычный случай — qty превышает то, что
      // вообще может влезть) — используем все точки максимальной ёмкости
      angles = [].concat.apply([], perRegion);
    } else {
      // деталей нужно МЕНЬШЕ, чем максимально возможно — берём часть
      // пропорционально ёмкости дуг (largest remainder method), внутри
      // дуги — равномерно с равным отступом от обоих краёв (не впритык)
      var caps = perRegion.map(function (p) { return p.length; });
      var raw = caps.map(function (c) { return (c / totalCap) * spec.qty; });
      var alloc = raw.map(Math.floor);
      var used = alloc.reduce(function (s, x) { return s + x; }, 0);
      var order = raw.map(function (rv, i) { return { i: i, frac: rv - alloc[i] }; }).sort(function (x, y) { return y.frac - x.frac; });
      for (var idx = 0; used < spec.qty && idx < order.length; idx++, used++) alloc[order[idx].i]++;
      angles = [];
      arcs.forEach(function (a, ai) {
        var k = Math.min(alloc[ai], caps[ai]);
        if (k <= 0) return;
        var w = a.a1 - a.a0;
        for (var m = 0; m < k; m++) angles.push(a.a0 + (w * (m + 0.5)) / k);
      });
    }

    var acc = [];
    angles.forEach(function (th) {
      var pl = makePl(r * Math.cos(th), r * Math.sin(th));
      if (!isValid(pl, ctx)) return; // сэмплирование дуг — приближение; здесь точная проверка
      for (var m = 0; m < acc.length; m++) {
        if (geom.placementDist(pl, acc[m]) < ctx.cl.pp + pad + (acc[m].pad || 0) - EPS) return;
      }
      acc.push(pl);
    });
    return acc;
  }

  // «Максимум» для круга: одно кольцо не всегда выгоднее гекс-сетки по всей
  // площади (и наоборот — для немногих крупных деталей у края точный ряд по
  // кольцу нередко вмещает больше, чем сетка с её фиксированным шагом, см.
  // фикс минШага выше). Раз цель — максимум, а не конкретное количество,
  // считаем ОБА варианта и берём тот, где деталей больше — НЕЗАВИСИМО от
  // выбранного anchor (по умолчанию anchor «от центра», но кольцевой
  // конкурент всё равно должен быть посчитан, иначе сравнение никогда не
  // сработает без ручного переключения на «от края»). Если anchor — «по
  // диаметру», кольцо считаем на этом диаметре, иначе (center/edge) — «от
  // края» (rMax), это и есть «по внешнему контуру». Каждый вариант — со
  // СВОИМ запасом на паз: у сетки при пазе запас 0 (угол паза известен
  // заранее, зазор — по точному контуру), у кольца — изотропный (угол паза
  // на кольце радиальный, разный у каждой позиции, см. circleRingLayout).
  function circleLayoutAuto(spec, ctx) {
    var ringAnchor = spec.anchor && spec.anchor.mode === "diameter" ? spec.anchor : { mode: "edge" };
    var ringSpec = Object.assign({}, spec, { anchor: ringAnchor, _pad: slotPad(spec) });
    var ringList = circleRingLayout(ringSpec, ctx);
    var hexSpec = Object.assign({}, spec, { _pad: spec.slotOn ? 0 : slotPad(spec) });
    var hexList = gridLayout(hexSpec, ctx);
    return hexList.length > ringList.length ? hexList : ringList;
  }

  function layoutForSpec(spec, ctx) {
    if (spec.type !== "circle" &&
        (spec.orientation === "radial-w" || spec.orientation === "radial-h")) {
      return radialLayout(spec, ctx);
    }
    if (spec.type === "circle" && spec.qty == null) {
      return circleLayoutAuto(spec, ctx);
    }
    if (spec.type === "circle" && spec.anchor &&
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
        // занятая зона контрольного отверстия — Ø посадки, если задан;
        // если у КО есть паз — он торчит за посадку, добавляем запас
        return { type: "circle", cx: h.x, cy: h.y, d: h.seatD != null ? h.seatD : h.d, pad: h.slotOn ? 2.5 : 0 };
      }).concat((opts.fixtureHoles || []).map(function (h) {
        // крепёжные/тех. отверстия болванки — тоже запретная зона (без запаса на паз)
        return { type: "circle", cx: h.x, cy: h.y, d: h.d, pad: 0 };
      })),
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
      // Изотропный запас на паз — везде, КРОМЕ обычной гекс-сетки круглых
      // деталей (anchor не «от края»/«по диаметру» — там угол паза известен
      // заранее, вместо запаса используется точный контур, см. hexSlotPitch
      // и makePlacement). На кольцах угол паза зависит от позиции — запас остаётся.
      var isRingCircle = spec.type === "circle" && spec.qty != null && spec.anchor &&
        (spec.anchor.mode === "edge" || spec.anchor.mode === "diameter");
      var isHexSlotCircle = spec.type === "circle" && spec.slotOn && !isRingCircle;
      spec._pad = isHexSlotCircle ? 0 : slotPad(spec);
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
