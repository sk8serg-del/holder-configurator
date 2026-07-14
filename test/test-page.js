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
for (const n of ["catalog", "geometry", "packer", "render", "export-csv", "report", "sheets", "app"]) {
  const src = fs.readFileSync(path.join(root, "js", n + ".js"), "utf8");
  w.eval(src);
}

const d = w.document;
const $ = (id) => d.getElementById(id);

// --- инициализация ---
check("список дисков заполнен", $("discSelect").options.length >= 3, String($("discSelect").options.length));
check("диск по умолчанию — Ø298", $("discSelect").value === "disc-298", $("discSelect").value);
check("контрольные отверстия: 3 строки", d.querySelectorAll("#controlList .ctrl-row").length === 3);
check("у Центр/7° поле детали d = 25.4 (авто D=25,6/CA=23,9)",
  d.querySelectorAll("#controlList .c-d").length === 2 &&
  d.querySelectorAll("#controlList .c-d")[0].value === "25.4" &&
  d.querySelectorAll("#controlList .c-d")[1].value === "25.4");
check("у Центр/7° есть чекбокс паза (slotAvailable)",
  d.querySelectorAll("#controlList .c-slot-on").length === 2);
const seatDs = Array.from(d.querySelectorAll("#controlList .c-seat-d")).map(function (el) { return el.value; });
check("Ø222/67°: посадка D=30.1, CA=24.1, без паза, без поля d",
  seatDs.indexOf("30.1") !== -1 &&
  Array.from(d.querySelectorAll("#controlList .c-ca")).some(function (el) { return el.value === "24.1"; }),
  seatDs.join(","));
check("схема Центр/7° показывает d25,4 (D25,6/CA23,9)",
  d.querySelectorAll("#controlList .part-preview")[0].innerHTML.indexOf("d25,4 (D25,6/CA23,9)") !== -1,
  d.querySelectorAll("#controlList .part-preview")[0].innerHTML);
check("схема Ø222/67° показывает (D30,1/CA24,1) · глуб. 3 без d",
  d.querySelectorAll("#controlList .part-preview")[2].innerHTML.indexOf("(D30,1/CA24,1) · глуб. 3") !== -1,
  d.querySelectorAll("#controlList .part-preview")[2].innerHTML);
check("зазоры предзаполнены (6/3/6)", $("clPP").value === "6" && $("clPE").value === "3" && $("clPC").value === "6",
  $("clPP").value + "/" + $("clPE").value + "/" + $("clPC").value);
check("есть строка детали", d.querySelectorAll("#partsList .part-row").length === 1);

// --- предпросмотр детали (для круга — крупная схема d/D/CA, авторасчёт) ---
check("схема отверстия отрисована с авто D/CA для d=10 (D10,2/CA8,5)",
  d.querySelector("#partsList .part-preview.hole-diagram svg") !== null &&
  d.querySelector("#partsList .part-preview").innerHTML.indexOf("d10 (D10,2/CA8,5)") !== -1,
  d.querySelector("#partsList .part-preview").innerHTML);
const dInput = d.querySelector("#partsList .p-d");
const seatInput = d.querySelector("#partsList .p-seat-d");
const caInput = d.querySelector("#partsList .p-ca");
dInput.value = "12";
dInput.dispatchEvent(new w.Event("input"));
check("при смене d авто D/CA пересчитались (D12,2/CA10,5)",
  d.querySelector("#partsList .part-preview").innerHTML.indexOf("d12 (D12,2/CA10,5)") !== -1,
  d.querySelector("#partsList .part-preview").innerHTML);
check("max у поля CA обновился до авто-максимума", caInput.getAttribute("max") === "10.5", caInput.getAttribute("max"));

// ручная правка D — дальше не должна затираться при новом изменении d
seatInput.value = "13";
seatInput.dispatchEvent(new w.Event("input"));
dInput.value = "20";
dInput.dispatchEvent(new w.Event("input"));
check("ручной D сохранился при смене d, CA пересчитался (D13/CA18,5)",
  d.querySelector("#partsList .part-preview").innerHTML.indexOf("d20 (D13/CA18,5)") !== -1,
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

// --- паз под пинцет должен быть виден и в общей раскладке, не только в карточке ---
seatInput.value = "12";
seatInput.dispatchEvent(new w.Event("input"));
slotOnEl.click(); // включаем обратно
$("packBtn").click();
check("на раскладке нарисован хотя бы один паз (path в svgHost)",
  $("svgHost").querySelectorAll("path").length > 0);
slotOnEl.click(); // выключаем, чтобы не мешать дальнейшим тестам

// --- выключаем контрольное отверстие, раскладываем снова ---
const firstOn = d.querySelector("#controlList .c-on");
firstOn.click();
check("после изменения кнопки заблокированы", $("csvBtn").disabled);
$("packBtn").click();
check("повторная раскладка прошла", $("summary").textContent.indexOf("размещено") !== -1);

// --- CSV ---
$("csvBtn").click(); // не должно упасть
check("CSV-кнопка отработала", true);

// --- отчёт ---
$("reportBtn").click();
check("print() вызван", printed === 1);
const rep = $("report").innerHTML;
check("в отчёте есть таблица координат", rep.indexOf("Координаты отверстий") !== -1);
check("в отчёте есть имя технолога", rep.indexOf("Тестов") !== -1);
check("в отчёте контрольные без выключенного центра", rep.indexOf("Ø222 / 7°") !== -1 && rep.indexOf("Центр Ø") === -1);

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
