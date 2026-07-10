/**
 * Code.gs — приём заказов конфигуратора в Google Таблицу.
 *
 * Установка (один раз, ~5 минут):
 * 1. Откройте свою учётную Google Таблицу.
 * 2. Расширения → Apps Script, вставьте этот код вместо содержимого Code.gs.
 * 3. Нажмите «Развернуть» → «Новое развёртывание» → тип «Веб-приложение»:
 *      - «Выполнять от имени» — от вашего имени;
 *      - «У кого есть доступ»  — «Все» (иначе браузер заказчика не сможет отправить).
 * 4. Скопируйте URL вида https://script.google.com/macros/s/…/exec
 *    и вставьте его в js/sheets.js → HC.APPS_SCRIPT_URL.
 *
 * Лист «Заказы» создастся автоматически при первом заказе.
 */

var SHEET_NAME = 'Заказы';

function doPost(e) {
  try {
    var d = JSON.parse(e.postData.contents);
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sh = ss.getSheetByName(SHEET_NAME);
    if (!sh) {
      sh = ss.insertSheet(SHEET_NAME);
      sh.appendRow([
        'Получен', 'Номер заказа', 'Технолог', 'Организация', 'Контакт',
        'Подложка', 'Контр. отверстия', 'Детали', 'Отверстий всего',
        'Зазоры (д-д / д-край / д-КО)', 'CSV для Inventor'
      ]);
      sh.setFrozenRows(1);
    }
    sh.appendRow([
      new Date(),
      d.id || '', d.name || '', d.org || '', d.contact || '',
      d.disc || '', d.control || '', d.parts || '', d.placed || '',
      d.clearances || '', d.csv || ''
    ]);
    return ContentService
      .createTextOutput(JSON.stringify({ ok: true }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService
      .createTextOutput(JSON.stringify({ ok: false, error: String(err) }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}
