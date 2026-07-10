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
check("дефолтный Ø контрольного = 24.7",
  d.querySelectorAll("#controlList .c-d")[1].value === "24.7",
  d.querySelectorAll("#controlList .c-d")[1].value);
check("зазоры предзаполнены (6/3/6)", $("clPP").value === "6" && $("clPE").value === "3" && $("clPC").value === "6",
  $("clPP").value + "/" + $("clPE").value + "/" + $("clPC").value);
check("есть строка детали", d.querySelectorAll("#partsList .part-row").length === 1);

// --- предпросмотр детали ---
check("предпросмотр круга отрисован", d.querySelector(".part-preview svg") !== null &&
  d.querySelector(".part-preview").innerHTML.indexOf("Ø10") !== -1);
const dInput = d.querySelector("#partsList .p-d");
dInput.value = "12";
dInput.dispatchEvent(new w.Event("input"));
check("предпросмотр обновился при вводе", d.querySelector(".part-preview").innerHTML.indexOf("Ø12") !== -1);
dInput.value = "10";
dInput.dispatchEvent(new w.Event("input"));

// --- раскладка ---
$("custName").value = "Тестов Т.Т.";
$("packBtn").click();
check("сводка появилась", $("summary").textContent.indexOf("размещено") !== -1, $("summary").textContent);
check("SVG отрисован", $("svgHost").innerHTML.indexOf("<svg") !== -1);
const circles = $("svgHost").querySelectorAll("circle").length;
check("кругов в SVG много (>100)", circles > 100, String(circles));
check("кнопки активны", !$("csvBtn").disabled && !$("reportBtn").disabled && !$("sendBtn").disabled);

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
check("предпросмотр восьмиугольника — полигон", d.querySelector(".part-preview polygon") !== null);
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
