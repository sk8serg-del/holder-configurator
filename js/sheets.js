/*
 * sheets.js — адаптер отправки заказа.
 *
 * Сейчас заказ уходит в Google Apps Script (запись в Google Таблицу, см. README).
 * При переносе в Odoo меняется ТОЛЬКО этот файл: submitOrder() должна отправить
 * payload в контроллер Odoo (можно параллельно и туда, и в таблицу).
 */
(function (g) {
  "use strict";
  var HC = (g.HC = g.HC || {});

  // ← После настройки Apps Script (README, шаг «Google Таблица») вставьте сюда
  //   URL веб-приложения вида https://script.google.com/macros/s/…/exec
  HC.APPS_SCRIPT_URL = "";

  /*
   * payload = { id, date, name, org, contact, disc, control, parts,
   *             placed, clearances, csv }
   * Возвращает Promise; отклоняется с понятным сообщением об ошибке.
   */
  HC.submitOrder = function (payload) {
    if (!HC.APPS_SCRIPT_URL) {
      return Promise.reject(new Error(
        "Отправка не настроена: не задан APPS_SCRIPT_URL в js/sheets.js (см. README)."
      ));
    }
    return fetch(HC.APPS_SCRIPT_URL, {
      method: "POST",
      // text/plain — простой запрос без CORS-preflight (стандартный приём для Apps Script)
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(payload)
    }).then(function (res) {
      if (!res.ok) throw new Error("Сервер ответил " + res.status);
      return res.json().catch(function () { return { ok: true }; });
    }).then(function (data) {
      if (data && data.ok === false) throw new Error(data.error || "ошибка на стороне таблицы");
      return data;
    });
  };
})(typeof globalThis !== "undefined" ? globalThis : window);
