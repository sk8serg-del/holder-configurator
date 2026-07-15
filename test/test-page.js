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

let failures = 0;
function check(name, cond, detail) {
  if (cond) console.log("  ok   " + name);
  else { failures++; console.log("  FAIL " + name + (detail ? " — " + detail : "")); }
}

// подключаем модули в том же порядке, что и на странице
// three.min.js в jsdom не грузим (нет WebGL) — viewer3d обязан жить без него
for (const n of ["catalog", "geometry", "packer", "render", "export-csv", "report", "sheets", "viewer3d", "app"]) {
  const src = fs.readFileSync(path.join(root, "js", n + ".js"), "utf8");
  w.eval(src);
}

const d = w.document;
const $ = (id) => d.getElementById(id);

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
check("свёрнутая строка Reference: (D30,1/CA24,2) · глуб. 4 без паза",
  summaries[2] === "(D30,1/CA24,2) · глуб. 4", summaries[2]);
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

// ручная правка D — дальше не должна затираться при новом изменении d
seatInput.value = "13";
seatInput.dispatchEvent(new w.Event("input"));
dInput.value = "20";
dInput.dispatchEvent(new w.Event("input"));
check("ручной D сохранился при смене d, CA от D (D13/CA11,5 = D−1.5)",
  d.querySelector("#partsList .part-preview").innerHTML.indexOf("d20 (D13/CA11,5)") !== -1,
  d.querySelector("#partsList .part-preview").innerHTML);

// ручная правка CA в меньшую сторону — тоже должна сохраняться при смене d
caInput.value = "15";
caInput.dispatchEvent(new w.Event("input"));
dInput.value = "22";
dInput.dispatchEvent(new w.Event("input"));
check("ручной CA сохранился при смене d (D13/CA15 — D пересчитался бы, но он тоже уже ручной)",
  d.querySelector("#partsList .part-preview").innerHTML.indexOf("CA15") !== -1,
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
  console.log(failures ? "\nПРОВАЛЕНО: " + failures : "\nSmoke-тест страницы пройден.");
  process.exit(failures ? 1 : 0);
}, 50);
