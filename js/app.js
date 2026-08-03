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

  function currentDisc() {
    var id = $("discSelect").value;
    for (var i = 0; i < HC.CATALOG.discs.length; i++) {
      if (HC.CATALOG.discs[i].id === id) return HC.CATALOG.discs[i];
    }
    return HC.CATALOG.discs[0];
  }

  // Граница, от которой реально отсчитывается «зазор деталь–край» (clPE) — это
  // Ø зоны напыления (там физически ложится покрытие), а НЕ просто «Ø полезной
  // зоны» (d.diameter, чисто разрешённая площадь размещения — может быть шире
  // зоны напыления). Деталь, стоящая между зоной напыления и Ø полезной зоны,
  // окажется непокрытой — раскладчик и все виды (2D/3D/раскладка) должны
  // одинаково это учитывать. Если зона напыления не задана (сейчас — только у
  // болванок из конструктора) — как и раньше, граница = Ø полезной зоны.
  function packBoundaryDiameter(d) {
    return (d && d.coatingZoneDiameter > 0) ? d.coatingZoneDiameter : (d && d.diameter);
  }

  // Настоящий физический диаметр болванки для отрисовки (полный диск, а НЕ
  // зона напыления/полезная зона — та задаётся отдельно через discDiameter,
  // см. packBoundaryDiameter). У CSV/STEP-импорта blankDiameter — реальный,
  // отдельный от diameter; у конструктора/каталожных записей без blankDiameter
  // сам diameter И ЕСТЬ полный физический диск — используем его как запасной
  // вариант (иначе renderSVG/viewer3d свели бы R к discDiameter, если тот
  // теперь меньше из-за зоны напыления, и нарисовали бы диск меньше, чем он есть).
  function physicalDiameter(d) {
    return (d && d.blankDiameter) || (d && d.diameter);
  }

  // Вариант контрольных отверстий всегда один — первый из каталога; наличие
  // каждого отверстия задаётся его галочкой (выпадающего списка вариантов нет).
  function currentControl() {
    var d = currentDisc();
    return (d.controlVariants && d.controlVariants[0]) || { holes: [] };
  }

  function fillDiscSelect() {
    $("discSelect").innerHTML = HC.CATALOG.discs.map(function (d) {
      var label = HC.t(d.name);
      if (d.installation) label += " — " + d.installation;
      if (d.description) label += " — " + d.description;
      return '<option value="' + escHtml(d.id) + '">' + escHtml(label) + "</option>";
    }).join("");
  }

  function updateDiscInfo() {
    var d = currentDisc();
    $("discInfo").textContent = HC.t("Диаметр диска: {0} мм", d.diameter);
  }

  // ---------- пользовательские подложки (загрузка из CSV, localStorage) ----------

  function isUserDisc(d) { return String(d.id).indexOf("user-") === 0; }

  // Болванка из подключённой папки (STEP, см. js/blank-storage.js) — хранится
  // ФАЙЛОМ в папке, а не в localStorage (иначе быстро упрёмся в его квоту —
  // см. README). Признак — наличие fileName (имя STEP-файла в этой папке).
  // Мигрированные старые STEP-записи (см. migrateOldStepDiscs) файла не имеют
  // (сырые байты раньше не сохранялись) — их метит sourceMissing, но они
  // ТАК ЖЕ живут в индексе папки, а не в localStorage.
  function isFolderDisc(d) { return !!(d && (d.fileName || d.sourceMissing)); }

  // Сохраняются: подложки пользователя (user-*) целиком и ПРАВКИ встроенных
  // (флаг _edited — запись хранится полной копией и при загрузке замещает
  // каталожную по id). Удаление встроенной — список id в hc-hidden-discs.
  // Папочные болванки (isFolderDisc) сюда НЕ попадают — они уже в индексе
  // папки, дублировать в localStorage незачем (и вредно по объёму).
  function saveCustomDiscs() {
    try {
      var custom = HC.CATALOG.discs.filter(function (d) { return (isUserDisc(d) || d._edited) && !isFolderDisc(d); });
      localStorage.setItem("hc-custom-discs", JSON.stringify(custom));
    } catch (e) { /* localStorage недоступен — не критично */ }
  }

  function hiddenDiscIds() {
    try {
      var arr = JSON.parse(localStorage.getItem("hc-hidden-discs") || "[]");
      return Array.isArray(arr) ? arr : [];
    } catch (e) { return []; }
  }

  function hideDiscId(id) {
    try {
      var arr = hiddenDiscIds();
      if (arr.indexOf(id) === -1) arr.push(id);
      localStorage.setItem("hc-hidden-discs", JSON.stringify(arr));
    } catch (e) { /* не критично */ }
  }

  // Добавляет/замещает записи в HC.CATALOG.discs по id — общий шаг для
  // localStorage (loadCustomDiscs) и индекса подключённой папки (loadFolderDiscs).
  function mergeDiscEntries(arr) {
    if (!Array.isArray(arr)) return;
    arr.forEach(function (d) {
      if (!d || !d.id) return;
      var idx = -1;
      HC.CATALOG.discs.forEach(function (x, i) { if (x.id === d.id) idx = i; });
      if (idx >= 0) HC.CATALOG.discs[idx] = d; // правленая встроенная/уже известная — замещает
      else HC.CATALOG.discs.push(d);
    });
  }

  function loadCustomDiscs() {
    try {
      mergeDiscEntries(JSON.parse(localStorage.getItem("hc-custom-discs") || "[]"));
      var hidden = hiddenDiscIds();
      if (hidden.length) {
        HC.CATALOG.discs = HC.CATALOG.discs.filter(function (d) { return hidden.indexOf(d.id) === -1; });
      }
    } catch (e) { /* игнорируем битый кэш */ }
  }

  // ---------- папка с заготовками (STEP-болванки, js/blank-storage.js) ----------
  // Хранит сами STEP-файлы + индекс их метаданных НА ДИСКЕ, а не в
  // localStorage (там быстро кончится квота — см. README). Индекс читается
  // асинхронно при подключении/загрузке страницы; до этого момента таблица
  // просто не содержит папочных болванок — не ошибка, а нормальная задержка.

  function refreshFolderStatus() {
    var el = $("blankFolderStatus");
    if (!el || !HC.blankStorage) return;
    if (!HC.blankStorage.isSupported()) {
      el.textContent = HC.t("Работа с папкой заготовок недоступна в этом браузере (нужен Chrome/Edge).");
    } else if (HC.blankStorage.isConnected()) {
      el.textContent = HC.t("Папка с заготовками подключена.");
    } else {
      el.textContent = HC.t("Папка с заготовками не подключена.");
    }
  }

  function setBlankFolderMsg(text, cls) {
    var el = $("blankFolderMsg");
    if (!el) return;
    el.textContent = text || "";
    el.className = "status" + (cls ? " " + cls : "");
  }

  function loadFolderDiscs() {
    if (!HC.blankStorage || !HC.blankStorage.isConnected()) return Promise.resolve();
    return HC.blankStorage.readIndex().then(function (arr) {
      mergeDiscEntries(arr);
      fillDiscSelect();
      renderBlanksTable();
    }).catch(function (err) {
      setBlankFolderMsg(HC.t("Не удалось прочитать папку: {0}", (err && err.message) || err), "error");
    });
  }

  // Клик по «Подключить папку» — жест пользователя, showDirectoryPicker
  // требует именно его (не может вызываться сам по себе при загрузке страницы).
  function connectBlankFolder() {
    if (!HC.blankStorage) return;
    HC.blankStorage.connect().then(function () {
      refreshFolderStatus();
      setBlankFolderMsg("");
      return loadFolderDiscs();
    }).then(function () {
      return migrateOldStepDiscs();
    }).catch(function (err) {
      setBlankFolderMsg(HC.t("Не удалось подключить папку: {0}", (err && err.message) || err), "error");
    });
  }

  // ---------- миграция старых STEP-болванок (до перехода на папку) ----------
  // Старый STEP-импорт клал болванку с полной (но хрупкой) классификацией
  // отверстий в localStorage как user-* — маркер "Из STEP" в имени варианта
  // (controlVariants[0].name); сырые байты самого файла никогда не
  // сохранялись. При каждом успешном подключении/переподключении папки
  // разворачиваем такие записи в плоский список запретных зон (тем же
  // способом, что и HC.stepImport.keepoutsFromHoles — просто на уже
  // classified holes, без повторного парсинга STEP) и переносим в индекс
  // папки БЕЗ fileName, помечая sourceMissing:true — карточка объясняет, что
  // для честного 3D/экспорта такую болванку стоит перезалить через новый
  // поток. После переноса запись убирается из localStorage — идемпотентно,
  // повторные вызовы (например, при каждом заходе на страницу) находят
  // уже пустой список и ничего не делают.
  function migrateOldStepDiscs() {
    if (!HC.blankStorage || !HC.blankStorage.isConnected() || !HC.stepImport) return Promise.resolve();
    var raw;
    try { raw = JSON.parse(localStorage.getItem("hc-custom-discs") || "[]"); } catch (e) { return Promise.resolve(); }
    if (!Array.isArray(raw)) return Promise.resolve();
    var oldStep = raw.filter(function (d) { return d && d.controlVariants && d.controlVariants[0] && d.controlVariants[0].name === "Из STEP"; });
    if (!oldStep.length) return Promise.resolve();

    var migrated = oldStep.map(function (d) {
      var controlKeepouts = HC.stepImport.keepoutsFromHoles(d.controlVariants[0].holes || []);
      var fixtureKeepouts = [];
      (d.fixtures && d.fixtures.holes || []).forEach(function (grp) {
        (grp.points || []).forEach(function (p) { fixtureKeepouts.push({ x: p[0], y: p[1], r: (grp.d || 0) / 2 }); });
      });
      return {
        id: d.id, name: d.name, installation: d.installation || "", description: d.description || "",
        diameter: d.diameter, blankDiameter: d.blankDiameter, thickness: d.thickness,
        coatingZoneDiameter: d.coatingZoneDiameter,
        previewSVG: "", sourceMissing: true,
        fixtures: {
          holes: HC.stepImport.groupKeepoutsByDiameter(controlKeepouts.concat(fixtureKeepouts)),
          cutouts: (d.fixtures && d.fixtures.cutouts) || [],
          grooves: (d.fixtures && d.fixtures.grooves) || []
        },
        controlVariants: [{ id: "none", name: "Без контрольных отверстий", holes: [] }],
        defaults: d.defaults || { partPart: 6, partEdge: 3, partControl: 6 }
      };
    });

    return HC.blankStorage.readIndex().then(function (arr) {
      migrated.forEach(function (m) {
        var idx = -1;
        arr.forEach(function (x, i) { if (x.id === m.id) idx = i; });
        if (idx >= 0) arr[idx] = m; else arr.push(m);
      });
      return HC.blankStorage.writeIndex(arr);
    }).then(function () {
      var movedIds = {};
      oldStep.forEach(function (d) { movedIds[d.id] = true; });
      var rest = raw.filter(function (d) { return !d || !movedIds[d.id]; });
      try { localStorage.setItem("hc-custom-discs", JSON.stringify(rest)); } catch (e) { /* не критично */ }
      mergeDiscEntries(migrated);
      fillDiscSelect();
      renderBlanksTable();
    }).catch(function (err) {
      setBlankFolderMsg(HC.t("Не удалось перенести старые STEP-болванки в папку: {0}", (err && err.message) || err), "error");
    });
  }

  // Все три способа добавления (CSV/STEP/конструктор) только СОБИРАЮТ запись
  // (pendingBlankEntry) и обновляют превью в модальном окне «Добавить болванку» —
  // название/установка/описание общие (см. saveAddBlankModal), окончательное
  // попадание в каталог происходит только по кнопке «Сохранить» этого окна.

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
        var entry = HC.holderImport.buildDiscEntry(reader.result, {
          id: "user-" + Date.now(), name: HC.t("Подложкодержатель"), discDiameter: zone, thickness: thk > 0 ? thk : 6
        });
        if (!entry) { msg(HC.t("В файле не найдено геометрии — это выгрузка DumpHoles?"), "error"); return; }
        pendingBlankEntry = entry;
        pendingBlankStepBytes = null;
        pendingBlankStepFileName = null;
        schedulePendingBlankPreviewSVG();
        renderAddBlankPreview();
        var extra = entry._threadPoints && entry._threadPoints.length ? HC.t(" Резьбовых отверстий без Ø: {0} (уточните в модели).", entry._threadPoints.length) : "";
        msg(HC.t("Разобрано.{0} Заполните название вверху и нажмите «Сохранить».", extra), "ok");
      } catch (e) {
        msg(HC.t("Ошибка разбора: {0}", e.message), "error");
      }
    };
    reader.onerror = function () { msg(HC.t("Не удалось прочитать файл."), "error"); };
    reader.readAsText(file);
  }

  // Импорт STEP-болванки: отверстия находятся геометрически только чтобы
  // собрать плоский список запретных зон для раскладчика (см. js/step-import.js) —
  // сама геометрия не пересобирается, штатное отверстие/паз в готовой болванке
  // никто по одному не редактирует (см. план в rosy-giggling-stroustrup.md).
  // Файл при сохранении ляжет в подключённую папку заготовок — без неё сохранить
  // такую болванку нельзя (localStorage не годится для хранения самих STEP-файлов).
  function loadDiscFromStepFile() {
    var input = $("discStepFile");
    var msgEl = $("discStepLoadMsg");
    var btn = $("discStepLoadBtn");
    function msg(t, cls) { msgEl.textContent = t || ""; msgEl.className = "status" + (cls ? " " + cls : ""); }
    if (!HC.blankStorage || !HC.blankStorage.isConnected()) {
      msg(HC.t("Сначала подключите папку с заготовками (кнопка над таблицей болванок)."), "error");
      return;
    }
    var file = input.files && input.files[0];
    if (!file) { msg(HC.t("Выберите STEP-файл болванки."), "error"); return; }
    var zone = parseFloat($("discStepZone").value);
    if (!(zone > 0)) { msg(HC.t("Укажите Ø полезной зоны."), "error"); return; }
    if (!HC.stepImport) { msg(HC.t("Модуль импорта STEP не загружен."), "error"); return; }

    var reader = new FileReader();
    reader.onload = function () {
      btn.disabled = true;
      var bytes = reader.result;
      HC.stepImport.fromFile(bytes, { id: "blank-" + Date.now(), name: HC.t("Подложкодержатель"), discDiameter: zone, fileName: file.name }, function (t) { msg(t); })
        .then(function (entry) {
          pendingBlankEntry = entry;
          pendingBlankStepBytes = bytes;
          pendingBlankStepFileName = file.name;
          // тихий фоновый прогрев меша — к переключению на 3D должен быть уже готов;
          // ошибку здесь не показываем (не критично) — она проявится (и будет
          // показана) при реальном открытии 3D в refreshAddBlank3D
          var warmMesh = pendingBlankMesh();
          if (warmMesh) warmMesh.catch(function () {});
          renderAddBlankPreview();
          var zones = entry.fixtures.holes.reduce(function (n, g) { return n + g.points.length; }, 0);
          msg(HC.t("Разобрано: запретных зон для раскладки {0}. Заполните название вверху и нажмите «Сохранить» — файл сохранится в папку заготовок.", zones), "ok");
        })
        .catch(function (err) {
          msg(HC.t("Ошибка разбора STEP: {0}", (err && err.message) || err), "error");
        })
        .then(function () { btn.disabled = false; });
    };
    reader.onerror = function () { msg(HC.t("Не удалось прочитать файл."), "error"); };
    reader.readAsArrayBuffer(file);
  }

  function deleteCurrentDisc() {
    var d = currentDisc();
    if (HC.CATALOG.discs.length <= 1) {
      var msgEl = $("blankSaveMsg");
      msgEl.textContent = HC.t("В каталоге должна остаться хотя бы одна болванка.");
      msgEl.className = "status error";
      return;
    }
    if (!g.confirm(HC.t("Удалить болванку «{0}»? Это действие нельзя отменить.", HC.t(d.name)))) return;
    HC.CATALOG.discs = HC.CATALOG.discs.filter(function (x) { return x.id !== d.id; });
    if (isFolderDisc(d)) {
      // папочная — стираем запись индекса и (если есть) сам файл в подключённой
      // папке; у мигрированных старых записей (sourceMissing) файла нет вовсе
      if (HC.blankStorage && HC.blankStorage.isConnected()) {
        HC.blankStorage.readIndex().then(function (arr) {
          var next = arr.filter(function (x) { return x && x.id !== d.id; });
          return HC.blankStorage.writeIndex(next);
        }).then(function () {
          return d.fileName ? HC.blankStorage.deleteFile(d.fileName) : Promise.resolve();
        }).catch(function () { /* папка могла быть отключена — запись уже убрана из каталога */ });
      }
    } else {
      // встроенная (не user-*) вернулась бы из catalog.js при следующей загрузке —
      // запоминаем её id как скрытый
      if (!isUserDisc(d)) hideDiscId(d.id);
      saveCustomDiscs();
    }
    fillDiscSelect();
    $("discSelect").value = HC.CATALOG.discs[0].id;
    onDiscChange();
  }

  // ---------- реальная 2D-проекция для болванок без исходного STEP-файла ----------
  // Единообразный вид сверху (см. HC.computeBlankPreviewSVG в step-export.js) —
  // одна и та же настоящая проекция, что и у STEP-импорта (js/step-import.js
  // combineProjectionSVG), вместо приближённой схемы из параметров. Считается
  // ЛЕНИВО (один раз при первом показе болванки без previewSVG, не при каждом
  // рендере — WASM недёшев) и кэшируется в самой записи каталога; у STEP-
  // болванок previewSVG уже посчитан при импорте, тут ничего не делаем.
  var previewSVGPending = {}; // id/ссылка на запись -> true, пока считается — не дублируем запрос

  function ensureBlankPreviewSVG(d, onReady) {
    if (!d || d.previewSVG || d.fileName || !HC.computeBlankPreviewSVG) return;
    var key = d.id || d;
    if (previewSVGPending[key]) return;
    previewSVGPending[key] = true;
    HC.computeBlankPreviewSVG(d).then(function (svg) {
      delete previewSVGPending[key];
      d.previewSVG = svg;
      if (onReady) onReady(d);
    }).catch(function () {
      delete previewSVGPending[key]; // не критично — 2D просто останется схематичным
    });
  }

  // Сохраняет посчитанный previewSVG туда же, откуда обычно сохраняется сама
  // запись: индекс подключённой папки для папочных болванок (актуально для
  // sourceMissing — мигрированных без файла, у fileName-болванок previewSVG
  // уже есть с импорта), localStorage — для пользовательских/правленых
  // встроенных. Обычный неправленый каталожный диск — только в памяти на эту
  // сессию (пересчитается заново при следующей загрузке страницы, не страшно).
  function persistBlankPreviewSVG(d) {
    if (isFolderDisc(d)) {
      if (HC.blankStorage && HC.blankStorage.isConnected()) {
        HC.blankStorage.readIndex().then(function (arr) {
          var idx = -1;
          arr.forEach(function (x, i) { if (x.id === d.id) idx = i; });
          if (idx < 0) return;
          arr[idx] = d;
          return HC.blankStorage.writeIndex(arr);
        }).catch(function () { /* папка могла отключиться — не критично */ });
      }
    } else if (isUserDisc(d) || d._edited) {
      saveCustomDiscs();
    }
  }

  function onDiscChange() {
    updateDiscInfo();
    rebuildControlHoles();
    applyDefaultClearances();
    fillBlankFields();
    markDirty();
    // фоновый прогрев настоящего меша STEP (см. HC.viewer3d.updateMesh) —
    // общий discSelect для Конфигуратора и вкладки «Болванки», прогреваем тут
    // один раз на смену болванки, а не в каждом месте, где она выбирается
    scheduleMeshPrefetch(currentDisc());
    ensureBlankPreviewSVG(currentDisc(), function (d) {
      if (currentDisc().id !== d.id) return; // выбор сменился, пока считали
      persistBlankPreviewSVG(d);
      refreshBlanksPreview();
      refreshView();
    });
  }

  function applyDefaultClearances() {
    var d = currentDisc().defaults;
    $("clPP").value = d.partPart;
    $("clPE").value = d.partEdge;
    $("clPC").value = d.partControl;
  }

  // ---------- контрольные отверстия ----------
  // У каждого те же поля, что у круглой детали (d/D/CA/depth/паз) — позиции
  // фиксированы каталогом, наличие/размеры правятся на вкладке «Болванки» и
  // сохраняются в саму запись каталога (см. saveBlankEdits/serializeControlHoles).

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
        // паз по умолчанию включён там, где доступен; угол — сохранённый в
        // каталоге дефолт для этого отверстия (задаётся в конструкторе/при
        // сохранении карточки), если не задан — 0
        slotOn: !!h.slotAvailable, slotAngle: h.slotAngle != null ? h.slotAngle : 0,
        // отверстие, привязанное к другому (по имени): показывается только когда
        // опорное выключено (shownWhenOff) или включено (shownWhenOn)
        shownWhenOff: h.shownWhenOff || null,
        shownWhenOn: h.shownWhenOn || null,
        on: h.on !== false // наличие — из каталога (по умолчанию есть, если не сохранено иное)
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
    // болванки из подключённой папки не разбираются на именованные контрольные
    // отверстия (см. isFolderDisc) — весь список пуст, поясняем почему
    var hintEl = $("controlListEmptyHint");
    if (hintEl) hintEl.hidden = !isFolderDisc(currentDisc());
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
    on(".c-d", "input", function (e) {
      h.d = parseFloat(e.target.value);
      // смена диаметра детали сбрасывает посадку/CA обратно на авто, даже
      // если их правили руками — иначе они остаются от старого d
      h.seatDAuto = true; h.apertureCAAuto = true;
      syncAutoFields(); refreshPreview(); markDirty();
    });
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
        depth: h.depth, slotOn: h.slotOn, slotAngle: h.slotOn ? h.slotAngle : null
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
  // Паз под пинцет у некруглых деталей по умолчанию — вдоль ДЛИННОЙ стороны
  // (больше места на сам паз): 0° — вдоль w, 90° — вдоль h, если h больше.
  function autoSlotAngle(w, h) {
    return (w || 0) >= (h || 0) ? 0 : 90;
  }

  // Диаметр по умолчанию для расположения «по диаметру» — как у Ø свидетеля
  // (кольцо, на котором стоят «Свидетель»/«Свидетель Центр»), если он есть у
  // текущего диска; иначе — старый общий дефолт 150.
  function defaultAnchorD() {
    var holes = currentControl().holes || [];
    var wit = holes.filter(function (h) { return /^Свидетель/.test(h.name || ""); })
      .sort(function (a, b) { return (a.x * a.x + a.y * a.y) - (b.x * b.x + b.y * b.y); })
      .pop(); // самый дальний от центра «Свидетель» — это и есть кольцо
    if (wit) {
      var r = Math.sqrt(wit.x * wit.x + wit.y * wit.y);
      if (r > 0) return Math.round(r * 2 * 100) / 100;
    }
    return 150;
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
      // паз под пинцет — у всех типов деталей; угол для некруглых — авто по
      // длинной стороне, пока пользователь не поправит вручную (slotAngleAuto)
      slotOn: false, slotAngle: autoSlotAngle(20, 10), slotAngleAuto: true,
      qtyMode: "max", qty: 10,
      orientation: "grid",                     // fixed | grid | radial-w | radial-h
      anchor: "center", anchorD: defaultAnchorD() // расположение при неполном заполнении
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
      '<input type="number" class="p-qty" min="1" step="1" value="' + p.qty + '">' +
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
        if (p.slotAngleAuto) {
          p.slotAngle = autoSlotAngle(p.w, p.h);
          var saEl = div.querySelector(".p-slot-angle"); if (saEl) saEl.value = p.slotAngle;
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
    on(".p-d", "input", function (e) {
      p.d = parseFloat(e.target.value);
      // смена диаметра детали сбрасывает посадку/CA обратно на авто, даже
      // если их правили руками — иначе они остаются от старого d
      p.seatDAuto = true; p.apertureCAAuto = true;
      syncAutoFields(); refreshPreview(); markDirty();
    });
    on(".p-seat-d", "input", function (e) { p.seatD = e.target.value === "" ? null : parseFloat(e.target.value); p.seatDAuto = false; syncAutoFields(); refreshPreview(); markDirty(); });
    on(".p-ca", "input", function (e) { p.apertureCA = e.target.value === "" ? null : parseFloat(e.target.value); p.apertureCAAuto = false; refreshPreview(); markDirty(); });
    on(".p-slot-on", "change", function (e) {
      p.slotOn = e.target.checked;
      var angleEl = div.querySelector(".p-slot-angle");
      if (angleEl) angleEl.disabled = !p.slotOn;
      refreshPreview(); markDirty();
    });
    on(".p-slot-angle", "input", function (e) { p.slotAngle = parseFloat(e.target.value); p.slotAngleAuto = false; refreshPreview(); markDirty(); });
    on(".p-w", "input", function (e) { p.w = parseFloat(e.target.value); syncAutoFields(); refreshPreview(); markDirty(); });
    on(".p-h", "input", function (e) { p.h = parseFloat(e.target.value); syncAutoFields(); refreshPreview(); markDirty(); });
    on(".p-seat-gap", "input", function (e) { p.seatGap = e.target.value === "" ? null : parseFloat(e.target.value); p.seatGapAuto = false; refreshPreview(); markDirty(); });
    on(".p-ca-inset", "input", function (e) { p.caInset = e.target.value === "" ? null : parseFloat(e.target.value); p.caInsetAuto = false; refreshPreview(); markDirty(); });
    on(".p-ch", "input", function (e) { p.chamfer = parseFloat(e.target.value); refreshPreview(); markDirty(); });
    on(".p-qty", "input", function (e) {
      p.qty = parseInt(e.target.value, 10);
      markDirty();
      // редактирование количества явно значит «хочу конкретное число», а не
      // максимум — переключаем режим сами, не заставляя отдельно щёлкать
      // радиокнопку (раньше поле вообще было disabled в режиме «максимум»)
      if (p.qtyMode !== "qty") {
        p.qtyMode = "qty";
        renderParts(); // показать радиокнопку/строку «Расположение» в новом состоянии
      }
    });
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
    $("stepBtn").disabled = !enabled;
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
    // вкладка «Болванки» не зависит от результата раскладки — обновляем сразу
    refreshBlanksTab();
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

  // short=true — компактная форма без D/CA (или без фаски у восьмиугольника):
  // используется, когда полное описание всех деталей не влезает в лимит, но
  // хочется сохранить упоминание каждой детали, а не жертвовать какими-то из них.
  function partDescriptor(spec, placedCount, short) {
    var base;
    if (spec.type === "circle") {
      if (short) {
        base = "d" + fmtRuShort(spec.d);
      } else {
        var dims = [];
        if (spec.seatD > 0) dims.push("D" + fmtRuShort(spec.seatD));
        if (spec.apertureCA > 0) dims.push("CA" + fmtRuShort(spec.apertureCA));
        base = "d" + fmtRuShort(spec.d) + (dims.length ? " (" + dims.join("/") + ")" : "");
      }
    } else if (spec.type === "oct" && !short) {
      base = fmtRuShort(spec.w) + "×" + fmtRuShort(spec.h) + "×" + fmtRuShort(spec.chamfer || 0);
    } else {
      base = fmtRuShort(spec.w) + "×" + fmtRuShort(spec.h);
    }
    return base + " N" + placedCount;
  }

  function autoHolderName(opts, perPart) {
    var items = [];
    perPart.forEach(function (r, i) {
      if (r.placed > 0) items.push({ spec: opts.parts[i], placed: r.placed });
    });
    if (!items.length) return "";

    function build(short) {
      return items.map(function (it) { return partDescriptor(it.spec, it.placed, short); }).join("/");
    }

    var name = build(false);
    // не влезает целиком — сначала убираем необязательную детализацию (D/CA,
    // фаску), но сохраняем упоминание КАЖДОЙ детали, а не жертвуем ими
    if (name.length > MAX_HOLDER_NAME) name = build(true);
    if (name.length > MAX_HOLDER_NAME) {
      // даже в компактной форме не влезает — только теперь убираем детали с конца
      var descs = items.map(function (it) { return partDescriptor(it.spec, it.placed, true); });
      while (descs.length > 1 && descs.join("/").length > MAX_HOLDER_NAME) descs.pop();
      name = descs.join("/");
      if (name.length > MAX_HOLDER_NAME) name = name.slice(0, MAX_HOLDER_NAME); // и одно не влезает целиком
    }
    return name;
  }

  function validate() {
    var errs = [];
    var disc = currentDisc();
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
    var fixtureHoles = [];
    ((disc.fixtures && disc.fixtures.holes) || []).forEach(function (grp) {
      if (!(grp.d > 0)) return;
      (grp.points || []).forEach(function (p) { fixtureHoles.push({ x: p[0], y: p[1], d: grp.d }); });
    });
    var opts = {
      discDiameter: packBoundaryDiameter(disc),
      controlHoles: activeControlHoles(),
      fixtureHoles: fixtureHoles,
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
      // раз есть готовая раскладка — скорее всего, дойдут и до «Скачать STEP»;
      // начинаем тихо тянуть CAD-движок (WASM) в фоне заранее, а не ждать клика
      if (HC.preloadSTEP) HC.preloadSTEP();
    }
  }

  function refreshSVG() {
    if (!lastResult) return;
    $("svgHost").innerHTML = HC.renderSVG({
      discDiameter: lastResult.opts.discDiameter,
      blankDiameter: physicalDiameter(lastResult.disc),
      fixtures: lastResult.disc.fixtures,
      edgeRecess: lastResult.disc.edgeRecess,
      coatingZoneDiameter: lastResult.disc.coatingZoneDiameter,
      previewSVG: lastResult.disc.previewSVG,
      edgeClearance: lastResult.opts.clearances.pe,
      controlHoles: lastResult.opts.controlHoles,
      placed: lastResult.placed,
      showNumbers: $("showNumbers").checked
    });
  }

  // ---------- 3D-вид ----------

  var mode3d = false;
  // Для STEP-болванок — выбор между двумя видами 3D (см. #view3dStepToggle):
  // "lite" — приближённая реконструкция слоями из УЖЕ РАЗОБРАННОЙ болванки
  //   (fixtures — плоские запретные зоны), та же buildGroup, что и у
  //   ручных/CSV-болванок — мгновенно, без WASM, но крепёж/фиксации самой
  //   болванки показаны декоративными сквозными кружками (без настоящей
  //   формы посадки/паза — эта деталь потеряна при упрощении STEP-импорта);
  //   детали и контрольные отверстия ЗАКАЗА при этом всё равно рисуются
  //   полноценно (посадка+паз+CA), они берутся из самого заказа, а не из
  //   разобранной болванки.
  // "stp" — настоящий вырезанный STEP (см. refresh3DFromMesh) — медленно.
  var mode3dStep = "lite";

  // Показывает переключатель Lite/STP только для STEP-болванок (fileName) —
  // для остальных выбирать нечего, там всегда честная реконструкция.
  function updateView3dStepToggle() {
    var el = $("view3dStepToggle");
    if (!el) return;
    var isStepDisc = !!(lastResult && lastResult.disc && lastResult.disc.fileName);
    el.hidden = !isStepDisc;
    $("view3dLiteBtn").classList.toggle("active", mode3dStep === "lite");
    $("view3dStpBtn").classList.toggle("active", mode3dStep === "stp");
  }

  function refresh3D() {
    if (!mode3d || !lastResult) return;
    if (!HC.viewer3d || !HC.viewer3d.available()) {
      setViewMode(false);
      setSendMsg(HC.t("3D-вид недоступен в этом браузере (нет WebGL)."), "error");
      return;
    }
    var d = lastResult.disc;
    if (d.fileName && mode3dStep === "stp") {
      refresh3DFromMesh(d);
      return;
    }
    var ok = HC.viewer3d.update($("view3dHost"), {
      discDiameter: lastResult.opts.discDiameter,
      blankDiameter: physicalDiameter(d),
      fixtures: d.fixtures,
      edgeRecess: d.edgeRecess,
      thickness: d.thickness || 6,
      controlHoles: lastResult.opts.controlHoles,
      placed: lastResult.placed,
      showNumbers: $("showNumbers").checked
    });
    if (!ok) {
      setViewMode(false);
      setSendMsg(HC.t("3D-вид недоступен в этом браузере (нет WebGL)."), "error");
    }
  }

  // Болванка с настоящим STEP-файлом — настоящий меш С УЖЕ ВЫРЕЗАННЫМИ
  // карманами деталей заказа (см. HC.buildOrderMeshFromImported — та же
  // булева вырезка, что и при экспорте STEP), а не приближённая декаль
  // поверх нетронутой геометрии. Кэш по ССЫЛКЕ на lastResult — новый
  // doPack() создаёт новый объект lastResult, автоматически инвалидируя кэш;
  // ВНИМАНИЕ: вырезка — та же дорогая булева операция, что и при экспорте,
  // на плотных раскладках (полусотня+ деталей) может заметно подвиснуть.
  var orderMeshCache = { lastResult: null, promise: null };
  function orderMesh(d) {
    if (orderMeshCache.lastResult !== lastResult) {
      orderMeshCache.lastResult = lastResult;
      orderMeshCache.promise = (!HC.blankStorage || !HC.blankStorage.isConnected() || !HC.buildOrderMeshFromImported)
        ? null
        : HC.blankStorage.readStepFile(d.fileName).then(function (buf) {
            var order = { disc: { thickness: d.thickness }, controlHoles: lastResult.opts.controlHoles, placed: lastResult.placed };
            return HC.buildOrderMeshFromImported(order, buf);
          });
    }
    return orderMeshCache.promise;
  }

  function refresh3DFromMesh(d) {
    var targetResult = lastResult;
    var meshPromise = orderMesh(d);
    if (!meshPromise) {
      setSendMsg(HC.t("3D недоступен: не удалось начать резку STEP (папка отключена?)."), "error");
      return;
    }
    setSendMsg(HC.t("Режу карманы в STEP…"));
    meshPromise.then(function (meshData) {
      if (!mode3d || lastResult !== targetResult) return; // раскладка сменилась, пока считалось
      var ok = HC.viewer3d.updateMesh($("view3dHost"), meshData);
      if (ok) setSendMsg("");
      else {
        setViewMode(false);
        setSendMsg(HC.t("3D-вид недоступен в этом браузере (нет WebGL)."), "error");
      }
    }).catch(function (err) {
      if (lastResult !== targetResult) return;
      setSendMsg(HC.t("Не удалось вырезать карманы в STEP: {0}", (err && err.message) || err), "error");
    });
  }

  function refreshView() {
    refreshSVG();
    updateView3dStepToggle();
    refresh3D();
  }

  function setViewMode(is3d) {
    if (is3d && !(HC.viewer3d && HC.viewer3d.available())) {
      // Three.js грузится динамически (см. index.html) — обычно к этому моменту
      // уже готов, но если нет, ждём HC.threeReady вместо мгновенной ошибки.
      if (HC.threeReady) {
        setSendMsg(HC.t("3D-вид загружается…"));
        HC.threeReady.then(function (ok) {
          if (ok && HC.viewer3d && HC.viewer3d.available()) {
            setSendMsg("");
            setViewMode(true);
          } else {
            setSendMsg(HC.t("3D-вид недоступен: библиотека Three.js не загрузилась."), "error");
          }
        });
      } else {
        setSendMsg(HC.t("3D-вид недоступен: библиотека Three.js не загрузилась."), "error");
      }
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

  // ---------- вкладка «Болванки»: таблица + предпросмотр ----------
  // Таблица — весь каталог (HC.CATALOG.discs); клик по строке выбирает ту же
  // подложку, что и #discSelect (вкладка «Конфигуратор») — единый источник
  // истины, редактирование контрольных отверстий ниже относится к ней же.
  // Предпросмотр — без раскладки деталей (placed:[]), только геометрия болванки.
  // По умолчанию ничего не выбрано (blanksExpanded=false) — превью/карточка
  // скрыты, пока не кликнуть строку; «Отмена» прячет их обратно.

  var blanksExpanded = false;

  function escHtml(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  function blankHasHole(d, name) {
    return (d.controlVariants || []).some(function (v) {
      return (v.holes || []).some(function (h) { return h.name === name && h.on !== false; });
    });
  }

  function renderBlanksTable() {
    var host = $("blanksTableBody");
    if (!host) return;
    var curId = $("discSelect").value;
    function yn(b) { return b ? HC.t("есть") : HC.t("нет"); }
    // папочные болванки (isFolderDisc) не разбираются на именованные
    // контрольные отверстия — «нет» тут вводило бы в заблуждение (как будто
    // их нет в геометрии), поэтому прочерк вместо да/нет
    function ynControl(d, name) { return isFolderDisc(d) ? "—" : yn(blankHasHole(d, name)); }
    host.innerHTML = HC.CATALOG.discs.map(function (d) {
      var active = blanksExpanded && d.id === curId;
      return '<tr data-id="' + escHtml(d.id) + '"' + (active ? ' class="active"' : "") + ">" +
        "<td>" + escHtml(HC.t(d.name)) + "</td>" +
        "<td>" + (d.installation ? escHtml(d.installation) : "—") + "</td>" +
        "<td>" + (d.description ? escHtml(d.description) : "—") + "</td>" +
        "<td>" + d.diameter + "</td>" +
        "<td>" + ynControl(d, "Reference") + "</td>" +
        "<td>" + ynControl(d, "Свидетель") + "</td>" +
        "<td>" + ynControl(d, "Свидетель Центр") + "</td>" +
        "</tr>";
    }).join("");
    host.querySelectorAll("tr").forEach(function (tr) {
      tr.addEventListener("click", function () {
        if (blanksExpanded && tr.dataset.id === $("discSelect").value) return;
        blanksSelectRow(tr.dataset.id);
      });
    });
  }

  function blanksSelectRow(id) {
    $("discSelect").value = id;
    onDiscChange();
    blanksExpanded = true;
    $("blanksMain").hidden = false;
    // всегда сбрасываем на 2D: иначе если превью было в 3D и курсор уже
    // оказался над ним (после скролла/повторного клика), колесо мыши крутит
    // зум модели вместо прокрутки страницы
    setBlanksViewMode(false);
    fillBlankFields();
    refreshBlanksPreview();
    renderBlanksTable();
    if ($("blanksMain").scrollIntoView) {
      $("blanksMain").scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }

  function blanksCancelSelection() {
    blanksExpanded = false;
    $("blanksMain").hidden = true;
    renderBlanksTable();
  }

  // ---------- карточка болванки: название/установка, сохранение, история ----------
  // «Название» и «Установка» — ручные поля записи каталога (пишутся в таблицу),
  // НЕ авто-название по составу деталей (то — скрытое #holderName в заказе).

  function fillBlankFields() {
    var d = currentDisc();
    $("blankName").value = d.name;
    $("blankInstall").value = d.installation || "";
    $("blankDesc").value = d.description || "";
    $("blankSaveMsg").textContent = "";
    var hintEl = $("sourceMissingHint");
    if (hintEl) hintEl.hidden = !d.sourceMissing;
    renderBlankHistory();
  }

  function renderBlankHistory() {
    var host = $("blankHistory");
    if (!host) return;
    var d = currentDisc();
    var hist = (d.history || []).slice().reverse(); // свежие сверху
    host.innerHTML = hist.length
      ? hist.map(function (h) {
          return "<div>" + escHtml(h.date) + (h.user ? " — " + escHtml(h.user) : "") + (h.note ? ": " + escHtml(h.note) : "") + "</div>";
        }).join("")
      : "<div>" + HC.t("Изменений пока нет.") + "</div>";
  }

  // Собирает текущее состояние ctrlHoles (наличие/размеры контрольных
  // отверстий) обратно в формат каталога — позиции/имена/привязки не
  // трогаются, правится только то, что реально доступно в форме.
  function serializeControlHoles() {
    return ctrlHoles.map(function (h) {
      var o = { x: h.x, y: h.y, name: h.name };
      if (h.on === false) o.on = false;
      if (h.d != null) o.d = h.d;
      if (h.seatD != null) o.seatD = h.seatD;
      if (h.apertureCA != null) o.apertureCA = h.apertureCA;
      if (h.depth != null) o.depth = h.depth;
      if (h.slotAvailable) { o.slotAvailable = true; o.slotAngle = h.slotAngle; }
      if (h.shownWhenOff) o.shownWhenOff = h.shownWhenOff;
      if (h.shownWhenOn) o.shownWhenOn = h.shownWhenOn;
      return o;
    });
  }

  function saveBlankEdits() {
    var d = currentDisc();
    var msgEl = $("blankSaveMsg");
    function msg(t, cls) { msgEl.textContent = t || ""; msgEl.className = "status" + (cls ? " " + cls : ""); }
    var name = $("blankName").value.trim();
    var install = $("blankInstall").value.trim();
    var desc = $("blankDesc").value.trim();
    if (!name) { msg(HC.t("Укажите название болванки."), "error"); $("blankName").focus(); return; }

    var changes = [];
    if (name !== d.name) changes.push(HC.t("название: «{0}» → «{1}»", d.name, name));
    if (install !== (d.installation || "")) changes.push(HC.t("установка: «{0}» → «{1}»", d.installation || "—", install || "—"));
    if (desc !== (d.description || "")) changes.push(HC.t("описание изменено"));
    d.name = name;
    d.installation = install;
    d.description = desc;

    // контрольные отверстия: наличие (галочка) и размеры — из текущей формы
    if (d.controlVariants && d.controlVariants[0]) {
      var oldHoles = d.controlVariants[0].holes || [];
      var newHoles = serializeControlHoles();
      newHoles.forEach(function (nh, i) {
        var oh = oldHoles[i];
        if (!oh) return;
        var oldOn = oh.on !== false, newOn = nh.on !== false;
        if (oldOn !== newOn) {
          changes.push(HC.t(newOn ? "«{0}»: включено" : "«{0}»: выключено", HC.t(oh.name)));
        } else if (newOn && (oh.seatD !== nh.seatD || oh.apertureCA !== nh.apertureCA || oh.depth !== nh.depth || oh.d !== nh.d || oh.slotAngle !== nh.slotAngle)) {
          changes.push(HC.t("«{0}»: изменены размеры", HC.t(oh.name)));
        }
      });
      d.controlVariants[0].holes = newHoles;
    }

    var now = new Date();
    function p2(x) { return (x < 10 ? "0" : "") + x; }
    d.history = d.history || [];
    d.history.push({
      date: p2(now.getDate()) + "." + p2(now.getMonth() + 1) + "." + now.getFullYear() + " " + p2(now.getHours()) + ":" + p2(now.getMinutes()),
      user: $("custName").value.trim(),
      note: changes.length ? changes.join("; ") : HC.t("правка параметров")
    });

    if (!isUserDisc(d)) d._edited = true; // встроенная — сохраняем полную копию поверх каталога
    saveCustomDiscs();

    var keep = d.id;
    fillDiscSelect();
    $("discSelect").value = keep;
    renderBlanksTable();
    renderBlankHistory();
    refreshBlanksPreview();
    msg(HC.t("Сохранено."), "ok");
  }

  var blanksMode3d = false;

  function setBlanksMsg(text, cls) {
    var el = $("blanksMsg");
    if (!el) return;
    el.textContent = text || "";
    el.className = "status" + (cls ? " " + cls : "");
  }

  // ---------- реальный меш болванки из STEP (для 3D папочных болванок) ----------
  // Настоящая твердотельная геометрия (а не приближённая реконструкция
  // buildGroup слоями) — считается один раз через тот же CAD-движок, что и
  // импорт (см. HC.loadReplicad в step-export.js), кэшируется по id диска на
  // сессию (вкладку не перезагружаем — WASM-разбор STEP не бесплатный).
  // Фоново подогревается при выборе строки таблицы (scheduleMeshPrefetch), чтобы
  // клик по кнопке «3D» обычно попадал в уже готовый кэш.
  var stepMeshCache = {}; // id -> Promise<{vertices,triangles,normals}>
  var blanksMeshPrefetchTimer = null;

  function prefetchDiscMesh(d) {
    if (!d || !d.fileName || stepMeshCache[d.id]) return;
    if (!HC.blankStorage || !HC.blankStorage.isConnected() || !HC.loadReplicad) return;
    stepMeshCache[d.id] = HC.blankStorage.readStepFile(d.fileName).then(function (buf) {
      return HC.loadReplicad().then(function (rep) {
        return rep.importSTEP(new Blob([buf])).then(function (shape) { return shape.mesh(); });
      });
    }).catch(function (err) {
      delete stepMeshCache[d.id]; // не кэшируем ошибку — следующий выбор строки попробует заново
      throw err;
    });
  }

  function scheduleMeshPrefetch(d) {
    if (blanksMeshPrefetchTimer) clearTimeout(blanksMeshPrefetchTimer);
    if (!d || !d.fileName) return;
    blanksMeshPrefetchTimer = setTimeout(function () { prefetchDiscMesh(d); }, 250);
  }

  function refreshBlanksSVG() {
    var d = currentDisc();
    $("blanksSvgHost").innerHTML = HC.renderSVG({
      discDiameter: packBoundaryDiameter(d),
      blankDiameter: physicalDiameter(d),
      fixtures: d.fixtures,
      edgeRecess: d.edgeRecess,
      coatingZoneDiameter: d.coatingZoneDiameter,
      previewSVG: d.previewSVG,
      controlHoles: activeControlHoles(),
      placed: [],
      showNumbers: false
    });
  }

  // Тот же выбор Lite/STP, что и в Конфигураторе (см. mode3dStep/
  // updateView3dStepToggle) — по умолчанию Lite (мгновенная реконструкция),
  // честный STEP-меш — по явному запросу.
  var blanksMode3dStep = "lite";
  function updateBlanksView3dStepToggle() {
    var el = $("blanksView3dStepToggle");
    if (!el) return;
    var d = currentDisc();
    el.hidden = !(d && d.fileName);
    $("blanksView3dLiteBtn").classList.toggle("active", blanksMode3dStep === "lite");
    $("blanksView3dStpBtn").classList.toggle("active", blanksMode3dStep === "stp");
  }

  function refreshBlanks3D() {
    if (!blanksMode3d) return;
    var d = currentDisc();
    if (!HC.viewer3d || !HC.viewer3d.available()) {
      setBlanksViewMode(false);
      setBlanksMsg(HC.t("3D-вид недоступен в этом браузере (нет WebGL)."), "error");
      return;
    }
    if (d.fileName && blanksMode3dStep === "stp") {
      refreshBlanks3DFromMesh(d);
      return;
    }
    var ok = HC.viewer3d.update($("blanksView3dHost"), {
      discDiameter: packBoundaryDiameter(d),
      blankDiameter: physicalDiameter(d),
      fixtures: d.fixtures,
      edgeRecess: d.edgeRecess,
      thickness: d.thickness || 6,
      controlHoles: activeControlHoles(),
      placed: [],
      showNumbers: false
    });
    if (!ok) {
      setBlanksViewMode(false);
      setBlanksMsg(HC.t("3D-вид недоступен в этом браузере (нет WebGL)."), "error");
    }
  }

  // Папочная болванка с настоящим STEP-файлом — честный меш вместо
  // реконструкции слоями (см. HC.viewer3d.updateMesh). Если фоновый
  // прогрев (scheduleMeshPrefetch) уже закончился — обновление мгновенное;
  // иначе ждём тот же промис и проверяем, что выбор не сменился, пока грузилось.
  function refreshBlanks3DFromMesh(d) {
    prefetchDiscMesh(d); // на случай если фон ещё не запускался (debounce не сработал)
    var entry = stepMeshCache[d.id];
    if (!entry) {
      setBlanksMsg(HC.t("3D недоступен: не удалось начать загрузку STEP (папка отключена?)."), "error");
      return;
    }
    setBlanksMsg(HC.t("Разбираю STEP…"));
    entry.then(function (meshData) {
      if (!blanksMode3d || currentDisc().id !== d.id) return; // выбор сменился, пока грузилось
      var ok = HC.viewer3d.updateMesh($("blanksView3dHost"), meshData);
      if (ok) setBlanksMsg("");
      else {
        setBlanksViewMode(false);
        setBlanksMsg(HC.t("3D-вид недоступен в этом браузере (нет WebGL)."), "error");
      }
    }).catch(function (err) {
      if (!blanksMode3d || currentDisc().id !== d.id) return;
      setBlanksMsg(HC.t("Не удалось построить 3D из STEP: {0}", (err && err.message) || err), "error");
    });
  }

  function refreshBlanksPreview() {
    var d = currentDisc();
    $("blanksSummary").textContent = HC.t(d.name) + " · Ø" + d.diameter;
    refreshBlanksSVG();
    updateBlanksView3dStepToggle();
    refreshBlanks3D();
  }

  function setBlanksViewMode(is3d) {
    if (is3d && !(HC.viewer3d && HC.viewer3d.available())) {
      if (HC.threeReady) {
        setBlanksMsg(HC.t("3D-вид загружается…"));
        HC.threeReady.then(function (ok) {
          if (ok && HC.viewer3d && HC.viewer3d.available()) {
            setBlanksMsg("");
            setBlanksViewMode(true);
          } else {
            setBlanksMsg(HC.t("3D-вид недоступен: библиотека Three.js не загрузилась."), "error");
          }
        });
      } else {
        setBlanksMsg(HC.t("3D-вид недоступен: библиотека Three.js не загрузилась."), "error");
      }
      return;
    }
    blanksMode3d = is3d;
    $("blanksView2dBtn").classList.toggle("active", !is3d);
    $("blanksView3dBtn").classList.toggle("active", is3d);
    $("blanksSvgHost").hidden = is3d;
    $("blanksView3dHost").hidden = !is3d;
    if (is3d) refreshBlanks3D();
  }

  function refreshBlanksTab() {
    renderBlanksTable();
    if (blanksExpanded) refreshBlanksPreview();
  }

  // ---------- ручной конструктор болванки ----------
  // Состояние формы «Создать самому»: списки свидетелей/Reference и крепёжных
  // групп; геометрия/каталожная запись собирается в js/blank-builder.js.

  var mbWitnesses = []; // [{name, mode, r, angle, x, y, seatD, apertureCA, depth, slotAvailable, slotAngle}]
  var mbFixtures = [];  // [{label, d, mode, r, count, rotation, x, y}]
  var mbCoatingZoneAuto = true; // пока true — поле «Зона напыления» следует за Ø диска/занижения (см. syncCoatingZoneAuto)

  // Авто-Ø зоны напыления: меньше диска на 3мм; если включено занижение по
  // краю — меньше диаметра ЗАНИЖЕНИЯ на те же 3мм (напыление не заходит на
  // занижение). Пока пользователь не тронул поле руками (mbCoatingZoneAuto).
  function autoCoatingZoneDia() {
    var dia = parseFloat($("mbDia").value);
    if (!(dia > 0)) return null;
    var base = dia;
    if ($("mbRecessOn").checked) {
      var rDia = parseFloat($("mbRecessDia").value);
      if (rDia > 0) base = Math.min(base, rDia);
    }
    return Math.max(1, Math.round((base - 3) * 100) / 100);
  }
  function syncCoatingZoneAuto() {
    if (!mbCoatingZoneAuto) return;
    var v = autoCoatingZoneDia();
    if (v != null) $("mbCoatingZoneDia").value = v;
  }
  // Текущая Ø зоны напыления для дефолтов расположения свидетеля/крепежа —
  // из поля формы, если введено, иначе разумный запасной вариант (диск ещё
  // не задан или зона напыления явно очищена).
  function currentCoatingZoneDia() {
    var v = parseFloat($("mbCoatingZoneDia").value);
    return v > 0 ? v : (autoCoatingZoneDia() || 300);
  }

  function defaultWitness() {
    return {
      name: "Свидетель", mode: "polar", r: currentCoatingZoneDia() / 2, angle: 0, x: 0, y: 0,
      d: 25.4, seatD: 25.6, apertureCA: 22.6, depth: 4.5,
      slotAvailable: true, slotAngle: 0
    };
  }
  function defaultFixture() {
    return { label: "Крепёж", d: 3.3, mode: "diameter", r: currentCoatingZoneDia() / 2, count: 3, rotation: 0, x: 0, y: 0 };
  }

  function mbWitnessRow(wit, i) {
    var div = document.createElement("div");
    div.className = "mb-row";
    var isPolar = wit.mode !== "xy";
    div.innerHTML =
      '<div class="row-head"><label style="margin:0">' + HC.t("Имя") + ' <input type="text" class="w-name" style="width:150px" value="' + escHtml(wit.name) + '"></label>' +
      '<button type="button" class="w-del p-del" title="' + HC.t("Удалить") + '">✕</button></div>' +
      '<label>' + HC.t("Позиция") + '<select class="w-mode">' +
      '<option value="polar"' + (isPolar ? " selected" : "") + ">" + HC.t("по диаметру и углу") + "</option>" +
      '<option value="xy"' + (!isPolar ? " selected" : "") + ">" + HC.t("точные координаты X,Y") + "</option>" +
      "</select></label>" +
      (isPolar
        ? '<div class="dims">' +
          "<label>" + HC.t("Ø расположения, мм") + '<input type="number" class="w-r" step="0.1" value="' + (wit.r * 2) + '"></label>' +
          "<label>" + HC.t("Угол, °") + '<input type="number" class="w-angle" step="1" value="' + wit.angle + '"></label>' +
          "</div>"
        : '<div class="dims">' +
          "<label>X, " + HC.t("мм") + '<input type="number" class="w-x" step="0.01" value="' + wit.x + '"></label>' +
          "<label>Y, " + HC.t("мм") + '<input type="number" class="w-y" step="0.01" value="' + wit.y + '"></label>' +
          "</div>") +
      '<div class="dims">' +
      "<label>" + HC.t("Деталь d, мм") + '<input type="number" class="w-d" min="0" step="0.1" value="' + (wit.d == null ? "" : wit.d) + '"></label>' +
      "<label>" + HC.t("Ø посадки D, мм") + '<input type="number" class="w-seat-d" min="0" step="0.1" value="' + (wit.seatD == null ? "" : wit.seatD) + '"></label>' +
      "<label>" + HC.t("Зона CA, мм") + '<input type="number" class="w-ca" min="0" step="0.1" value="' + (wit.apertureCA == null ? "" : wit.apertureCA) + '"></label>' +
      "<label>" + HC.t("Глубина, мм") + '<input type="number" class="w-depth" min="0" step="0.1" value="' + (wit.depth == null ? "" : wit.depth) + '"></label>' +
      "</div>" +
      '<div class="slot-line">' +
      '<label><input type="checkbox" class="w-slot-on"' + (wit.slotAvailable ? " checked" : "") + "> " + HC.t("паз под пинцет") + "</label>" +
      "<label>" + HC.t("Угол, °") + '<input type="number" class="w-slot-angle" min="0" max="359" step="1" value="' + wit.slotAngle + '"' + (wit.slotAvailable ? "" : " disabled") + "></label>" +
      "</div>";
    function on(sel, ev, fn) { var el = div.querySelector(sel); if (el) el.addEventListener(ev, fn); }
    function num(v) { var x = parseFloat(v); return isNaN(x) ? null : x; }
    on(".w-name", "input", function (e) { wit.name = e.target.value; scheduleConstructorPreview(); });
    on(".w-mode", "change", function (e) { wit.mode = e.target.value; renderMbWitnesses(); scheduleConstructorPreview(); });
    on(".w-r", "input", function (e) { wit.r = (num(e.target.value) || 0) / 2; scheduleConstructorPreview(); });
    on(".w-angle", "input", function (e) { wit.angle = num(e.target.value) || 0; scheduleConstructorPreview(); });
    on(".w-x", "input", function (e) { wit.x = num(e.target.value) || 0; scheduleConstructorPreview(); });
    on(".w-y", "input", function (e) { wit.y = num(e.target.value) || 0; scheduleConstructorPreview(); });
    on(".w-d", "input", function (e) { wit.d = num(e.target.value); scheduleConstructorPreview(); });
    on(".w-seat-d", "input", function (e) { wit.seatD = num(e.target.value); scheduleConstructorPreview(); });
    on(".w-ca", "input", function (e) { wit.apertureCA = num(e.target.value); scheduleConstructorPreview(); });
    on(".w-depth", "input", function (e) { wit.depth = num(e.target.value); scheduleConstructorPreview(); });
    on(".w-slot-on", "change", function (e) {
      wit.slotAvailable = e.target.checked;
      var angleEl = div.querySelector(".w-slot-angle");
      if (angleEl) angleEl.disabled = !wit.slotAvailable;
      scheduleConstructorPreview();
    });
    on(".w-slot-angle", "input", function (e) { wit.slotAngle = num(e.target.value) || 0; scheduleConstructorPreview(); });
    on(".w-del", "click", function () { mbWitnesses.splice(i, 1); renderMbWitnesses(); scheduleConstructorPreview(); });
    return div;
  }

  function mbFixtureRow(fx, i) {
    var div = document.createElement("div");
    div.className = "mb-row";
    var byDia = fx.mode !== "xy";
    div.innerHTML =
      '<div class="row-head"><label style="margin:0">' + HC.t("Метка") + ' <input type="text" class="f-label" style="width:150px" value="' + escHtml(fx.label) + '"></label>' +
      '<button type="button" class="f-del p-del" title="' + HC.t("Удалить") + '">✕</button></div>' +
      '<div class="dims">' +
      "<label>" + HC.t("Ø отверстия, мм") + '<input type="number" class="f-d" min="0.1" step="0.1" value="' + fx.d + '"></label>' +
      "<label>" + HC.t("Позиция") + '<select class="f-mode">' +
      '<option value="diameter"' + (byDia ? " selected" : "") + ">" + HC.t("по диаметру, N штук") + "</option>" +
      '<option value="xy"' + (!byDia ? " selected" : "") + ">" + HC.t("точные координаты X,Y") + "</option>" +
      "</select></label>" +
      "</div>" +
      (byDia
        ? '<div class="dims">' +
          "<label>" + HC.t("Ø расположения, мм") + '<input type="number" class="f-r" step="0.1" value="' + (fx.r * 2) + '"></label>' +
          "<label>" + HC.t("Количество") + '<input type="number" class="f-count" min="1" step="1" value="' + fx.count + '"></label>' +
          "<label>" + HC.t("Поворот, °") + '<input type="number" class="f-rotation" step="1" value="' + (fx.rotation || 0) + '"></label>' +
          "</div>"
        : '<div class="dims">' +
          "<label>X, " + HC.t("мм") + '<input type="number" class="f-x" step="0.01" value="' + (fx.x || 0) + '"></label>' +
          "<label>Y, " + HC.t("мм") + '<input type="number" class="f-y" step="0.01" value="' + (fx.y || 0) + '"></label>' +
          "</div>");
    function on(sel, ev, fn) { var el = div.querySelector(sel); if (el) el.addEventListener(ev, fn); }
    function num(v) { var x = parseFloat(v); return isNaN(x) ? null : x; }
    on(".f-label", "input", function (e) { fx.label = e.target.value; scheduleConstructorPreview(); });
    on(".f-d", "input", function (e) { fx.d = num(e.target.value); scheduleConstructorPreview(); });
    on(".f-mode", "change", function (e) { fx.mode = e.target.value; renderMbFixtures(); scheduleConstructorPreview(); });
    on(".f-r", "input", function (e) { fx.r = (num(e.target.value) || 0) / 2; scheduleConstructorPreview(); });
    on(".f-count", "input", function (e) { fx.count = parseInt(e.target.value, 10) || 1; scheduleConstructorPreview(); });
    on(".f-rotation", "input", function (e) { fx.rotation = num(e.target.value) || 0; scheduleConstructorPreview(); });
    on(".f-x", "input", function (e) { fx.x = num(e.target.value) || 0; scheduleConstructorPreview(); });
    on(".f-y", "input", function (e) { fx.y = num(e.target.value) || 0; scheduleConstructorPreview(); });
    on(".f-del", "click", function () { mbFixtures.splice(i, 1); renderMbFixtures(); scheduleConstructorPreview(); });
    return div;
  }

  function renderMbWitnesses() {
    var host = $("mbWitnessList");
    if (!host) return;
    host.innerHTML = "";
    mbWitnesses.forEach(function (w, i) { host.appendChild(mbWitnessRow(w, i)); });
  }

  function renderMbFixtures() {
    var host = $("mbFixtureList");
    if (!host) return;
    host.innerHTML = "";
    mbFixtures.forEach(function (f, i) { host.appendChild(mbFixtureRow(f, i)); });
  }

  // Живой предпросмотр конструктора: пересобирает pendingBlankEntry и
  // обновляет превью в модальном окне на каждое изменение поля, без ожидания
  // клика «Собрать» — молча ничего не делает, пока введённые данные не
  // складываются в валidную геометрию (это черновой ввод, а не отправка формы).
  var mbPreviewTimer = null;
  function scheduleConstructorPreview() {
    if (mbPreviewTimer) clearTimeout(mbPreviewTimer);
    mbPreviewTimer = setTimeout(updateConstructorPreviewLive, 200);
  }
  function updateConstructorPreviewLive() {
    var dia = parseFloat($("mbDia").value);
    var thk = parseFloat($("mbThk").value);
    if (!(dia > 0) || !(thk > 0)) return;

    var recess = null;
    if ($("mbRecessOn").checked) {
      var rDia = parseFloat($("mbRecessDia").value), rDepth = parseFloat($("mbRecessDepth").value);
      if (rDia > 0 && rDepth > 0 && rDia < dia && rDepth < thk) {
        recess = { side: $("mbRecessSide").value, diameter: rDia, depth: rDepth };
      }
    }

    var coatingZoneDia = parseFloat($("mbCoatingZoneDia").value);
    pendingBlankEntry = HC.blankBuilder.buildManualDiscEntry({
      id: pendingBlankEntry ? pendingBlankEntry.id : undefined, name: HC.t("Болванка"), diameter: dia, thickness: thk,
      coatingZoneDiameter: coatingZoneDia > 0 ? coatingZoneDia : null,
      edgeRecess: recess, witnesses: mbWitnesses, fixtureGroups: mbFixtures
    });
    pendingBlankStepBytes = null;
    pendingBlankStepFileName = null;
    schedulePendingBlankPreviewSVG();
    renderAddBlankPreview();
  }

  function createManualBlank() {
    var msgEl = $("mbMsg");
    function msg(t, cls) { msgEl.textContent = t || ""; msgEl.className = "status" + (cls ? " " + cls : ""); }
    var dia = parseFloat($("mbDia").value);
    var thk = parseFloat($("mbThk").value);
    if (!(dia > 0)) { msg(HC.t("Укажите диаметр болванки."), "error"); return; }
    if (!(thk > 0)) { msg(HC.t("Укажите толщину болванки."), "error"); return; }

    var recess = null;
    if ($("mbRecessOn").checked) {
      recess = {
        side: $("mbRecessSide").value,
        diameter: parseFloat($("mbRecessDia").value),
        depth: parseFloat($("mbRecessDepth").value)
      };
      if (!(recess.diameter > 0) || !(recess.depth > 0)) { msg(HC.t("Занижение по краю: укажите Ø границы и глубину."), "error"); return; }
      if (recess.diameter >= dia) { msg(HC.t("Ø границы занижения должен быть меньше диаметра болванки."), "error"); return; }
      if (recess.depth >= thk) { msg(HC.t("Глубина занижения должна быть меньше толщины."), "error"); return; }
    }

    var coatingZoneDia = parseFloat($("mbCoatingZoneDia").value);
    var entry = HC.blankBuilder.buildManualDiscEntry({
      id: "user-" + Date.now(), name: HC.t("Болванка"), diameter: dia, thickness: thk,
      coatingZoneDiameter: coatingZoneDia > 0 ? coatingZoneDia : null,
      edgeRecess: recess, witnesses: mbWitnesses, fixtureGroups: mbFixtures
    });
    pendingBlankEntry = entry;
    pendingBlankStepBytes = null;
    pendingBlankStepFileName = null;
    schedulePendingBlankPreviewSVG();
    renderAddBlankPreview();
    msg(HC.t("Собрано. Заполните название вверху и нажмите «Сохранить»."), "ok");
  }

  // ---------- модальное окно «Добавить болванку» ----------
  // Общие поля (название/установка/описание) — сверху; ниже — три способа
  // получить геометрию (CSV/STEP/конструктор), каждый только СОБИРАЕТ запись
  // (pendingBlankEntry) и обновляет превью здесь же; «Сохранить» применяет
  // общие поля и добавляет запись в каталог, «Отмена» просто закрывает окно.

  var pendingBlankEntry = null;
  // если запись пришла из STEP — сырые байты файла + предложенное имя, чтобы
  // saveAddBlankModal записал сам файл в подключённую папку заготовок
  // (см. js/blank-storage.js); для CSV/конструктора оба всегда null.
  var pendingBlankStepBytes = null;
  var pendingBlankStepFileName = null;
  var addBlankMode3d = false;

  // Реальная 2D-проекция для CSV/конструктор-записей в самой модалке (см.
  // ensureBlankPreviewSVG выше — то же единообразие с STEP: previewSVG вместо
  // приближённой схемы). Отдельный, более длинный дебаунс (не как у мгновенной
  // схематичной 2D-схемы) — WASM недёшев гонять на каждое движение слайдера в
  // конструкторе; при смене параметров pendingBlankEntry подменяется НОВЫМ
  // объектом — проверка ниже отбрасывает устаревший результат, если параметры
  // успели поменяться, пока считалось.
  var pendingPreviewTimer = null;
  function schedulePendingBlankPreviewSVG() {
    if (pendingPreviewTimer) clearTimeout(pendingPreviewTimer);
    pendingPreviewTimer = setTimeout(function () {
      var target = pendingBlankEntry;
      if (!target || target.previewSVG || target.fileName || !HC.computeBlankPreviewSVG) return;
      HC.computeBlankPreviewSVG(target).then(function (svg) {
        if (pendingBlankEntry !== target) return; // параметры уже сменились, результат устарел
        target.previewSVG = svg;
        renderAddBlankPreview();
      }).catch(function () { /* не критично — превью останется схематичным */ });
    }, 500);
  }

  function addBlankPreviewHoles(d) {
    var holes = (d.controlVariants && d.controlVariants[0] && d.controlVariants[0].holes) || [];
    // сырые holes из каталога несут только slotAvailable (возможность паза);
    // renderSVG/viewer3d рисуют паз по slotOn (реальный переключатель заказа) —
    // здесь заказа нет, поэтому паз включаем везде, где он в принципе доступен
    return holes.map(function (h) {
      return h.slotAvailable ? Object.assign({}, h, { slotOn: true, slotAngle: h.slotAngle || 0 }) : h;
    });
  }

  function refreshAddBlankSVG() {
    var host = $("addBlankPreviewHost");
    if (!pendingBlankEntry) { host.innerHTML = ""; return; }
    var d = pendingBlankEntry;
    host.innerHTML = HC.renderSVG({
      discDiameter: packBoundaryDiameter(d),
      blankDiameter: physicalDiameter(d),
      fixtures: d.fixtures,
      edgeRecess: d.edgeRecess,
      coatingZoneDiameter: d.coatingZoneDiameter,
      previewSVG: d.previewSVG,
      controlHoles: addBlankPreviewHoles(d),
      placed: [],
      showNumbers: false
    });
  }

  // Пока запись собирается в модалке из STEP, сырые байты уже в памяти
  // (pendingBlankStepBytes) — не нужно ни подключать папку, ни писать файл,
  // чтобы посчитать настоящий меш для 3D-превью здесь же. Кэш по идентичности
  // байт (меняются только при новой загрузке STEP/переключении на CSV или
  // конструктор — тогда pendingBlankStepBytes становится null, и следующий
  // вызов просто вернёт null вместо промиса).
  var pendingBlankMeshBytes = null;
  var pendingBlankMeshPromise = null;
  function pendingBlankMesh() {
    if (pendingBlankMeshBytes !== pendingBlankStepBytes) {
      pendingBlankMeshBytes = pendingBlankStepBytes;
      pendingBlankMeshPromise = (pendingBlankStepBytes && HC.loadReplicad)
        ? HC.loadReplicad().then(function (rep) {
            return rep.importSTEP(new Blob([pendingBlankStepBytes])).then(function (shape) { return shape.mesh(); });
          })
        : null;
    }
    return pendingBlankMeshPromise;
  }

  // Тот же выбор Lite/STP, что и везде (см. mode3dStep) — по умолчанию Lite.
  var addBlankMode3dStep = "lite";
  function updateAddBlankView3dStepToggle() {
    var el = $("addBlankView3dStepToggle");
    if (!el) return;
    el.hidden = !pendingBlankStepBytes;
    $("addBlankView3dLiteBtn").classList.toggle("active", addBlankMode3dStep === "lite");
    $("addBlankView3dStpBtn").classList.toggle("active", addBlankMode3dStep === "stp");
  }

  function refreshAddBlank3D() {
    if (!addBlankMode3d) return;
    var host = $("addBlankView3dHost");
    if (!pendingBlankEntry) { return; }
    if (!HC.viewer3d || !HC.viewer3d.available()) {
      setAddBlankViewMode(false);
      setAddBlankMsg(HC.t("3D-вид недоступен в этом браузере (нет WebGL)."), "error");
      return;
    }
    var d = pendingBlankEntry;
    var meshPromise = pendingBlankStepBytes && addBlankMode3dStep === "stp" ? pendingBlankMesh() : null;
    if (meshPromise) {
      // настоящий STEP-меш вместо приближённой реконструкции слоями (см.
      // refreshBlanks3DFromMesh — тот же приём для уже сохранённых болванок)
      var bytesAtRequest = pendingBlankStepBytes;
      setAddBlankMsg(HC.t("Разбираю STEP…"));
      meshPromise.then(function (meshData) {
        if (!addBlankMode3d || pendingBlankStepBytes !== bytesAtRequest) return; // сменилось, пока грузилось
        var ok = HC.viewer3d.updateMesh(host, meshData);
        if (ok) setAddBlankMsg("");
        else {
          setAddBlankViewMode(false);
          setAddBlankMsg(HC.t("3D-вид недоступен в этом браузере (нет WebGL)."), "error");
        }
      }).catch(function (err) {
        if (pendingBlankStepBytes !== bytesAtRequest) return;
        setAddBlankMsg(HC.t("Не удалось построить 3D из STEP: {0}", (err && err.message) || err), "error");
      });
      return;
    }
    var ok = HC.viewer3d.update(host, {
      discDiameter: packBoundaryDiameter(d),
      blankDiameter: physicalDiameter(d),
      fixtures: d.fixtures,
      edgeRecess: d.edgeRecess,
      thickness: d.thickness || 6,
      controlHoles: addBlankPreviewHoles(d),
      placed: [],
      showNumbers: false
    });
    if (!ok) {
      setAddBlankViewMode(false);
      setAddBlankMsg(HC.t("3D-вид недоступен в этом браузере (нет WebGL)."), "error");
    }
  }

  function setAddBlankMsg(text, cls) {
    var el = $("addBlankMsg");
    el.textContent = text || "";
    el.className = "status" + (cls ? " " + cls : "");
  }

  function setAddBlankViewMode(is3d) {
    if (is3d && !(HC.viewer3d && HC.viewer3d.available())) {
      if (HC.threeReady) {
        setAddBlankMsg(HC.t("3D-вид загружается…"));
        HC.threeReady.then(function (ok) {
          if (ok && HC.viewer3d && HC.viewer3d.available()) {
            renderAddBlankPreview();
            setAddBlankViewMode(true);
          } else {
            setAddBlankMsg(HC.t("3D-вид недоступен: библиотека Three.js не загрузилась."), "error");
          }
        });
      } else {
        setAddBlankMsg(HC.t("3D-вид недоступен: библиотека Three.js не загрузилась."), "error");
      }
      return;
    }
    addBlankMode3d = is3d;
    $("addBlankView2dBtn").classList.toggle("active", !is3d);
    $("addBlankView3dBtn").classList.toggle("active", is3d);
    $("addBlankPreviewHost").hidden = is3d;
    $("addBlankView3dHost").hidden = !is3d;
    if (is3d) refreshAddBlank3D();
  }

  function renderAddBlankPreview() {
    if (!pendingBlankEntry) {
      $("addBlankPreviewHost").innerHTML = "";
      setAddBlankMsg(HC.t("Загрузите CSV/STEP или соберите болванку конструктором ниже."));
      return;
    }
    var d = pendingBlankEntry;
    refreshAddBlankSVG();
    updateAddBlankView3dStepToggle();
    refreshAddBlank3D();
    setAddBlankMsg(HC.t("Готово к сохранению: Ø{0}, толщина {1} мм.", d.diameter, d.thickness), "ok");
  }

  function openAddBlankModal() {
    pendingBlankEntry = null;
    pendingBlankStepBytes = null;
    pendingBlankStepFileName = null;
    $("nbName").value = "";
    $("nbInstall").value = "";
    $("nbDesc").value = "";
    mbCoatingZoneAuto = true;
    syncCoatingZoneAuto();
    setAddBlankViewMode(false);
    renderAddBlankPreview();
    $("addBlankModal").hidden = false;
  }

  function closeAddBlankModal() {
    $("addBlankModal").hidden = true;
    pendingBlankEntry = null;
    pendingBlankStepBytes = null;
    pendingBlankStepFileName = null;
  }

  function saveAddBlankModal() {
    var msgEl = $("addBlankModalMsg");
    function msg(t, cls) { msgEl.textContent = t || ""; msgEl.className = "status" + (cls ? " " + cls : ""); }
    if (!pendingBlankEntry) {
      msg(HC.t("Сначала загрузите CSV/STEP или соберите болванку одним из способов ниже."), "error");
      return;
    }
    var name = $("nbName").value.trim();
    if (!name) { msg(HC.t("Укажите название болванки."), "error"); $("nbName").focus(); return; }
    var entry = pendingBlankEntry;
    entry.name = name;
    entry.installation = $("nbInstall").value.trim();
    entry.description = $("nbDesc").value.trim();
    if (!entry.id) entry.id = "user-" + Date.now();

    if (pendingBlankStepBytes) {
      // папочная болванка — сначала пишем сам файл и индекс в подключённую
      // папку, каталог обновляем только после успешной записи (иначе запись
      // в HC.CATALOG.discs будет ссылаться на fileName, которого нет на диске)
      if (!HC.blankStorage || !HC.blankStorage.isConnected()) {
        msg(HC.t("Папка с заготовками не подключена — файл сохранить некуда."), "error");
        return;
      }
      entry.fileName = pendingBlankStepFileName;
      var bytes = pendingBlankStepBytes;
      HC.blankStorage.writeStepFile(entry.fileName, bytes)
        .then(function () { return HC.blankStorage.readIndex(); })
        .then(function (arr) {
          arr = arr.filter(function (x) { return x && x.id !== entry.id; });
          arr.push(entry);
          return HC.blankStorage.writeIndex(arr);
        })
        .then(function () {
          HC.CATALOG.discs.push(entry);
          saveCustomDiscs();
          fillDiscSelect();
          closeAddBlankModal();
          blanksSelectRow(entry.id);
        })
        .catch(function (err) {
          msg(HC.t("Не удалось сохранить в папку: {0}", (err && err.message) || err), "error");
        });
      return;
    }

    HC.CATALOG.discs.push(entry);
    saveCustomDiscs();
    fillDiscSelect();
    closeAddBlankModal();
    blanksSelectRow(entry.id);
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
      disc: {
        id: lr.disc.id, name: lr.disc.name, diameter: lr.disc.diameter, blankDiameter: lr.disc.blankDiameter,
        thickness: lr.disc.thickness, edgeRecess: lr.disc.edgeRecess, fixtures: lr.disc.fixtures,
        coatingZoneDiameter: lr.disc.coatingZoneDiameter, previewSVG: lr.disc.previewSVG,
        // БЕЗ этого поля HC.downloadSTEP никогда не берёт настоящий импортированный
        // STEP (buildSolidFromImported) — order.disc.fileName всегда оказывался
        // undefined, и экспорт ВСЕГДА тихо пересобирал диск с нуля по параметрам
        // (buildSolid, Ø = «Ø полезной зоны», без реальных канавок/фигурных вырезов)
        fileName: lr.disc.fileName
      },
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

  // ---------- вкладка «База подложкодержателей»: локальный реестр заказов ----------
  // Каждый отправленный заказ (см. sendBtn) сохраняется в localStorage целиком
  // (assembleOrder() уже даёт всё нужное для CSV/STEP/отчёта — те же функции,
  // что и в Конфигураторе, просто вызываются повторно с сохранённой записью).
  // По умолчанию ничего не выбрано — таблица + превью/карточка по клику, как
  // и на вкладке «Болванки» (тот же UX-паттерн: Отмена, автопрокрутка, 2D/3D).

  var ordersExpanded = false;
  var currentOrderId = null;
  var ordersMode3d = false;

  function loadOrderRegistry() {
    try {
      var arr = JSON.parse(localStorage.getItem("hc-orders") || "[]");
      return Array.isArray(arr) ? arr : [];
    } catch (e) { return []; }
  }

  function saveOrderRegistryArr(arr) {
    try { localStorage.setItem("hc-orders", JSON.stringify(arr)); } catch (e) { /* localStorage недоступен — не критично */ }
  }

  function addOrderToRegistry(order) {
    var arr = loadOrderRegistry();
    var saved = JSON.parse(JSON.stringify(order)); // независимая копия на момент отправки
    saved.sentOk = null; // ещё не известно — обновится после ответа submitOrder
    arr.push(saved);
    saveOrderRegistryArr(arr);
    renderOrdersTable();
  }

  function updateOrderSentStatus(orderId, sentOk) {
    var arr = loadOrderRegistry();
    arr.forEach(function (o) { if (o.id === orderId) o.sentOk = sentOk; });
    saveOrderRegistryArr(arr);
    renderOrdersTable();
  }

  function currentOrderFromRegistry() {
    var found = null;
    loadOrderRegistry().forEach(function (o) { if (o.id === currentOrderId) found = o; });
    return found;
  }

  function renderOrdersTable() {
    var host = $("ordersTableBody");
    if (!host) return;
    var arr = loadOrderRegistry();
    function yn(v) { return v === true ? HC.t("да") : v === false ? HC.t("нет") : "—"; }
    host.innerHTML = arr.slice().reverse().map(function (o) { // свежие сверху
      var active = ordersExpanded && o.id === currentOrderId;
      return '<tr data-id="' + escHtml(o.id) + '"' + (active ? ' class="active"' : "") + ">" +
        "<td>" + escHtml(o.dateHuman || "") + "</td>" +
        "<td>" + (o.holderNo ? escHtml(o.holderNo) : "—") + "</td>" +
        "<td>" + (o.holderName ? escHtml(o.holderName) : "—") + "</td>" +
        "<td>" + escHtml((o.customer && o.customer.name) || "—") + "</td>" +
        "<td>" + escHtml(o.disc.name) + " (Ø" + o.disc.diameter + ")</td>" +
        "<td>" + ((o.placed && o.placed.length) || 0) + "</td>" +
        "<td>" + yn(o.sentOk) + "</td>" +
        "</tr>";
    }).join("");
    var emptyHint = $("ordersEmptyHint");
    if (emptyHint) emptyHint.hidden = arr.length > 0;
    host.querySelectorAll("tr").forEach(function (tr) {
      tr.addEventListener("click", function () {
        if (ordersExpanded && tr.dataset.id === currentOrderId) return;
        ordersSelectRow(tr.dataset.id);
      });
    });
  }

  function renderOrderInfo(o) {
    function row(label, val) { return "<div><b>" + escHtml(label) + ":</b> " + escHtml(val) + "</div>"; }
    var lines = [];
    lines.push(row(HC.t("Номер"), o.holderNo || "—"));
    lines.push(row(HC.t("Технолог"), (o.customer && o.customer.name) || "—"));
    if (o.customer && o.customer.org) lines.push(row(HC.t("Организация"), o.customer.org));
    if (o.customer && o.customer.contact) lines.push(row(HC.t("Контакт"), o.customer.contact));
    lines.push(row(HC.t("Подложка"), o.disc.name + " (Ø" + o.disc.diameter + ")"));
    lines.push(row(HC.t("Контрольные отверстия"), o.controlName));
    lines.push(row(HC.t("Зазоры, мм"), HC.t("деталь–деталь {0}; деталь–край {1}; деталь–контр. отв. {2}", o.clearances.pp, o.clearances.pe, o.clearances.pc)));
    (o.partsSummary || []).forEach(function (r, i) {
      lines.push(row(HC.t("Деталь {0}", i + 1),
        r.size + " — " + r.placed + (r.requested == null ? " " + HC.t("(макс.)") : HC.t(" из {0}", r.requested))));
    });
    return lines.join("");
  }

  function setOrdersMsg(text, cls) {
    var el = $("ordersMsg");
    el.textContent = text || "";
    el.className = "status" + (cls ? " " + cls : "");
  }

  function refreshOrdersSVG() {
    var o = currentOrderFromRegistry();
    if (!o) return;
    $("ordersSvgHost").innerHTML = HC.renderSVG({
      discDiameter: packBoundaryDiameter(o.disc), blankDiameter: physicalDiameter(o.disc), fixtures: o.disc.fixtures,
      edgeRecess: o.disc.edgeRecess, coatingZoneDiameter: o.disc.coatingZoneDiameter, previewSVG: o.disc.previewSVG,
      edgeClearance: o.clearances.pe,
      controlHoles: o.controlHoles, placed: o.placed, showNumbers: false
    });
  }

  // Тот же выбор Lite/STP, что и везде (см. mode3dStep) — по умолчанию Lite.
  // Кэш вырезанного меша по id заказа (не по ссылке на объект —
  // currentOrderFromRegistry() каждый раз парсит localStorage заново и
  // отдаёт НОВЫЙ объект, ссылка никогда не совпадёт).
  var ordersMode3dStep = "lite";
  var ordersOrderMeshCache = { orderId: null, promise: null };

  function updateOrdersView3dStepToggle() {
    var el = $("ordersView3dStepToggle");
    if (!el) return;
    var o = currentOrderFromRegistry();
    el.hidden = !(o && o.disc && o.disc.fileName);
    $("ordersView3dLiteBtn").classList.toggle("active", ordersMode3dStep === "lite");
    $("ordersView3dStpBtn").classList.toggle("active", ordersMode3dStep === "stp");
  }

  function ordersOrderMesh(o) {
    if (ordersOrderMeshCache.orderId !== o.id) {
      ordersOrderMeshCache.orderId = o.id;
      ordersOrderMeshCache.promise = (!HC.blankStorage || !HC.blankStorage.isConnected() || !HC.buildOrderMeshFromImported)
        ? null
        : HC.blankStorage.readStepFile(o.disc.fileName).then(function (buf) {
            var order = { disc: { thickness: o.disc.thickness }, controlHoles: o.controlHoles, placed: o.placed };
            return HC.buildOrderMeshFromImported(order, buf);
          });
    }
    return ordersOrderMeshCache.promise;
  }

  function refreshOrders3D() {
    if (!ordersMode3d) return;
    var o = currentOrderFromRegistry();
    if (!o) return;
    if (!HC.viewer3d || !HC.viewer3d.available()) {
      setOrdersViewMode(false);
      setOrdersMsg(HC.t("3D-вид недоступен в этом браузере (нет WebGL)."), "error");
      return;
    }
    if (o.disc.fileName && ordersMode3dStep === "stp") {
      refreshOrders3DFromMesh(o);
      return;
    }
    var ok = HC.viewer3d.update($("ordersView3dHost"), {
      discDiameter: packBoundaryDiameter(o.disc), blankDiameter: physicalDiameter(o.disc), fixtures: o.disc.fixtures,
      edgeRecess: o.disc.edgeRecess, thickness: o.disc.thickness || 6,
      controlHoles: o.controlHoles, placed: o.placed, showNumbers: false
    });
    if (!ok) {
      setOrdersViewMode(false);
      setOrdersMsg(HC.t("3D-вид недоступен в этом браузере (нет WebGL)."), "error");
    }
  }

  function refreshOrders3DFromMesh(o) {
    var targetOrderId = o.id;
    var meshPromise = ordersOrderMesh(o);
    if (!meshPromise) {
      setOrdersMsg(HC.t("3D недоступен: не удалось начать резку STEP (папка отключена?)."), "error");
      return;
    }
    setOrdersMsg(HC.t("Режу карманы в STEP…"));
    meshPromise.then(function (meshData) {
      if (!ordersMode3d || currentOrderId !== targetOrderId) return; // выбор сменился, пока считалось
      var ok = HC.viewer3d.updateMesh($("ordersView3dHost"), meshData);
      if (ok) setOrdersMsg("");
      else {
        setOrdersViewMode(false);
        setOrdersMsg(HC.t("3D-вид недоступен в этом браузере (нет WebGL)."), "error");
      }
    }).catch(function (err) {
      if (currentOrderId !== targetOrderId) return;
      setOrdersMsg(HC.t("Не удалось вырезать карманы в STEP: {0}", (err && err.message) || err), "error");
    });
  }

  function setOrdersViewMode(is3d) {
    if (is3d && !(HC.viewer3d && HC.viewer3d.available())) {
      if (HC.threeReady) {
        setOrdersMsg(HC.t("3D-вид загружается…"));
        HC.threeReady.then(function (ok) {
          if (ok && HC.viewer3d && HC.viewer3d.available()) { setOrdersMsg(""); setOrdersViewMode(true); }
          else setOrdersMsg(HC.t("3D-вид недоступен: библиотека Three.js не загрузилась."), "error");
        });
      } else {
        setOrdersMsg(HC.t("3D-вид недоступен: библиотека Three.js не загрузилась."), "error");
      }
      return;
    }
    ordersMode3d = is3d;
    $("ordersView2dBtn").classList.toggle("active", !is3d);
    $("ordersView3dBtn").classList.toggle("active", is3d);
    $("ordersSvgHost").hidden = is3d;
    $("ordersView3dHost").hidden = !is3d;
    if (is3d) refreshOrders3D();
  }

  function refreshOrderCard() {
    var o = currentOrderFromRegistry();
    if (!o) return;
    $("ordersSummary").textContent = (o.holderName || o.id) + " · " + o.dateHuman;
    $("orderInfo").innerHTML = renderOrderInfo(o);
    $("orderActionMsg").textContent = "";
    refreshOrdersSVG();
    updateOrdersView3dStepToggle();
    refreshOrders3D();
  }

  function ordersSelectRow(id) {
    currentOrderId = id;
    ordersExpanded = true;
    $("ordersMain").hidden = false;
    setOrdersViewMode(false); // см. blanksSelectRow — иначе колесо мыши над 3D крутит зум вместо скролла
    renderOrdersTable();
    refreshOrderCard();
    if ($("ordersMain").scrollIntoView) $("ordersMain").scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function ordersCancelSelection() {
    ordersExpanded = false;
    currentOrderId = null;
    $("ordersMain").hidden = true;
    renderOrdersTable();
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
  refreshFolderStatus();
  if (HC.blankStorage) {
    // тихая попытка переиспользовать папку, подключённую в прошлый раз —
    // без нового клика пользователя (жест нужен только для самого connect())
    HC.blankStorage.reconnect().then(function (handle) {
      refreshFolderStatus();
      if (handle) return loadFolderDiscs().then(migrateOldStepDiscs);
    });
  }
  fillDiscSelect();
  updateDiscInfo();
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
    var discVal = $("discSelect").value;
    HC.i18n.set(lang); // сохраняет выбор, переводит статическую разметку
    $("langRu").classList.toggle("active", lang === "ru");
    $("langEn").classList.toggle("active", lang === "en");
    fillDiscSelect(); $("discSelect").value = discVal;
    updateDiscInfo();
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

  // ---------- вкладки (Конфигуратор / Болванки / База) ----------
  // Без роутинга — просто показ/скрытие .tab-panel по data-tab кнопки.
  document.querySelectorAll(".tab-btn").forEach(function (btn) {
    btn.addEventListener("click", function () {
      document.querySelectorAll(".tab-btn").forEach(function (b) {
        b.classList.toggle("active", b === btn);
        b.setAttribute("aria-selected", b === btn ? "true" : "false");
      });
      document.querySelectorAll(".tab-panel").forEach(function (panel) {
        panel.hidden = panel.id !== btn.dataset.tab;
      });
      // Вкладки просто показываются/прячутся (не удаляются из DOM) — пока
      // панель скрыта (display:none), её 3D-хост не имеет размеров и не
      // рисуется. Если в этой вкладке уже был выбран 3D-вид, перерисовываем
      // его сейчас же — иначе пришлось бы вручную щёлкать 2D→3D после
      // каждого переключения вкладки, чтобы вид снова появился.
      if (btn.dataset.tab === "tabConfigurator" && mode3d) refresh3D();
      else if (btn.dataset.tab === "tabBlanks" && blanksExpanded && blanksMode3d) refreshBlanks3D();
      else if (btn.dataset.tab === "tabOrders" && ordersExpanded && ordersMode3d) refreshOrders3D();
    });
  });

  // ---------- заглушка входа (вместо логина/пароля) ----------
  // ВРЕМЕННО: настоящей проверки нет — заготовка под будущую авторизацию
  // (Supabase Auth и т.п.). При каждой загрузке страницы весь контент размыт
  // и недоступен, пока не нажать «Войти»; поле — то же ФИО технолога, что
  // раньше вводилось в разделе «Заказчик» (см. #custName, скрыт, но по-прежнему
  // используется при сборке заказа/CSV/отчёта — здесь только меняется способ
  // его заполнения).
  (function () {
    var overlay = $("loginOverlay"), input = $("loginInput"), appEl = $("app");
    appEl.classList.add("blurred");
    input.value = $("custName").value || ""; // подсказать прошлое имя, но всё равно спросить
    function login() {
      var name = input.value.trim();
      if (!name) { input.focus(); return; }
      $("custName").value = name;
      saveCustomer();
      appEl.classList.remove("blurred");
      overlay.hidden = true;
    }
    $("loginBtn").addEventListener("click", login);
    input.addEventListener("keydown", function (e) { if (e.key === "Enter") login(); });
  })();

  $("discSelect").addEventListener("change", onDiscChange);
  $("discLoadBtn").addEventListener("click", loadDiscFromFile);
  $("discStepLoadBtn").addEventListener("click", loadDiscFromStepFile);
  $("discDelBtn").addEventListener("click", deleteCurrentDisc);
  ["clPP", "clPE", "clPC"].forEach(function (id) { $(id).addEventListener("input", markDirty); });
  $("clReset").addEventListener("click", function () { applyDefaultClearances(); markDirty(); });
  $("addPart").addEventListener("click", function () { parts.push(defaultPart()); renderParts(); markDirty(); });
  $("packBtn").addEventListener("click", doPack);
  $("showNumbers").addEventListener("change", refreshView);
  $("view2dBtn").addEventListener("click", function () { setViewMode(false); });
  $("view3dBtn").addEventListener("click", function () { setViewMode(true); });
  $("view3dLiteBtn").addEventListener("click", function () {
    if (mode3dStep === "lite") return;
    mode3dStep = "lite";
    updateView3dStepToggle();
    refresh3D();
  });
  $("view3dStpBtn").addEventListener("click", function () {
    if (mode3dStep === "stp") return;
    mode3dStep = "stp";
    updateView3dStepToggle();
    refresh3D();
  });
  $("blanksView2dBtn").addEventListener("click", function () { setBlanksViewMode(false); });
  $("blanksView3dBtn").addEventListener("click", function () { setBlanksViewMode(true); });
  $("blanksView3dLiteBtn").addEventListener("click", function () {
    if (blanksMode3dStep === "lite") return;
    blanksMode3dStep = "lite";
    updateBlanksView3dStepToggle();
    refreshBlanks3D();
  });
  $("blanksView3dStpBtn").addEventListener("click", function () {
    if (blanksMode3dStep === "stp") return;
    blanksMode3dStep = "stp";
    updateBlanksView3dStepToggle();
    refreshBlanks3D();
  });
  $("blankSaveBtn").addEventListener("click", saveBlankEdits);
  $("addBlankBtn").addEventListener("click", openAddBlankModal);
  $("connectBlankFolderBtn").addEventListener("click", connectBlankFolder);
  $("addBlankModalSaveBtn").addEventListener("click", saveAddBlankModal);
  $("addBlankModalCancelBtn").addEventListener("click", closeAddBlankModal);
  $("addBlankView2dBtn").addEventListener("click", function () { setAddBlankViewMode(false); });
  $("addBlankView3dBtn").addEventListener("click", function () { setAddBlankViewMode(true); });
  $("addBlankView3dLiteBtn").addEventListener("click", function () {
    if (addBlankMode3dStep === "lite") return;
    addBlankMode3dStep = "lite";
    updateAddBlankView3dStepToggle();
    refreshAddBlank3D();
  });
  $("addBlankView3dStpBtn").addEventListener("click", function () {
    if (addBlankMode3dStep === "stp") return;
    addBlankMode3dStep = "stp";
    updateAddBlankView3dStepToggle();
    refreshAddBlank3D();
  });
  $("mbDia").addEventListener("input", function () { syncCoatingZoneAuto(); scheduleConstructorPreview(); });
  $("mbThk").addEventListener("input", scheduleConstructorPreview);
  $("mbRecessOn").addEventListener("change", function (e) {
    $("mbRecessFields").hidden = !e.target.checked;
    syncCoatingZoneAuto();
    scheduleConstructorPreview();
  });
  $("mbRecessSide").addEventListener("change", scheduleConstructorPreview);
  $("mbRecessDia").addEventListener("input", function () { syncCoatingZoneAuto(); scheduleConstructorPreview(); });
  $("mbRecessDepth").addEventListener("input", scheduleConstructorPreview);
  $("mbCoatingZoneDia").addEventListener("input", function () { mbCoatingZoneAuto = false; scheduleConstructorPreview(); });
  $("mbAddWitness").addEventListener("click", function () { mbWitnesses.push(defaultWitness()); renderMbWitnesses(); scheduleConstructorPreview(); });
  $("mbAddFixture").addEventListener("click", function () { mbFixtures.push(defaultFixture()); renderMbFixtures(); scheduleConstructorPreview(); });
  $("mbCreateBtn").addEventListener("click", createManualBlank);
  $("blanksCancelBtn").addEventListener("click", blanksCancelSelection);
  renderBlanksTable(); // таблица болванок; превью/карточка — только после клика по строке
  ["custName", "custOrg", "custContact"].forEach(function (id) { $(id).addEventListener("change", saveCustomer); });

  $("csvBtn").addEventListener("click", function () {
    if (lastResult) HC.downloadCSV(assembleOrder());
  });

  $("stepBtn").addEventListener("click", function () {
    if (!lastResult || !HC.downloadSTEP) return;
    var btn = $("stepBtn");
    btn.disabled = true;
    HC.downloadSTEP(assembleOrder(), function (t) { setSendMsg(t); }).then(function () {
      btn.disabled = false;
    }).catch(function (err) {
      setSendMsg(HC.t("Не удалось построить STEP: {0}", (err && err.message) || err), "error");
      if (g.console) console.error(err);
      btn.disabled = false;
    });
  });

  $("reportBtn").addEventListener("click", function () {
    if (!lastResult) return;
    var order = assembleOrder();
    var svg = HC.renderSVG({
      discDiameter: lastResult.opts.discDiameter,
      blankDiameter: physicalDiameter(lastResult.disc),
      previewSVG: lastResult.disc.previewSVG,
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
    addOrderToRegistry(order); // в «Базу подложкодержателей» — сразу, независимо от исхода отправки в таблицу
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
      updateOrderSentStatus(order.id, true);
    }).catch(function (err) {
      setSendMsg(HC.t("Не удалось отправить: {0}", err.message), "error");
      $("sendBtn").disabled = false;
      updateOrderSentStatus(order.id, false);
    });
  });

  $("ordersCancelBtn").addEventListener("click", ordersCancelSelection);
  $("ordersView2dBtn").addEventListener("click", function () { setOrdersViewMode(false); });
  $("ordersView3dBtn").addEventListener("click", function () { setOrdersViewMode(true); });
  $("ordersView3dLiteBtn").addEventListener("click", function () {
    if (ordersMode3dStep === "lite") return;
    ordersMode3dStep = "lite";
    updateOrdersView3dStepToggle();
    refreshOrders3D();
  });
  $("ordersView3dStpBtn").addEventListener("click", function () {
    if (ordersMode3dStep === "stp") return;
    ordersMode3dStep = "stp";
    updateOrdersView3dStepToggle();
    refreshOrders3D();
  });
  $("orderCsvBtn").addEventListener("click", function () {
    var o = currentOrderFromRegistry();
    if (o) HC.downloadCSV(o);
  });
  $("orderStepBtn").addEventListener("click", function () {
    var o = currentOrderFromRegistry();
    if (!o || !HC.downloadSTEP) return;
    var btn = $("orderStepBtn");
    function msg(t, cls) { var el = $("orderActionMsg"); el.textContent = t || ""; el.className = "status" + (cls ? " " + cls : ""); }
    btn.disabled = true;
    HC.downloadSTEP(o, function (t) { msg(t); }).then(function () {
      btn.disabled = false;
    }).catch(function (err) {
      msg(HC.t("Не удалось построить STEP: {0}", (err && err.message) || err), "error");
      btn.disabled = false;
    });
  });
  $("orderReportBtn").addEventListener("click", function () {
    var o = currentOrderFromRegistry();
    if (!o) return;
    var svg = HC.renderSVG({
      discDiameter: packBoundaryDiameter(o.disc), blankDiameter: physicalDiameter(o.disc), previewSVG: o.disc.previewSVG,
      edgeClearance: o.clearances.pe,
      controlHoles: o.controlHoles, placed: o.placed, showNumbers: true
    });
    HC.showReport(o, svg);
  });
  $("orderDelBtn").addEventListener("click", function () {
    var o = currentOrderFromRegistry();
    if (!o) return;
    if (!g.confirm(HC.t("Удалить заказ «{0}» из базы? Это действие нельзя отменить.", o.holderName || o.id))) return;
    saveOrderRegistryArr(loadOrderRegistry().filter(function (x) { return x.id !== o.id; }));
    ordersCancelSelection();
  });
  renderOrdersTable(); // первичная отрисовка (таблица; превью/карточка — только после клика по строке)
})(typeof globalThis !== "undefined" ? globalThis : window);
