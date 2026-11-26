/**
 * Dots Inventory — browser-only first-install bootstrap.
 *
 * One-time use in a NEW, spreadsheet-bound Apps Script project.
 * Fetches a fixed Git commit directly from GitHub, verifies every Git blob,
 * backs up the current Apps Script source to Drive, asks for confirmation,
 * then replaces project content through Apps Script API.
 *
 * This file intentionally remains in the installed project as an unmanaged
 * bootstrap/recovery entry point. It does not run setup or touch spreadsheet data.
 */
var DI3_GITHUB_BOOTSTRAP_CONFIG = Object.freeze({
  REPOSITORY: "brusvv/dots_inventory-",
  COMMIT: "39ae1b1af9753a31ab3c92175d5fe6d33ef92f16",
  EXPECTED_FILE_COUNT: 47,
  BACKUP_PREFIX: "DotsInventory_AppsScript_Source_",
  MAX_BACKUP_BYTES: 10000000,
  TIME_ZONE: "Europe/Moscow",
  REQUIRED_SCOPES: [
    "https://www.googleapis.com/auth/script.projects",
    "https://www.googleapis.com/auth/script.projects.readonly",
    "https://www.googleapis.com/auth/script.external_request",
    "https://www.googleapis.com/auth/drive",
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/script.container.ui",
    "https://www.googleapis.com/auth/script.scriptapp"
  ]
});

/**
 * Run this function once from the editor in a new test spreadsheet's project.
 * It is intentionally not installed as an onOpen menu command.
 */
function di3GitHubBootstrapInstall() {
  var ui = SpreadsheetApp.getUi();
  var spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  if (!spreadsheet) {
    throw new Error("Bootstrap остановлен: проект не привязан к активной Google-таблице. Создай новую тестовую таблицу и открой Apps Script через Расширения → Apps Script.");
  }

  var project = di3BootstrapGetProjectContent_();
  di3BootstrapAssertBlankProject_(project.content.files);
  var manifest = di3BootstrapReadAndValidateManifest_(project.content.files);
  var sources = di3BootstrapDownloadPinnedSources_();
  var targetFiles = di3BootstrapBuildTargetFiles_(project.content.files, sources);
  var sourceFingerprint = di3BootstrapFingerprint_(project.content.files);

  var backup = di3BootstrapCreateVerifiedBackup_(project.script_id, project.content.files);
  var changedFiles = sources.map(function (file) { return file.name; });

  var message = [
    "Первоначальная установка Dots Inventory v4",
    "",
    "Таблица: " + spreadsheet.getName(),
    "Spreadsheet ID: " + spreadsheet.getId(),
    "Apps Script ID: " + project.script_id,
    "Git commit: " + DI3_GITHUB_BOOTSTRAP_CONFIG.COMMIT,
    "Часовой пояс: " + DI3_GITHUB_BOOTSTRAP_CONFIG.TIME_ZONE,
    "Модулей из GitHub: " + sources.length,
    "Файлов в полном наборе: " + targetFiles.length,
    "",
    "Проверенная резервная копия исходного проекта создана:",
    backup.name,
    backup.url,
    "",
    "Будет сохранён текущий appsscript.json и сам Bootstrap-файл.",
    "Будут добавлены 47 проверенных .gs модулей из закреплённого commit.",
    "Незапрошенные файлы и непустые исходники в проекте не допускаются.",
    "",
    "Установка заменит полное содержимое Apps Script проекта.",
    "Таблица, листы, данные, триггеры и развёртывания не изменяются.",
    "Setup, Clean Start, миграции, FIFO и складские операции НЕ запускаются.",
    "",
    "Файлы:",
    changedFiles.slice(0, 18).join("\n") + (changedFiles.length > 18 ? "\n… ещё " + (changedFiles.length - 18) : ""),
    "",
    "Продолжить?"
  ].join("\n");

  var answer = ui.alert("Dots Inventory · первоначальная установка", message, ui.ButtonSet.YES_NO);
  if (answer !== ui.Button.YES) {
    return {
      status: "CANCELLED",
      write_performed: false,
      script_id: project.script_id,
      backup: backup,
      source_commit: DI3_GITHUB_BOOTSTRAP_CONFIG.COMMIT
    };
  }

  var immediatelyBeforeWrite = di3BootstrapGetProjectContent_();
  if (immediatelyBeforeWrite.script_id !== project.script_id ||
      di3BootstrapFingerprint_(immediatelyBeforeWrite.content.files) !== sourceFingerprint) {
    throw new Error("Установка отменена: содержимое Apps Script проекта изменилось после создания backup. Повтори проверку; запись не выполнялась.");
  }

  var update = di3BootstrapUpdateProject_(project.script_id, targetFiles);
  var after = di3BootstrapGetProjectContent_();
  var expectedFingerprint = di3BootstrapFingerprint_(targetFiles);
  var actualFingerprint = di3BootstrapFingerprint_(after.content.files);
  if (after.script_id !== project.script_id || actualFingerprint !== expectedFingerprint) {
    throw new Error(
      "POST_WRITE_VERIFICATION_FAILED: Apps Script API принял запрос, но повторная проверка полного содержимого не совпала. " +
      "Не запускай установку повторно. Исходная резервная копия: " + backup.url
    );
  }

  var result = {
    status: "INSTALLED_AND_VERIFIED",
    write_performed: true,
    script_id: project.script_id,
    spreadsheet_id: spreadsheet.getId(),
    source_commit: DI3_GITHUB_BOOTSTRAP_CONFIG.COMMIT,
    installed_modules: sources.length,
    target_file_count: targetFiles.length,
    backup: backup,
    api_update_time: update.updateTime || ""
  };
  ui.alert(
    "Dots Inventory · установка проверена",
    "Статус: INSTALLED_AND_VERIFIED\n" +
    "Модулей: " + result.installed_modules + "\n" +
    "Script ID: " + result.script_id + "\n" +
    "Commit: " + result.source_commit + "\n\n" +
    "Код записан и повторно прочитан. Данные таблицы не изменялись.\n" +
    "Backup: " + backup.url + "\n\n" +
    "Перезагрузи таблицу. Не запускай Clean Start или миграции до отдельного согласования runtime-приёмки.",
    ui.ButtonSet.OK
  );
  return result;
}

function di3BootstrapReadAndValidateManifest_(files) {
  var matches = files.filter(function (file) {
    return file && file.type === "JSON" && file.name === "appsscript";
  });
  if (matches.length !== 1) {
    throw new Error("Нужен ровно один appsscript.json. Включи отображение файла манифеста в настройках Apps Script и проверь проект.");
  }
  var manifest;
  try { manifest = JSON.parse(String(matches[0].source || "")); }
  catch (error) { throw new Error("appsscript.json содержит некорректный JSON: " + (error.message || String(error))); }
  if (manifest.timeZone !== DI3_GITHUB_BOOTSTRAP_CONFIG.TIME_ZONE) {
    throw new Error("Часовой пояс appsscript.json должен быть " + DI3_GITHUB_BOOTSTRAP_CONFIG.TIME_ZONE +
      ", сейчас: " + String(manifest.timeZone || "(не задан)") + ". Исправь манифест до установки.");
  }
  var scopes = Array.isArray(manifest.oauthScopes) ? manifest.oauthScopes : [];
  var missing = DI3_GITHUB_BOOTSTRAP_CONFIG.REQUIRED_SCOPES.filter(function (scope) {
    return scopes.indexOf(scope) === -1;
  });
  if (missing.length) {
    throw new Error("В appsscript.json отсутствуют OAuth scopes:\n• " + missing.join("\n• ") +
      "\nДобавь их в oauthScopes, сохрани манифест и запусти Bootstrap повторно.");
  }
  return manifest;
}

function di3BootstrapAssertBlankProject_(files) {
  if (!Array.isArray(files) || !files.length) throw new Error("Apps Script API не вернул файлы проекта.");
  var manifests = 0;
  var bootstrapFiles = 0;
  var unexpected = [];
  files.forEach(function (file) {
    if (!file || !file.name || !file.type || typeof file.source !== "string") {
      unexpected.push("(неполный объект файла)");
      return;
    }
    if (file.type === "JSON" && file.name === "appsscript") {
      manifests++;
      return;
    }
    if (file.type === "SERVER_JS" && file.name === "DI3_GitHubBootstrap") {
      bootstrapFiles++;
      return;
    }
    // A new Apps Script project may contain the default empty Code.gs file.
    if (file.type === "SERVER_JS" && file.name === "Code" && !String(file.source).trim()) return;
    unexpected.push(file.type + ":" + file.name);
  });
  if (manifests !== 1 || bootstrapFiles !== 1 || unexpected.length) {
    throw new Error(
      "Bootstrap разрешён только в новом пустом Apps Script-проекте. " +
      "Ожидаются appsscript.json и этот DI3_GitHubBootstrap.gs; допускается пустой Code.gs. " +
      "Найдено: manifest=" + manifests + ", bootstrap=" + bootstrapFiles +
      ", лишние файлы=" + (unexpected.length ? unexpected.join(", ") : "нет") + ". " +
      "Другие файлы не будут удалены автоматически."
    );
  }
}

function di3BootstrapDownloadPinnedSources_() {
  var config = DI3_GITHUB_BOOTSTRAP_CONFIG;
  var apiBase = "https://api.github.com/repos/" + config.REPOSITORY;
  var commitUrl = apiBase + "/git/commits/" + config.COMMIT;
  var commitResponse = di3BootstrapFetchText_(commitUrl, "application/vnd.github+json");
  var commit;
  try { commit = JSON.parse(commitResponse); }
  catch (error) { throw new Error("GitHub вернул некорректный commit object: " + (error.message || String(error))); }
  if (commit.sha !== config.COMMIT || !commit.tree || !/^[0-9a-f]{40}$/i.test(String(commit.tree.sha || ""))) {
    throw new Error("GitHub commit object не совпал с закреплённым commit SHA/tree SHA; установка остановлена.");
  }

  // Resolve the tree SHA from the immutable commit object instead of treating
  // the commit SHA itself as a tree identifier.
  var treeUrl = apiBase + "/git/trees/" + commit.tree.sha + "?recursive=1";
  var treeResponse = di3BootstrapFetchText_(treeUrl, "application/vnd.github+json");
  var tree;
  try { tree = JSON.parse(treeResponse); }
  catch (error) { throw new Error("GitHub вернул некорректное дерево репозитория: " + (error.message || String(error))); }
  if (tree.sha !== commit.tree.sha || tree.truncated === true || !Array.isArray(tree.tree)) {
    throw new Error("GitHub tree не прошёл проверку SHA/truncated; установка остановлена.");
  }

  var entries = tree.tree.filter(function (item) {
    return item && item.type === "blob" &&
      /^src\/apps_script\/[A-Za-z0-9_.-]+\.gs$/.test(String(item.path || ""));
  }).sort(function (a, b) { return a.path.localeCompare(b.path); });

  if (entries.length !== config.EXPECTED_FILE_COUNT) {
    throw new Error("Число Apps Script модулей не совпало с ожидаемым: " + entries.length +
      ", ожидалось " + config.EXPECTED_FILE_COUNT + ". Возможно, изменился commit или дерево.");
  }

  var seen = {};
  return entries.map(function (entry) {
    var fileName = entry.path.substring("src/apps_script/".length);
    var key = fileName.toLowerCase();
    if (seen[key]) throw new Error("В GitHub найдены дублирующиеся имена файлов: " + fileName);
    seen[key] = true;
    var rawUrl = "https://raw.githubusercontent.com/" + config.REPOSITORY + "/" + config.COMMIT + "/" + entry.path;
    var source = di3BootstrapFetchText_(rawUrl, "text/plain");
    var byteLength = Utilities.newBlob(source).getBytes().length;
    if (byteLength !== Number(entry.size)) {
      throw new Error("Размер файла не совпал с Git tree: " + fileName + " (" + byteLength + " вместо " + entry.size + ").");
    }
    var gitBlobSha = di3BootstrapGitBlobSha1_(source);
    if (gitBlobSha.toLowerCase() !== String(entry.sha).toLowerCase()) {
      throw new Error("Git blob SHA-1 не совпал: " + fileName + ". Исходник не будет установлен.");
    }
    return { name: fileName.replace(/\.gs$/i, ""), type: "SERVER_JS", source: source };
  });
}

function di3BootstrapFetchText_(url, accept) {
  var initial = String(url || "");
  var allowed = /^https:\/\/(api\.github\.com|raw\.githubusercontent\.com)\//i.exec(initial);
  if (!allowed) throw new Error("Bootstrap заблокировал неожиданный URL: " + initial);

  // Keep redirects manual: only the original, explicitly approved GitHub host
  // may receive the follow-up request. This avoids forwarding requests to an
  // arbitrary Location supplied by an intermediary.
  var origin = "https://" + allowed[1].toLowerCase();
  var currentUrl = initial;
  var maxRedirects = 5;
  for (var attempt = 0; attempt <= maxRedirects; attempt++) {
    var response;
    try {
      response = UrlFetchApp.fetch(currentUrl, {
        method: "get",
        headers: {
          Accept: accept || "text/plain",
          "User-Agent": "DotsInventoryBrowserBootstrap/1.0"
        },
        muteHttpExceptions: true,
        followRedirects: false
      });
    } catch (error) {
      throw new Error("Не удалось получить данные GitHub: " + (error.message || String(error)));
    }

    var code = Number(response.getResponseCode());
    if (code === 200) {
      return String(response.getContentText() == null ? "" : response.getContentText());
    }

    if ([301, 302, 303, 307, 308].indexOf(code) !== -1) {
      if (attempt === maxRedirects) {
        throw new Error("GitHub превысил лимит перенаправлений (" + maxRedirects + ") для " + initial);
      }
      var headers = response.getAllHeaders ? response.getAllHeaders() : {};
      var location = "";
      Object.keys(headers || {}).some(function (key) {
        if (String(key).toLowerCase() === "location") {
          location = String(headers[key] || "");
          return true;
        }
        return false;
      });
      if (!location) throw new Error("GitHub вернул HTTP " + code + " без заголовка Location для " + currentUrl);
      if (location.charAt(0) === "/") location = origin + location;
      if (!new RegExp("^" + origin.replace(/[.*+?^{}()|[\]\\]/g, "\\$&") + "/?", "i").test(location)) {
        throw new Error("Bootstrap заблокировал перенаправление на недоверенный адрес: " + location);
      }
      currentUrl = location;
      continue;
    }

    var body = "";
    try { body = String(response.getContentText() || ""); } catch (ignored) {}
    var responseHeaders = response.getAllHeaders ? response.getAllHeaders() : {};
    var diagnostic = [];
    Object.keys(responseHeaders || {}).forEach(function (key) {
      var lower = String(key).toLowerCase();
      if (lower === "x-ratelimit-limit" || lower === "x-ratelimit-remaining" ||
          lower === "x-ratelimit-reset" || lower === "retry-after") {
        diagnostic.push(key + "=" + responseHeaders[key]);
      }
    });
    throw new Error(
      "GitHub вернул HTTP " + code + " для " + currentUrl +
      (diagnostic.length ? ". Rate-limit headers: " + diagnostic.join("; ") : "") +
      (body ? ". Ответ GitHub: " + body.slice(0, 1200) : ". Тело ответа пустое.")
    );
  }
  throw new Error("Bootstrap остановлен: недостижимое состояние загрузчика GitHub.");
}

function di3BootstrapGitBlobSha1_(source) {
  var size = Utilities.newBlob(source).getBytes().length;
  var payload = "blob " + size + "\u0000" + source;
  var digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_1, payload, Utilities.Charset.UTF_8);
  return digest.map(function (byte) {
    var value = byte < 0 ? byte + 256 : byte;
    return ("0" + value.toString(16)).slice(-2);
  }).join("");
}

function di3BootstrapBuildTargetFiles_(currentFiles, downloadedFiles) {
  var target = [];
  var manifest = currentFiles.filter(function (file) {
    return file.type === "JSON" && file.name === "appsscript";
  })[0];
  var bootstrap = currentFiles.filter(function (file) {
    return file.type === "SERVER_JS" && file.name === "DI3_GitHubBootstrap";
  })[0];
  if (!manifest || !bootstrap) throw new Error("Не удалось сохранить фактический appsscript.json и Bootstrap.");
  target.push({ name: "appsscript", type: "JSON", source: String(manifest.source) });
  target.push({ name: "DI3_GitHubBootstrap", type: "SERVER_JS", source: String(bootstrap.source) });
  downloadedFiles.forEach(function (file) {
    if (target.some(function (item) { return item.type === file.type && item.name.toLowerCase() === file.name.toLowerCase(); })) {
      throw new Error("Конфликт имени файла при сборке установки: " + file.name);
    }
    target.push(file);
  });
  if (target.length !== DI3_GITHUB_BOOTSTRAP_CONFIG.EXPECTED_FILE_COUNT + 2) {
    throw new Error("Полный набор файлов неожиданного размера: " + target.length);
  }
  return target;
}

function di3BootstrapGetProjectContent_() {
  var scriptId = String(ScriptApp.getScriptId() || "").trim();
  if (!scriptId) throw new Error("Не удалось получить Script ID текущего Apps Script проекта.");
  var token = String(ScriptApp.getOAuthToken() || "");
  if (!token) throw new Error("OAuth token пуст.");
  var response = UrlFetchApp.fetch(
    "https://script.googleapis.com/v1/projects/" + encodeURIComponent(scriptId) + "/content",
    { method: "get", headers: { Authorization: "Bearer " + token, Accept: "application/json" }, muteHttpExceptions: true }
  );
  var code = Number(response.getResponseCode());
  var body = String(response.getContentText() || "");
  if (code !== 200) throw new Error("Apps Script API projects.getContent вернул HTTP " + code + ": " + body.slice(0, 700));
  var content;
  try { content = JSON.parse(body); }
  catch (error) { throw new Error("Apps Script API вернул некорректный JSON: " + (error.message || String(error))); }
  if (content.scriptId && content.scriptId !== scriptId) throw new Error("Apps Script API вернул другой Script ID.");
  if (!Array.isArray(content.files) || !content.files.length) throw new Error("Apps Script API вернул пустой набор файлов.");
  return { script_id: scriptId, content: content };
}

function di3BootstrapCreateVerifiedBackup_(scriptId, files) {
  var spreadsheetId = SpreadsheetApp.getActiveSpreadsheet().getId();
  var payloadFiles = files.map(function (file) {
    var source = String(file.source);
    return {
      name: String(file.name),
      type: String(file.type),
      source: source,
      sha256: di3BootstrapSha256_(source),
      size_bytes: Utilities.newBlob(source).getBytes().length
    };
  });
  var payload = {
    format: "dots-inventory-appsscript-source-backup/v1",
    script_id: scriptId,
    spreadsheet_id: spreadsheetId,
    created_at_utc: new Date().toISOString(),
    file_count: payloadFiles.length,
    files: payloadFiles
  };
  var envelope = {
    format: "dots-inventory-appsscript-source-backup/v1",
    payload_sha256: di3BootstrapSha256_(JSON.stringify(payload)),
    payload: payload
  };
  var serialized = JSON.stringify(envelope, null, 2);
  var size = Utilities.newBlob(serialized).getBytes().length;
  if (size > DI3_GITHUB_BOOTSTRAP_CONFIG.MAX_BACKUP_BYTES) {
    throw new Error("Исходная резервная копия превышает безопасный лимит " +
      DI3_GITHUB_BOOTSTRAP_CONFIG.MAX_BACKUP_BYTES + " байт.");
  }
  var stamp = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
  var fileName = DI3_GITHUB_BOOTSTRAP_CONFIG.BACKUP_PREFIX + stamp + "_BOOTSTRAP.json";
  var file = DriveApp.createFile(fileName, serialized, "application/json");
  var reopened = DriveApp.getFileById(file.getId());
  var readBack = reopened.getBlob().getDataAsString("UTF-8");
  if (di3BootstrapSha256_(readBack) !== di3BootstrapSha256_(serialized)) {
    throw new Error("Проверка read-after-write резервной копии не пройдена. Apps Script проект не изменён.");
  }
  var saved;
  try { saved = JSON.parse(readBack); }
  catch (error) { throw new Error("Резервная копия создана, но JSON не читается. Apps Script проект не изменён."); }
  if (saved.format !== "dots-inventory-appsscript-source-backup/v1" ||
      saved.payload_sha256 !== di3BootstrapSha256_(JSON.stringify(saved.payload)) ||
      saved.payload.script_id !== scriptId ||
      saved.payload.file_count !== files.length ||
      saved.payload.files.length !== files.length) {
    throw new Error("Структурная проверка резервной копии не пройдена. Apps Script проект не изменён.");
  }
  saved.payload.files.forEach(function (item) {
    if (item.sha256 !== di3BootstrapSha256_(item.source) ||
        item.size_bytes !== Utilities.newBlob(item.source).getBytes().length) {
      throw new Error("SHA-256/размер резервной копии не совпал для " + item.name + ". Apps Script проект не изменён.");
    }
  });
  file.setDescription("DI3_APPS_SCRIPT_SOURCE_BACKUP_V1:" + JSON.stringify({
    status: "VERIFIED",
    script_id: scriptId,
    file_count: files.length,
    payload_sha256: saved.payload_sha256,
    created_at_utc: saved.payload.created_at_utc
  }));
  return {
    id: file.getId(),
    file_id: file.getId(),
    name: file.getName(),
    file_name: file.getName(),
    url: file.getUrl(),
    size_bytes: size,
    payload_sha256: saved.payload_sha256,
    status: "VERIFIED"
  };
}

function di3BootstrapUpdateProject_(scriptId, files) {
  var token = String(ScriptApp.getOAuthToken() || "");
  if (!token) throw new Error("OAuth token пуст; запись запрещена.");
  var response = UrlFetchApp.fetch(
    "https://script.googleapis.com/v1/projects/" + encodeURIComponent(scriptId) + "/content",
    {
      method: "put",
      contentType: "application/json",
      payload: JSON.stringify({ files: files }),
      headers: { Authorization: "Bearer " + token, Accept: "application/json" },
      muteHttpExceptions: true
    }
  );
  var code = Number(response.getResponseCode());
  var body = String(response.getContentText() || "");
  if (code !== 200) {
    throw new Error("Apps Script API projects.updateContent вернул HTTP " + code +
      ". Резервная копия сохранена. Ответ: " + body.slice(0, 900));
  }
  try { return JSON.parse(body); }
  catch (error) { throw new Error("projects.updateContent вернул HTTP 200, но некорректный JSON. Проверь проект вручную; backup сохранён."); }
}

function di3BootstrapFingerprint_(files) {
  var normalized = files.map(function (file) {
    return { name: String(file.name), type: String(file.type), source: String(file.source) };
  }).sort(function (a, b) {
    return (a.type + ":" + a.name).localeCompare(b.type + ":" + b.name);
  });
  return di3BootstrapSha256_(JSON.stringify(normalized));
}

function di3BootstrapSha256_(value) {
  var digest = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    String(value == null ? "" : value),
    Utilities.Charset.UTF_8
  );
  return digest.map(function (byte) {
    var normalized = byte < 0 ? byte + 256 : byte;
    return ("0" + normalized.toString(16)).slice(-2);
  }).join("");
}
