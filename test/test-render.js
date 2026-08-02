// Тест HC.renderSVG: previewSVG (настоящий вид сверху STEP-геометрии, см.
// js/step-import.js buildBlankSummary) должен рисоваться фоном вместо
// приближённой реконструкции контура/крепежа/канавок из fixtures, но не
// мешать функциональным слоям (полезная зона, раскладка деталей).
// Запуск: node test/test-render.js
"use strict";
require("../js/geometry.js");
require("../js/render.js");
var HC = globalThis.HC;

var failures = 0;
function check(name, cond, detail) {
  if (cond) console.log("  ok   " + name);
  else { failures++; console.log("  FAIL " + name + (detail ? " — " + detail : "")); }
}

// Формат — как у настоящего replicad drawProjection(...).toSVG(): fill/stroke
// заданы на КОРНЕВОМ <svg> (версия/vector-effect как у replicad), дочерний
// <path> — БЕЗ своих атрибутов, наследует их. Регрессия: если при переносе во
// вложенный <svg> потерять родительские fill/stroke, path красится дефолтным
// SVG-заливом (сплошной чёрный) вместо тонкой линии.
var fakePreview = '<svg version="1.1" xmlns="http://www.w3.org/2000/svg" viewBox="-10 -10 20 20" ' +
  'fill="none" stroke="black" stroke-width="0.6%" vector-effect="non-scaling-stroke">' +
  '<path d="M 9 0 A 9 9 0 1 1 -9 0 A 9 9 0 1 1 9 0 Z"/></svg>';

var baseModel = {
  discDiameter: 100, blankDiameter: 120,
  fixtures: { holes: [{ d: 5, points: [[50, 0]] }], grooves: [{ outer: 118, inner: 116, depth: 1 }] },
  controlHoles: [], placed: [{ type: "circle", cx: 10, cy: 0, d: 4, partIndex: 0 }], showNumbers: false
};

function withoutPreview(extra) {
  var m = {}; for (var k in baseModel) m[k] = baseModel[k];
  for (var k2 in extra) m[k2] = extra[k2];
  return m;
}

var svgNoPreview = HC.renderSVG(withoutPreview({}));
check("без previewSVG рисуется контур болванки (R=60)", svgNoPreview.indexOf('r="60"') !== -1, svgNoPreview);
check("без previewSVG рисуется декоративный крепёж (r=2.5)", svgNoPreview.indexOf('r="2.5"') !== -1);
check("без previewSVG рисуется канавка (r=59)", svgNoPreview.indexOf('r="59"') !== -1);
check("канавка — сплошной линией (реальная физическая грань, не разметка)",
  /r="59"[^/]*stroke="#c0beb8"(?![^/]*stroke-dasharray)/.test(svgNoPreview), svgNoPreview);

// занижение по краю (edgeRecess) — та же реальная физическая ступенька, что и
// в 3D/STEP: должна быть сплошной линией, а не пунктиром (пунктир читался как
// «вырез с другой стороны/не по-настоящему» — единообразно с остальным)
var svgWithRecess = HC.renderSVG(withoutPreview({ edgeRecess: { side: "top", diameter: 80, depth: 1 } }));
check("edgeRecess: кольцо рисуется (r=40)", svgWithRecess.indexOf('r="40"') !== -1, svgWithRecess);
check("edgeRecess: сплошной линией, без stroke-dasharray",
  /r="40"[^/]*stroke="#9a8f7a"(?![^/]*stroke-dasharray)/.test(svgWithRecess), svgWithRecess);

var svgWithPreview = HC.renderSVG(withoutPreview({ previewSVG: fakePreview }));
check("с previewSVG исходное содержимое (путь контура) присутствует", svgWithPreview.indexOf('M 9 0 A 9 9') !== -1);
check("с previewSVG родительский fill=\"none\" перенесён (иначе path красится чёрным по умолчанию)",
  /<g[^>]*\bfill="none"/.test(svgWithPreview), svgWithPreview);
check("с previewSVG родительский stroke=\"black\" перенесён", /<g[^>]*\bstroke="black"/.test(svgWithPreview), svgWithPreview);
check("с previewSVG vector-effect НЕ перенесён (иначе линии остаются фиксированной толщины в пикселях — толще остального чертежа)",
  svgWithPreview.indexOf('vector-effect') === -1, svgWithPreview);
check("с previewSVG толщина линии — своя тонкая (как у остального чертежа), не replicad-овские 0.6%",
  svgWithPreview.indexOf('stroke-width="0.6%"') === -1 && /<g[^>]*stroke-width="0\.[0-9]+"/.test(svgWithPreview), svgWithPreview);
check("с previewSVG нет отдельного вложенного viewBox (координаты — прямо в общей системе, без флипа-зеркала)",
  svgWithPreview.indexOf("viewBox=\"-10 -10 20 20\"") === -1, svgWithPreview);
check("с previewSVG слой идёт ВНУТРИ общего flip-слоя (после scale(1,-1)) — иначе зеркалится по вертикали относительно остального чертежа/3D",
  svgWithPreview.indexOf('scale(1,-1)') < svgWithPreview.indexOf('M 9 0 A 9 9'), svgWithPreview);
check("с previewSVG декоративный крепёж (r=2.5) НЕ рисуется — уже настоящий на картинке", svgWithPreview.indexOf('r="2.5"') === -1);
check("с previewSVG декоративная канавка (r=59) НЕ рисуется отдельно", svgWithPreview.indexOf('r="59"') === -1);
check("с previewSVG полезная зона (Ruse=50) всё равно рисуется — функциональный слой", svgWithPreview.indexOf('r="50"') !== -1);
check("с previewSVG полезная зона БЕЗ непрозрачной заливки (иначе закрашивает реальную геометрию под собой)",
  /r="50" fill="none"/.test(svgWithPreview), svgWithPreview);
check("без previewSVG полезная зона со старой непрозрачной заливкой (#fdfdfc) — поведение не поменялось",
  /r="50" fill="#fdfdfc"/.test(svgNoPreview), svgNoPreview);
check("с previewSVG деталь раскладки всё равно рисуется (translate(10,0))", svgWithPreview.indexOf('translate(10,0)') !== -1);

console.log(failures ? failures + " FAIL" : "Тест render.js (previewSVG-фон) пройден.");
process.exit(failures ? 1 : 0);
