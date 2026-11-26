/**
 * Dots Inventory — read-only installation preview for a pinned GitHub release.
 * This module never calls projects.updateContent and never writes to the Apps Script project.
 */
var DI3_GITHUB_INSTALL_PREVIEW_FORMAT = "dots-inventory-install-preview/v1";

function di3FetchPinnedGitHubSource_(manifestFile) {
  if (!manifestFile || typeof manifestFile.raw_url !== "string") throw new Error("У файла релиза отсутствует закреплённый raw_url.");
  var response;
  try {
    response = UrlFetchApp.fetch(manifestFile.raw_url, { method: "get", headers: { Accept: "text/plain" },
      muteHttpExceptions: true, followRedirects: false });
  } catch (error) {
    throw new Error("Не удалось загрузить " + manifestFile.name + ": " + (error && error.message ? error.message : String(error)));
  }
  var code = Number(response.getResponseCode());
  if (code !== 200) throw new Error("Загрузка " + manifestFile.name + " остановлена: HTTP " + code + ". Перенаправления не принимаются.");
  var source = String(response.getContentText() == null ? "" : response.getContentText());
  var size = Utilities.newBlob(source).getBytes().length;
  var hash = di3Sha256Hex_(source);
  if (size !== Number(manifestFile.size_bytes) || hash.toLowerCase() !== String(manifestFile.sha256 || "").toLowerCase()) {
    throw new Error("Проверка SHA-256/размера исходника не пройдена: " + manifestFile.name + ".");
  }
  return { name: manifestFile.name, source: source, size_bytes: size, sha256: hash };
}

function di3BuildGitHubInstallPreview_(manifest, projectFiles, downloadedFiles) {
  if (!manifest || !Array.isArray(manifest.files) || !manifest.files.length) throw new Error("Install preview: release manifest не содержит списка файлов.");
  if (!Array.isArray(projectFiles) || !projectFiles.length) throw new Error("Install preview: текущий проект Apps Script пуст или недоступен.");
  if (!Array.isArray(downloadedFiles) || downloadedFiles.length !== manifest.files.length) throw new Error("Install preview: число загруженных исходников не совпадает с манифестом.");

  var current = [], currentKeys = {}, manifestFiles = {}, downloadedByName = {};
  projectFiles.forEach(function (file) {
    if (!file || !String(file.name || "").trim() || !String(file.type || "").trim() || typeof file.source !== "string") {
      throw new Error("Install preview: найден неполный файл текущего Apps Script проекта.");
    }
    var key = String(file.type) + "|" + String(file.name).toLowerCase();
    if (currentKeys[key]) throw new Error("Install preview: дублирующийся файл проекта " + file.name + ".");
    currentKeys[key] = true;
    current.push({ name: String(file.name), type: String(file.type), source: file.source });
  });
  var manifests = current.filter(function (file) { return file.type === "JSON" && file.name === "appsscript"; });
  if (manifests.length !== 1) throw new Error("Install preview остановлен: нужен ровно один фактический appsscript.json целевого проекта.");

  manifest.files.forEach(function (file) {
    if (!file || !/^[A-Za-z0-9_.-]+\.gs$/.test(String(file.name || ""))) throw new Error("Install preview: недопустимое имя SERVER_JS в release manifest.");
    var key = String(file.name).toLowerCase();
    if (manifestFiles[key]) throw new Error("Install preview: повтор файла в release manifest: " + file.name + ".");
    manifestFiles[key] = file;
  });
  downloadedFiles.forEach(function (file) {
    if (!file || !file.name || typeof file.source !== "string") throw new Error("Install preview: загруженный исходник имеет неполные данные.");
    var key = String(file.name).toLowerCase();
    if (downloadedByName[key]) throw new Error("Install preview: повтор загруженного исходника " + file.name + ".");
    downloadedByName[key] = file;
  });

  var added = [], changed = [], unchanged = [], preservedUnmanaged = [];
  var target = current.map(function (file) {
    if (file.type !== "SERVER_JS") return { name: file.name, type: file.type, source: file.source };
    var normalizedName = /\.gs$/i.test(file.name) ? file.name : file.name + ".gs";
    var manifestFile = manifestFiles[normalizedName.toLowerCase()];
    if (!manifestFile) {
      preservedUnmanaged.push(normalizedName);
      return { name: file.name, type: file.type, source: file.source };
    }
    var downloaded = downloadedByName[normalizedName.toLowerCase()];
    if (!downloaded) throw new Error("Install preview: отсутствует загруженный файл " + normalizedName + ".");
    var actualSize = Utilities.newBlob(downloaded.source).getBytes().length;
    var actualHash = di3Sha256Hex_(downloaded.source);
    if (actualSize !== Number(manifestFile.size_bytes) || actualHash.toLowerCase() !== String(manifestFile.sha256).toLowerCase()) {
      throw new Error("Install preview: повторная проверка исходника не пройдена: " + normalizedName + ".");
    }
    if (file.source === downloaded.source) unchanged.push(normalizedName); else changed.push(normalizedName);
    delete downloadedByName[normalizedName.toLowerCase()];
    return { name: file.name, type: "SERVER_JS", source: downloaded.source };
  });

  manifest.files.forEach(function (manifestFile) {
    var key = String(manifestFile.name).toLowerCase();
    if (!downloadedByName[key]) return;
    var downloaded = downloadedByName[key];
    if (Utilities.newBlob(downloaded.source).getBytes().length !== Number(manifestFile.size_bytes) ||
        di3Sha256Hex_(downloaded.source).toLowerCase() !== String(manifestFile.sha256).toLowerCase()) {
      throw new Error("Install preview: повторная проверка нового исходника не пройдена: " + manifestFile.name + ".");
    }
    var apiName = manifestFile.name.replace(/\.gs$/i, "");
    if (target.some(function (file) { return file.name.toLowerCase() === apiName.toLowerCase() && file.type !== "SERVER_JS"; })) {
      throw new Error("Install preview: имя " + apiName + " уже занято файлом другого типа.");
    }
    target.push({ name: apiName, type: "SERVER_JS", source: downloaded.source });
    added.push(manifestFile.name);
    delete downloadedByName[key];
  });
  if (Object.keys(downloadedByName).length) throw new Error("Install preview: получены исходники, отсутствующие в release manifest.");
  if (target.filter(function (file) { return file.type === "JSON" && file.name === "appsscript"; }).length !== 1) {
    throw new Error("Install preview: итоговый набор потерял или продублировал appsscript.json.");
  }
  var nonServerBefore = current.filter(function (file) { return file.type !== "SERVER_JS"; });
  var nonServerAfter = target.filter(function (file) { return file.type !== "SERVER_JS"; });
  if (JSON.stringify(nonServerBefore) !== JSON.stringify(nonServerAfter)) throw new Error("Install preview: обнаружено непредусмотренное изменение файла не типа SERVER_JS.");
  if (target.filter(function (file) { return file.type === "SERVER_JS"; }).length !==
      current.filter(function (file) { return file.type === "SERVER_JS"; }).length + added.length) {
    throw new Error("Install preview: контроль состава SERVER_JS не пройден.");
  }
  return {
    format: DI3_GITHUB_INSTALL_PREVIEW_FORMAT, status: "PREVIEW_READY", write_performed: false, update_content_called: false,
    release_tag: String(manifest.git_tag || ""), commit: String(manifest.git_commit || ""),
    target_schema_version: Number(manifest.target_schema_version), target_time_zone: String(manifest.application_time_zone || ""),
    target_files: target,
    preserved_non_server_files: nonServerAfter.map(function (file) { return file.name + " (" + file.type + ")"; }),
    preserved_unmanaged_server_js: preservedUnmanaged.sort(),
    diff: { added: added.sort(), changed: changed.sort(), unchanged: unchanged.sort(),
      preserved_unmanaged: preservedUnmanaged.length, preserved_non_server: nonServerAfter.length, removed: 0 },
    summary: { target_file_count: target.length, current_file_count: current.length, added: added.length, changed: changed.length,
      unchanged: unchanged.length, preserved_unmanaged: preservedUnmanaged.length, preserved_non_server: nonServerAfter.length, removed: 0 }
  };
}

function di3PrepareGitHubInstallPreview() {
  var releaseResult = di3GetLatestGitHubReleaseManifest_();
  if (releaseResult.status !== "READY") {
    var noRelease = { status: "NO_RELEASE", message: releaseResult.message, write_performed: false };
    try { SpreadsheetApp.getUi().alert("GitHub · подготовка обновления", noRelease.message, SpreadsheetApp.getUi().ButtonSet.OK); } catch (ignoreNoRelease) {}
    return noRelease;
  }
  var project = di3GetAppsScriptProjectContent_(), downloaded = [], totalBytes = 0;
  releaseResult.manifest.files.forEach(function (file) {
    var result = di3FetchPinnedGitHubSource_(file);
    totalBytes += result.size_bytes;
    if (totalBytes > di3GetGitHubDeploymentConfig_().max_source_backup_bytes) throw new Error("Install preview остановлен: общий размер исходников превышает настроенный лимит.");
    downloaded.push(result);
  });
  var preview = di3BuildGitHubInstallPreview_(releaseResult.manifest, project.content.files, downloaded);
  preview.release = releaseResult.release; preview.project_id = project.script_id; preview.downloaded_bytes = totalBytes;
  preview.source_project_fingerprint = di3AppsScriptFilesFingerprint_(project.content.files);
  var lines = [
    "Релиз: " + preview.release_tag, "Commit: " + preview.commit,
    "Целевая схема релиза: v" + preview.target_schema_version, "Часовой пояс релиза: " + preview.target_time_zone,
    "Файлов в полном наборе: " + preview.summary.target_file_count,
    "Новых: " + preview.summary.added + " · изменённых: " + preview.summary.changed + " · без изменений: " + preview.summary.unchanged,
    "Локальных SERVER_JS сохранено: " + preview.summary.preserved_unmanaged,
    "Файлов других типов сохранено: " + preview.summary.preserved_non_server, "Удалений: 0", "",
    "projects.updateContent НЕ вызывался. Это только предварительный просмотр."
  ];
  var names = preview.diff.added.concat(preview.diff.changed);
  if (names.length) lines.push("", "Файлы к добавлению/замене:", names.slice(0, 25).join("\n") + (names.length > 25 ? "\n… и ещё " + (names.length - 25) : ""));
  try { SpreadsheetApp.getUi().alert("GitHub · предварительный просмотр готов", lines.join("\n"), SpreadsheetApp.getUi().ButtonSet.OK); } catch (ignorePreviewUi) {}
  return preview;
}
function di3PrepareGitHubInstallPreviewFromMenu() { return di3PrepareGitHubInstallPreview(); }
