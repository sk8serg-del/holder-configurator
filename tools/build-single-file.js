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

const SCRIPTS = ["catalog", "geometry", "packer", "render", "export-csv", "report", "sheets", "vendor/three.min", "viewer3d", "holder-import", "app"];

function readIndex() {
  return fs.readFileSync(path.join(root, "index.html"), "utf8");
}

function build() {
  let html = readIndex();

  // <link rel="stylesheet" href="css/style.css"> → <style>...</style>
  html = html.replace(
    /<link rel="stylesheet" href="css\/style\.css">/,
    function () {
      var css = fs.readFileSync(path.join(root, "css", "style.css"), "utf8");
      return "<style>\n" + css + "\n</style>";
    }
  );

  // каждый <script src="js/NAME.js"></script> → <script>...</script>,
  // строго в исходном порядке подключения (важно — модули зависят друг от друга)
  SCRIPTS.forEach(function (name) {
    var re = new RegExp('<script src="js\\/' + name.replace(/[/.]/g, "\\$&") + '\\.js"></script>');
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
