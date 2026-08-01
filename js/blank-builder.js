/*
 * blank-builder.js — сборка записи каталога болванки из формы ручного
 * конструктора (вкладка «Болванки» → «Добавить болванку» → «Создать самому»).
 * Чистая логика, без DOM — координаты/каталожная запись, разбор списка точек.
 *
 * HC.blankBuilder.buildManualDiscEntry(opts) → запись диска (см. js/catalog.js)
 * opts = {
 *   id, name, diameter, thickness,
 *   edgeRecess: {side:'top'|'bottom', diameter, depth} | null,
 *   witnesses: [{name, mode:'polar'|'xy', r, angle, x, y, d, seatD, apertureCA, depth, slotAvailable, slotAngle}],
 *   fixtureGroups: [{label, d, mode:'diameter'|'xy', r, count, rotation, x, y}]
 * }
 */
(function (g) {
  "use strict";
  var HC = (g.HC = g.HC || {});

  function round2(v) { return Math.round(v * 100) / 100; }

  // Полярные (диаметр расположения + угол) или декартовы координаты — в одну точку [x,y]
  function witnessXY(w) {
    if (w.mode === "xy") return [round2(w.x || 0), round2(w.y || 0)];
    var rad = ((w.angle || 0) * Math.PI) / 180;
    var r = w.r || 0;
    return [round2(r * Math.cos(rad)), round2(r * Math.sin(rad))];
  }

  // Точки крепёжной группы: по диаметру расположения + количеству, равномерно
  // по кругу, с поворотом первой точки на rotation° от оси +X (по часовой,
  // как angle у свидетелей); либо ровно одна точка по точным координатам X,Y
  // (как у свидетеля — группа тогда представляет одно отверстие)
  function fixtureGroupPoints(grp) {
    if (grp.mode === "xy") return [[round2(grp.x || 0), round2(grp.y || 0)]];
    var n = Math.max(1, parseInt(grp.count, 10) || 0);
    var r = grp.r || 0;
    var rot = ((grp.rotation || 0) * Math.PI) / 180;
    var pts = [];
    for (var i = 0; i < n; i++) {
      var a = rot + (2 * Math.PI * i) / n;
      pts.push([round2(r * Math.cos(a)), round2(r * Math.sin(a))]);
    }
    return pts;
  }

  HC.blankBuilder = {
    witnessXY: witnessXY,
    fixtureGroupPoints: fixtureGroupPoints,

    buildManualDiscEntry: function (opts) {
      var holes = (opts.witnesses || []).map(function (w) {
        var xy = witnessXY(w);
        return {
          x: xy[0], y: xy[1], name: w.name || "",
          d: w.d > 0 ? w.d : undefined,
          seatD: w.seatD > 0 ? w.seatD : undefined,
          apertureCA: w.apertureCA > 0 ? w.apertureCA : undefined,
          depth: w.depth > 0 ? w.depth : undefined,
          slotAvailable: !!w.slotAvailable,
          slotAngle: w.slotAvailable ? (w.slotAngle || 0) : undefined
        };
      });

      var fixtureHoleGroups = (opts.fixtureGroups || [])
        .map(function (grp) {
          return { d: grp.d > 0 ? grp.d : 3.3, label: grp.label || "", points: fixtureGroupPoints(grp) };
        })
        .filter(function (grp) { return grp.points.length > 0; });

      var entry = {
        id: opts.id,
        name: opts.name,
        installation: opts.installation || "",
        description: opts.description || "",
        diameter: opts.diameter,
        thickness: opts.thickness > 0 ? opts.thickness : 6,
        fixtures: { holes: fixtureHoleGroups, cutouts: [], grooves: [] },
        controlVariants: [
          { id: "std", name: "Свидетели/Reference", holes: holes },
          { id: "none", name: "Без контрольных отверстий", holes: [] }
        ],
        defaults: { partPart: 6, partEdge: 3, partControl: 6 }
      };
      if (opts.edgeRecess && opts.edgeRecess.diameter > 0 && opts.edgeRecess.depth > 0) {
        entry.edgeRecess = {
          side: opts.edgeRecess.side === "bottom" ? "bottom" : "top",
          diameter: opts.edgeRecess.diameter,
          depth: opts.edgeRecess.depth
        };
      }
      return entry;
    }
  };
})(typeof globalThis !== "undefined" ? globalThis : window);
