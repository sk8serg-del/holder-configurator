// Сквозной smoke-тест страницы в jsdom: init → раскладка → CSV → отчёт.
// Требует jsdom: один раз выполнить `npm install jsdom` в корне проекта.
// Запуск: node test/test-page.js
"use strict";
const fs = require("fs");
const path = require("path");
const { JSDOM } = require("jsdom");

const root = path.join(__dirname, "..");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");

const dom = new JSDOM(html, { runScripts: "outside-only", url: "http://localhost/" });
const w = dom.window;

// заглушки того, чего нет в jsdom
w.URL.createObjectURL = () => "blob:fake";
w.URL.revokeObjectURL = () => {};
w.HTMLAnchorElement.prototype.click = function () {};
let printed = 0;
w.print = () => { printed++; };
let confirmReturn = true;
w.confirm = () => confirmReturn;

let failures = 0;
function check(name, cond, detail) {
  if (cond) console.log("  ok   " + name);
  else { failures++; console.log("  FAIL " + name + (detail ? " — " + detail : "")); }
}

// подключаем модули в том же порядке, что и на странице
// three.min.js в jsdom не грузим (нет WebGL) — viewer3d обязан жить без него
for (const n of ["catalog", "i18n", "geometry", "packer", "render", "export-csv", "report", "sheets", "viewer3d", "holder-import", "blank-builder", "blank-storage", "app"]) {
  const src = fs.readFileSync(path.join(root, "js", n + ".js"), "utf8");
  w.eval(src);
}

const d = w.document;
const $ = (id) => d.getElementById(id);

// --- заглушка входа: при загрузке страница размыта и закрыта оверлеем;
// «Войти» с пустым именем ничего не делает, с именем — снимает размытие,
// прячет оверлей и пишет имя в скрытое поле custName (заказ им подписывается) ---
check("вход: оверлей виден, страница размыта при загрузке", !$("loginOverlay").hidden && $("app").classList.contains("blurred"));
$("loginBtn").click();
check("вход: клик с пустым именем не снимает размытие/оверлей", $("app").classList.contains("blurred") && !$("loginOverlay").hidden);
$("loginInput").value = "Петров П.П.";
$("loginBtn").click();
check("вход: клик с именем снимает размытие", !$("app").classList.contains("blurred"));
check("вход: оверлей скрыт после входа", $("loginOverlay").hidden);
check("вход: имя ушло в скрытое поле custName", $("custName").value === "Петров П.П.", $("custName").value);

// --- инициализация ---
check("список дисков заполнен", $("discSelect").options.length >= 3, String($("discSelect").options.length));
check("диск по умолчанию — Ø298", $("discSelect").value === "disc-298", $("discSelect").value);
check("контрольные отверстия: 3 строки (свидетели + Reference; тех. привязаны, без строк)",
  d.querySelectorAll("#controlList .ctrl-row").length === 3, String(d.querySelectorAll("#controlList .ctrl-row").length));
check("для тех. отверстий отдельных строк/галочек нет",
  Array.from(d.querySelectorAll("#controlList .ctrl-head label")).every(function (el) { return el.textContent.indexOf("Тех.") === -1; }));
const ctrlNames = Array.from(d.querySelectorAll("#controlList .ctrl-head label")).map(function (el) { return el.textContent.trim(); });
check("имена: Свидетель Центр / Свидетель / Reference",
  ctrlNames[0] === "Свидетель Центр" && ctrlNames[1] === "Свидетель" && ctrlNames[2] === "Reference",
  ctrlNames.join(" | "));
check("у свидетелей поле детали d = 25.4 (первые два из c-d)",
  d.querySelectorAll("#controlList .c-d")[0].value === "25.4" &&
  d.querySelectorAll("#controlList .c-d")[1].value === "25.4");
check("у свидетелей есть чекбокс паза и он включён по умолчанию",
  d.querySelectorAll("#controlList .c-slot-on").length === 2 &&
  Array.from(d.querySelectorAll("#controlList .c-slot-on")).every(function (el) { return el.checked; }));
check("настройки контрольных отверстий свёрнуты по умолчанию (details закрыты)",
  Array.from(d.querySelectorAll("#controlList details")).every(function (el) { return !el.open; }));
const summaries = Array.from(d.querySelectorAll("#controlList .c-summary")).map(function (el) { return el.textContent; });
check("свёрнутая строка свидетеля: d25,4 (D25,6/CA22,6) · глуб. 4,5 · паз",
  summaries[0] === "d25,4 (D25,6/CA22,6) · глуб. 4,5 · паз", summaries[0]);
check("свёрнутая строка Reference: (D30,1/CA24,2) · глуб. 3 без паза",
  summaries[2] === "(D30,1/CA24,2) · глуб. 3", summaries[2]);
const seatDs = Array.from(d.querySelectorAll("#controlList .c-seat-d")).map(function (el) { return el.value; });
check("Reference: посадка D=30.1, CA=24.2, без поля d",
  seatDs.indexOf("30.1") !== -1 &&
  Array.from(d.querySelectorAll("#controlList .c-ca")).some(function (el) { return el.value === "24.2"; }),
  seatDs.join(","));
check("схема свидетеля показывает d25,4 (D25,6/CA22,6)",
  d.querySelectorAll("#controlList .part-preview")[0].innerHTML.indexOf("d25,4 (D25,6/CA22,6)") !== -1,
  d.querySelectorAll("#controlList .part-preview")[0].innerHTML);
check("зазоры предзаполнены (6/3/6)", $("clPP").value === "6" && $("clPE").value === "3" && $("clPC").value === "6",
  $("clPP").value + "/" + $("clPE").value + "/" + $("clPC").value);
check("есть строка детали", d.querySelectorAll("#partsList .part-row").length === 1);

// --- раскладка посчиталась сама при загрузке, без нажатия кнопки ---
check("автораскладка при загрузке: сводка и SVG уже есть",
  $("summary").textContent.indexOf("размещено") !== -1 && $("svgHost").innerHTML.indexOf("<svg") !== -1,
  $("summary").textContent);

// --- название подложкодержателя генерируется автоматически (d/D/CA + N-кол-во) ---
check("поле «Название» readonly", $("holderName").hasAttribute("readonly"));
check("название = «d25,4 (D25,6/CA24,1) N<кол-во>» для стандартной детали",
  /^d25,4 \(D25,6\/CA24,1\) N\d+$/.test($("holderName").value), $("holderName").value);
check("название не длиннее 42 символов", $("holderName").value.length <= 42, String($("holderName").value.length));

// --- две детали: обе должны попасть в название, даже если полная форма
// (с D/CA) не влезает в 42 символа — тогда сокращается детализация, а не
// выбрасывается деталь целиком (регрессия: раньше вторая деталь пропадала) ---
$("addPart").click();
const rows2 = d.querySelectorAll("#partsList .part-row");
const dInp2 = rows2[1].querySelector(".p-d");
dInp2.value = "15";
dInp2.dispatchEvent(new w.Event("input"));
$("packBtn").click();
check("название содержит обе детали (не только первую) при переполнении лимита",
  $("holderName").value.indexOf("d25,4") !== -1 && $("holderName").value.indexOf("d15") !== -1 &&
  $("holderName").value.length <= 42,
  $("holderName").value);
// возвращаем к одной детали для дальнейших тестов
rows2[1].querySelector(".p-del").click();

// --- предпросмотр детали (для круга — крупная схема d/D/CA, авторасчёт) ---
check("стандартная деталь d=25.4, авто D/CA (D25,6/CA24,1 = D−1.5)",
  d.querySelector("#partsList .part-preview.hole-diagram svg") !== null &&
  d.querySelector("#partsList .part-preview").innerHTML.indexOf("d25,4 (D25,6/CA24,1)") !== -1,
  d.querySelector("#partsList .part-preview").innerHTML);
const dInput = d.querySelector("#partsList .p-d");
const seatInput = d.querySelector("#partsList .p-seat-d");
const caInput = d.querySelector("#partsList .p-ca");
dInput.value = "12";
dInput.dispatchEvent(new w.Event("input"));
check("при смене d авто D/CA пересчитались (D12,2/CA10,7 = D−1.5)",
  d.querySelector("#partsList .part-preview").innerHTML.indexOf("d12 (D12,2/CA10,7)") !== -1,
  d.querySelector("#partsList .part-preview").innerHTML);
check("max у поля CA обновился до авто-максимума (D−1.5)", caInput.getAttribute("max") === "10.7", caInput.getAttribute("max"));

// ручная правка D — при следующей смене d должна сброситься обратно на авто
// (чтобы правки не «залипали» от старого диаметра детали)
seatInput.value = "13";
seatInput.dispatchEvent(new w.Event("input"));
dInput.value = "20";
dInput.dispatchEvent(new w.Event("input"));
check("ручная правка D сбрасывается на авто при смене d (D20,2/CA18,7)",
  d.querySelector("#partsList .part-preview").innerHTML.indexOf("d20 (D20,2/CA18,7)") !== -1,
  d.querySelector("#partsList .part-preview").innerHTML);

// ручная правка CA — тоже должна сброситься на авто при смене d
caInput.value = "5";
caInput.dispatchEvent(new w.Event("input"));
dInput.value = "22";
dInput.dispatchEvent(new w.Event("input"));
check("ручная правка CA сбрасывается на авто при смене d (D22,2/CA20,7)",
  d.querySelector("#partsList .part-preview").innerHTML.indexOf("d22 (D22,2/CA20,7)") !== -1,
  d.querySelector("#partsList .part-preview").innerHTML);

// CA больше технологического максимума — ошибка валидации при раскладке
dInput.value = "10";
dInput.dispatchEvent(new w.Event("input"));
seatInput.value = "";
seatInput.dispatchEvent(new w.Event("input"));
caInput.value = "50";
caInput.dispatchEvent(new w.Event("input"));
$("packBtn").click();
check("CA больше максимума — раскладка отклонена с понятной ошибкой",
  $("statusMsg").textContent.indexOf("зона напыления") !== -1 && $("statusMsg").className.indexOf("error") !== -1,
  $("statusMsg").textContent);

// --- паз под пинцет: L = D+5, W = min(9, 0.75×D), угол задаётся вручную ---
seatInput.value = "20";
seatInput.dispatchEvent(new w.Event("input"));
const slotOnEl = d.querySelector("#partsList .p-slot-on");
const slotAngleEl = d.querySelector("#partsList .p-slot-angle");
check("поле угла паза изначально отключено", slotAngleEl.disabled === true);
slotOnEl.click();
check("после включения паза поле угла активно", slotAngleEl.disabled === false);
slotAngleEl.value = "45";
slotAngleEl.dispatchEvent(new w.Event("input"));
check("подпись не упоминает паз (только d/D/CA)",
  d.querySelector("#partsList .part-preview").innerHTML.indexOf("паз") === -1);
check("на схеме есть контур паза (path) при включённом чекбоксе",
  d.querySelector("#partsList .part-preview svg path") !== null);
check("паз повёрнут на заданный угол (rotate(45))",
  d.querySelector("#partsList .part-preview").innerHTML.indexOf("rotate(45)") !== -1,
  d.querySelector("#partsList .part-preview").innerHTML);
slotOnEl.click();
check("после выключения паза угол недоступен и контур паза исчез",
  slotAngleEl.disabled === true && d.querySelector("#partsList .part-preview svg path") === null);

// --- D не может быть меньше d ---
dInput.value = "10";
dInput.dispatchEvent(new w.Event("input"));
seatInput.value = "5";
seatInput.dispatchEvent(new w.Event("input"));
check("min у поля D равен текущему d", seatInput.getAttribute("min") === "10", seatInput.getAttribute("min"));
$("packBtn").click();
check("D меньше d — раскладка отклонена с понятной ошибкой",
  $("statusMsg").textContent.indexOf("Ø посадки D") !== -1 && $("statusMsg").className.indexOf("error") !== -1,
  $("statusMsg").textContent);
seatInput.value = "";
seatInput.dispatchEvent(new w.Event("input"));

// возвращаем деталь в валидное состояние для дальнейших тестов
caInput.value = "";
caInput.dispatchEvent(new w.Event("input"));

// --- раскладка ---
$("custName").value = "Тестов Т.Т.";
$("packBtn").click();
check("сводка появилась", $("summary").textContent.indexOf("размещено") !== -1, $("summary").textContent);
check("SVG отрисован", $("svgHost").innerHTML.indexOf("<svg") !== -1);
const circles = $("svgHost").querySelectorAll("circle").length;
check("кругов в SVG много (>100)", circles > 100, String(circles));
check("кнопки активны", !$("csvBtn").disabled && !$("reportBtn").disabled && !$("sendBtn").disabled);

// --- полный диск: болванка крупнее полезной зоны + граница зоны + крепёж ---
const svgHtml0 = $("svgHost").innerHTML;
check("нарисована болванка Ø324.5 (r≈162.25)", svgHtml0.indexOf('r="162.25"') !== -1);
check("нарисована граница полезной зоны (зелёный штрих #6f9e6f)", svgHtml0.indexOf("#6f9e6f") !== -1);
check("нарисован фланцевый крепёж вне полезной зоны (центр за R149)",
  Array.from($("svgHost").querySelectorAll("circle")).some(function (c) {
    const cx = parseFloat(c.getAttribute("cx")) || 0, cy = parseFloat(c.getAttribute("cy")) || 0;
    return Math.sqrt(cx * cx + cy * cy) > 149;
  }));
check("тех. отверстия 1-3 активны при включённом «Свидетель Центр»", svgHtml0.indexOf("translate(-19") !== -1);
// фигурный вырез (полигон-fixture) рисуется как <polygon>
const svgCut = w.HC.renderSVG({
  discDiameter: 298, blankDiameter: 324.5,
  fixtures: { cutouts: [{ label: "Mountings", points: [[-140, 60], [-120, 70], [-125, 90], [-145, 82]] }] },
  controlHoles: [], placed: []
});
check("фигурный вырез рисуется как polygon в SVG", svgCut.indexOf("<polygon") !== -1);

// крепёжное отверстие РОВНО на краю болванки — контур получает реальную
// выемку (<path>), а не рисуется целым <circle> с дырой поверх
const svgEdgeHole = w.HC.renderSVG({
  discDiameter: 300, blankDiameter: 300,
  fixtures: { holes: [{ d: 10, label: "вырез", points: [[150, 0]] }] },
  controlHoles: [], placed: []
});
check("отверстие на краю болванки: контур диска — <path> с выемкой (не целый <circle>)",
  svgEdgeHole.indexOf('<path d="M') !== -1 && svgEdgeHole.indexOf('r="150"') === -1,
  svgEdgeHole.slice(0, 200));
// то же отверстие полностью внутри — обычный <circle>, без изменений контура
const svgInnerHole = w.HC.renderSVG({
  discDiameter: 300, blankDiameter: 300,
  fixtures: { holes: [{ d: 10, label: "вырез", points: [[50, 0]] }] },
  controlHoles: [], placed: []
});
check("отверстие внутри болванки: контур диска — обычный <circle> r=150",
  svgInnerHole.indexOf('r="150"') !== -1);

// --- контрольное отверстие с явно заданной ориентацией паза (slotAngle) —
// используется именно этот угол, а не радиальный (раньше radAngle
// пересчитывался всегда, свидетель из конструктора не мог задать свою
// ориентацию нигде, кроме собственного превью модального окна) ---
const svgSlotCustom = w.HC.renderSVG({
  discDiameter: 300,
  controlHoles: [{ x: 0, y: 100, d: 25.4, seatD: 25.6, apertureCA: 22.6, slotOn: true, slotAngle: 30 }],
  placed: []
});
check("контрольное отверстие: явный slotAngle=30 использован (не радиальный 90°)",
  svgSlotCustom.indexOf('rotate(30)') !== -1 && svgSlotCustom.indexOf('rotate(90)') === -1,
  svgSlotCustom.match(/rotate\([^)]+\)/g));
// без явного slotAngle — как раньше, радиально (обратная совместимость со старыми болванками)
const svgSlotRadial = w.HC.renderSVG({
  discDiameter: 300,
  controlHoles: [{ x: 0, y: 100, d: 25.4, seatD: 25.6, apertureCA: 22.6, slotOn: true }],
  placed: []
});
check("контрольное отверстие: без slotAngle — радиально (90°), для обратной совместимости",
  svgSlotRadial.indexOf('rotate(90)') !== -1, svgSlotRadial.match(/rotate\([^)]+\)/g));

// --- паз под пинцет должен быть виден и в общей раскладке, не только в карточке ---
seatInput.value = "12";
seatInput.dispatchEvent(new w.Event("input"));
slotOnEl.click(); // включаем обратно
$("packBtn").click();
check("на раскладке нарисован хотя бы один паз (path в svgHost)",
  $("svgHost").querySelectorAll("path").length > 0);
slotOnEl.click(); // выключаем, чтобы не мешать дальнейшим тестам

// --- переключатель 2D/3D: без Three.js (jsdom) 3D вежливо отказывает ---
check("кнопки 2D/3D есть, активна 2D", $("view2dBtn").classList.contains("active") && !$("view3dBtn").classList.contains("active"));
$("view3dBtn").click();
check("3D без Three.js — понятное сообщение, остаёмся в 2D",
  $("sendMsg").textContent.indexOf("3D") !== -1 && !$("svgHost").hidden && $("view3dHost").hidden,
  $("sendMsg").textContent);

// --- выключаем контрольное отверстие, раскладываем снова ---
const firstOn = d.querySelector("#controlList .c-on");
firstOn.click();
check("после изменения кнопки заблокированы", $("csvBtn").disabled);
$("packBtn").click();
check("повторная раскладка прошла", $("summary").textContent.indexOf("размещено") !== -1);
check("выкл. «Свидетель Центр» → тех. отверстия 1-3 исчезают из раскладки",
  $("svgHost").innerHTML.indexOf("translate(-19") === -1);

// --- CSV ---
$("csvBtn").click(); // не должно упасть
check("CSV-кнопка отработала", true);

// --- отчёт ---
$("reportBtn").click();
check("print() вызван", printed === 1);
const rep = $("report").innerHTML;
check("в отчёте есть таблица координат", rep.indexOf("Координаты отверстий") !== -1);
check("в отчёте есть имя технолога", rep.indexOf("Тестов") !== -1);
check("в отчёте контрольные без выключенного Свидетеля Центр",
  rep.indexOf("Reference Ø") !== -1 && rep.indexOf("Свидетель Центр Ø") === -1);
// при выключенном «Свидетель Центр» проявляется центральное тех. отверстие
check("выкл. Свидетель Центр → центральное тех. отверстие активно (в отчёте)",
  rep.indexOf("Тех. отверстие центр Ø") !== -1);

// --- смена диска и типа детали ---
$("clPE").value = "9"; // испортим, чтобы проверить сброс к дефолту
$("discSelect").value = "disc-100";
$("discSelect").dispatchEvent(new w.Event("change"));
check("после смены диска зазоры сброшены к дефолту", $("clPE").value === "3", $("clPE").value);
const typeSel = d.querySelector("#partsList .p-type");
typeSel.value = "oct";
typeSel.dispatchEvent(new w.Event("change"));
check("для восьмиугольника есть поле фаски", d.querySelector("#partsList .p-ch") !== null);
check("для восьмиугольника есть селект ориентации", d.querySelector("#partsList .p-orient") !== null);
check("предпросмотр восьмиугольника — полигон", d.querySelector("#partsList .part-preview polygon") !== null);
$("packBtn").click();
check("раскладка восьмиугольников прошла", $("summary").textContent.indexOf("размещено") !== -1, $("summary").textContent);
check("название для восьмиугольника — «20×10×2 N<кол-во>»",
  /^20×10×2 N\d+$/.test($("holderName").value), $("holderName").value);

// --- радиальная ориентация + количество с расположением от края ---
const orientSel = d.querySelector("#partsList .p-orient");
orientSel.value = "radial-w";
orientSel.dispatchEvent(new w.Event("change"));
d.querySelector('#partsList input[value="qty"]').click();
check("появилась строка «Расположение»", d.querySelector("#partsList .p-anchor") !== null);
const anchorSel = d.querySelector("#partsList .p-anchor");
anchorSel.value = "edge";
anchorSel.dispatchEvent(new w.Event("change"));
const qtyInp = d.querySelector("#partsList .p-qty");
qtyInp.value = "6";
qtyInp.dispatchEvent(new w.Event("input"));
$("packBtn").click();
check("радиальная раскладка от края: 6 из 6",
  $("summary").textContent.indexOf("размещено 6 из 6") !== -1, $("summary").textContent);

// --- расположение «по диаметру» показывает поле Ø ---
const anchorSel2 = d.querySelector("#partsList .p-anchor");
anchorSel2.value = "diameter";
anchorSel2.dispatchEvent(new w.Event("change"));
check("поле Ø расположения появилось", d.querySelector("#partsList .p-anchor-d") !== null);

// --- отправка без настроенного URL даёт понятную ошибку ---
$("packBtn").click(); // после правок формы раскладываем заново, чтобы кнопки ожили
$("sendBtn").click();
setTimeout(() => {
  check("отправка без URL — понятное сообщение", $("sendMsg").textContent.indexOf("не настроена") !== -1, $("sendMsg").textContent);

  // --- «База подложкодержателей»: заказ сохраняется локально даже если
  // отправка в Google Таблицу не удалась (URL не настроен) ---
  const savedOrders = JSON.parse(w.localStorage.getItem("hc-orders") || "[]");
  check("заказ сохранён в локальном реестре (hc-orders) сразу при отправке",
    savedOrders.length === 1, JSON.stringify(savedOrders.map((o) => o.id)));
  check("статус отправки — «нет» (URL не настроен, submitOrder отклонён)", savedOrders[0].sentOk === false);

  d.querySelector('.tab-btn[data-tab="tabOrders"]').click();
  check("вкладка «База»: таблица содержит заказ", d.querySelectorAll("#ordersTableBody tr").length === 1);
  check("вкладка «База»: превью/карточка скрыты по умолчанию", $("ordersMain").hidden);
  const orderRow = d.querySelector("#ordersTableBody tr");
  check("в таблице «Отправлено» — нет", orderRow.children[6].textContent.trim() === "нет", orderRow.children[6].textContent);
  orderRow.click();
  check("клик по заказу показывает превью+карточку", !$("ordersMain").hidden);
  check("превью заказа отрисовано (SVG)", $("ordersSvgHost").querySelector("svg") !== null);
  check("карточка заказа показывает технолога", $("orderInfo").textContent.indexOf($("custName").value) !== -1, $("orderInfo").textContent);
  check("кнопки 2D/3D заказа есть, активна 2D",
    $("ordersView2dBtn").classList.contains("active") && !$("ordersView3dBtn").classList.contains("active"));

  let csvDownloaded = false;
  const origCreateObjectURL = w.URL.createObjectURL;
  w.URL.createObjectURL = () => { csvDownloaded = true; return "blob:fake"; };
  $("orderCsvBtn").click();
  check("«Скачать CSV» для сохранённого заказа сработала", csvDownloaded);
  w.URL.createObjectURL = origCreateObjectURL;

  const printedBefore = printed;
  $("orderReportBtn").click();
  check("«Отчёт / PDF» для сохранённого заказа вызвала печать", printed === printedBefore + 1);

  $("ordersCancelBtn").click();
  check("«Отмена» прячет превью+карточку заказа", $("ordersMain").hidden);
  check("«Отмена» снимает активность со строки заказа", !d.querySelector("#ordersTableBody tr").classList.contains("active"));

  d.querySelector("#ordersTableBody tr").click();
  confirmReturn = false;
  $("orderDelBtn").click();
  check("отказ от подтверждения — заказ не удалён", JSON.parse(w.localStorage.getItem("hc-orders")).length === 1);
  confirmReturn = true;
  $("orderDelBtn").click();
  check("удаление заказа: пропал из реестра и из таблицы",
    JSON.parse(w.localStorage.getItem("hc-orders")).length === 0 && d.querySelectorAll("#ordersTableBody tr").length === 0);
  check("удаление заказа: панель скрылась", $("ordersMain").hidden);

  d.querySelector('.tab-btn[data-tab="tabConfigurator"]').click(); // вернуть исходное состояние для остальных тестов

  // --- вкладки: Конфигуратор активна по умолчанию, переключение показывает/скрывает панели ---
  check("вкладка «Конфигуратор» активна по умолчанию, остальные скрыты",
    !$("tabConfigurator").hidden && $("tabBlanks").hidden && $("tabOrders").hidden);
  d.querySelector('.tab-btn[data-tab="tabBlanks"]').click();
  check("клик по «Болванки» показывает её панель и скрывает остальные",
    $("tabConfigurator").hidden && !$("tabBlanks").hidden && $("tabOrders").hidden);
  check("активная вкладка получает класс active", d.querySelector('.tab-btn[data-tab="tabBlanks"]').classList.contains("active"));
  d.querySelector('.tab-btn[data-tab="tabConfigurator"]').click(); // вернуть исходное состояние для остальных тестов
  check("возврат на «Конфигуратор» скрывает остальные панели снова",
    !$("tabConfigurator").hidden && $("tabBlanks").hidden && $("tabOrders").hidden);

  // --- переключение вкладок само перерисовывает 3D, если он уже был выбран
  // (панели просто скрываются/показываются, не удаляются из DOM — 3D-хост,
  // пока скрыт, не имеет размеров и не рисуется; раньше приходилось вручную
  // щёлкать 2D→3D после каждого переключения вкладки) ---
  {
    const origAvailable = w.HC.viewer3d.available, origUpdate = w.HC.viewer3d.update;
    const calls = [];
    w.HC.viewer3d.available = () => true;
    w.HC.viewer3d.update = (host) => { calls.push(host.id); return true; };
    $("view3dBtn").click();
    check("3D включился (со стабом viewer3d.available)", calls.indexOf("view3dHost") !== -1, JSON.stringify(calls));
    calls.length = 0;
    d.querySelector('.tab-btn[data-tab="tabBlanks"]').click();
    d.querySelector('.tab-btn[data-tab="tabConfigurator"]').click();
    check("возврат на вкладку с активным 3D сам перерисовывает вид (без ручного 2D→3D)",
      calls.indexOf("view3dHost") !== -1, JSON.stringify(calls));
    w.HC.viewer3d.available = origAvailable;
    w.HC.viewer3d.update = origUpdate;
    $("view2dBtn").click(); // вернуть 2D для остальных тестов
  }

  // --- вкладка «Болванки»: ничего не выбрано по умолчанию ---
  check("нет опции «кастомный подложкодержитель» в списке дисков",
    !Array.from($("discSelect").options).some((o) => o.value === "custom"));
  const catalogCount = $("discSelect").options.length;
  const rows0 = Array.from(d.querySelectorAll("#blanksTableBody tr"));
  check("таблица болванок: по строке на каждый диск каталога", rows0.length === catalogCount, rows0.length + " vs " + catalogCount);
  check("таблица болванок: заголовок первого столбца — «Номер» (не «Название»)",
    d.querySelector("#blanksTable thead th").textContent === "Номер", d.querySelector("#blanksTable thead th").textContent);
  check("по умолчанию ни одна строка не активна", !rows0.some((tr) => tr.classList.contains("active")));
  check("превью/карточка скрыты по умолчанию (#blanksMain hidden)", $("blanksMain").hidden);

  // клик по строке — показывает превью+карточку и скроллит наверх
  let scrollCalls = 0;
  w.Element.prototype.scrollIntoView = function () { scrollCalls++; };
  const disc298Row0 = d.querySelector('#blanksTableBody tr[data-id="disc-298"]');
  disc298Row0.click();
  check("клик по строке показывает превью+карточку (#blanksMain)", !$("blanksMain").hidden);
  check("клик по строке отмечает её активной",
    d.querySelector('#blanksTableBody tr[data-id="disc-298"]').classList.contains("active"));
  check("клик по строке вызывает прокрутку к превью", scrollCalls > 0, String(scrollCalls));
  check("предпросмотр болванки отрисован (SVG)", $("blanksSvgHost").querySelector("svg") !== null);
  check("карточка: поле Название заполнено именем диска (не авто-названием по деталям)",
    $("blankName").value === "Диск, полезная зона Ø298", $("blankName").value);
  check("карточка: история пуста («Изменений пока нет»)",
    $("blankHistory").textContent.indexOf("Изменений пока нет") !== -1, $("blankHistory").textContent);

  // «Отмена» прячет превью+карточку обратно и снимает активность со строки
  $("blanksCancelBtn").click();
  check("«Отмена» прячет превью+карточку", $("blanksMain").hidden);
  check("«Отмена» снимает активность со строки", !d.querySelector('#blanksTableBody tr[data-id="disc-298"]').classList.contains("active"));

  check("Reference «есть» для disc-298 (у него есть Reference-отверстие)",
    disc298Row0.children[4].textContent.trim() === "есть", disc298Row0.children[4].textContent);
  check("Свидетель с краю «есть» для disc-298", disc298Row0.children[5].textContent.trim() === "есть");
  check("Свидетель центр «есть» для disc-298", disc298Row0.children[6].textContent.trim() === "есть");
  check("Установка не задана — в таблице «—»", disc298Row0.children[1].textContent.trim() === "—", disc298Row0.children[1].textContent);
  check("Описание не задано — в таблице «—»", disc298Row0.children[2].textContent.trim() === "—", disc298Row0.children[2].textContent);

  // повторный клик по той же строке — снова показывает панель
  disc298Row0.click();
  check("повторный клик по строке снова показывает панель", !$("blanksMain").hidden);
  check("кнопки 2D/3D болванок есть, активна 2D",
    $("blanksView2dBtn").classList.contains("active") && !$("blanksView3dBtn").classList.contains("active"));
  $("blanksView3dBtn").click();
  check("3D болванок без Three.js — понятное сообщение, остаёмся в 2D",
    $("blanksView2dBtn").classList.contains("active") && $("blanksMsg").textContent.indexOf("не загрузилась") !== -1,
    $("blanksMsg").textContent);

  // выбор новой строки всегда сбрасывает превью на 2D (иначе колесо мыши над
  // 3D-моделью крутит зум вместо прокрутки страницы) — симулируем «застрявшее»
  // 3D-состояние разметки и проверяем, что клик по другой болванке его снимает
  $("blanksView2dBtn").classList.remove("active");
  $("blanksView3dBtn").classList.add("active");
  $("blanksSvgHost").hidden = true;
  $("blanksView3dHost").hidden = false;
  d.querySelector('#blanksTableBody tr[data-id="disc-100"]').click();
  check("выбор другой болванки сбрасывает превью на 2D",
    $("blanksView2dBtn").classList.contains("active") && !$("blanksView3dBtn").classList.contains("active") &&
    !$("blanksSvgHost").hidden && $("blanksView3dHost").hidden);
  d.querySelector('#blanksTableBody tr[data-id="disc-298"]').click(); // вернуться к disc-298 для дальнейших тестов

  // --- карточка болванки: ручные Название/Установка/Описание, Сохранить + история ---
  $("blankName").value = "Диск Ø298 (правка)";
  $("blankInstall").value = "Ortus 700";
  $("blankDesc").value = "Тестовое описание";
  $("blankSaveBtn").click();
  check("карточка: сохранение — сообщение «Сохранено.»", $("blankSaveMsg").textContent === "Сохранено.", $("blankSaveMsg").textContent);
  const savedRow = d.querySelector('#blanksTableBody tr[data-id="disc-298"]');
  check("карточка: новое название в таблице", savedRow.children[0].textContent === "Диск Ø298 (правка)", savedRow.children[0].textContent);
  check("карточка: установка в таблице", savedRow.children[1].textContent === "Ortus 700", savedRow.children[1].textContent);
  check("карточка: описание в таблице", savedRow.children[2].textContent === "Тестовое описание", savedRow.children[2].textContent);
  check("карточка: название обновилось в выпадающем списке дисков (+ установка/описание после названия)",
    Array.from($("discSelect").options).some((o) => o.textContent === "Диск Ø298 (правка) — Ortus 700 — Тестовое описание"),
    Array.from($("discSelect").options).map((o) => o.textContent).join(" | "));
  check("карточка: история пополнилась записью с автором и сутью правки",
    $("blankHistory").textContent.indexOf($("custName").value) !== -1 && $("blankHistory").textContent.indexOf("Ortus 700") !== -1,
    $("blankHistory").textContent);
  const savedStore = JSON.parse(w.localStorage.getItem("hc-custom-discs") || "[]");
  check("карточка: правленая встроенная болванка сохранена в localStorage (полная копия с историей)",
    savedStore.some((x) => x.id === "disc-298" && x._edited && x.installation === "Ortus 700" && (x.history || []).length === 1),
    JSON.stringify(savedStore.map((x) => x.id)));

  // --- контрольные отверстия: снятие галочки (наличие) — правится ЗДЕСЬ и
  // должно попадать в каталог/таблицу при «Сохранить», а не пропадать после
  // раскладки/переключения ---
  const ctrlRows = Array.from(d.querySelectorAll("#controlList .ctrl-row"));
  const refRow = ctrlRows[2];
  check("3-я строка контрольных отверстий — Reference", refRow.querySelector(".ctrl-head label").textContent.trim() === "Reference", refRow.querySelector(".ctrl-head label").textContent);
  const refCheckbox = refRow.querySelector(".c-on");
  check("Reference изначально включён", refCheckbox.checked);
  refCheckbox.checked = false;
  refCheckbox.dispatchEvent(new w.Event("change"));
  $("blankSaveBtn").click();
  const discAfterSave = w.HC.CATALOG.discs.filter((x) => x.id === "disc-298")[0];
  check("после «Сохранить»: Reference выключен в записи каталога (on:false)",
    discAfterSave.controlVariants[0].holes.some((h) => h.name === "Reference" && h.on === false),
    JSON.stringify(discAfterSave.controlVariants[0].holes.map((h) => [h.name, h.on])));
  check("после «Сохранить»: в таблице болванок Reference — «нет»",
    d.querySelector('#blanksTableBody tr[data-id="disc-298"]').children[4].textContent.trim() === "нет");
  check("история фиксирует выключение Reference", $("blankHistory").textContent.indexOf("выключено") !== -1, $("blankHistory").textContent);

  // переключились на другую болванку и обратно — выключенный Reference должен остаться выключенным
  $("discSelect").value = "disc-100";
  $("discSelect").dispatchEvent(new w.Event("change"));
  $("discSelect").value = "disc-298";
  $("discSelect").dispatchEvent(new w.Event("change"));
  const refRowAfter = Array.from(d.querySelectorAll("#controlList .ctrl-row"))[2];
  check("после переключения туда-обратно Reference остаётся выключенным (не сбрасывается на «включён»)",
    !refRowAfter.querySelector(".c-on").checked);

  // --- модальное окно «Добавить болванку»: Отмена просто закрывает, без побочных эффектов ---
  check("модальное окно скрыто по умолчанию", $("addBlankModal").hidden);
  $("addBlankBtn").click();
  check("клик по «Добавить болванку» открывает модальное окно", !$("addBlankModal").hidden);
  check("превью пусто, подсказка про загрузку/конструктор", $("addBlankMsg").textContent.indexOf("конструктором") !== -1, $("addBlankMsg").textContent);
  const catalogCountBeforeCancel = w.HC.CATALOG.discs.length;
  $("addBlankModalCancelBtn").click();
  check("«Отмена» закрывает модальное окно", $("addBlankModal").hidden);
  check("«Отмена» ничего не добавляет в каталог", w.HC.CATALOG.discs.length === catalogCountBeforeCancel);

  // Сохранить без собранной геометрии — понятная ошибка
  $("addBlankBtn").click();
  $("addBlankModalSaveBtn").click();
  check("«Сохранить» без загруженной/собранной геометрии — понятная ошибка",
    $("addBlankModalMsg").textContent.indexOf("Сначала загрузите") !== -1, $("addBlankModalMsg").textContent);

  // --- ручной конструктор внутри модального окна: занижение, свидетель, крепёж ---
  $("mbDia").value = "280"; $("mbDia").dispatchEvent(new w.Event("input"));
  $("mbThk").value = "8"; $("mbThk").dispatchEvent(new w.Event("input"));
  check("конструктор: зона напыления авто-считается (Ø диска −3мм = 277) без занижения",
    $("mbCoatingZoneDia").value === "277", $("mbCoatingZoneDia").value);
  $("mbRecessOn").checked = true;
  $("mbRecessOn").dispatchEvent(new w.Event("change"));
  check("конструктор: поля занижения показаны после включения галочки", !$("mbRecessFields").hidden);
  $("mbRecessSide").value = "bottom"; $("mbRecessDia").value = "300"; $("mbRecessDepth").value = "2";
  $("mbRecessDia").dispatchEvent(new w.Event("input"));
  $("mbCreateBtn").click();
  check("конструктор: Ø границы ≥ диаметра — понятная ошибка", $("mbMsg").textContent.indexOf("меньше диаметра") !== -1, $("mbMsg").textContent);
  $("mbRecessDia").value = "240"; $("mbRecessDia").dispatchEvent(new w.Event("input"));
  check("конструктор: зона напыления авто-пересчиталась по занижению (Ø240 −3мм = 237, меньше Ø диска)",
    $("mbCoatingZoneDia").value === "237", $("mbCoatingZoneDia").value);
  $("mbCoatingZoneDia").value = "150"; $("mbCoatingZoneDia").dispatchEvent(new w.Event("input"));
  $("mbDia").value = "280.5"; $("mbDia").dispatchEvent(new w.Event("input")); // тронули диаметр — авто-поле трогать уже не должно
  check("конструктор: ручная правка зоны напыления отключает авто-пересчёт", $("mbCoatingZoneDia").value === "150", $("mbCoatingZoneDia").value);
  $("mbDia").value = "280"; $("mbDia").dispatchEvent(new w.Event("input")); // вернуть точное значение для остальных проверок
  $("mbCoatingZoneDia").value = "237"; $("mbCoatingZoneDia").dispatchEvent(new w.Event("input")); // вернуть ожидаемое значение (проверили отключение авто — дальше снова используем его как дефолт)
  $("mbAddWitness").click();
  check("конструктор: строка свидетеля появилась", d.querySelectorAll("#mbWitnessList .mb-row").length === 1);
  const wRow = d.querySelector("#mbWitnessList .mb-row");
  check("конструктор: новый свидетель по умолчанию — Ø расположения = зона напыления (237), не 300",
    wRow.querySelector(".w-r").value === "237", wRow.querySelector(".w-r").value);
  wRow.querySelector(".w-r").value = "220";
  wRow.querySelector(".w-r").dispatchEvent(new w.Event("input"));
  wRow.querySelector(".w-angle").value = "90";
  wRow.querySelector(".w-angle").dispatchEvent(new w.Event("input"));
  check("конструктор: у свидетеля есть паз под пинцет + угол ориентации", wRow.querySelector(".w-slot-on") !== null && wRow.querySelector(".w-slot-angle") !== null);
  check("конструктор: паз у свидетеля включён по умолчанию, угол активен", wRow.querySelector(".w-slot-on").checked && !wRow.querySelector(".w-slot-angle").disabled);
  wRow.querySelector(".w-slot-angle").value = "45";
  wRow.querySelector(".w-slot-angle").dispatchEvent(new w.Event("input"));
  wRow.querySelector(".w-slot-on").checked = false;
  wRow.querySelector(".w-slot-on").dispatchEvent(new w.Event("change"));
  check("конструктор: снятие галочки паза отключает поле угла", wRow.querySelector(".w-slot-angle").disabled);
  wRow.querySelector(".w-slot-on").checked = true;
  wRow.querySelector(".w-slot-on").dispatchEvent(new w.Event("change"));
  $("mbAddFixture").click();
  check("конструктор: строка крепежа появилась", d.querySelectorAll("#mbFixtureList .mb-row").length === 1);
  const fRow = d.querySelector("#mbFixtureList .mb-row");
  check("конструктор: Ø крепежа по умолчанию 3.3", fRow.querySelector(".f-d").value === "3.3", fRow.querySelector(".f-d").value);
  check("конструктор: у крепежа (режим «по диаметру») есть поле поворота", fRow.querySelector(".f-rotation") !== null);
  check("конструктор: новый крепёж по умолчанию — Ø расположения = зона напыления (237), не 320",
    fRow.querySelector(".f-r").value === "237", fRow.querySelector(".f-r").value);
  fRow.querySelector(".f-count").value = "4";
  fRow.querySelector(".f-count").dispatchEvent(new w.Event("input"));
  fRow.querySelector(".f-rotation").value = "15";
  fRow.querySelector(".f-rotation").dispatchEvent(new w.Event("input"));
  fRow.querySelector(".f-mode").value = "xy";
  fRow.querySelector(".f-mode").dispatchEvent(new w.Event("change"));
  const fRowXY = d.querySelector("#mbFixtureList .mb-row");
  check("конструктор: у крепежа (режим «точные координаты») — поля X и Y (не textarea)",
    fRowXY.querySelector(".f-x") !== null && fRowXY.querySelector(".f-y") !== null && fRowXY.querySelector("textarea") === null);
  fRowXY.querySelector(".f-mode").value = "diameter";
  fRowXY.querySelector(".f-mode").dispatchEvent(new w.Event("change"));
  d.querySelector("#mbFixtureList .mb-row .f-count").value = "4";
  d.querySelector("#mbFixtureList .mb-row .f-count").dispatchEvent(new w.Event("input"));
  d.querySelector("#mbFixtureList .mb-row .f-rotation").value = "15";
  d.querySelector("#mbFixtureList .mb-row .f-rotation").dispatchEvent(new w.Event("input"));
  $("mbCreateBtn").click();
  check("конструктор: собрано — превью и подсказка сохранить", $("mbMsg").textContent.indexOf("Собрано") !== -1, $("mbMsg").textContent);
  check("конструктор: превью в модальном окне показывает занижение (пунктирное кольцо r=120)",
    $("addBlankPreviewHost").innerHTML.indexOf('r="120"') !== -1);

  // --- модальное окно: 2D/3D-переключение превью (та же панель, что и у карточки) ---
  check("модальное окно: кнопки 2D/3D есть, активна 2D",
    $("addBlankView2dBtn").classList.contains("active") && !$("addBlankView3dBtn").classList.contains("active"));
  $("addBlankView3dBtn").click();
  check("модальное окно: 3D без Three.js — понятное сообщение, остаёмся в 2D",
    $("addBlankView2dBtn").classList.contains("active") && $("addBlankMsg").textContent.indexOf("не загрузилась") !== -1,
    $("addBlankMsg").textContent);

  // Сохранить без названия (геометрия уже собрана) — понятная ошибка
  $("addBlankModalSaveBtn").click();
  check("«Сохранить» без названия — понятная ошибка", $("addBlankModalMsg").textContent.indexOf("название") !== -1, $("addBlankModalMsg").textContent);

  const catalogCountBeforeMb = w.HC.CATALOG.discs.length;
  $("nbName").value = "Тест-конструктор Ø280";
  $("nbInstall").value = "Lidiz 700";
  $("nbDesc").value = "Собрана конструктором";
  $("addBlankModalSaveBtn").click();
  check("«Сохранить» закрывает модальное окно", $("addBlankModal").hidden);
  check("«Сохранить» добавляет запись в каталог", w.HC.CATALOG.discs.length === catalogCountBeforeMb + 1);
  check("после сохранения превью+карточка сразу показаны (без повторного клика по таблице)", !$("blanksMain").hidden);
  const mbDisc = w.HC.CATALOG.discs.filter((x) => x.name === "Тест-конструктор Ø280")[0];
  check("конструктор: название/установка/описание из модального окна",
    mbDisc && mbDisc.installation === "Lidiz 700" && mbDisc.description === "Собрана конструктором",
    mbDisc && JSON.stringify([mbDisc.installation, mbDisc.description]));
  check("конструктор: edgeRecess в записи (bottom, Ø240, 2 мм)",
    mbDisc && mbDisc.edgeRecess && mbDisc.edgeRecess.side === "bottom" && mbDisc.edgeRecess.diameter === 240 && mbDisc.edgeRecess.depth === 2,
    JSON.stringify(mbDisc && mbDisc.edgeRecess));
  check("конструктор: свидетель на (0, 110) — Ø расположения 220, угол 90°",
    mbDisc && Math.abs(mbDisc.controlVariants[0].holes[0].x) < 1e-6 && Math.abs(mbDisc.controlVariants[0].holes[0].y - 110) < 1e-6,
    mbDisc && JSON.stringify(mbDisc.controlVariants[0].holes[0]));
  check("конструктор: крепёж — 4 точки Ø3.3",
    mbDisc && mbDisc.fixtures.holes.length === 1 && mbDisc.fixtures.holes[0].points.length === 4 && mbDisc.fixtures.holes[0].d === 3.3,
    mbDisc && JSON.stringify(mbDisc.fixtures.holes));
  check("конструктор: паз/ориентация свидетеля сохранены (slotAvailable, угол 45°)",
    mbDisc && mbDisc.controlVariants[0].holes[0].slotAvailable === true && mbDisc.controlVariants[0].holes[0].slotAngle === 45,
    mbDisc && JSON.stringify(mbDisc.controlVariants[0].holes[0]));
  check("конструктор: поворот крепежа (15°) сместил первую точку (r=118.5 — дефолт по зоне напыления)",
    mbDisc && Math.abs(mbDisc.fixtures.holes[0].points[0][0] - 118.5 * Math.cos((15 * Math.PI) / 180)) < 0.01,
    mbDisc && JSON.stringify(mbDisc.fixtures.holes[0].points[0]));
  check("конструктор: зона напыления (237) сохранена в записи",
    mbDisc && mbDisc.coatingZoneDiameter === 237, mbDisc && mbDisc.coatingZoneDiameter);
  check("конструктор: новая болванка выбрана и активна в таблице",
    d.querySelector('#blanksTableBody tr[data-id="' + mbDisc.id + '"]').classList.contains("active"));

  // --- «зазор деталь-край» отсчитывается от зоны напыления (Ø237), а НЕ от
  // «Ø полезной зоны» (Ø280) — иначе деталь могла бы встать между зоной
  // напыления и краем полезной зоны и остаться непокрытой. Сам физический
  // диск при этом рисуется в полный рост (Ø280), не сжимается до зоны
  // напыления (см. packBoundaryDiameter/physicalDiameter в app.js) ---
  $("packBtn").click();
  const svgCoating = $("svgHost").innerHTML;
  check("границу раскладки (Ruse) взяли по зоне напыления: r=118.5 (Ø237/2), а не r=140 (Ø280/2)",
    svgCoating.indexOf('r="118.5"') !== -1, svgCoating.slice(0, 200));
  check("физический диск всё равно в полный рост — r=140 (Ø280) присутствует, не сжат до зоны напыления",
    svgCoating.indexOf('r="140"') !== -1, svgCoating.slice(0, 200));

  // --- загрузка своей подложки из CSV через модальное окно (FileReader → buildDiscEntry → каталог) ---
  const uploadCsv = [
    "holes-dump;1", "part;Up", "columns;name;x;y;diameter;depth;type;extra1;extra2;tapped",
    "Bound;0;0;324.5;through;drilled;;;no",
    "Wit;0;0;25.6;4.5;drilled;;;no", "WitCA;0;0;22.6;through;drilled;;;no",
    "Flange;160;0;6;through;drilled;;;no"
  ].join("\n");
  const discCountBefore = w.HC.CATALOG.discs.length;
  $("addBlankBtn").click();
  $("discZone").value = "298"; $("discThk").value = "6";
  const upFile = new w.File([uploadCsv], "up-holes.csv", { type: "text/csv" });
  Object.defineProperty($("discFile"), "files", { value: [upFile], configurable: true });
  $("discLoadBtn").click(); // FileReader асинхронный
  setTimeout(() => {
    check("CSV разобран — превью в модальном окне и подсказка сохранить", $("discLoadMsg").textContent.indexOf("Разобрано") !== -1, $("discLoadMsg").textContent);
    check("CSV: превью показывает отрисованную геометрию", $("addBlankPreviewHost").querySelector("svg") !== null);
    $("nbName").value = "Загруженный Ø298";
    $("addBlankModalSaveBtn").click();
    check("загрузка своей подложки: диск добавлен в список",
      w.HC.CATALOG.discs.length === discCountBefore + 1, w.HC.CATALOG.discs.length + " vs " + discCountBefore);
    check("загруженная подложка выбрана и есть по имени",
      Array.from($("discSelect").options).some((o) => o.textContent === "Загруженный Ø298"));
    check("для загруженной подложки видна кнопка удаления", !$("discDelBtn").hidden);
    check("после сохранения панель показывает загруженную подложку", $("blankName").value === "Загруженный Ø298", $("blankName").value);

    // --- удаление: спрашивает подтверждение, отказ ничего не удаляет ---
    $("discSelect").value = "disc-298";
    $("discSelect").dispatchEvent(new w.Event("change"));
    d.querySelector('#blanksTableBody tr[data-id="disc-298"]').click();
    const beforeCancelDel = w.HC.CATALOG.discs.length;
    confirmReturn = false;
    $("discDelBtn").click();
    check("отказ от подтверждения — болванка не удалена", w.HC.CATALOG.discs.length === beforeCancelDel);
    confirmReturn = true;

    // --- удаление: встроенная болванка скрывается через hc-hidden-discs ---
    const before298 = w.HC.CATALOG.discs.length;
    $("discDelBtn").click();
    check("удаление: диск исчез из каталога и таблицы",
      w.HC.CATALOG.discs.length === before298 - 1 && d.querySelector('#blanksTableBody tr[data-id="disc-298"]') === null);
    const hiddenIds = JSON.parse(w.localStorage.getItem("hc-hidden-discs") || "[]");
    check("удаление: встроенный id запомнен в hc-hidden-discs", hiddenIds.indexOf("disc-298") !== -1, JSON.stringify(hiddenIds));
    check("удаление: выбор перешёл на первую оставшуюся болванку", $("discSelect").value === w.HC.CATALOG.discs[0].id, $("discSelect").value);

    // --- удаление созданной пользователем: просто уходит из каталога (без тумбстоуна) ---
    d.querySelector('#blanksTableBody tr[data-id="' + mbDisc.id + '"]').click();
    $("discDelBtn").click();
    check("удаление пользовательской болванки: исчезла из каталога",
      !w.HC.CATALOG.discs.some((x) => x.id === mbDisc.id));
    check("удаление пользовательской: её нет в hc-hidden-discs (не тумбстоун)",
      JSON.parse(w.localStorage.getItem("hc-hidden-discs")).indexOf(mbDisc.id) === -1);

    // --- assembleOrder переносит fileName в снимок диска заказа: без этого
    // поля HC.downloadSTEP никогда не брал настоящий импортированный STEP
    // (buildSolidFromImported) — order.disc.fileName всегда оказывался
    // undefined, и экспорт тихо пересобирал диск с нуля по параметрам
    // (buildSolid, Ø «полезной зоны», без реальных канавок/фигурных вырезов) ---
    $("addBlankBtn").click();
    $("mbRecessOn").checked = false; // сбрасываем занижение, оставшееся от предыдущей болванки (Ø240 >= новых 200 — иначе ошибка валидации)
    $("mbDia").value = "200"; $("mbThk").value = "6";
    $("mbDia").dispatchEvent(new w.Event("input"));
    $("mbThk").dispatchEvent(new w.Event("input"));
    $("mbCreateBtn").click();
    $("nbName").value = "ТестFileName";
    $("addBlankModalSaveBtn").click();
    const fnDisc = w.HC.CATALOG.discs.filter((x) => x.name === "ТестFileName")[0];
    check("тестовая болванка для проверки fileName создана и выбрана",
      fnDisc && $("discSelect").value === fnDisc.id, fnDisc && fnDisc.id);
    fnDisc.fileName = "real-blank.stp"; // симулируем болванку с настоящим импортированным STEP-файлом
    $("packBtn").click();
    $("sendBtn").click();
    const ordersAfterFnTest = JSON.parse(w.localStorage.getItem("hc-orders") || "[]");
    const fnOrder = ordersAfterFnTest[ordersAfterFnTest.length - 1];
    check("assembleOrder: order.disc.fileName перенесён из исходной болванки (регрессия)",
      fnOrder && fnOrder.disc.fileName === "real-blank.stp", fnOrder && JSON.stringify(fnOrder.disc));
    d.querySelector('#blanksTableBody tr[data-id="' + fnDisc.id + '"]').click();
    $("discDelBtn").click();

    // --- нельзя удалить последнюю оставшуюся болванку ---
    while (w.HC.CATALOG.discs.length > 1) {
      d.querySelector("#blanksTableBody tr").click();
      $("discDelBtn").click();
    }
    const lastId = w.HC.CATALOG.discs[0].id;
    d.querySelector('#blanksTableBody tr[data-id="' + lastId + '"]').click();
    $("discDelBtn").click();
    check("последнюю болванку удалить нельзя — понятная ошибка",
      w.HC.CATALOG.discs.length === 1 && $("blankSaveMsg").textContent.indexOf("хотя бы одна") !== -1,
      $("blankSaveMsg").textContent);

    // --- превью конструктора обновляется само, без клика по «Собрать» ---
    $("addBlankBtn").click();
    check("повторное открытие модального окна сбрасывает превью", $("addBlankPreviewHost").innerHTML === "");
    $("mbDia").value = "222"; $("mbThk").value = "7";
    $("mbDia").dispatchEvent(new w.Event("input"));
    $("mbThk").dispatchEvent(new w.Event("input"));
    check("превью ещё не обновилось сразу (обновление отложено)", $("addBlankPreviewHost").innerHTML === "");
    setTimeout(() => {
      check("превью обновилось само по себе (без клика «Собрать»)",
        $("addBlankPreviewHost").querySelector("svg") !== null && $("addBlankPreviewHost").innerHTML.indexOf('r="111"') !== -1,
        $("addBlankPreviewHost").innerHTML.slice(0, 150));
      $("addBlankModalCancelBtn").click();

      console.log(failures ? "\nПРОВАЛЕНО: " + failures : "\nSmoke-тест страницы пройден.");
      process.exit(failures ? 1 : 0);
    }, 250);
  }, 60);
}, 50);
