/*
 * build-single-file.js — собирает всю страницу в один HTML-файл
 * (CSS и все скрипты инлайнятся) для отправки/хостинга без папок.
 *
 * Запуск:  node tools/build-single-file.js
 * Результат: dist/holder-configurator.html (без сборки/npm, чистый node).
 *
 * Каталог (js/catalog.js) и всё остальное остаются источником правды —
 * этот файл нужно пересобирать заново после любых правок в src.
 */
"use strict";
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const outDir = path.join(root, "dist");
const outFile = path.join(outDir, "holder-configurator.html");

const SCRIPTS = ["catalog", "i18n", "geometry", "packer", "render", "export-csv", "step-export", "step-import", "report", "sheets", "viewer3d", "holder-import", "blank-builder", "app"];

function readIndex() {
  return fs.readFileSync(path.join(root, "index.html"), "utf8");
}

function build() {
  let html = readIndex();

  // <link rel="stylesheet" href="css/style.css[?v=…]"> → <style>...</style>
  // (кэш-версии ?v=… на ассетах игнорируем при инлайне)
  html = html.replace(
    /<link rel="stylesheet" href="css\/style\.css(\?v=\d+)?">/,
    function () {
      var css = fs.readFileSync(path.join(root, "css", "style.css"), "utf8");
      return "<style>\n" + css + "\n</style>";
    }
  );

  // Three.js грузится динамически (js/vendor/three.min.js через createElement,
  // см. index.html) — для собранного файла это ссылка на несуществующую рядом
  // папку js/, поэтому инлайним его как data:-URI прямо в s.src, чтобы файл
  // остался самодостаточным, но загрузка by-design осталась динамической/после
  // оболочки, а не статичным тегом.
  html = html.replace(
    /s\.src = "js\/vendor\/three\.min\.js(\?v=\d+)?";/,
    function () {
      var js = fs.readFileSync(path.join(root, "js", "vendor", "three.min.js"), "utf8");
      var b64 = Buffer.from(js, "utf8").toString("base64");
      return 's.src = "data:text/javascript;base64,' + b64 + '";';
    }
  );

  // каждый <script src="js/NAME.js[?v=…]"></script> → <script>...</script>,
  // строго в исходном порядке подключения (важно — модули зависят друг от друга)
  SCRIPTS.forEach(function (name) {
    var re = new RegExp('<script src="js\\/' + name.replace(/[/.]/g, "\\$&") + '\\.js(\\?v=\\d+)?"></script>');
    var js = fs.readFileSync(path.join(root, "js", name + ".js"), "utf8");
    html = html.replace(re, function () { return "<script>\n" + js + "\n</script>"; });
  });

  if (/<script src="js\//.test(html)) {
    throw new Error("Не все <script> инлайнены — проверьте список SCRIPTS.");
  }

  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(outFile, html);
  console.log("Собрано: " + path.relative(root, outFile) + " (" + html.length + " байт)");
}

build();
