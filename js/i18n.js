/*
 * i18n.js — переключение языка интерфейса (RU / EN).
 *
 * Русский текст ЯВЛЯЕТСЯ ключом: словарь DICT_EN содержит только английские
 * замены. Если ключа нет — возвращается русский оригинал (ничего не ломается).
 *
 * Использование:
 *   HC.t("Разложить")                 → "Arrange" (en) / "Разложить" (ru)
 *   HC.t("Диаметр диска: {0} мм", 298) → подстановка {0},{1},…
 *
 * Статическая разметка переводится через атрибуты:
 *   data-i18n="..."        — textContent
 *   data-i18n-ph="..."     — placeholder
 *   data-i18n-title="..."  — title
 *   data-i18n-html="..."   — innerHTML (для текста с разметкой)
 * Значение атрибута — русский оригинал (тот же ключ, что и в JS).
 */
(function (g) {
  "use strict";
  var HC = (g.HC = g.HC || {});

  var DICT_EN = {
    // ---------- шапка / заголовки ----------
    "Конфигуратор подложкодержателей": "Substrate Holder Configurator",
    "1. Заказчик": "1. Customer",
    "Технолог (ФИО)": "Engineer (full name)",
    "Иванов И. И.": "John A. Doe",
    "Организация": "Organization",
    "Контакт (e-mail / телефон)": "Contact (e-mail / phone)",
    "2. Подложкодержатель": "2. Substrate holder",
    "Диск": "Disc",
    "Ø кастомного подложкодержителя, мм": "Custom holder Ø, mm",
    "Контрольные отверстия": "Control holes",
    "Позиции контрольных отверстий фиксированы; наличие и диаметр — задаются здесь.":
      "Control-hole positions are fixed; presence and diameter are set here.",
    "удалить этот подложкодержатель": "delete this substrate holder",
    "＋ Загрузить свой подложкодержатель (CSV из Inventor)": "＋ Upload your own substrate holder (CSV from Inventor)",
    "Файл выгрузки правила <code>DumpHoles</code>. Подложкодержатель добавится в список и сохранится в этом браузере.":
      "Export file from the <code>DumpHoles</code> rule. The substrate holder is added to the list and saved in this browser.",
    "Файл выгрузки (.csv)": "Export file (.csv)",
    "Название": "Name",
    "Название формируется автоматически по составу деталей (после раскладки).":
      "The name is generated automatically from the part composition (after layout).",
    "напр. Диск Ø320": "e.g. Disc Ø320",
    "Ø полезной зоны, мм": "Usable-zone Ø, mm",
    "Толщина, мм": "Thickness, mm",
    "Добавить в каталог": "Add to catalog",
    "3. Детали": "3. Parts",
    "+ Добавить деталь": "+ Add part",
    "4. Минимальные зазоры, мм": "4. Minimum clearances, mm",
    "деталь–деталь": "part–part",
    "деталь–край": "part–edge",
    "деталь–контр. отв.": "part–control hole",
    "сбросить к значениям по умолчанию": "reset to defaults",
    "Разложить": "Arrange",
    "Выберите параметры и нажмите «Разложить»": "Choose parameters and click “Arrange”",
    "номера позиций": "position numbers",
    "Левая кнопка — поворот · правая (или Shift+левая) — перетаскивание · колесо — масштаб · двойной клик — сброс. На тач: один палец — поворот, два — масштаб и перетаскивание.":
      "Left button — rotate · right (or Shift+left) — pan · wheel — zoom · double-click — reset. Touch: one finger — rotate, two — zoom and pan.",
    "Скачать CSV для Inventor": "Download CSV for Inventor",
    "Скачать STEP": "Download STEP",
    "Не удалось построить STEP: {0}": "Failed to build STEP: {0}",
    "Отчёт / PDF": "Report / PDF",
    "Отправить заказ": "Send order",
    "Координаты отверстий — от центра диска, единицы — мм. Контрольные отверстия фиксированы и изменению не подлежат.":
      "Hole coordinates are from the disc center, units — mm. Control holes are fixed and cannot be changed.",

    // ---------- каталог / подложка ----------
    "Кастомный подложкодержитель": "Custom holder",
    "Кастомный подложкодержитель (задать Ø)": "Custom holder (set Ø)",
    "Без контрольных отверстий": "No control holes",
    "Диаметр диска: {0} мм": "Disc diameter: {0} mm",

    // ---------- контрольные отверстия / детали (поля) ----------
    "Деталь d, мм": "Part d, mm",
    "Ø посадки D, мм": "Seat Ø D, mm",
    "Зона CA, мм": "CA zone, mm",
    "паз под пинцет": "tweezer slot",
    "Угол, °": "Angle, °",
    "параметры": "parameters",
    "глуб.": "depth",
    "паз": "slot",
    "Деталь {0}": "Part {0}",
    "Удалить деталь": "Delete part",
    "Номер": "Number",
    "Форма": "Shape",
    "Круглая": "Round",
    "Прямоугольная": "Rectangular",
    "Прямоугольная с фаской": "Rectangular chamfered",
    "Овальная": "Oval",
    "Диаметр детали d, мм": "Part diameter d, mm",
    "(авто, можно поправить, не меньше d)": "(auto, editable, not less than d)",
    "Зона напыления CA, мм": "Coating zone CA, mm",
    "(авто-максимум, можно только уменьшить)": "(auto max, can only decrease)",
    "Ширина, мм": "Width, mm",
    "Высота, мм": "Height, mm",
    "Фаска, мм": "Chamfer, mm",
    "фаска": "chamfer",
    "Припуск на посадку, мм": "Seat allowance, mm",
    "Отступ зоны напыления, мм": "Coating inset, mm",
    "(нужен Ø посадки D)": "(requires seat Ø D)",
    "Ориентация": "Orientation",
    "фиксированная (без поворота)": "fixed (no rotation)",
    "свободная (0° / 90°)": "free (0° / 90°)",
    "радиальная — ширина вдоль радиуса": "radial — width along radius",
    "радиальная — высота вдоль радиуса": "radial — height along radius",
    " — радиально, ширина вдоль радиуса": " — radial, width along radius",
    " — радиально, высота вдоль радиуса": " — radial, height along radius",
    "максимум": "maximum",
    "количество:": "quantity:",
    "Расположение": "Placement",
    "от центра": "from center",
    "от края": "from edge",
    "по диаметру": "along diameter",
    "Ø расположения, мм": "Placement Ø, mm",

    // ---------- статусы / раскладка ----------
    "Пересчитываю…": "Recalculating…",
    "Укажите диаметр кастомного подложкодержителя (мм).": "Specify the custom holder diameter (mm).",
    "Добавьте хотя бы одну деталь.": "Add at least one part.",
    "Деталь {0}: ": "Part {0}: ",
    "укажите диаметр.": "specify the diameter.",
    "деталь больше диска.": "part is larger than the disc.",
    "Ø посадки D не может быть меньше диаметра детали d ({0}).":
      "Seat Ø D cannot be less than part diameter d ({0}).",
    "зона напыления CA не может быть больше D−1.5 мм": "coating zone CA cannot exceed D−1.5 mm",
    " (максимум {0})": " (max {0})",
    "укажите ширину и высоту.": "specify width and height.",
    "укажите фаску (0 — без фаски).": "specify chamfer (0 — none).",
    "фаска должна быть меньше половины меньшей стороны.": "chamfer must be less than half the shorter side.",
    "припуск на посадку не может быть отрицательным.": "seat allowance cannot be negative.",
    "отступ зоны напыления не может быть отрицательным.": "coating inset cannot be negative.",
    "отступ зоны напыления должен быть меньше половины меньшей стороны.": "coating inset must be less than half the shorter side.",
    "укажите количество (целое ≥ 1).": "specify quantity (integer ≥ 1).",
    "укажите диаметр расположения.": "specify the placement diameter.",
    "Контрольное отверстие «{0}»: ": "Control hole “{0}”: ",
    "укажите Ø посадки.": "specify the seat Ø.",
    "Все зазоры должны быть числами ≥ 0.": "All clearances must be numbers ≥ 0.",
    "Исправьте ошибки в форме — раскладка обновится сама.":
      "Fix the errors in the form — the layout will update automatically.",
    "Деталь {0} ({1}): ": "Part {0} ({1}): ",
    "максимум — размещено {0}": "maximum — placed {0}",
    "размещено {0} из {1}": "placed {0} of {1}",
    "влезло только {0} из {1} ⚠": "only {0} of {1} fit ⚠",
    "Всего отверстий под детали: {0}": "Total part holes: {0}",
    "Ни одна деталь не поместилась: проверьте размеры и зазоры.":
      "No parts fit: check sizes and clearances.",
    "Поместились не все детали — уменьшите количество, зазоры или размеры.":
      "Not all parts fit — reduce quantity, clearances, or sizes.",
    "Готово.": "Done.",

    // ---------- краткие типы (typeShort) ----------
    "круглая Ø{0}": "round Ø{0}",
    "прямоугольная {0}×{1}": "rectangular {0}×{1}",
    "овальная {0}×{1}": "oval {0}×{1}",
    "с фаской {0}×{1}×{2}": "chamfered {0}×{1}×{2}",

    // ---------- отправка заказа ----------
    "Укажите ФИО технолога — им подписывается заказ.":
      "Specify the engineer's name — the order is signed with it.",
    "Отправляю…": "Sending…",
    "Заказ {0} отправлен и записан в таблицу.": "Order {0} sent and recorded in the sheet.",
    "Не удалось отправить: {0}": "Failed to send: {0}",
    "круг": "round",
    "прямоуг.": "rect.",
    "с фаской": "chamfered",
    "овал": "oval",
    "(макс.)": "(max)",
    " из {0}": " of {0}",

    // ---------- загрузка своей подложки ----------
    "Выберите CSV-файл выгрузки.": "Choose a CSV export file.",
    "Укажите Ø полезной зоны.": "Specify the usable-zone Ø.",
    "В файле не найдено геометрии — это выгрузка DumpHoles?":
      "No geometry found in the file — is it a DumpHoles export?",
    "Подложкодержатель": "Substrate holder",
    " Резьбовых отверстий без Ø: {0} (уточните в модели).":
      " Threaded holes without Ø: {0} (check in the model).",
    "Подложкодержатель «{0}» добавлен и сохранён.{1}": "Substrate holder “{0}” added and saved.{1}",
    "Ошибка разбора: {0}": "Parse error: {0}",
    "Не удалось прочитать файл.": "Failed to read the file.",

    // ---------- 3D ----------
    "3D-вид недоступен в этом браузере (нет WebGL).": "3D view is unavailable in this browser (no WebGL).",
    "3D-вид недоступен: библиотека Three.js не загрузилась.": "3D view unavailable: Three.js failed to load.",

    // ---------- отчёт ----------
    "Подложкодержатель — заказ {0}": "Substrate holder — order {0}",
    "Печать / Сохранить в PDF": "Print / Save as PDF",
    "Скачать отчёт (HTML)": "Download report (HTML)",
    "Закрыть": "Close",
    "Номер подложкодержателя": "Substrate holder number",
    "Название подложкодержателя": "Substrate holder name",
    "Дата": "Date",
    "Технолог": "Engineer",
    "Контакт": "Contact",
    "Зазоры, мм": "Clearances, mm",
    "деталь–деталь {0}; деталь–край {1}; деталь–контр. отв. {2}":
      "part–part {0}; part–edge {1}; part–control hole {2}",
    "Детали": "Parts",
    "№ поз.": "Pos. #",
    "Тип": "Type",
    "Размер, мм": "Size, mm",
    "Заказано": "Ordered",
    "Размещено": "Placed",
    "Координаты отверстий (центр диска — 0,0; мм)": "Hole coordinates (disc center — 0,0; mm)",
    "№": "#",
    "Размер": "Size",
    "Поворот, °": "Rotation, °",
    "Сформировано веб-конфигуратором подложкодержателей.":
      "Generated by the web substrate-holder configurator.",

    // ---------- названия из каталога (контрольные отверстия и варианты) ----------
    "Свидетель Центр": "Witness Center",
    "Свидетель": "Witness",
    "Тех. отверстие 1": "Tech hole 1",
    "Тех. отверстие 2": "Tech hole 2",
    "Тех. отверстие 3": "Tech hole 3",
    "Тех. отверстие центр": "Tech hole center",
    "Свидетели + Reference + тех. отверстия": "Witnesses + Reference + tech holes",
    "Диск, полезная зона Ø298": "Disc, usable zone Ø298",
    "Диск Ø100 (пример)": "Disc Ø100 (example)",
    "Диск Ø150 (пример)": "Disc Ø150 (example)",
    "3 × Ø4 на R40 через 120° (пример)": "3 × Ø4 at R40 every 120° (example)",
    "4 × Ø6 крестом на R60 + Ø8 в центре (пример)": "4 × Ø6 cross at R60 + Ø8 center (example)"
  };

  var LANG = "ru";
  try {
    var saved = g.localStorage && localStorage.getItem("hc-lang");
    if (saved === "en" || saved === "ru") LANG = saved;
  } catch (e) { /* localStorage недоступен — остаёмся на ru */ }

  var onChange = [];

  function format(s, args) {
    return s.replace(/\{(\d+)\}/g, function (_, i) {
      var v = args[+i];
      return v == null ? "" : String(v);
    });
  }

  HC.t = function (key) {
    var args = Array.prototype.slice.call(arguments, 1);
    var s = (LANG === "en" && DICT_EN[key] != null) ? DICT_EN[key] : key;
    return format(s, args);
  };

  function apply() {
    var d = g.document;
    if (!d) return;
    d.querySelectorAll("[data-i18n]").forEach(function (el) {
      el.textContent = HC.t(el.getAttribute("data-i18n"));
    });
    d.querySelectorAll("[data-i18n-html]").forEach(function (el) {
      el.innerHTML = HC.t(el.getAttribute("data-i18n-html"));
    });
    d.querySelectorAll("[data-i18n-ph]").forEach(function (el) {
      el.setAttribute("placeholder", HC.t(el.getAttribute("data-i18n-ph")));
    });
    d.querySelectorAll("[data-i18n-title]").forEach(function (el) {
      el.setAttribute("title", HC.t(el.getAttribute("data-i18n-title")));
    });
    d.title = HC.t("Конфигуратор подложкодержателей");
    if (d.documentElement) d.documentElement.setAttribute("lang", LANG);
  }

  HC.i18n = {
    get: function () { return LANG; },
    apply: apply,
    onChange: function (fn) { onChange.push(fn); },
    set: function (lang) {
      if (lang !== "en" && lang !== "ru") return;
      LANG = lang;
      try { if (g.localStorage) localStorage.setItem("hc-lang", lang); } catch (e) { /* не критично */ }
      apply();
      onChange.forEach(function (fn) { try { fn(lang); } catch (e) { /* игнорируем */ } });
    }
  };
})(typeof globalThis !== "undefined" ? globalThis : window);
