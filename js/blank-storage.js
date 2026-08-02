/*
 * blank-storage.js — локальная папка «Заготовки» (File System Access API):
 * подключение, JSON-манифест (индекс) болванок, чтение/запись STEP-файлов.
 *
 * Работает только в Chromium (Chrome/Edge) — showDirectoryPicker есть только
 * там. HC.blankStorage.isSupported() — фича-детект; вызывающий код сам решает,
 * что показать при отсутствии поддержки (см. app.js) — без запасного пути.
 *
 * Хендл папки (FileSystemDirectoryHandle) — НЕ JSON, в localStorage не
 * положить; хранится в IndexedDB (структурно клонируемый объект), переживает
 * перезагрузку страницы. Разрешение браузер может не дать бесшумно при
 * следующем заходе (требует явного жеста пользователя) — reconnect() тихо
 * пробует queryPermission, при отказе возвращает null (вызывающий код
 * показывает кнопку «Подключить» заново, клик — уже жест, connect() пройдёт).
 *
 * Вся эта поверхность — тонкая обёртка над браузерными API (indexedDB,
 * FileSystemDirectoryHandle), в Node/jsdom не существующими, поэтому
 * автотестами не покрывается (тот же класс ограничения, что у WebGL в
 * viewer3d.js) — проверяется вручную в браузере.
 */
(function (g) {
  "use strict";
  var HC = (g.HC = g.HC || {});

  var DB_NAME = "hc-blank-storage";
  var DB_VERSION = 1;
  var STORE = "handles";
  var HANDLE_KEY = "blanksDir";
  var INDEX_FILE = "blanks-index.json";

  function openDB() {
    return new Promise(function (resolve, reject) {
      var req = g.indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = function () { req.result.createObjectStore(STORE); };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
  }

  function idbGet(key) {
    return openDB().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(STORE, "readonly");
        var req = tx.objectStore(STORE).get(key);
        req.onsuccess = function () { resolve(req.result || null); };
        req.onerror = function () { reject(req.error); };
      });
    });
  }

  function idbSet(key, value) {
    return openDB().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(STORE, "readwrite");
        tx.objectStore(STORE).put(value, key);
        tx.oncomplete = function () { resolve(); };
        tx.onerror = function () { reject(tx.error); };
      });
    });
  }

  var dirHandle = null; // подключённая папка — в памяти на сессию

  function isSupported() {
    return typeof g.showDirectoryPicker === "function";
  }

  function isConnected() { return !!dirHandle; }

  // Запрашивает у пользователя папку (системный диалог — нужен жест
  // пользователя, поэтому зовётся только из обработчика клика), запоминает
  // хендл в IndexedDB для последующих заходов.
  function connect() {
    if (!isSupported()) {
      return Promise.reject(new Error("Работа с локальной папкой недоступна в этом браузере — нужен Chrome или Edge."));
    }
    return g.showDirectoryPicker({ id: "hc-blanks", mode: "readwrite" }).then(function (handle) {
      dirHandle = handle;
      return idbSet(HANDLE_KEY, handle).then(function () { return handle; });
    });
  }

  // Тихая попытка переиспользовать ранее подключённую папку при загрузке
  // страницы. Возвращает handle (разрешение уже было дано) или null —
  // тогда нужен повторный клик «Подключить» (connect()), браузер требует
  // жест пользователя для повторного запроса разрешения.
  function reconnect() {
    if (!isSupported()) return Promise.resolve(null);
    return idbGet(HANDLE_KEY).then(function (handle) {
      if (!handle) return null;
      return handle.queryPermission({ mode: "readwrite" }).then(function (state) {
        if (state === "granted") { dirHandle = handle; return handle; }
        return null;
      });
    }).catch(function () { return null; });
  }

  function requireDir() {
    if (!dirHandle) return Promise.reject(new Error("Папка с заготовками не подключена."));
    return Promise.resolve(dirHandle);
  }

  // Индекс — [{id, name, installation, description, diameter, thickness,
  // blankDiameter, coatingZoneDiameter, fileName, previewSVG, keepouts, ...}]
  // — та же форма записи диска, что и в HC.CATALOG.discs (см. app.js).
  function readIndex() {
    return requireDir().then(function (dir) {
      return dir.getFileHandle(INDEX_FILE, { create: false })
        .then(function (fh) { return fh.getFile(); })
        .then(function (file) { return file.text(); })
        .then(function (text) {
          try {
            var arr = JSON.parse(text);
            return Array.isArray(arr) ? arr : [];
          } catch (e) { return []; }
        })
        .catch(function () { return []; }); // файла ещё нет — пустой индекс
    });
  }

  function writeIndex(arr) {
    return requireDir().then(function (dir) {
      return dir.getFileHandle(INDEX_FILE, { create: true });
    }).then(function (fh) {
      return fh.createWritable();
    }).then(function (writable) {
      return writable.write(JSON.stringify(arr, null, 2)).then(function () { return writable.close(); });
    });
  }

  function readStepFile(name) {
    return requireDir().then(function (dir) {
      return dir.getFileHandle(name, { create: false });
    }).then(function (fh) { return fh.getFile(); })
      .then(function (file) { return file.arrayBuffer(); });
  }

  function writeStepFile(name, arrayBuffer) {
    return requireDir().then(function (dir) {
      return dir.getFileHandle(name, { create: true });
    }).then(function (fh) { return fh.createWritable(); })
      .then(function (writable) {
        return writable.write(arrayBuffer).then(function () { return writable.close(); });
      });
  }

  function deleteFile(name) {
    return requireDir().then(function (dir) {
      return dir.removeEntry(name).catch(function () { /* уже нет — не критично */ });
    });
  }

  HC.blankStorage = {
    isSupported: isSupported,
    isConnected: isConnected,
    connect: connect,
    reconnect: reconnect,
    readIndex: readIndex,
    writeIndex: writeIndex,
    readStepFile: readStepFile,
    writeStepFile: writeStepFile,
    deleteFile: deleteFile
  };
})(typeof globalThis !== "undefined" ? globalThis : window);
