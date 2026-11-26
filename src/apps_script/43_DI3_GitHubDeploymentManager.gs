/**
 * Dots Inventory — read-only GitHub release inspection and Apps Script source backup.
 *
 * This module never writes to the Apps Script project. It reads the published
 * release manifest, compares the release checksums with the current project,
 * and can save a verified source snapshot to the existing Drive backup folder.
 *
 * Apps Script API access requires the project API to be enabled and the OAuth
 * scopes documented in docs/GITHUB_RELEASE_PIPELINE.md. The actual target
 * appsscript.json is read and included in backups; this code never replaces it.
 */
var DI3_GITHUB_RELEASE_FORMAT = "dots-inventory-release/v1";
var DI3_SOURCE_BACKUP_FORMAT = "dots-inventory-appsscript-source-backup/v1";
var DI3_GITHUB_API_VERSION = "2022-11-28";

function di3GetGitHubDeploymentConfig_() {
  var config = DI3_APP_CONFIG && DI3_APP_CONFIG.GITHUB_RELEASE ? DI3_APP_CONFIG.GITHUB_RELEASE : {};
  return {
    repository: String(config.REPOSITORY || "brusvv/dots_inventory-").trim(),
    token_property: String(config.TOKEN_PROPERTY || "DI3_GITHUB_READ_TOKEN").trim(),
    source_backup_prefix: String(config.SOURCE_BACKUP_PREFIX || "DotsInventory_AppsScript_Source_"),
    max_source_backup_bytes: Math.max(100000, Number(config.MAX_SOURCE_BACKUP_BYTES) || 10000000)
  };
}

function di3Sha256Hex_(value) {
  var bytes = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    String(value == null ? "" : value),
    Utilities.Charset.UTF_8
  );
  return bytes.map(function (byte) {
    var normalized = byte < 0 ? byte + 256 : byte;
    return ("0" + normalized.toString(16)).slice(-2);
  }).join("");
}

function di3GetGitHubHeaders_() {
  var config = di3GetGitHubDeploymentConfig_();
  var headers = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": DI3_GITHUB_API_VERSION
  };
  var token = "";
  try { token = String(PropertiesService.getScriptProperties().getProperty(config.token_property) || "").trim(); }
  catch (ignoreProperties) {}
  if (token) headers.Authorization = "Bearer " + token;
  return headers;
}

function di3FetchGitHubResponse_(url, accept, followRedirects) {
  if (typeof UrlFetchApp === "undefined") {
    throw new Error("UrlFetchApp недоступен. Проверка релизов требует разрешения script.external_request.");
  }
  var headers = di3GetGitHubHeaders_();
  if (accept) headers.Accept = accept;
  var response;
  try {
    response = UrlFetchApp.fetch(url, { method: "get", headers: headers, muteHttpExceptions: true,
      followRedirects: followRedirects !== false });
  } catch (error) {
    throw new Error("Не удалось обратиться к GitHub. Проверь доступ к сети и разрешение script.external_request. " +
      (error && error.message ? error.message : String(error)));
  }
  return {
    code: Number(response.getResponseCode()),
    text: String(response.getContentText() || ""),
    headers: typeof response.getAllHeaders === "function" ? response.getAllHeaders() : {}
  };
}

function di3FetchGitHubJson_(url) {
  var response = di3FetchGitHubResponse_(url, "application/vnd.github+json");
  if (response.code !== 200) {
    if (response.code === 404) return { status: "NOT_FOUND", http_status: 404 };
    if (response.code === 401 || response.code === 403) {
      throw new Error("GitHub отклонил запрос (" + response.code + "). Если репозиторий приватный, задай read-only token в Script Properties: " +
        di3GetGitHubDeploymentConfig_().token_property + ". Токену достаточно Contents: read.");
    }
    throw new Error("GitHub API вернул HTTP " + response.code + ": " + response.text.slice(0, 500));
  }
  try { return { status: "OK", data: JSON.parse(response.text) }; }
  catch (error) { throw new Error("GitHub API вернул некорректный JSON: " + (error.message || String(error))); }
}

function di3ValidateGitHubReleaseManifest_(manifest, releaseTag) {
  var issues = [];
  var config = di3GetGitHubDeploymentConfig_();
  var repository = config.repository;
  var commit = String(manifest && manifest.git_commit || "").toLowerCase();
  if (!manifest || manifest.format !== DI3_GITHUB_RELEASE_FORMAT) issues.push("Неподдерживаемый format манифеста.");
  if (!/^dots-inventory-v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(String(releaseTag || ""))) {
    issues.push("Некорректный GitHub release tag.");
  }
  if (manifest && manifest.git_tag !== releaseTag) issues.push("git_tag манифеста не совпадает с GitHub Release.");
  if (!/^[0-9a-f]{40}$/.test(commit)) issues.push("git_commit должен быть полным SHA из 40 hex-символов.");
  if (!manifest || !Number.isSafeInteger(Number(manifest.target_schema_version)) || Number(manifest.target_schema_version) < 1) {
    issues.push("Некорректная target_schema_version.");
  }
  if (!manifest || !String(manifest.application_time_zone || "").trim()) issues.push("В манифесте отсутствует application_time_zone.");
  if (!manifest || manifest.manifest_policy !== "PRESERVE_TARGET_PROJECT_MANIFEST") {
    issues.push("Манифест не гарантирует сохранение appsscript.json целевого проекта.");
  }
  if (!manifest || manifest.source_policy !== "PINNED_COMMIT_RAW_FILES") {
    issues.push("Неизвестная политика получения исходников.");
  }
  if (!manifest || !Array.isArray(manifest.files) || !manifest.files.length || manifest.files.length > 200) {
    issues.push("Список Apps Script файлов пуст или превышает безопасный предел 200.");
  } else {
    var seen = {};
    manifest.files.forEach(function (file, index) {
      var name = String(file && file.name || "");
      if (!/^[A-Za-z0-9_.-]+\.gs$/.test(name) || name.indexOf("..") !== -1) {
        issues.push("Недопустимое имя файла в files[" + index + "].");
        return;
      }
      var key = name.toLowerCase();
      if (seen[key]) issues.push("Дублирующееся имя файла: " + name + ".");
      seen[key] = true;
      if (file.type !== "SERVER_JS") issues.push(name + ": ожидался тип SERVER_JS.");
      if (file.source_path !== "src/apps_script/" + name) issues.push(name + ": source_path не соответствует имени.");
      if (!/^[0-9a-f]{64}$/i.test(String(file.sha256 || ""))) issues.push(name + ": некорректный SHA-256.");
      if (!Number.isSafeInteger(Number(file.size_bytes)) || Number(file.size_bytes) < 0) issues.push(name + ": некорректный size_bytes.");
      var expectedUrl = "https://raw.githubusercontent.com/" + repository + "/" + commit + "/src/apps_script/" + encodeURIComponent(name);
      if (file.raw_url !== expectedUrl) issues.push(name + ": URL не закреплён за ожидаемым репозиторием и commit.");
    });
  }
  if (issues.length) throw new Error("Проверка release manifest не пройдена:\n• " + issues.join("\n• "));
  return { status: "VALID", file_count: manifest.files.length, commit: commit };
}

function di3IsSafeGitHubAssetRedirect_(url) {
  return /^https:\/\/(?:release-assets|objects)\.githubusercontent\.com\//i.test(String(url || ""));
}

function di3FetchGitHubAsset_(asset, expectedName) {
  var config = di3GetGitHubDeploymentConfig_();
  var expectedApiUrl = "https://api.github.com/repos/" + config.repository + "/releases/assets/" + Number(asset && asset.id);
  if (!asset || !Number.isSafeInteger(Number(asset.id)) || Number(asset.id) < 1 || asset.url !== expectedApiUrl) {
    throw new Error("GitHub asset " + expectedName + " имеет неожиданный API URL.");
  }
  var response = di3FetchGitHubResponse_(expectedApiUrl, "application/octet-stream", false);
  if (response.code === 200) return response.text;
  if ([301, 302, 303, 307, 308].indexOf(response.code) === -1) {
    throw new Error("Не удалось скачать GitHub asset " + expectedName + ": HTTP " + response.code + ".");
  }
  var location = String(response.headers.Location || response.headers.location || "");
  if (!di3IsSafeGitHubAssetRedirect_(location)) {
    throw new Error("GitHub asset " + expectedName + " перенаправляет на недоверенный адрес; загрузка остановлена.");
  }
  // The signed asset URL is fetched without the GitHub token to avoid forwarding
  // repository credentials to a redirect host.
  var redirected;
  try {
    redirected = UrlFetchApp.fetch(location, {
      method: "get", headers: { Accept: "application/octet-stream" },
      muteHttpExceptions: true, followRedirects: true
    });
  } catch (error) {
    throw new Error("Не удалось скачать GitHub asset после безопасного перенаправления: " +
      (error && error.message ? error.message : String(error)));
  }
  var redirectedCode = Number(redirected.getResponseCode());
  if (redirectedCode !== 200) throw new Error("GitHub asset " + expectedName + " вернул HTTP " + redirectedCode + " после перенаправления.");
  return String(redirected.getContentText() || "");
}

function di3GetLatestGitHubReleaseManifest_() {
  var config = di3GetGitHubDeploymentConfig_();
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(config.repository)) {
    throw new Error("Некорректный DI3_APP_CONFIG.GITHUB_RELEASE.REPOSITORY.");
  }
  var apiBase = "https://api.github.com/repos/" + config.repository;
  var releaseResult = di3FetchGitHubJson_(apiBase + "/releases/latest");
  if (releaseResult.status === "NOT_FOUND") {
    return { status: "NO_RELEASE", message: "В репозитории пока нет опубликованного стабильного GitHub Release." };
  }
  var release = releaseResult.data;
  if (!release || release.draft || release.prerelease) {
    throw new Error("GitHub latest release не является опубликованным стабильным релизом.");
  }
  var assets = Array.isArray(release.assets) ? release.assets : [];
  function asset(name) {
    var matches = assets.filter(function (item) { return item && item.name === name && item.id && item.url; });
    if (matches.length !== 1) throw new Error("В релизе должен находиться ровно один asset " + name + ".");
    return matches[0];
  }
  var manifestText = di3FetchGitHubAsset_(asset("release-manifest.json"), "release-manifest.json");
  var checksumText = di3FetchGitHubAsset_(asset("release-manifest.asset.sha256"), "release-manifest.asset.sha256");
  var checksumMatch = checksumText.trim().match(/^([0-9a-f]{64})\s+\*?(?:.*\/)?release-manifest\.json$/i);
  if (!checksumMatch) throw new Error("Файл release-manifest.asset.sha256 имеет неизвестный формат.");
  var actualHash = di3Sha256Hex_(manifestText);
  if (actualHash.toLowerCase() !== checksumMatch[1].toLowerCase()) {
    throw new Error("SHA-256 release-manifest.json не совпадает с контрольной суммой из релиза.");
  }
  var manifest;
  try { manifest = JSON.parse(manifestText); }
  catch (error) { throw new Error("release-manifest.json содержит некорректный JSON: " + (error.message || String(error))); }
  var validation = di3ValidateGitHubReleaseManifest_(manifest, release.tag_name);
  return {
    status: "READY",
    release: {
      tag_name: release.tag_name,
      name: String(release.name || release.tag_name),
      html_url: String(release.html_url || ""),
      published_at: String(release.published_at || "")
    },
    manifest: manifest,
    validation: validation
  };
}

function di3GetAppsScriptProjectContent_() {
  var scriptId = "";
  try { scriptId = String(ScriptApp.getScriptId() || "").trim(); }
  catch (error) { throw new Error("Не удалось получить Script ID текущего проекта Apps Script: " + (error.message || String(error))); }
  if (!scriptId) throw new Error("Apps Script API: текущий Script ID пуст.");
  var token = "";
  try { token = ScriptApp.getOAuthToken(); }
  catch (error) { throw new Error("Не удалось получить OAuth token. Проверь авторизацию Apps Script API и scope script.projects. " + (error.message || String(error))); }
  var url = "https://script.googleapis.com/v1/projects/" + encodeURIComponent(scriptId) + "/content";
  var response;
  try {
    response = UrlFetchApp.fetch(url, {
      method: "get",
      headers: { Authorization: "Bearer " + token, Accept: "application/json" },
      muteHttpExceptions: true
    });
  } catch (error) {
    throw new Error("Не удалось вызвать Apps Script API. Включи Google Apps Script API и проверь scopes script.projects и script.external_request. " +
      (error.message || String(error)));
  }
  var code = Number(response.getResponseCode());
  var text = String(response.getContentText() || "");
  if (code !== 200) {
    var hint = code === 401 || code === 403 ?
      " Нужны включённый Apps Script API и OAuth scopes https://www.googleapis.com/auth/script.projects.readonly и https://www.googleapis.com/auth/script.external_request." : "";
    throw new Error("Apps Script API projects.getContent вернул HTTP " + code + "." + hint + " Ответ: " + text.slice(0, 500));
  }
  var content;
  try { content = JSON.parse(text); }
  catch (error) { throw new Error("Apps Script API вернул некорректный JSON: " + (error.message || String(error))); }
  if (!Array.isArray(content.files) || !content.files.length) {
    throw new Error("Apps Script API вернул пустой список файлов; резервирование и сравнение остановлены.");
  }
  return { script_id: scriptId, content: content };
}

function di3NormalizeAppsScriptApiFileName_(file) {
  var name = String(file && file.name || "");
  if (file && file.type === "SERVER_JS" && !/\.gs$/i.test(name)) return name + ".gs";
  return name;
}

function di3BuildGitHubSourceDiff_(manifest, projectFiles) {
  if (!Array.isArray(projectFiles)) throw new Error("Apps Script project files отсутствуют.");
  var localByName = {};
  projectFiles.forEach(function (file) {
    var name = di3NormalizeAppsScriptApiFileName_(file);
    if (!name) throw new Error("В Apps Script API найден файл без имени.");
    if (file.type === "SERVER_JS") {
      if (localByName[name]) throw new Error("В Apps Script API обнаружены дублирующиеся SERVER_JS файлы: " + name + ".");
      localByName[name] = file;
    }
  });
  var releaseNames = {};
  var added = [];
  var changed = [];
  var unchanged = [];
  manifest.files.forEach(function (file) {
    releaseNames[file.name] = true;
    var local = localByName[file.name];
    if (!local) {
      added.push(file.name);
      return;
    }
    var localSource = String(local.source == null ? "" : local.source);
    var localHash = di3Sha256Hex_(localSource);
    var localSize = Utilities.newBlob(localSource).getBytes().length;
    if (localHash.toLowerCase() !== String(file.sha256).toLowerCase() || localSize !== Number(file.size_bytes)) {
      changed.push({ name: file.name, local_sha256: localHash, release_sha256: file.sha256 });
    } else {
      unchanged.push(file.name);
    }
  });
  var preservedUnmanaged = Object.keys(localByName).filter(function (name) { return !releaseNames[name]; }).sort();
  var nonServerFiles = projectFiles.filter(function (file) { return file.type !== "SERVER_JS"; }).map(function (file) {
    return { name: String(file.name || ""), type: String(file.type || "") };
  });
  return {
    added: added,
    changed: changed,
    unchanged: unchanged,
    preserved_unmanaged_server_js: preservedUnmanaged,
    preserved_non_server_files: nonServerFiles,
    manifest_preserved: nonServerFiles.some(function (file) { return file.type === "JSON" && file.name === "appsscript"; }),
    summary: {
      release_files: manifest.files.length,
      local_server_js_files: Object.keys(localByName).length,
      added: added.length,
      changed: changed.length,
      unchanged: unchanged.length,
      preserved_unmanaged: preservedUnmanaged.length,
      non_server_files_preserved: nonServerFiles.length
    }
  };
}

function di3CheckGitHubRelease() {
  var releaseResult = di3GetLatestGitHubReleaseManifest_();
  if (releaseResult.status === "NO_RELEASE") {
    var noRelease = { status: "NO_RELEASE", message: releaseResult.message };
    try { SpreadsheetApp.getUi().alert("GitHub · обновления", noRelease.message, SpreadsheetApp.getUi().ButtonSet.OK); } catch (ignoreNoReleaseUi) {}
    return noRelease;
  }
  var project = di3GetAppsScriptProjectContent_();
  var diff = di3BuildGitHubSourceDiff_(releaseResult.manifest, project.content.files);
  var installedTag = "";
  try { installedTag = String(PropertiesService.getScriptProperties().getProperty("DI3_INSTALLED_RELEASE_TAG") || ""); }
  catch (ignoreInstalledTag) {}
  var result = {
    status: diff.added.length || diff.changed.length ? "UPDATE_AVAILABLE" : "UP_TO_DATE",
    release: releaseResult.release,
    manifest: {
      schema_version: Number(releaseResult.manifest.target_schema_version),
      time_zone: releaseResult.manifest.application_time_zone,
      commit: releaseResult.manifest.git_commit,
      file_count: releaseResult.manifest.files.length
    },
    installed_release_tag: installedTag || null,
    diff: diff,
    project_id: project.script_id,
    write_performed: false,
    manifest_preserved: diff.manifest_preserved
  };
  var lines = [
    "Последний релиз: " + result.release.tag_name,
    "Схема: v" + result.manifest.schema_version + " · часовой пояс: " + result.manifest.time_zone,
    "Файлов релиза: " + diff.summary.release_files,
    "Новых: " + diff.summary.added + " · изменённых: " + diff.summary.changed + " · без изменений: " + diff.summary.unchanged,
    "Локальных дополнительных .gs (будут сохранены): " + diff.summary.preserved_unmanaged,
    "Файлов других типов (включая appsscript.json): " + diff.summary.non_server_files_preserved,
    "Манифест appsscript.json обнаружен: " + (diff.manifest_preserved ? "да" : "нет"),
    "",
    result.status === "UP_TO_DATE" ? "Исходники совпадают с опубликованным релизом." : "Доступны изменения. Автоматическая установка не выполнялась."
  ];
  var changedNames = diff.added.concat(diff.changed.map(function (item) { return item.name; }));
  if (changedNames.length) lines.push("", "Файлы:", changedNames.slice(0, 20).join("\n") +
    (changedNames.length > 20 ? "\n… и ещё " + (changedNames.length - 20) : ""));
  try {
    SpreadsheetApp.getUi().alert("GitHub · " + (result.status === "UP_TO_DATE" ? "обновлений нет" : "доступно обновление"),
      lines.join("\n"), SpreadsheetApp.getUi().ButtonSet.OK);
  } catch (ignoreUpdateUi) {}
  return result;
}

function di3BuildAppsScriptSourceBackupEnvelope_(project, spreadsheetId, createdAt) {
  if (!project || !project.script_id || !project.content || !Array.isArray(project.content.files) || !project.content.files.length) {
    throw new Error("Нельзя создать backup: данные Apps Script проекта неполны.");
  }
  var files = project.content.files.map(function (file) {
    var name = String(file.name || "");
    var type = String(file.type || "");
    if (!name || !type || typeof file.source !== "string") {
      throw new Error("Нельзя создать backup: файл проекта имеет неполные метаданные или не содержит source.");
    }
    return {
      name: name,
      type: type,
      source: file.source,
      sha256: di3Sha256Hex_(file.source),
      size_bytes: Utilities.newBlob(file.source).getBytes().length
    };
  });
  var payload = {
    format: DI3_SOURCE_BACKUP_FORMAT,
    script_id: project.script_id,
    spreadsheet_id: String(spreadsheetId || ""),
    created_at_utc: String(createdAt || new Date().toISOString()),
    file_count: files.length,
    files: files
  };
  var payloadJson = JSON.stringify(payload);
  return {
    format: DI3_SOURCE_BACKUP_FORMAT,
    payload_sha256: di3Sha256Hex_(payloadJson),
    payload: payload
  };
}

function di3VerifyAppsScriptSourceBackupEnvelope_(envelope) {
  if (!envelope || envelope.format !== DI3_SOURCE_BACKUP_FORMAT || !envelope.payload) {
    throw new Error("Неверный формат Apps Script source backup.");
  }
  var payload = envelope.payload;
  if (envelope.payload_sha256 !== di3Sha256Hex_(JSON.stringify(payload))) {
    throw new Error("Контрольная сумма payload Apps Script source backup не совпадает.");
  }
  if (!payload.script_id || !Array.isArray(payload.files) || !payload.files.length || payload.file_count !== payload.files.length) {
    throw new Error("В Apps Script source backup отсутствуют обязательные файлы проекта.");
  }
  var seen = {};
  payload.files.forEach(function (file) {
    var key = String(file.name || "") + "|" + String(file.type || "");
    if (!file.name || !file.type || typeof file.source !== "string" || seen[key]) {
      throw new Error("Apps Script source backup содержит некорректный или дублирующийся файл.");
    }
    seen[key] = true;
    if (di3Sha256Hex_(file.source) !== file.sha256 ||
        Utilities.newBlob(file.source).getBytes().length !== Number(file.size_bytes)) {
      throw new Error("Проверка SHA-256/размера файла не пройдена: " + file.name + ".");
    }
  });
  return { status: "VERIFIED", file_count: payload.files.length, script_id: payload.script_id };
}

function di3CreateAppsScriptSourceBackup() {
  var project = di3GetAppsScriptProjectContent_();
  var spreadsheetId = "";
  try { spreadsheetId = di3GetSpreadsheet_().getId(); } catch (ignoreSpreadsheet) {}
  var envelope = di3BuildAppsScriptSourceBackupEnvelope_(project, spreadsheetId, new Date().toISOString());
  var serialized = JSON.stringify(envelope, null, 2);
  var config = di3GetGitHubDeploymentConfig_();
  var byteSize = Utilities.newBlob(serialized).getBytes().length;
  if (byteSize > config.max_source_backup_bytes) {
    throw new Error("Backup остановлен: размер исходников " + byteSize + " байт превышает лимит " +
      config.max_source_backup_bytes + ". Увеличь GITHUB_RELEASE.MAX_SOURCE_BACKUP_BYTES после проверки.");
  }
  var folder = di3GetBackupFolder_();
  var timezone = di3GetConfiguredTimeZone_();
  var stamp = Utilities.formatDate(new Date(), timezone, "yyyyMMdd_HHmmss");
  var fileName = config.source_backup_prefix + stamp + "_" + Utilities.getUuid().replace(/-/g, "").slice(0, 8) + ".json";
  var file = folder.createFile(fileName, serialized, "application/json");
  var savedText = "";
  try { savedText = file.getBlob().getDataAsString("UTF-8"); }
  catch (readError) {
    throw new Error("Source backup создан, но не удалось прочитать его для проверки. Файл сохранён: " + file.getId() + ". " +
      (readError.message || String(readError)));
  }
  var savedEnvelope;
  try { savedEnvelope = JSON.parse(savedText); }
  catch (parseError) { throw new Error("Source backup создан, но JSON не читается. Файл сохранён: " + file.getId() + "."); }
  var verification = di3VerifyAppsScriptSourceBackupEnvelope_(savedEnvelope);
  if (verification.file_count !== project.content.files.length || verification.script_id !== project.script_id) {
    throw new Error("Source backup создан, но проверка состава проекта не совпала. Файл сохранён: " + file.getId() + ".");
  }
  file.setDescription("DI3_APPS_SCRIPT_SOURCE_BACKUP_V1:" + JSON.stringify({
    status: "VERIFIED",
    script_id: project.script_id,
    file_count: verification.file_count,
    payload_sha256: savedEnvelope.payload_sha256,
    created_at_utc: savedEnvelope.payload.created_at_utc
  }));
  try { PropertiesService.getScriptProperties().setProperty("DI3_LAST_SOURCE_BACKUP_FILE_ID", file.getId()); }
  catch (ignoreLastBackupProperty) {}
  var result = {
    status: "VERIFIED",
    file_id: file.getId(),
    file_name: file.getName(),
    url: file.getUrl(),
    folder_url: folder.getUrl(),
    script_id: project.script_id,
    file_count: verification.file_count,
    size_bytes: byteSize,
    payload_sha256: savedEnvelope.payload_sha256,
    includes_appsscript_manifest: savedEnvelope.payload.files.some(function (item) { return item.type === "JSON" && item.name === "appsscript"; }),
    verification: verification
  };
  try {
    SpreadsheetApp.getUi().alert("Apps Script · backup VERIFIED",
      "Файл проекта сохранён и повторно прочитан.\nФайлов: " + result.file_count +
      "\nРазмер: " + result.size_bytes + " байт\nappsscript.json включён: " +
      (result.includes_appsscript_manifest ? "да" : "нет") + "\nSHA-256: " + result.payload_sha256 +
      "\n\n" + result.url, SpreadsheetApp.getUi().ButtonSet.OK);
  } catch (ignoreBackupUi) {}
  return result;
}

function di3CreateAppsScriptSourceBackupFromMenu() {
  return di3CreateAppsScriptSourceBackup();
}
