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

  function currentControl() {
    var d = currentDisc();
    var id = $("controlSelect").value;
    for (var i = 0; i < d.controlVariants.length; i++) {
      if (d.controlVariants[i].id === id) return d.controlVariants[i];
    }
    return d.controlVariants[0];
  }

  function fillDiscSelect() {
    $("discSelect").innerHTML = HC.CATALOG.discs.map(function (d) {
      return '<option value="' + d.id + '">' + d.name + "</option>";
    }).join("");
  }

  function fillControlSelect() {
    var d = currentDisc();
    $("controlSelect").innerHTML = d.controlVariants.map(function (v) {
      return '<option value="' + v.id + '">' + v.name + "</option>";
    }).join("");
    $("discInfo").textContent = "Диаметр диска: " + d.diameter + " мм";
  }

  function applyDefaultClearances() {
    var d = currentDisc().defaults;
    $("clPP").value = d.partPart;
    $("clPE").value = d.partEdge;
    $("clPC").value = d.partControl;
  }

  // ---------- контрольные отверстия ----------

  function rebuildControlHoles() {
    ctrlHoles = currentControl().holes.map(function (h) {
      return {
        x: h.x, y: h.y, d: h.d, on: true,
        name: h.name || ("X " + h.x + ", Y " + h.y)
      };
    });
    renderControlHoles();
  }

  function renderControlHoles() {
    var host = $("controlList");
    host.innerHTML = "";
    ctrlHoles.forEach(function (h) {
      var div = document.createElement("div");
      div.className = "ctrl-row";
      div.innerHTML =
        '<label><input type="checkbox" class="c-on"' + (h.on ? " checked" : "") + ">" + h.name + "</label>" +
        '<span class="hint">Ø, мм</span>' +
        '<input type="number" class="c-d" min="0.1" step="0.1" value="' + h.d + '"' + (h.on ? "" : " disabled") + ">";
      div.querySelector(".c-on").addEventListener("change", function (e) {
        h.on = e.target.checked;
        div.querySelector(".c-d").disabled = !h.on;
        markDirty();
      });
      div.querySelector(".c-d").addEventListener("input", function (e) {
        h.d = parseFloat(e.target.value);
        markDirty();
      });
      host.appendChild(div);
    });
  }

  function activeControlHoles() {
    return ctrlHoles.filter(function (h) { return h.on; }).map(function (h) {
      return { x: h.x, y: h.y, d: h.d };
    });
  }

  function controlSummary() {
    var act = ctrlHoles.filter(function (h) { return h.on; });
    if (!act.length) return "нет";
    return act.map(function (h) { return h.name + " Ø" + h.d; }).join("; ");
  }

  // ---------- детали ----------

  // Ø посадки по умолчанию: зазор растёт со размером детали (технологический запас)
  function autoSeatD(d) {
    if (!(d > 0)) return null;
    var add = d <= 50 ? 0.2 : (d <= 100 ? 0.3 : 0.4);
    return Math.round((d + add) * 100) / 100;
  }

  // Максимально возможная технологически зона напыления — деталь минус 1.5 мм на кольцо посадки
  function autoCA(d) {
    if (!(d > 0)) return null;
    var ca = d - 1.5;
    return ca > 0 ? Math.round(ca * 100) / 100 : null;
  }

  function defaultPart() {
    var d = 10;
    return {
      type: "circle", d: d, w: 20, h: 10, chamfer: 2,
      // посадка (D) и зона напыления (CA) — только для круглых; авто, пока пользователь не поправит вручную
      seatD: autoSeatD(d), seatDAuto: true,
      apertureCA: autoCA(d), apertureCAAuto: true,
      slotOn: false, slotAngle: 0, // паз под пинцет — только для круглых, требует заданного D
      qtyMode: "max", qty: 10,
      orientation: "grid",           // fixed | grid | radial-w | radial-h
      anchor: "center", anchorD: 150 // расположение при неполном заполнении
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
    var caMax = autoCA(p.d);
    var dims = p.type === "circle"
      ? '<label>Диаметр детали d, мм<input type="number" class="p-d" min="0.1" step="0.1" value="' + p.d + '"></label>' +
        '<label>Ø посадки D, мм <span class="hint">(авто, можно поправить, не меньше d)</span><input type="number" class="p-seat-d" min="' + p.d + '" step="0.1" value="' + (p.seatD == null ? "" : p.seatD) + '"></label>' +
        '<label>Зона напыления CA, мм <span class="hint">(авто-максимум, можно только уменьшить)</span><input type="number" class="p-ca" min="0.1" step="0.1" max="' + (caMax == null ? "" : caMax) + '" value="' + (p.apertureCA == null ? "" : p.apertureCA) + '"></label>'
      : '<label>Ширина, мм<input type="number" class="p-w" min="0.1" step="0.1" value="' + p.w + '"></label>' +
        '<label>Высота, мм<input type="number" class="p-h" min="0.1" step="0.1" value="' + p.h + '"></label>' +
        (p.type === "oct" ? '<label>Фаска, мм<input type="number" class="p-ch" min="0" step="0.1" value="' + p.chamfer + '"></label>' : "");

    div.innerHTML =
      '<div class="row-head"><strong>Деталь ' + (i + 1) + "</strong>" +
      (parts.length > 1 ? '<button type="button" class="p-del" title="Удалить деталь">✕</button>' : "") +
      "</div>" +
      '<label>Форма<select class="p-type">' +
      '<option value="circle"' + (p.type === "circle" ? " selected" : "") + ">Круглая</option>" +
      '<option value="rect"' + (p.type === "rect" ? " selected" : "") + ">Прямоугольная</option>" +
      '<option value="oct"' + (p.type === "oct" ? " selected" : "") + ">Прямоугольная с фаской</option>" +
      "</select></label>" +
      '<div class="dims">' + dims + "</div>" +
      (p.type === "circle"
        ? '<div class="slot-line">' +
          '<label><input type="checkbox" class="p-slot-on"' + (p.slotOn ? " checked" : "") + '> паз под пинцет <span class="hint">(нужен Ø посадки D)</span></label>' +
          '<label>Угол, °<input type="number" class="p-slot-angle" min="0" max="359" step="1" value="' + p.slotAngle + '"' + (p.slotOn ? "" : " disabled") + "></label>" +
          "</div>"
        : "") +
      '<div class="part-preview' + (p.type === "circle" ? " hole-diagram" : "") + '">' +
      (p.type === "circle" ? HC.renderHoleDiagram(p) : HC.renderPartPreview(p)) + "</div>" +
      (p.type !== "circle"
        ? '<label>Ориентация<select class="p-orient">' +
          '<option value="fixed"' + (p.orientation === "fixed" ? " selected" : "") + ">фиксированная (без поворота)</option>" +
          '<option value="grid"' + (p.orientation === "grid" ? " selected" : "") + ">свободная (0° / 90°)</option>" +
          '<option value="radial-w"' + (p.orientation === "radial-w" ? " selected" : "") + ">радиальная — ширина вдоль радиуса</option>" +
          '<option value="radial-h"' + (p.orientation === "radial-h" ? " selected" : "") + ">радиальная — высота вдоль радиуса</option>" +
          "</select></label>"
        : "") +
      '<div class="qty-line">' +
      '<label><input type="radio" name="qty' + i + '" value="max"' + (p.qtyMode === "max" ? " checked" : "") + ">максимум</label>" +
      '<label><input type="radio" name="qty' + i + '" value="qty"' + (p.qtyMode === "qty" ? " checked" : "") + ">количество:</label>" +
      '<input type="number" class="p-qty" min="1" step="1" value="' + p.qty + '"' + (p.qtyMode === "max" ? " disabled" : "") + ">" +
      "</div>" +
      (p.qtyMode === "qty"
        ? '<div class="place-line">' +
          '<label>Расположение<select class="p-anchor">' +
          '<option value="center"' + (p.anchor === "center" ? " selected" : "") + ">от центра</option>" +
          '<option value="edge"' + (p.anchor === "edge" ? " selected" : "") + ">от края</option>" +
          '<option value="diameter"' + (p.anchor === "diameter" ? " selected" : "") + ">по диаметру</option>" +
          "</select></label>" +
          (p.anchor === "diameter"
            ? '<label>Ø расположения, мм<input type="number" class="p-anchor-d" min="1" step="1" value="' + p.anchorD + '"></label>'
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
      if (p.type !== "circle") return;
      var maxCA = autoCA(p.d);
      var caEl = div.querySelector(".p-ca");
      if (caEl) {
        if (maxCA != null) caEl.setAttribute("max", maxCA); else caEl.removeAttribute("max");
      }
      var seatEl = div.querySelector(".p-seat-d");
      if (seatEl) seatEl.setAttribute("min", p.d);
      if (p.seatDAuto) {
        p.seatD = autoSeatD(p.d);
        if (seatEl) seatEl.value = p.seatD == null ? "" : p.seatD;
      }
      if (p.apertureCAAuto) {
        p.apertureCA = maxCA;
        if (caEl) caEl.value = p.apertureCA == null ? "" : p.apertureCA;
      }
    }
    on(".p-type", "change", function (e) { p.type = e.target.value; renderParts(); markDirty(); });
    on(".p-d", "input", function (e) { p.d = parseFloat(e.target.value); syncAutoFields(); refreshPreview(); markDirty(); });
    on(".p-seat-d", "input", function (e) { p.seatD = e.target.value === "" ? null : parseFloat(e.target.value); p.seatDAuto = false; refreshPreview(); markDirty(); });
    on(".p-ca", "input", function (e) { p.apertureCA = e.target.value === "" ? null : parseFloat(e.target.value); p.apertureCAAuto = false; refreshPreview(); markDirty(); });
    on(".p-slot-on", "change", function (e) {
      p.slotOn = e.target.checked;
      var angleEl = div.querySelector(".p-slot-angle");
      if (angleEl) angleEl.disabled = !p.slotOn;
      refreshPreview(); markDirty();
    });
    on(".p-slot-angle", "input", function (e) { p.slotAngle = parseFloat(e.target.value); refreshPreview(); markDirty(); });
    on(".p-w", "input", function (e) { p.w = parseFloat(e.target.value); refreshPreview(); markDirty(); });
    on(".p-h", "input", function (e) { p.h = parseFloat(e.target.value); refreshPreview(); markDirty(); });
    on(".p-ch", "input", function (e) { p.chamfer = parseFloat(e.target.value); refreshPreview(); markDirty(); });
    on(".p-qty", "input", function (e) { p.qty = parseInt(e.target.value, 10); markDirty(); });
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

  function markDirty() {
    if (lastResult) {
      lastResult = null;
      $("svgHost").innerHTML = "";
      $("summary").textContent = "Параметры изменены — нажмите «Разложить»";
    }
    setActions(false);
    setStatus("");
    setSendMsg("");
  }

  // ---------- раскладка ----------

  function typeShort(spec) {
    if (spec.type === "circle") return "круглая Ø" + spec.d;
    if (spec.type === "rect") return "прямоугольная " + spec.w + "×" + spec.h;
    return "с фаской " + spec.w + "×" + spec.h + "×" + spec.chamfer;
  }

  function validate() {
    var errs = [];
    var disc = currentDisc();
    if (!parts.length) errs.push("Добавьте хотя бы одну деталь.");
    parts.forEach(function (p, i) {
      var n = "Деталь " + (i + 1) + ": ";
      if (p.type === "circle") {
        if (!(p.d > 0)) {
          errs.push(n + "укажите диаметр.");
        } else if (p.d >= disc.diameter) {
          errs.push(n + "деталь больше диска.");
        } else {
          if (p.seatD != null && p.seatD < p.d - 1e-6) {
            errs.push(n + "Ø посадки D не может быть меньше диаметра детали d (" + p.d + ").");
          }
          if (p.apertureCA != null) {
            var maxCA = autoCA(p.d);
            if (maxCA == null || p.apertureCA > maxCA + 1e-6) {
              errs.push(n + "зона напыления CA не может быть больше d−1.5 мм" + (maxCA != null ? " (максимум " + maxCA + ")" : "") + ".");
            }
          }
        }
      } else {
        if (!(p.w > 0) || !(p.h > 0)) errs.push(n + "укажите ширину и высоту.");
        else if (p.type === "oct") {
          if (!(p.chamfer >= 0)) errs.push(n + "укажите фаску (0 — без фаски).");
          else if (p.chamfer >= Math.min(p.w, p.h) / 2) errs.push(n + "фаска должна быть меньше половины меньшей стороны.");
        }
      }
      if (p.qtyMode === "qty" && !(p.qty >= 1)) errs.push(n + "укажите количество (целое ≥ 1).");
      if (p.qtyMode === "qty" && p.anchor === "diameter" && !(p.anchorD > 0)) {
        errs.push(n + "укажите диаметр расположения.");
      }
    });
    ctrlHoles.forEach(function (h) {
      if (h.on && !(h.d > 0)) errs.push("Контрольное отверстие «" + h.name + "»: укажите диаметр.");
    });
    ["clPP", "clPE", "clPC"].forEach(function (id) {
      var v = parseFloat($(id).value);
      if (!(v >= 0)) errs.push("Все зазоры должны быть числами ≥ 0.");
    });
    return errs;
  }

  function doPack() {
    var errs = validate();
    if (errs.length) { setStatus(errs.join("\n"), "error"); return; }

    var disc = currentDisc();
    var opts = {
      discDiameter: disc.diameter,
      controlHoles: activeControlHoles(),
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
          // только для отображения на раскладке — угол паза считается на месте, не общий
          seatD: p.type === "circle" ? p.seatD : null,
          apertureCA: p.type === "circle" ? p.apertureCA : null,
          slotOn: p.type === "circle" ? p.slotOn : false
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
      var label = "Деталь " + (i + 1) + " (" + typeShort(opts.parts[i]) + "): ";
      if (r.requested == null) lines.push(label + "максимум — размещено " + r.placed);
      else if (r.placed >= r.requested) lines.push(label + "размещено " + r.placed + " из " + r.requested);
      else { lines.push(label + "влезло только " + r.placed + " из " + r.requested + " ⚠"); warn = true; }
    });
    lines.push("Всего отверстий под детали: " + res.placed.length);
    $("summary").textContent = lines.join("\n");

    refreshSVG();
    setActions(res.placed.length > 0);
    if (!res.placed.length) {
      setStatus("Ни одна деталь не поместилась: проверьте размеры и зазоры.", "error");
    } else {
      setStatus(warn ? "Поместились не все детали — уменьшите количество, зазоры или размеры." : "Готово.", warn ? "error" : "ok");
    }
  }

  function refreshSVG() {
    if (!lastResult) return;
    $("svgHost").innerHTML = HC.renderSVG({
      discDiameter: lastResult.disc.diameter,
      edgeClearance: lastResult.opts.clearances.pe,
      controlHoles: lastResult.opts.controlHoles,
      placed: lastResult.placed,
      showNumbers: $("showNumbers").checked
    });
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
      disc: { id: lr.disc.id, name: lr.disc.name, diameter: lr.disc.diameter },
      controlName: lr.controlName,
      controlHoles: lr.opts.controlHoles,
      clearances: lr.opts.clearances,
      placed: lr.placed,
      partsSummary: lr.perPart.map(function (r, i) {
        var s = lr.opts.parts[i];
        var orientNote = {
          "radial-w": " — радиально, ширина вдоль радиуса",
          "radial-h": " — радиально, высота вдоль радиуса"
        }[s.orientation] || "";
        return {
          type: s.type,
          size: (s.type === "circle" ? "Ø" + s.d : s.w + " × " + s.h + (s.type === "oct" ? ", фаска " + s.chamfer : "")) + orientNote,
          requested: r.requested,
          placed: r.placed
        };
      })
    };
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

  fillDiscSelect();
  fillControlSelect();
  rebuildControlHoles();
  applyDefaultClearances();
  parts = [defaultPart()];
  renderParts();
  loadCustomer();

  $("discSelect").addEventListener("change", function () {
    fillControlSelect();
    rebuildControlHoles();
    applyDefaultClearances();
    markDirty();
  });
  $("controlSelect").addEventListener("change", function () {
    rebuildControlHoles();
    markDirty();
  });
  ["clPP", "clPE", "clPC"].forEach(function (id) { $(id).addEventListener("input", markDirty); });
  $("clReset").addEventListener("click", function () { applyDefaultClearances(); markDirty(); });
  $("addPart").addEventListener("click", function () { parts.push(defaultPart()); renderParts(); markDirty(); });
  $("packBtn").addEventListener("click", doPack);
  $("showNumbers").addEventListener("change", refreshSVG);
  ["custName", "custOrg", "custContact"].forEach(function (id) { $(id).addEventListener("change", saveCustomer); });

  $("csvBtn").addEventListener("click", function () {
    if (lastResult) HC.downloadCSV(assembleOrder());
  });

  $("reportBtn").addEventListener("click", function () {
    if (!lastResult) return;
    var order = assembleOrder();
    var svg = HC.renderSVG({
      discDiameter: lastResult.disc.diameter,
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
      setSendMsg("Укажите ФИО технолога — им подписывается заказ.", "error");
      $("custName").focus();
      return;
    }
    saveCustomer();
    var typeLabel = { circle: "круг", rect: "прямоуг.", oct: "с фаской" };
    var payload = {
      id: order.id,
      date: order.date,
      name: order.customer.name,
      org: order.customer.org,
      contact: order.customer.contact,
      disc: order.disc.name + " (Ø" + order.disc.diameter + ")",
      control: order.controlName,
      parts: order.partsSummary.map(function (r, i) {
        return (i + 1) + ") " + typeLabel[r.type] + " " + r.size + " — " + r.placed +
          (r.requested == null ? " (макс.)" : " из " + r.requested);
      }).join("; "),
      placed: order.placed.length,
      clearances: order.clearances.pp + " / " + order.clearances.pe + " / " + order.clearances.pc,
      csv: HC.buildCSV(order)
    };
    $("sendBtn").disabled = true;
    setSendMsg("Отправляю…");
    HC.submitOrder(payload).then(function () {
      setSendMsg("Заказ " + order.id + " отправлен и записан в таблицу.", "ok");
      $("sendBtn").disabled = false;
    }).catch(function (err) {
      setSendMsg("Не удалось отправить: " + err.message, "error");
      $("sendBtn").disabled = false;
    });
  });
})(typeof globalThis !== "undefined" ? globalThis : window);
