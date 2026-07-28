/*
 * app.js — состояние формы и связывание модулей.
 */
(function (g) {
  "use strict";
  var HC = g.HC;

  function $(id) { return document.getElementById(id); }

  var parts = [];        // [{type, d, w, h, chamfer, qtyMode:'max'|'qty', qty, allowRotate}]
  var ctrlHoles = [];    // [{x, y, d, on, name}] — позиции из каталога, наличие/диаметр задаёт технолог
  var lastResult = null; // результат последней раскладки; сбрасывается при изменении параметров

  // ---------- каталог ----------

  // Кастомный подложкодержитель: обычный круглый диск, диаметр которого
  // технолог задаёт на странице. Контрольных отверстий и элементов болванки нет.
  function customDisc() {
    var dia = parseFloat($("customDiscDia").value);
    return {
      id: "custom",
      name: HC.t("Кастомный подложкодержитель"),
      diameter: dia > 0 ? dia : 0,
      thickness: 6,
      controlVariants: [{ id: "none", name: HC.t("Без контрольных отверстий"), holes: [] }],
      defaults: { partPart: 6, partEdge: 3, partControl: 6 }
    };
  }

  function currentDisc() {
    var id = $("discSelect").value;
    if (id === "custom") return customDisc();
    for (var i = 0; i < HC.CATALOG.discs.length; i++) {
      if (HC.CATALOG.discs[i].id === id) return HC.CATALOG.discs[i];
    }
    return HC.CATALOG.discs[0];
  }

  function currentControl() {
    var d = currentDisc();
    var id = $("controlSelect").value;
    for (var i = 0; i < d.controlVariants.length; i++) {
      if (d.controlVariants[i].id === id) return d.controlVariants[i];
    }
    return d.controlVariants[0];
  }

  function fillDiscSelect() {
    var opts = HC.CATALOG.discs.map(function (d) {
      return '<option value="' + d.id + '">' + HC.t(d.name) + "</option>";
    }).join("");
    opts += '<option value="custom">' + HC.t("Кастомный подложкодержитель (задать Ø)") + "</option>";
    $("discSelect").innerHTML = opts;
  }

  function fillControlSelect() {
    var d = currentDisc();
    $("controlSelect").innerHTML = d.controlVariants.map(function (v) {
      return '<option value="' + v.id + '">' + HC.t(v.name) + "</option>";
    }).join("");
    $("discInfo").textContent = HC.t("Диаметр диска: {0} мм", d.diameter);
    // кнопка удаления — только для загруженных пользователем подложек
    $("discDelBtn").hidden = String(d.id).indexOf("user-") !== 0;
  }

  // ---------- пользовательские подложки (загрузка из CSV, localStorage) ----------

  function isUserDisc(d) { return String(d.id).indexOf("user-") === 0; }

  function saveCustomDiscs() {
    try {
      var custom = HC.CATALOG.discs.filter(isUserDisc);
      localStorage.setItem("hc-custom-discs", JSON.stringify(custom));
    } catch (e) { /* localStorage недоступен — не критично */ }
  }

  function loadCustomDiscs() {
    try {
      var arr = JSON.parse(localStorage.getItem("hc-custom-discs") || "[]");
      if (Array.isArray(arr)) {
        arr.forEach(function (d) {
          if (d && d.id && !HC.CATALOG.discs.some(function (x) { return x.id === d.id; })) HC.CATALOG.discs.push(d);
        });
      }
    } catch (e) { /* игнорируем битый кэш */ }
  }

  function loadDiscFromFile() {
    var input = $("discFile");
    var msgEl = $("discLoadMsg");
    function msg(t, cls) { msgEl.textContent = t || ""; msgEl.className = "status" + (cls ? " " + cls : ""); }
    var file = input.files && input.files[0];
    if (!file) { msg(HC.t("Выберите CSV-файл выгрузки."), "error"); return; }
    var zone = parseFloat($("discZone").value), thk = parseFloat($("discThk").value);
    if (!(zone > 0)) { msg(HC.t("Укажите Ø полезной зоны."), "error"); return; }
    var reader = new FileReader();
    reader.onload = function () {
      try {
        var name = $("discName").value.trim() || file.name.replace(/-holes\.csv$/i, "").replace(/\.csv$/i, "") || HC.t("Подложкодержатель");
        var entry = HC.holderImport.buildDiscEntry(reader.result, {
          id: "user-" + Date.now(), name: name, discDiameter: zone, thickness: thk > 0 ? thk : 6
        });
        if (!entry) { msg(HC.t("В файле не найдено геометрии — это выгрузка DumpHoles?"), "error"); return; }
        HC.CATALOG.discs.push(entry);
        saveCustomDiscs();
        fillDiscSelect();
        $("discSelect").value = entry.id;
        onDiscChange();
        var extra = entry._threadPoints && entry._threadPoints.length ? HC.t(" Резьбовых отверстий без Ø: {0} (уточните в модели).", entry._threadPoints.length) : "";
        msg(HC.t("Подложкодержатель «{0}» добавлен и сохранён.{1}", entry.name, extra), "ok");
      } catch (e) {
        msg(HC.t("Ошибка разбора: {0}", e.message), "error");
      }
    };
    reader.onerror = function () { msg(HC.t("Не удалось прочитать файл."), "error"); };
    reader.readAsText(file);
  }

  function deleteCurrentDisc() {
    var d = currentDisc();
    if (!isUserDisc(d)) return;
    HC.CATALOG.discs = HC.CATALOG.discs.filter(function (x) { return x.id !== d.id; });
    saveCustomDiscs();
    fillDiscSelect();
    $("discSelect").value = HC.CATALOG.discs[0].id;
    onDiscChange();
  }

  function onDiscChange() {
    $("customDiscWrap").hidden = $("discSelect").value !== "custom";
    fillControlSelect();
    rebuildControlHoles();
    applyDefaultClearances();
    markDirty();
  }

  function applyDefaultClearances() {
    var d = currentDisc().defaults;
    $("clPP").value = d.partPart;
    $("clPE").value = d.partEdge;
    $("clPC").value = d.partControl;
  }

  // ---------- контрольные отверстия ----------
  // У каждого те же поля, что у круглой детали (d/D/CA/depth/паз) — позиции
  // фиксированы каталогом, но размеры и наличие паза можно поправить на странице.

  function rebuildControlHoles() {
    ctrlHoles = currentControl().holes.map(function (h) {
      var hasD = h.d != null;
      var seatD = h.seatD != null ? h.seatD : (hasD ? autoSeatD(h.d) : null);
      return {
        x: h.x, y: h.y,
        name: h.name || ("X " + h.x + ", Y " + h.y),
        d: hasD ? h.d : null,
        seatD: seatD,
        seatDAuto: h.seatD == null && hasD,
        apertureCA: h.apertureCA != null ? h.apertureCA : (seatD != null ? autoCA(seatD) : null),
        apertureCAAuto: h.apertureCA == null && seatD != null,
        depth: h.depth != null ? h.depth : null,
        slotAvailable: !!h.slotAvailable,
        slotOn: !!h.slotAvailable, slotAngle: 0, // паз по умолчанию включён там, где доступен
        // отверстие, привязанное к другому (по имени): показывается только когда
        // опорное выключено (shownWhenOff) или включено (shownWhenOn)
        shownWhenOff: h.shownWhenOff || null,
        shownWhenOn: h.shownWhenOn || null,
        on: true
      };
    });
    renderControlHoles();
  }

  function renderControlHoles() {
    var host = $("controlList");
    host.innerHTML = "";
    ctrlHoles.forEach(function (h) {
      // техотверстия 1/2/3 (shownWhenOn) жёстко привязаны к свидетелю — без
      // отдельной строки/галочки; появляются и исчезают только вместе с ним
      if (h.shownWhenOn) return;
      // центральное техотверстие (shownWhenOff) показываем со своей галочкой,
      // только когда опорное выключено — тогда его можно убрать отдельно
      if (h.shownWhenOff && !isControlShown(h)) return;
      host.appendChild(ctrlHoleRow(h));
    });
  }

  // показывается ли привязанное отверстие сейчас (по состоянию опорного);
  // для обычных отверстий — всегда
  function isControlShown(h) {
    if (h.shownWhenOff) {
      var refOff = ctrlHoles.filter(function (r) { return r.name === h.shownWhenOff; })[0];
      return refOff ? !refOff.on : true;
    }
    if (h.shownWhenOn) {
      var refOn = ctrlHoles.filter(function (r) { return r.name === h.shownWhenOn; })[0];
      return refOn ? refOn.on : false;
    }
    return true;
  }

  // активно ли отверстие в геометрии (keepout):
  //  • shownWhenOn (техотв. 1/2/3) — жёстко по опорному, без своей галочки;
  //  • shownWhenOff (центральное) — показано по опорному И включено своей галочкой
  //    (его можно убрать отдельно, чтобы освободить центр);
  //  • обычное — по своей галочке.
  function isControlActive(h) {
    if (h.shownWhenOn) return isControlShown(h);
    if (h.shownWhenOff) return isControlShown(h) && h.on;
    return h.on;
  }

  // управляет ли это отверстие показом привязанных (по имени)
  function controlsOthers(h) {
    return ctrlHoles.some(function (r) { return r.shownWhenOn === h.name || r.shownWhenOff === h.name; });
  }

  function ctrlHoleRow(h) {
    var div = document.createElement("div");
    div.className = "ctrl-row";
    var caMax = autoCA(h.seatD); // максимум CA — от Ø посадки D
    // все настройки спрятаны в сворачиваемый блок; наружу — только галочка
    // наличия отверстия и краткая строка с текущими размерами
    div.innerHTML =
      '<div class="ctrl-head"><label><input type="checkbox" class="c-on"' + (h.on ? " checked" : "") + ">" + HC.t(h.name) + "</label></div>" +
      '<details class="ctrl-details">' +
      '<summary><span class="c-summary"></span></summary>' +
      '<div class="dims">' +
      (h.d != null ? "<label>" + HC.t("Деталь d, мм") + '<input type="number" class="c-d" min="0.1" step="0.1" value="' + h.d + '"' + (h.on ? "" : " disabled") + "></label>" : "") +
      "<label>" + HC.t("Ø посадки D, мм") + '<input type="number" class="c-seat-d" min="' + (h.d != null ? h.d : 0.1) + '" step="0.1" value="' + (h.seatD == null ? "" : h.seatD) + '"' + (h.on ? "" : " disabled") + "></label>" +
      "<label>" + HC.t("Зона CA, мм") + '<input type="number" class="c-ca" min="0.1" step="0.1" max="' + (caMax == null ? "" : caMax) + '" value="' + (h.apertureCA == null ? "" : h.apertureCA) + '"' + (h.on ? "" : " disabled") + "></label>" +
      "</div>" +
      (h.slotAvailable
        ? '<div class="slot-line">' +
          '<label><input type="checkbox" class="c-slot-on"' + (h.slotOn ? " checked" : "") + (h.on ? "" : " disabled") + "> " + HC.t("паз под пинцет") + "</label>" +
          "<label>" + HC.t("Угол, °") + '<input type="number" class="c-slot-angle" min="0" max="359" step="1" value="' + h.slotAngle + '"' + (h.slotOn && h.on ? "" : " disabled") + "></label>" +
          "</div>"
        : "") +
      '<div class="part-preview hole-diagram"></div>' +
      "</details>";

    function summaryText() {
      function ru(v) { return (Math.round(v * 100) / 100).toString().replace(".", ","); }
      var partsT = [];
      if (h.seatD > 0) partsT.push("D" + ru(h.seatD));
      if (h.apertureCA > 0) partsT.push("CA" + ru(h.apertureCA));
      var t = (h.d > 0 ? "d" + ru(h.d) + " " : "") + (partsT.length ? "(" + partsT.join("/") + ")" : "");
      if (h.depth > 0) t += " · " + HC.t("глуб.") + " " + ru(h.depth);
      if (h.slotOn) t += " · " + HC.t("паз");
      return t || HC.t("параметры");
    }

    function refreshPreview() {
      div.querySelector(".part-preview").innerHTML = HC.renderHoleDiagram(h);
      div.querySelector(".c-summary").textContent = summaryText();
    }
    function on(sel, ev, fn) {
      var el = div.querySelector(sel);
      if (el) el.addEventListener(ev, fn);
    }
    function syncAutoFields() {
      var seatEl = div.querySelector(".c-seat-d");
      if (h.d != null) {
        if (seatEl) seatEl.setAttribute("min", h.d);
        if (h.seatDAuto) {
          h.seatD = autoSeatD(h.d);
          if (seatEl) seatEl.value = h.seatD == null ? "" : h.seatD;
        }
      }
      var maxCA = autoCA(h.seatD); // CA — от Ø посадки D
      var caEl = div.querySelector(".c-ca");
      if (caEl) { if (maxCA != null) caEl.setAttribute("max", maxCA); else caEl.removeAttribute("max"); }
      if (h.apertureCAAuto) {
        h.apertureCA = maxCA;
        if (caEl) caEl.value = h.apertureCA == null ? "" : h.apertureCA;
      }
    }

    on(".c-on", "change", function (e) {
      h.on = e.target.checked;
      if (controlsOthers(h)) {
        // это опорное отверстие (напр. «Свидетель Центр») — перерисуем список,
        // чтобы привязанные техотверстия появились/исчезли со своими галочками
        renderControlHoles();
      } else {
        var dEl = div.querySelector(".c-d"); if (dEl) dEl.disabled = !h.on;
        var seatEl = div.querySelector(".c-seat-d"); if (seatEl) seatEl.disabled = !h.on;
        var caEl = div.querySelector(".c-ca"); if (caEl) caEl.disabled = !h.on;
        var slotOnEl = div.querySelector(".c-slot-on"); if (slotOnEl) slotOnEl.disabled = !h.on;
        var slotAngleEl = div.querySelector(".c-slot-angle"); if (slotAngleEl) slotAngleEl.disabled = !h.on || !h.slotOn;
      }
      markDirty();
    });
    on(".c-d", "input", function (e) { h.d = parseFloat(e.target.value); syncAutoFields(); refreshPreview(); markDirty(); });
    on(".c-seat-d", "input", function (e) { h.seatD = e.target.value === "" ? null : parseFloat(e.target.value); h.seatDAuto = false; syncAutoFields(); refreshPreview(); markDirty(); });
    on(".c-ca", "input", function (e) { h.apertureCA = e.target.value === "" ? null : parseFloat(e.target.value); h.apertureCAAuto = false; refreshPreview(); markDirty(); });
    on(".c-slot-on", "change", function (e) {
      h.slotOn = e.target.checked;
      var angleEl = div.querySelector(".c-slot-angle");
      if (angleEl) angleEl.disabled = !h.slotOn;
      refreshPreview(); markDirty();
    });
    on(".c-slot-angle", "input", function (e) { h.slotAngle = parseFloat(e.target.value); refreshPreview(); markDirty(); });

    refreshPreview();
    return div;
  }

  function activeControlHoles() {
    return ctrlHoles.filter(isControlActive).map(function (h) {
      return {
        x: h.x, y: h.y,
        d: h.d, seatD: h.seatD, apertureCA: h.apertureCA,
        depth: h.depth, slotOn: h.slotOn
      };
    });
  }

  function controlSummary() {
    var act = ctrlHoles.filter(isControlActive);
    if (!act.length) return "нет";
    return act.map(function (h) { return HC.t(h.name) + " Ø" + (h.seatD != null ? h.seatD : h.d); }).join("; ");
  }

  // ---------- детали ----------

  // Ø посадки по умолчанию: зазор растёт со размером детали (технологический запас)
  function autoSeatD(d) {
    if (!(d > 0)) return null;
    var add = d <= 50 ? 0.2 : (d <= 100 ? 0.3 : 0.4);
    return Math.round((d + add) * 100) / 100;
  }

  // Максимально возможная технологически зона напыления — Ø посадки D минус 1.5 мм
  function autoCA(seatD) {
    if (!(seatD > 0)) return null;
    var ca = seatD - 1.5;
    return ca > 0 ? Math.round(ca * 100) / 100 : null;
  }

  // Некруглые детали: посадка/зона напыления задаются отступами от контура.
  // Припуск на посадку (контур больше на N мм со стороны) — растёт с размером, как у круга.
  function autoSeatGap(w, h) {
    var m = Math.max(w || 0, h || 0);
    return m <= 50 ? 0.1 : (m <= 100 ? 0.15 : 0.2);
  }
  // Отступ зоны напыления (контур меньше на N мм со стороны) — как у круга ≈0.6 мм.
  function autoCaInset(w, h) {
    var m = Math.min(w || 0, h || 0);
    return m > 1.6 ? 0.6 : Math.max(0, Math.round((m / 2 - 0.2) * 100) / 100);
  }

  function defaultPart() {
    var d = 25.4; // стандартная деталь
    var seatD = autoSeatD(d);
    return {
      type: "circle", d: d, w: 20, h: 10, chamfer: 2,
      // посадка (D) и зона напыления (CA) — для круглых; авто, пока пользователь не поправит вручную
      seatD: seatD, seatDAuto: true,
      apertureCA: autoCA(seatD), apertureCAAuto: true,
      // посадка/зона напыления некруглых — отступами от контура (авто)
      seatGap: autoSeatGap(20, 10), seatGapAuto: true,
      caInset: autoCaInset(20, 10), caInsetAuto: true,
      slotOn: false, slotAngle: 0, // паз под пинцет — у всех типов деталей
      qtyMode: "max", qty: 10,
      orientation: "grid",           // fixed | grid | radial-w | radial-h
      anchor: "center", anchorD: 150 // расположение при неполном заполнении
    };
  }

  function renderParts() {
    var host = $("partsList");
    host.innerHTML = "";
    parts.forEach(function (p, i) { host.appendChild(partRow(p, i)); });
  }

  function partRow(p, i) {
    var div = document.createElement("div");
    div.className = "part-row";
    var caMax = autoCA(p.seatD); // максимум CA — от Ø посадки D
    var dims = p.type === "circle"
      ? "<label>" + HC.t("Диаметр детали d, мм") + '<input type="number" class="p-d" min="0.1" step="0.1" value="' + p.d + '"></label>' +
        "<label>" + HC.t("Ø посадки D, мм") + ' <span class="hint">' + HC.t("(авто, можно поправить, не меньше d)") + '</span><input type="number" class="p-seat-d" min="' + p.d + '" step="0.1" value="' + (p.seatD == null ? "" : p.seatD) + '"></label>' +
        "<label>" + HC.t("Зона напыления CA, мм") + ' <span class="hint">' + HC.t("(авто-максимум, можно только уменьшить)") + '</span><input type="number" class="p-ca" min="0.1" step="0.1" max="' + (caMax == null ? "" : caMax) + '" value="' + (p.apertureCA == null ? "" : p.apertureCA) + '"></label>'
      : "<label>" + HC.t("Ширина, мм") + '<input type="number" class="p-w" min="0.1" step="0.1" value="' + p.w + '"></label>' +
        "<label>" + HC.t("Высота, мм") + '<input type="number" class="p-h" min="0.1" step="0.1" value="' + p.h + '"></label>' +
        (p.type === "oct" ? "<label>" + HC.t("Фаска, мм") + '<input type="number" class="p-ch" min="0" step="0.1" value="' + p.chamfer + '"></label>' : "") +
        "<label>" + HC.t("Припуск на посадку, мм") + '<input type="number" class="p-seat-gap" min="0" step="0.05" value="' + (p.seatGap == null ? "" : p.seatGap) + '"></label>' +
        "<label>" + HC.t("Отступ зоны напыления, мм") + '<input type="number" class="p-ca-inset" min="0" step="0.05" value="' + (p.caInset == null ? "" : p.caInset) + '"></label>';

    div.innerHTML =
      '<div class="row-head"><strong>' + HC.t("Деталь {0}", i + 1) + "</strong>" +
      (parts.length > 1 ? '<button type="button" class="p-del" title="' + HC.t("Удалить деталь") + '">✕</button>' : "") +
      "</div>" +
      "<label>" + HC.t("Форма") + '<select class="p-type">' +
      '<option value="circle"' + (p.type === "circle" ? " selected" : "") + ">" + HC.t("Круглая") + "</option>" +
      '<option value="rect"' + (p.type === "rect" ? " selected" : "") + ">" + HC.t("Прямоугольная") + "</option>" +
      '<option value="oct"' + (p.type === "oct" ? " selected" : "") + ">" + HC.t("Прямоугольная с фаской") + "</option>" +
      '<option value="oval"' + (p.type === "oval" ? " selected" : "") + ">" + HC.t("Овальная") + "</option>" +
      "</select></label>" +
      '<div class="dims">' + dims + "</div>" +
      '<div class="slot-line">' +
      '<label><input type="checkbox" class="p-slot-on"' + (p.slotOn ? " checked" : "") + "> " + HC.t("паз под пинцет") +
      (p.type === "circle" ? ' <span class="hint">' + HC.t("(нужен Ø посадки D)") + "</span>" : "") + "</label>" +
      "<label>" + HC.t("Угол, °") + '<input type="number" class="p-slot-angle" min="0" max="359" step="1" value="' + p.slotAngle + '"' + (p.slotOn ? "" : " disabled") + "></label>" +
      "</div>" +
      '<div class="part-preview' + (p.type === "circle" ? " hole-diagram" : "") + '">' +
      (p.type === "circle" ? HC.renderHoleDiagram(p) : HC.renderPartPreview(p)) + "</div>" +
      (p.type !== "circle"
        ? "<label>" + HC.t("Ориентация") + '<select class="p-orient">' +
          '<option value="fixed"' + (p.orientation === "fixed" ? " selected" : "") + ">" + HC.t("фиксированная (без поворота)") + "</option>" +
          '<option value="grid"' + (p.orientation === "grid" ? " selected" : "") + ">" + HC.t("свободная (0° / 90°)") + "</option>" +
          '<option value="radial-w"' + (p.orientation === "radial-w" ? " selected" : "") + ">" + HC.t("радиальная — ширина вдоль радиуса") + "</option>" +
          '<option value="radial-h"' + (p.orientation === "radial-h" ? " selected" : "") + ">" + HC.t("радиальная — высота вдоль радиуса") + "</option>" +
          "</select></label>"
        : "") +
      '<div class="qty-line">' +
      '<label><input type="radio" name="qty' + i + '" value="max"' + (p.qtyMode === "max" ? " checked" : "") + "> " + HC.t("максимум") + "</label>" +
      '<label><input type="radio" name="qty' + i + '" value="qty"' + (p.qtyMode === "qty" ? " checked" : "") + "> " + HC.t("количество:") + "</label>" +
      '<input type="number" class="p-qty" min="1" step="1" value="' + p.qty + '"' + (p.qtyMode === "max" ? " disabled" : "") + ">" +
      "</div>" +
      (p.qtyMode === "qty"
        ? '<div class="place-line">' +
          "<label>" + HC.t("Расположение") + '<select class="p-anchor">' +
          '<option value="center"' + (p.anchor === "center" ? " selected" : "") + ">" + HC.t("от центра") + "</option>" +
          '<option value="edge"' + (p.anchor === "edge" ? " selected" : "") + ">" + HC.t("от края") + "</option>" +
          '<option value="diameter"' + (p.anchor === "diameter" ? " selected" : "") + ">" + HC.t("по диаметру") + "</option>" +
          "</select></label>" +
          (p.anchor === "diameter"
            ? "<label>" + HC.t("Ø расположения, мм") + '<input type="number" class="p-anchor-d" min="1" step="1" value="' + p.anchorD + '"></label>'
            : "") +
          "</div>"
        : "");

    function on(sel, ev, fn) {
      var el = div.querySelector(sel);
      if (el) el.addEventListener(ev, fn);
    }
    function refreshPreview() {
      var host = div.querySelector(".part-preview");
      host.className = "part-preview" + (p.type === "circle" ? " hole-diagram" : "");
      host.innerHTML = p.type === "circle" ? HC.renderHoleDiagram(p) : HC.renderPartPreview(p);
    }
    // При изменении d пересчитывает D/CA, пока пользователь их не тронул руками
    // (обновляет поля напрямую через DOM, без renderParts(), чтобы не сбивать фокус при вводе)
    function syncAutoFields() {
      if (p.type !== "circle") {
        // некруглые: пересчёт авто-отступов посадки/зоны напыления при смене габаритов
        if (p.seatGapAuto) {
          p.seatGap = autoSeatGap(p.w, p.h);
          var sgEl = div.querySelector(".p-seat-gap"); if (sgEl) sgEl.value = p.seatGap == null ? "" : p.seatGap;
        }
        if (p.caInsetAuto) {
          p.caInset = autoCaInset(p.w, p.h);
          var ciEl = div.querySelector(".p-ca-inset"); if (ciEl) ciEl.value = p.caInset == null ? "" : p.caInset;
        }
        return;
      }
      var seatEl = div.querySelector(".p-seat-d");
      if (seatEl) seatEl.setAttribute("min", p.d);
      if (p.seatDAuto) {
        p.seatD = autoSeatD(p.d);
        if (seatEl) seatEl.value = p.seatD == null ? "" : p.seatD;
      }
      var maxCA = autoCA(p.seatD); // CA — от Ø посадки D
      var caEl = div.querySelector(".p-ca");
      if (caEl) {
        if (maxCA != null) caEl.setAttribute("max", maxCA); else caEl.removeAttribute("max");
      }
      if (p.apertureCAAuto) {
        p.apertureCA = maxCA;
        if (caEl) caEl.value = p.apertureCA == null ? "" : p.apertureCA;
      }
    }
    on(".p-type", "change", function (e) { p.type = e.target.value; renderParts(); markDirty(); });
    on(".p-d", "input", function (e) { p.d = parseFloat(e.target.value); syncAutoFields(); refreshPreview(); markDirty(); });
    on(".p-seat-d", "input", function (e) { p.seatD = e.target.value === "" ? null : parseFloat(e.target.value); p.seatDAuto = false; syncAutoFields(); refreshPreview(); markDirty(); });
    on(".p-ca", "input", function (e) { p.apertureCA = e.target.value === "" ? null : parseFloat(e.target.value); p.apertureCAAuto = false; refreshPreview(); markDirty(); });
    on(".p-slot-on", "change", function (e) {
      p.slotOn = e.target.checked;
      var angleEl = div.querySelector(".p-slot-angle");
      if (angleEl) angleEl.disabled = !p.slotOn;
      refreshPreview(); markDirty();
    });
    on(".p-slot-angle", "input", function (e) { p.slotAngle = parseFloat(e.target.value); refreshPreview(); markDirty(); });
    on(".p-w", "input", function (e) { p.w = parseFloat(e.target.value); syncAutoFields(); refreshPreview(); markDirty(); });
    on(".p-h", "input", function (e) { p.h = parseFloat(e.target.value); syncAutoFields(); refreshPreview(); markDirty(); });
    on(".p-seat-gap", "input", function (e) { p.seatGap = e.target.value === "" ? null : parseFloat(e.target.value); p.seatGapAuto = false; refreshPreview(); markDirty(); });
    on(".p-ca-inset", "input", function (e) { p.caInset = e.target.value === "" ? null : parseFloat(e.target.value); p.caInsetAuto = false; refreshPreview(); markDirty(); });
    on(".p-ch", "input", function (e) { p.chamfer = parseFloat(e.target.value); refreshPreview(); markDirty(); });
    on(".p-qty", "input", function (e) { p.qty = parseInt(e.target.value, 10); markDirty(); });
    on(".p-orient", "change", function (e) { p.orientation = e.target.value; markDirty(); });
    on(".p-anchor", "change", function (e) { p.anchor = e.target.value; renderParts(); markDirty(); });
    on(".p-anchor-d", "input", function (e) { p.anchorD = parseFloat(e.target.value); markDirty(); });
    on(".p-del", "click", function () { parts.splice(i, 1); renderParts(); markDirty(); });
    div.querySelectorAll('input[name="qty' + i + '"]').forEach(function (r) {
      r.addEventListener("change", function (e) {
        p.qtyMode = e.target.value;
        renderParts(); // показать/скрыть строку «Расположение»
        markDirty();
      });
    });
    return div;
  }

  // ---------- статусы ----------

  function setActions(enabled) {
    $("csvBtn").disabled = !enabled;
    $("reportBtn").disabled = !enabled;
    $("sendBtn").disabled = !enabled;
  }

  function setStatus(text, cls) {
    var el = $("statusMsg");
    el.textContent = text || "";
    el.className = "status" + (cls ? " " + cls : "");
  }

  function setSendMsg(text, cls) {
    var el = $("sendMsg");
    el.textContent = text || "";
    el.className = "status" + (cls ? " " + cls : "");
  }

  var autoPackTimer = null;

  function markDirty() {
    if (lastResult) {
      lastResult = null;
      $("summary").textContent = HC.t("Пересчитываю…");
    }
    setActions(false);
    setStatus("");
    setSendMsg("");
    // авторазложение: пересчитываем сами, с небольшой паузой, чтобы не
    // дёргать раскладку на каждый символ при вводе числа
    if (autoPackTimer) clearTimeout(autoPackTimer);
    autoPackTimer = setTimeout(doPack, 400);
  }

  // ---------- раскладка ----------

  function typeShort(spec) {
    if (spec.type === "circle") return HC.t("круглая Ø{0}", spec.d);
    if (spec.type === "rect") return HC.t("прямоугольная {0}×{1}", spec.w, spec.h);
    if (spec.type === "oval") return HC.t("овальная {0}×{1}", spec.w, spec.h);
    return HC.t("с фаской {0}×{1}×{2}", spec.w, spec.h, spec.chamfer);
  }

  // ---------- авто-название подложкодержателя (для гравировки) ----------
  // Формат по каждому типу деталей: "d{d} (D{seatD}/CA{ca}) N{кол-во}" для
  // круга, "{w}×{h}(×{ch}) N{кол-во}" для прямоугольника/овала/фаски; при
  // нескольких типах деталей — через "/". Максимум 42 символа (гравировка).
  var MAX_HOLDER_NAME = 42;

  function fmtRuShort(v) {
    return (Math.round(v * 100) / 100).toString().replace(".", ",");
  }

  function partDescriptor(spec, placedCount) {
    var base;
    if (spec.type === "circle") {
      var dims = [];
      if (spec.seatD > 0) dims.push("D" + fmtRuShort(spec.seatD));
      if (spec.apertureCA > 0) dims.push("CA" + fmtRuShort(spec.apertureCA));
      base = "d" + fmtRuShort(spec.d) + (dims.length ? " (" + dims.join("/") + ")" : "");
    } else if (spec.type === "oct") {
      base = fmtRuShort(spec.w) + "×" + fmtRuShort(spec.h) + "×" + fmtRuShort(spec.chamfer || 0);
    } else {
      base = fmtRuShort(spec.w) + "×" + fmtRuShort(spec.h);
    }
    return base + " N" + placedCount;
  }

  function autoHolderName(opts, perPart) {
    var descs = [];
    perPart.forEach(function (r, i) {
      if (r.placed > 0) descs.push(partDescriptor(opts.parts[i], r.placed));
    });
    var name = descs.join("/");
    if (name.length > MAX_HOLDER_NAME) {
      // не влезает целиком — сначала убираем описания деталей с конца
      while (descs.length > 1 && descs.join("/").length > MAX_HOLDER_NAME) descs.pop();
      name = descs.join("/");
      if (name.length > MAX_HOLDER_NAME) name = name.slice(0, MAX_HOLDER_NAME); // и одно не влезает целиком
    }
    return name;
  }

  function validate() {
    var errs = [];
    var disc = currentDisc();
    if (disc.id === "custom" && !(disc.diameter > 0)) errs.push(HC.t("Укажите диаметр кастомного подложкодержителя (мм)."));
    if (!parts.length) errs.push(HC.t("Добавьте хотя бы одну деталь."));
    parts.forEach(function (p, i) {
      var n = HC.t("Деталь {0}: ", i + 1);
      if (p.type === "circle") {
        if (!(p.d > 0)) {
          errs.push(n + HC.t("укажите диаметр."));
        } else if (p.d >= disc.diameter) {
          errs.push(n + HC.t("деталь больше диска."));
        } else {
          if (p.seatD != null && p.seatD < p.d - 1e-6) {
            errs.push(n + HC.t("Ø посадки D не может быть меньше диаметра детали d ({0}).", p.d));
          }
          if (p.apertureCA != null) {
            var maxCA = autoCA(p.seatD);
            if (maxCA == null || p.apertureCA > maxCA + 1e-6) {
              errs.push(n + HC.t("зона напыления CA не может быть больше D−1.5 мм") + (maxCA != null ? HC.t(" (максимум {0})", maxCA) : "") + ".");
            }
          }
        }
      } else {
        if (!(p.w > 0) || !(p.h > 0)) errs.push(n + HC.t("укажите ширину и высоту."));
        else {
          if (p.type === "oct") {
            if (!(p.chamfer >= 0)) errs.push(n + HC.t("укажите фаску (0 — без фаски)."));
            else if (p.chamfer >= Math.min(p.w, p.h) / 2) errs.push(n + HC.t("фаска должна быть меньше половины меньшей стороны."));
          }
          if (p.seatGap != null && p.seatGap < 0) errs.push(n + HC.t("припуск на посадку не может быть отрицательным."));
          if (p.caInset != null && p.caInset < 0) errs.push(n + HC.t("отступ зоны напыления не может быть отрицательным."));
          if (p.caInset != null && p.caInset >= Math.min(p.w, p.h) / 2) errs.push(n + HC.t("отступ зоны напыления должен быть меньше половины меньшей стороны."));
        }
      }
      if (p.qtyMode === "qty" && !(p.qty >= 1)) errs.push(n + HC.t("укажите количество (целое ≥ 1)."));
      if (p.qtyMode === "qty" && p.anchor === "diameter" && !(p.anchorD > 0)) {
        errs.push(n + HC.t("укажите диаметр расположения."));
      }
    });
    ctrlHoles.forEach(function (h) {
      if (!isControlActive(h)) return;
      var hn = HC.t("Контрольное отверстие «{0}»: ", HC.t(h.name));
      if (!(h.seatD > 0)) { errs.push(hn + HC.t("укажите Ø посадки.")); return; }
      if (h.d != null && h.seatD < h.d - 1e-6) {
        errs.push(hn + HC.t("Ø посадки D не может быть меньше диаметра детали d ({0}).", h.d));
      }
      if (h.apertureCA != null) {
        var maxCAh = autoCA(h.seatD);
        if (maxCAh == null || h.apertureCA > maxCAh + 1e-6) {
          errs.push(hn + HC.t("зона напыления CA не может быть больше D−1.5 мм") + (maxCAh != null ? HC.t(" (максимум {0})", maxCAh) : "") + ".");
        }
      }
    });
    ["clPP", "clPE", "clPC"].forEach(function (id) {
      var v = parseFloat($(id).value);
      if (!(v >= 0)) errs.push(HC.t("Все зазоры должны быть числами ≥ 0."));
    });
    return errs;
  }

  function doPack() {
    if (autoPackTimer) { clearTimeout(autoPackTimer); autoPackTimer = null; }
    var errs = validate();
    if (errs.length) {
      setStatus(errs.join("\n"), "error");
      $("summary").textContent = HC.t("Исправьте ошибки в форме — раскладка обновится сама.");
      return;
    }

    var disc = currentDisc();
    var opts = {
      discDiameter: disc.diameter,
      controlHoles: activeControlHoles(),
      clearances: {
        pp: parseFloat($("clPP").value),
        pe: parseFloat($("clPE").value),
        pc: parseFloat($("clPC").value)
      },
      parts: parts.map(function (p) {
        return {
          type: p.type, d: p.d, w: p.w, h: p.h,
          chamfer: p.type === "oct" ? p.chamfer : 0,
          qty: p.qtyMode === "max" ? null : p.qty,
          orientation: p.type === "circle" ? "fixed" : p.orientation,
          anchor: p.qtyMode === "qty"
            ? { mode: p.anchor, d: p.anchorD }
            : { mode: "center" },
          // только для отображения на схеме (2D/3D), на раскладку не влияет
          seatD: p.type === "circle" ? p.seatD : null,
          apertureCA: p.type === "circle" ? p.apertureCA : null,
          seatGap: p.type !== "circle" ? p.seatGap : null,
          caInset: p.type !== "circle" ? p.caInset : null,
          slotOn: p.slotOn,
          slotAngle: p.slotAngle
        };
      })
    };

    var res = HC.pack(opts);

    var now = new Date();
    function p2(x) { return (x < 10 ? "0" : "") + x; }
    lastResult = {
      opts: opts, placed: res.placed, perPart: res.perPart,
      disc: disc, controlName: controlSummary(),
      orderId: "PD-" + now.getFullYear() + p2(now.getMonth() + 1) + p2(now.getDate()) + "-" + p2(now.getHours()) + p2(now.getMinutes()),
      dateISO: now.toISOString(),
      dateHuman: p2(now.getDate()) + "." + p2(now.getMonth() + 1) + "." + now.getFullYear() + " " + p2(now.getHours()) + ":" + p2(now.getMinutes())
    };

    var lines = [], warn = false;
    res.perPart.forEach(function (r, i) {
      var label = HC.t("Деталь {0} ({1}): ", i + 1, typeShort(opts.parts[i]));
      if (r.requested == null) lines.push(label + HC.t("максимум — размещено {0}", r.placed));
      else if (r.placed >= r.requested) lines.push(label + HC.t("размещено {0} из {1}", r.placed, r.requested));
      else { lines.push(label + HC.t("влезло только {0} из {1} ⚠", r.placed, r.requested)); warn = true; }
    });
    lines.push(HC.t("Всего отверстий под детали: {0}", res.placed.length));
    $("summary").textContent = lines.join("\n");
    $("holderName").value = autoHolderName(opts, res.perPart);

    refreshView();
    setActions(res.placed.length > 0);
    if (!res.placed.length) {
      setStatus(HC.t("Ни одна деталь не поместилась: проверьте размеры и зазоры."), "error");
    } else {
      setStatus(warn ? HC.t("Поместились не все детали — уменьшите количество, зазоры или размеры.") : HC.t("Готово."), warn ? "error" : "ok");
    }
  }

  function refreshSVG() {
    if (!lastResult) return;
    $("svgHost").innerHTML = HC.renderSVG({
      discDiameter: lastResult.disc.diameter,
      blankDiameter: lastResult.disc.blankDiameter,
      fixtures: lastResult.disc.fixtures,
      edgeClearance: lastResult.opts.clearances.pe,
      controlHoles: lastResult.opts.controlHoles,
      placed: lastResult.placed,
      showNumbers: $("showNumbers").checked
    });
  }

  // ---------- 3D-вид ----------

  var mode3d = false;

  function refresh3D() {
    if (!mode3d || !lastResult) return;
    var ok = HC.viewer3d && HC.viewer3d.available() && HC.viewer3d.update($("view3dHost"), {
      discDiameter: lastResult.disc.diameter,
      blankDiameter: lastResult.disc.blankDiameter,
      fixtures: lastResult.disc.fixtures,
      thickness: lastResult.disc.thickness || 6,
      controlHoles: lastResult.opts.controlHoles,
      placed: lastResult.placed,
      showNumbers: $("showNumbers").checked
    });
    if (!ok) {
      setViewMode(false);
      setSendMsg(HC.t("3D-вид недоступен в этом браузере (нет WebGL)."), "error");
    }
  }

  function refreshView() {
    refreshSVG();
    refresh3D();
  }

  function setViewMode(is3d) {
    if (is3d && !(HC.viewer3d && HC.viewer3d.available())) {
      setSendMsg(HC.t("3D-вид недоступен: библиотека Three.js не загрузилась."), "error");
      return;
    }
    mode3d = is3d;
    $("view2dBtn").classList.toggle("active", !is3d);
    $("view3dBtn").classList.toggle("active", is3d);
    $("svgHost").hidden = is3d;
    $("view3dHost").hidden = !is3d;
    $("view3dHint").hidden = !is3d;
    if (is3d) refresh3D(); // контейнер уже показан — размеры известны
  }

  // ---------- заказ ----------

  function assembleOrder() {
    var lr = lastResult;
    return {
      id: lr.orderId,
      date: lr.dateISO,
      dateHuman: lr.dateHuman,
      customer: {
        name: $("custName").value.trim(),
        org: $("custOrg").value.trim(),
        contact: $("custContact").value.trim()
      },
      holderNo: $("holderNo").value.trim(),
      holderName: $("holderName").value.trim(),
      disc: { id: lr.disc.id, name: lr.disc.name, diameter: lr.disc.diameter, thickness: lr.disc.thickness },
      controlName: lr.controlName,
      controlHoles: lr.opts.controlHoles,
      clearances: lr.opts.clearances,
      placed: lr.placed,
      partsSummary: lr.perPart.map(function (r, i) {
        var s = lr.opts.parts[i];
        var orientNote = {
          "radial-w": HC.t(" — радиально, ширина вдоль радиуса"),
          "radial-h": HC.t(" — радиально, высота вдоль радиуса")
        }[s.orientation] || "";
        return {
          type: s.type,
          size: (s.type === "circle" ? "Ø" + s.d : s.w + " × " + s.h + (s.type === "oct" ? ", " + HC.t("фаска") + " " + s.chamfer : "")) + orientNote,
          requested: r.requested,
          placed: r.placed
        };
      })
    };
  }

  // ---------- заказчик: запоминание полей ----------

  function saveCustomer() {
    try {
      localStorage.setItem("hc-customer", JSON.stringify({
        name: $("custName").value, org: $("custOrg").value, contact: $("custContact").value
      }));
    } catch (e) { /* localStorage может быть недоступен — не критично */ }
  }

  function loadCustomer() {
    try {
      var v = JSON.parse(localStorage.getItem("hc-customer") || "null");
      if (v) {
        $("custName").value = v.name || "";
        $("custOrg").value = v.org || "";
        $("custContact").value = v.contact || "";
      }
    } catch (e) { /* игнорируем */ }
  }

  // ---------- инициализация ----------

  loadCustomDiscs(); // ранее загруженные пользователем подложки из localStorage
  fillDiscSelect();
  fillControlSelect();
  rebuildControlHoles();
  applyDefaultClearances();
  parts = [defaultPart()];
  renderParts();
  loadCustomer();
  // первый doPack() — ниже, ПОСЛЕ HC.i18n.apply(): иначе apply() перетирает
  // вычисленную сводку статическим плейсхолдером #summary (data-i18n)

  // ---------- переключение языка ----------
  // Динамическая разметка (детали, контрольные отверстия, сводка) собирается через
  // HC.t на месте, поэтому её нужно перерисовать; состояние формы при этом сохраняется.
  function setLanguage(lang) {
    var discVal = $("discSelect").value, ctrlVal = $("controlSelect").value;
    HC.i18n.set(lang); // сохраняет выбор, переводит статическую разметку
    $("langRu").classList.toggle("active", lang === "ru");
    $("langEn").classList.toggle("active", lang === "en");
    fillDiscSelect(); $("discSelect").value = discVal;
    fillControlSelect(); if (ctrlVal) $("controlSelect").value = ctrlVal;
    renderControlHoles();
    renderParts();
    doPack(); // сводка и статусы — на новом языке
  }

  // применяем сохранённый язык к статической разметке и подсветке кнопок
  $("langRu").classList.toggle("active", HC.i18n.get() === "ru");
  $("langEn").classList.toggle("active", HC.i18n.get() === "en");
  HC.i18n.apply();
  doPack(); // первая раскладка при открытии (после apply, чтобы сводка не затёрлась); дальше — автоматически
  $("langRu").addEventListener("click", function () { setLanguage("ru"); });
  $("langEn").addEventListener("click", function () { setLanguage("en"); });

  $("discSelect").addEventListener("change", onDiscChange);
  $("customDiscDia").addEventListener("input", function () {
    $("discInfo").textContent = HC.t("Диаметр диска: {0} мм", currentDisc().diameter || "?");
    markDirty();
  });
  $("discLoadBtn").addEventListener("click", loadDiscFromFile);
  $("discDelBtn").addEventListener("click", deleteCurrentDisc);
  $("controlSelect").addEventListener("change", function () {
    rebuildControlHoles();
    markDirty();
  });
  ["clPP", "clPE", "clPC"].forEach(function (id) { $(id).addEventListener("input", markDirty); });
  $("clReset").addEventListener("click", function () { applyDefaultClearances(); markDirty(); });
  $("addPart").addEventListener("click", function () { parts.push(defaultPart()); renderParts(); markDirty(); });
  $("packBtn").addEventListener("click", doPack);
  $("showNumbers").addEventListener("change", refreshView);
  $("view2dBtn").addEventListener("click", function () { setViewMode(false); });
  $("view3dBtn").addEventListener("click", function () { setViewMode(true); });
  ["custName", "custOrg", "custContact"].forEach(function (id) { $(id).addEventListener("change", saveCustomer); });

  $("csvBtn").addEventListener("click", function () {
    if (lastResult) HC.downloadCSV(assembleOrder());
  });

  $("reportBtn").addEventListener("click", function () {
    if (!lastResult) return;
    var order = assembleOrder();
    var svg = HC.renderSVG({
      discDiameter: lastResult.disc.diameter,
      edgeClearance: lastResult.opts.clearances.pe,
      controlHoles: lastResult.opts.controlHoles,
      placed: lastResult.placed,
      showNumbers: true
    });
    HC.showReport(order, svg);
  });

  $("sendBtn").addEventListener("click", function () {
    if (!lastResult) return;
    var order = assembleOrder();
    if (!order.customer.name) {
      setSendMsg(HC.t("Укажите ФИО технолога — им подписывается заказ."), "error");
      $("custName").focus();
      return;
    }
    saveCustomer();
    var typeLabel = { circle: HC.t("круг"), rect: HC.t("прямоуг."), oct: HC.t("с фаской"), oval: HC.t("овал") };
    var payload = {
      id: order.id,
      date: order.date,
      name: order.customer.name,
      org: order.customer.org,
      contact: order.customer.contact,
      holderNo: order.holderNo,
      holderName: order.holderName,
      disc: order.disc.name + " (Ø" + order.disc.diameter + ")",
      control: order.controlName,
      parts: order.partsSummary.map(function (r, i) {
        return (i + 1) + ") " + (typeLabel[r.type] || r.type) + " " + r.size + " — " + r.placed +
          (r.requested == null ? " " + HC.t("(макс.)") : HC.t(" из {0}", r.requested));
      }).join("; "),
      placed: order.placed.length,
      clearances: order.clearances.pp + " / " + order.clearances.pe + " / " + order.clearances.pc,
      csv: HC.buildCSV(order)
    };
    $("sendBtn").disabled = true;
    setSendMsg(HC.t("Отправляю…"));
    HC.submitOrder(payload).then(function () {
      setSendMsg(HC.t("Заказ {0} отправлен и записан в таблицу.", order.id), "ok");
      $("sendBtn").disabled = false;
    }).catch(function (err) {
      setSendMsg(HC.t("Не удалось отправить: {0}", err.message), "error");
      $("sendBtn").disabled = false;
    });
  });
})(typeof globalThis !== "undefined" ? globalThis : window);
