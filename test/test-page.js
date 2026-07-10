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
check("зазоры предзаполнены", $("clPP").value === "2" && $("clPE").value === "2" && $("clPC").value === "3");
check("есть строка детали", d.querySelectorAll("#partsList .part-row").length === 1);

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
$("discSelect").value = "disc-100";
$("discSelect").dispatchEvent(new w.Event("change"));
check("после смены диска зазоры обновились", $("clPE").value === "5", $("clPE").value);
const typeSel = d.querySelector("#partsList .p-type");
typeSel.value = "oct";
typeSel.dispatchEvent(new w.Event("change"));
check("для восьмиугольника есть поле фаски", d.querySelector("#partsList .p-ch") !== null);
check("для восьмиугольника есть галочка поворота", d.querySelector("#partsList .p-rot") !== null);
$("packBtn").click();
check("раскладка восьмиугольников прошла", $("summary").textContent.indexOf("размещено") !== -1, $("summary").textContent);

// --- отправка без настроенного URL даёт понятную ошибку ---
$("sendBtn").click();
setTimeout(() => {
  check("отправка без URL — понятное сообщение", $("sendMsg").textContent.indexOf("не настроена") !== -1, $("sendMsg").textContent);
  console.log(failures ? "\nПРОВАЛЕНО: " + failures : "\nSmoke-тест страницы пройден.");
  process.exit(failures ? 1 : 0);
}, 50);
