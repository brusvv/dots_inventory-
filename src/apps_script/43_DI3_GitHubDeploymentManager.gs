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
var DI3_GITHUB_UPDATER_VERSION = "0.2.0";

/** Compare strict numeric MAJOR.MINOR.PATCH versions. Returns -1, 0 or 1. */
function di3CompareUpdaterVersions_(left, right) {
  function parse(value) {
    var match = String(value || "").trim().match(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/);
    if (!match) throw new Error("Некорректная версия updater: " + String(value || ""));
    var parts = match.slice(1).map(Number);
    if (parts.some(function (part) { return !Number.isSafeInteger(part); })) throw new Error("Версия updater выходит за безопасный числовой диапазон: " + value);
    return parts;
  }
  var a = parse(left), b = parse(right);
  for (var i = 0; i < 3; i++) { if (a[i] < b[i]) return -1; if (a[i] > b[i]) return 1; }
  return 0;
}

function di3BuildGitHubInstallCompatibilityReport_(manifest, context) {
  context = context || {};
  var issues = (context.read_errors || []).slice();
  var targetSchema = Number(manifest && manifest.target_schema_version);
  var workbookSchema = Number(context.workbook_schema_version);
  var codeSchema = Number(context.code_schema_version);
  if (!Number.isSafeInteger(targetSchema) || targetSchema < 1) issues.push("Релиз содержит некорректную целевую версию схемы.");
  if (!Number.isSafeInteger(workbookSchema) || workbookSchema < 0) issues.push("Не удалось достоверно определить _AppMeta.schema_version текущей таблицы.");
  else if (Number.isSafeInteger(targetSchema) && workbookSchema !== targetSchema) issues.push("Версия схемы таблицы v" + workbookSchema + " не совпадает со схемой релиза v" + targetSchema + ". Установщик обновляет только код и не выполняет миграции.");
  if (!Number.isSafeInteger(codeSchema) || codeSchema < 1) issues.push("Не удалось определить DI3_SCHEMA_VERSION текущего кода.");
  else if (Number.isSafeInteger(targetSchema) && codeSchema !== targetSchema) issues.push("Текущий код поддерживает схему v" + codeSchema + ", а релиз требует v" + targetSchema + ". Обновление кода без отдельной миграции заблокировано.");
  var targetZone = String(manifest && manifest.application_time_zone || "").trim();
  if (!targetZone) issues.push("В release manifest отсутствует application_time_zone.");
  [
    ["DI3_APP_CONFIG.TIME_ZONE", context.config_time_zone],
    ["appsscript.json timeZone", context.manifest_time_zone],
    ["Session.getScriptTimeZone()", context.script_time_zone],
    ["часовой пояс Google Sheets", context.spreadsheet_time_zone]
  ].forEach(function (entry) {
    var actual = String(entry[1] || "").trim();
    if (!actual) issues.push("Не удалось прочитать " + entry[0] + "; требуется точная проверка часового пояса.");
    else if (targetZone && actual !== targetZone) issues.push(entry[0] + " = " + actual + ", а релиз требует " + targetZone + ".");
  });
  return {
    status: issues.length ? "BLOCKED" : "READY",
    target_schema_version: Number.isSafeInteger(targetSchema) ? targetSchema : null,
    workbook_schema_version: Number.isSafeInteger(workbookSchema) ? workbookSchema : null,
    current_code_schema_version: Number.isSafeInteger(codeSchema) ? codeSchema : null,
    target_time_zone: targetZone,
    time_zones: {
      app_config: String(context.config_time_zone || ""),
      appsscript_manifest: String(context.manifest_time_zone || ""),
      script_runtime: String(context.script_time_zone || ""),
      spreadsheet: String(context.spreadsheet_time_zone || "")
    },
    issues: issues
  };
}

/** Read-only compatibility gate. No schema, timezone, date or project data is changed. */
function di3GetGitHubInstallCompatibilityReport_(manifest, projectFiles) {
  var context = { read_errors: [] };
  try { context.workbook_schema_version = di3GetSchemaVersion_(); }
  catch (error) { context.read_errors.push("Не удалось прочитать версию схемы таблицы: " + (error.message || String(error))); }
  try { context.code_schema_version = Number(DI3_SCHEMA_VERSION); }
  catch (error) { context.read_errors.push("Не удалось прочитать DI3_SCHEMA_VERSION: " + (error.message || String(error))); }
  try { context.config_time_zone = di3GetConfiguredTimeZone_(); }
  catch (error) { context.read_errors.push("Некорректный DI3_APP_CONFIG.TIME_ZONE: " + (error.message || String(error))); }
  try { context.script_time_zone = di3GetScriptTimeZone_(); }
  catch (error) { context.read_errors.push("Не удалось прочитать часовой пояс Apps Script: " + (error.message || String(error))); }
  try { context.spreadsheet_time_zone = di3GetSpreadsheet_().getSpreadsheetTimeZone(); }
  catch (error) { context.read_errors.push("Не удалось прочитать часовой пояс Google Sheets: " + (error.message || String(error))); }
  var manifests = (projectFiles || []).filter(function (file) { return file && file.type === "JSON" && file.name === "appsscript"; });
  if (manifests.length !== 1) {
    context.read_errors.push("Для проверки timezone нужен ровно один фактический appsscript.json.");
  } else {
    try { context.manifest_time_zone = String(JSON.parse(String(manifests[0].source || "")).timeZone || ""); }
    catch (error) { context.read_errors.push("Фактический appsscript.json содержит некорректный JSON: " + (error.message || String(error))); }
  }
  return di3BuildGitHubInstallCompatibilityReport_(manifest, context);
}


function di3GetGitHubDeploymentConfig_() {
  var config = DI3_APP_CONFIG && DI3_APP_CONFIG.GITHUB_RELEASE ? DI3_APP_CONFIG.GITHUB_RELEASE : {};
  return {
    repository: String(config.REPOSITORY || "brusvv/dots_inventory-").trim(),
    release_channel: String(config.RELEASE_CHANNEL || "stable").trim().toLowerCase(),
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
    // GitHub API endpoints should not redirect. Fail closed rather than
    // forwarding an Authorization header to a redirect target.
    response = UrlFetchApp.fetch(url, { method: "get", headers: headers, muteHttpExceptions: true,
      followRedirects: false });
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
  var channel = String(manifest && manifest.release_channel || "");
  var sourceBranch = String(manifest && manifest.source_branch || "");
  if (channel !== "stable" && channel !== "preview" && channel !== "branch") issues.push("Некорректный release_channel в манифесте.");
  var tag = String(releaseTag || "");
  if (channel === "stable" && (sourceBranch !== "main" || !/^dots-inventory-v[0-9]+\.[0-9]+\.[0-9]+$/.test(tag))) {
    issues.push("Stable-релиз должен иметь source_branch=main и точный тег dots-inventory-vX.Y.Z.");
  }
  if (channel === "preview" && (!/^(feature|release|hotfix)\/[A-Za-z0-9._/-]+$/.test(sourceBranch) ||
      !/^dots-inventory-v[0-9]+\.[0-9]+\.[0-9]+-preview\.[0-9]+$/.test(tag))) {
    issues.push("Preview должен иметь тег dots-inventory-vX.Y.Z-preview.N и source_branch из feature/*, release/* или hotfix/*.");
  }
  if (channel === "branch") {
    try { di3ValidateGitHubBranchName_(sourceBranch); }
    catch (branchError) { issues.push(branchError.message || String(branchError)); }
  }
  if (channel !== "branch" && channel && channel !== config.release_channel) issues.push("Канал манифеста (" + channel + ") не совпадает с выбранным каналом установки (" + config.release_channel + ").");
  var repository = config.repository;
  var commit = String(manifest && manifest.git_commit || "").toLowerCase();
  if (!manifest || manifest.format !== DI3_GITHUB_RELEASE_FORMAT) issues.push("Неподдерживаемый format манифеста.");
  if (channel === "branch") {
    if (!/^[0-9a-f]{40}$/.test(commit) || tag !== "branch:" + sourceBranch + "@" + commit.slice(0, 12)) {
      issues.push("Branch snapshot должен быть привязан к точному commit SHA и выбранной ветке.");
    }
  } else if (!/^dots-inventory-v[0-9]+\.[0-9]+\.[0-9]+(-preview\.[0-9]+)?$/.test(String(releaseTag || ""))) {
    issues.push("Некорректный GitHub release tag.");
  }
  if (manifest && manifest.git_tag !== releaseTag) issues.push("git_tag манифеста не совпадает с GitHub Release.");
  if (!/^[0-9a-f]{40}$/.test(commit)) issues.push("git_commit должен быть полным SHA из 40 hex-символов.");
  if (!manifest || !Number.isSafeInteger(Number(manifest.target_schema_version)) || Number(manifest.target_schema_version) < 1) {
    issues.push("Некорректная target_schema_version.");
  }
  if (!manifest || !String(manifest.application_time_zone || "").trim()) issues.push("В манифесте отсутствует application_time_zone.");
  var minimumUpdater = String(manifest && manifest.minimum_updater_version || "").trim();
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(minimumUpdater)) issues.push("В манифесте отсутствует корректная minimum_updater_version (MAJOR.MINOR.PATCH).");
  else if (di3CompareUpdaterVersions_(DI3_GITHUB_UPDATER_VERSION, minimumUpdater) < 0) issues.push("Релиз требует минимальную версию updater " + minimumUpdater + ", текущая версия " + DI3_GITHUB_UPDATER_VERSION + ". Обнови updater отдельно перед установкой.");
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
  // Fetch signed asset URLs without credentials and validate every redirect
  // hop. A trusted first host must not be allowed to redirect to an arbitrary host.
  var currentUrl = location;
  var maxRedirects = 5;
  for (var hop = 0; hop <= maxRedirects; hop++) {
    if (!di3IsSafeGitHubAssetRedirect_(currentUrl)) {
      throw new Error("GitHub asset " + expectedName + " перенаправляет на недоверенный адрес; загрузка остановлена.");
    }
    var redirected;
    try {
      redirected = UrlFetchApp.fetch(currentUrl, {
        method: "get", headers: { Accept: "application/octet-stream" },
        muteHttpExceptions: true, followRedirects: false
      });
    } catch (error) {
      throw new Error("Не удалось скачать GitHub asset после безопасного перенаправления: " +
        (error && error.message ? error.message : String(error)));
    }
    var redirectedCode = Number(redirected.getResponseCode());
    if (redirectedCode === 200) return String(redirected.getContentText() || "");
    if ([301, 302, 303, 307, 308].indexOf(redirectedCode) === -1) {
      throw new Error("GitHub asset " + expectedName + " вернул HTTP " + redirectedCode + " после перенаправления.");
    }
    if (hop === maxRedirects) throw new Error("GitHub asset " + expectedName + " превысил лимит перенаправлений.");
    var redirectHeaders = redirected.getAllHeaders ? redirected.getAllHeaders() : {};
    var nextUrl = "";
    Object.keys(redirectHeaders || {}).some(function (key) {
      if (String(key).toLowerCase() === "location") {
        nextUrl = String(redirectHeaders[key] || "");
        return true;
      }
      return false;
    });
    if (!nextUrl || !di3IsSafeGitHubAssetRedirect_(nextUrl)) {
      throw new Error("GitHub asset " + expectedName + " перенаправляет на недоверенный адрес; загрузка остановлена.");
    }
    currentUrl = nextUrl;
  }
  throw new Error("GitHub asset " + expectedName + " остановлен: недостижимое состояние загрузчика.");
}


/** Validate a user-selected branch name before it is used in GitHub API or raw URLs. */
function di3ValidateGitHubBranchName_(branch) {
  var value = String(branch || "").trim();
  if (!/^(feature|release|hotfix)\/[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(value) ||
      value.indexOf("//") !== -1 || /(^|\/)\.{1,2}(?=\/|$)/.test(value) || value.charAt(value.length - 1) === "/") {
    throw new Error("Разрешены только ветки feature/*, release/* и hotfix/* с корректным именем.");
  }
  return value;
}

function di3GetSelectedGitHubBranchSelection_() {
  try {
    var properties = PropertiesService.getScriptProperties();
    var branch = String(properties.getProperty("DI3_GITHUB_SELECTED_BRANCH") || "").trim();
    if (!branch) return null;
    branch = di3ValidateGitHubBranchName_(branch);
    var commit = String(properties.getProperty("DI3_GITHUB_SELECTED_COMMIT") || "").trim().toLowerCase();
    if (!/^[0-9a-f]{40}$/.test(commit)) {
      throw new Error("Для выбранной ветки не сохранён полный commit SHA. Сбрось выбор ветки и выбери её заново.");
    }
    return { branch: branch, commit: commit };
  } catch (error) {
    if (String(error && error.message || "").indexOf("Разрешены только ветки") === 0 ||
        String(error && error.message || "").indexOf("Сохранённый commit") === 0) throw error;
    throw new Error("Не удалось прочитать сохранённый источник GitHub: " + (error.message || String(error)));
  }
}

function di3GetSelectedGitHubBranch_() {
  var selection = di3GetSelectedGitHubBranchSelection_();
  return selection ? selection.branch : "";
}

function di3GetGitHubSourceLabel_(channel) {
  return channel === "branch" ? "BRANCH" : (channel === "preview" ? "PREVIEW" : "STABLE");
}

function di3GitBlobSha1Hex_(source) {
  var size = Utilities.newBlob(String(source == null ? "" : source)).getBytes().length;
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_1,
    "blob " + size + String.fromCharCode(0) + String(source == null ? "" : source), Utilities.Charset.UTF_8);
  return bytes.map(function (byte) {
    var normalized = byte < 0 ? byte + 256 : byte;
    return ("0" + normalized.toString(16)).slice(-2);
  }).join("");
}

function di3BuildGitHubBranchManifestFromSources_(branch, commit, treeEntries, sourceTexts) {
  branch = di3ValidateGitHubBranchName_(branch);
  commit = String(commit || "").toLowerCase();
  if (!/^[0-9a-f]{40}$/.test(commit)) throw new Error("GitHub branch не вернул полный commit SHA.");
  if (!Array.isArray(treeEntries) || !sourceTexts || typeof sourceTexts !== "object") throw new Error("Git tree или исходники ветки неполны.");
  var updaterSource = sourceTexts["src/apps_script/43_DI3_GitHubDeploymentManager.gs"];
  var branchSelectorCapable = typeof updaterSource === "string" && /function\s+di3SelectGitHubSourceBranch\s*\(/.test(updaterSource);
  var sourceFiles = treeEntries.filter(function (entry) {
    if (!entry || entry.type !== "blob" || (entry.mode !== "100644" && entry.mode !== "100755") || !/^src\/apps_script\/[^/]+\.gs$/.test(String(entry.path || ""))) return false;
    // Older feature branches may contain an older updater. Preserve the installed
    // updater modules as local extras unless the branch explicitly carries this
    // branch-selector-aware manager and can safely replace the whole manager set.
    if (!branchSelectorCapable && /^src\/apps_script\/(4[3-6]_DI3_GitHub.*)\.gs$/.test(String(entry.path || ""))) return false;
    return true;
  });
  if (!sourceFiles.length || sourceFiles.length > 200) throw new Error("В выбранной ветке нет допустимого набора Apps Script .gs файлов (1–200).");
  sourceFiles.sort(function (a, b) { return a.path < b.path ? -1 : (a.path > b.path ? 1 : 0); });
  var files = [], seen = {};
  sourceFiles.forEach(function (entry) {
    var name = String(entry.path).slice("src/apps_script/".length);
    if (!/^[A-Za-z0-9_.-]+\.gs$/.test(name) || name.indexOf("..") !== -1) throw new Error("В Git tree найдено недопустимое имя Apps Script файла: " + name);
    var key = name.toLowerCase();
    if (seen[key]) throw new Error("В Git tree найден повтор Apps Script файла: " + name);
    seen[key] = true;
    if (typeof sourceTexts[entry.path] !== "string") throw new Error("Не удалось получить исходник " + entry.path);
    var source = sourceTexts[entry.path];
    var size = Utilities.newBlob(source).getBytes().length;
    if (Number(entry.size) !== size) throw new Error("Размер исходника не совпадает с Git tree: " + name);
    if (!/^[0-9a-f]{40}$/i.test(String(entry.sha || "")) ||
        di3GitBlobSha1Hex_(source).toLowerCase() !== String(entry.sha).toLowerCase()) {
      throw new Error("Git blob SHA-1 исходника не совпадает с выбранным commit: " + name);
    }
    files.push({ name: name, type: "SERVER_JS", source_path: entry.path,
      raw_url: "https://raw.githubusercontent.com/" + di3GetGitHubDeploymentConfig_().repository + "/" + commit + "/src/apps_script/" + encodeURIComponent(name),
      size_bytes: size, sha256: di3Sha256Hex_(source) });
  });
  var configSource = sourceTexts["src/apps_script/00_DI3_AppConfig.gs"] || "";
  var schemaSource = sourceTexts["src/apps_script/33_DI3_SchemaVersioning.gs"] || "";
  var timezoneMatch = configSource.match(/TIME_ZONE\s*:\s*["']([^"']+)["']/);
  var schemaMatch = schemaSource.match(/var\s+DI3_SCHEMA_VERSION\s*=\s*([0-9]+)\s*;/);
  if (!timezoneMatch || !schemaMatch) throw new Error("Ветка не содержит достоверные DI3_APP_CONFIG.TIME_ZONE и DI3_SCHEMA_VERSION; установка заблокирована.");
  if (branchSelectorCapable) {
    var updaterMatch = updaterSource.match(/var\s+DI3_GITHUB_UPDATER_VERSION\s*=\s*["']([^"']+)["']/);
    if (!updaterMatch || di3CompareUpdaterVersions_(updaterMatch[1], DI3_GITHUB_UPDATER_VERSION) < 0) {
      throw new Error("Выбранная ветка содержит более старый или неизвестный GitHub updater; возможен downgrade механизма обновления.");
    }
  }
  return { format: DI3_GITHUB_RELEASE_FORMAT, git_tag: "branch:" + branch + "@" + commit.slice(0, 12),
    release_channel: "branch", source_branch: branch, git_commit: commit,
    target_schema_version: Number(schemaMatch[1]), application_time_zone: timezoneMatch[1],
    minimum_updater_version: DI3_GITHUB_UPDATER_VERSION,
    manifest_policy: "PRESERVE_TARGET_PROJECT_MANIFEST", source_policy: "PINNED_COMMIT_RAW_FILES", files: files };
}

function di3GetGitHubBranchManifest_(branch, pinnedCommit) {
  var config = di3GetGitHubDeploymentConfig_();
  branch = di3ValidateGitHubBranchName_(branch);
  var apiBase = "https://api.github.com/repos/" + config.repository;
  var commit = String(pinnedCommit || "").trim().toLowerCase();
  if (!commit) {
    var branchPath = encodeURIComponent(branch);
    var branchResult = di3FetchGitHubJson_(apiBase + "/branches/" + branchPath);
    if (branchResult.status !== "OK" || !branchResult.data || String(branchResult.data.name || "") !== branch) {
      throw new Error("Ветка " + branch + " не найдена в GitHub или недоступна.");
    }
    commit = String(branchResult.data.commit && branchResult.data.commit.sha || "").toLowerCase();
  }
  if (!/^[0-9a-f]{40}$/.test(commit)) throw new Error("GitHub вернул некорректный commit SHA для ветки " + branch + ".");
  var commitResult = di3FetchGitHubJson_(apiBase + "/git/commits/" + commit);
  if (commitResult.status !== "OK" || !commitResult.data || String(commitResult.data.sha || "").toLowerCase() !== commit) {
    throw new Error("Не удалось проверить commit выбранной ветки.");
  }
  var treeSha = String(commitResult.data.tree && commitResult.data.tree.sha || "");
  if (!/^[0-9a-f]{40}$/i.test(treeSha)) throw new Error("GitHub commit не содержит корректный tree SHA.");
  var treeResult = di3FetchGitHubJson_(apiBase + "/git/trees/" + treeSha + "?recursive=1");
  if (treeResult.status !== "OK" || !treeResult.data || !Array.isArray(treeResult.data.tree) || treeResult.data.truncated) {
    throw new Error("Git tree выбранной ветки неполон или превышает лимит GitHub API; установка заблокирована.");
  }
  var entries = treeResult.data.tree.filter(function (entry) {
    return entry && /^src\/apps_script\/[^/]+\.gs$/.test(String(entry.path || ""));
  });
  if (!entries.length || entries.length > 200) {
    throw new Error("В Git tree должно быть от 1 до 200 корневых Apps Script .gs файлов; загрузка остановлена до скачивания исходников.");
  }
  var seenNames = {};
  var totalSourceBytes = 0;
  entries.forEach(function (entry) {
    var name = String(entry.path).slice("src/apps_script/".length);
    if (entry.type !== "blob" || (entry.mode !== "100644" && entry.mode !== "100755")) {
      throw new Error("Недопустимый тип Git tree entry для Apps Script файла " + name + "; разрешены только обычные файлы.");
    }
    if (!/^[A-Za-z0-9_.-]+\.gs$/.test(name) || name.indexOf("..") !== -1) {
      throw new Error("Недопустимый путь Apps Script файла в Git tree: " + name);
    }
    var key = name.toLowerCase();
    if (seenNames[key]) throw new Error("Повторяющееся имя Apps Script файла в Git tree: " + name);
    seenNames[key] = true;
    if (!/^[0-9a-f]{40}$/i.test(String(entry.sha || "")) ||
        !Number.isSafeInteger(Number(entry.size)) || Number(entry.size) < 0) {
      throw new Error("Git tree не содержит достоверные SHA/size для " + name);
    }
    totalSourceBytes += Number(entry.size);
    if (totalSourceBytes > 10000000) throw new Error("Общий размер исходников ветки превышает 10 MB; загрузка остановлена.");
  });
  var sourceTexts = {};
  entries.forEach(function (entry) {
    var name = String(entry.path).slice("src/apps_script/".length);
    var rawUrl = "https://raw.githubusercontent.com/" + config.repository + "/" + commit + "/src/apps_script/" + encodeURIComponent(name);
    var response = UrlFetchApp.fetch(rawUrl, { method: "get", headers: { Accept: "text/plain" },
      muteHttpExceptions: true, followRedirects: false });
    if (Number(response.getResponseCode()) !== 200) throw new Error("Загрузка " + name + " из выбранного commit остановлена: HTTP " + response.getResponseCode() + ".");
    sourceTexts[entry.path] = String(response.getContentText() == null ? "" : response.getContentText());
  });
  var manifest = di3BuildGitHubBranchManifestFromSources_(branch, commit, entries, sourceTexts);
  var validation = di3ValidateGitHubReleaseManifest_(manifest, manifest.git_tag);
  return { status: "READY", release: { tag_name: manifest.git_tag, name: "Branch " + branch + " @ " + commit.slice(0, 12),
    html_url: "https://github.com/" + config.repository + "/tree/" + branch,
    published_at: "", prerelease: true, channel: "branch", source_branch: branch }, manifest: manifest, validation: validation };
}

function di3SelectGitHubSourceBranch() {
  var config = di3GetGitHubDeploymentConfig_();
  var response = di3FetchGitHubJson_("https://api.github.com/repos/" + config.repository + "/branches?per_page=100");
  if (response.status !== "OK" || !Array.isArray(response.data)) throw new Error("Не удалось получить список веток GitHub.");
  var allowed = response.data.map(function (item) { return String(item && item.name || ""); })
    .filter(function (name) { try { di3ValidateGitHubBranchName_(name); return true; } catch (ignore) { return false; } });
  if (!allowed.length) throw new Error("В репозитории нет веток feature/*, release/* или hotfix/*.");
  var ui = SpreadsheetApp.getUi(), current = di3GetSelectedGitHubBranch_();
  var prompt = ui.prompt("GitHub · выбор ветки",
    "Введи точное имя ветки. Доступные ветки (первые 40):\n" + allowed.slice(0, 40).join("\n") +
      (allowed.length > 40 ? "\n… и ещё " + (allowed.length - 40) : "") +
      (current ? "\n\nСейчас выбрана: " + current : "") +
      "\n\nВетка будет закреплена за текущим commit SHA. Перед установкой потребуются preview, backup и YES.",
    ui.ButtonSet.OK_CANCEL);
  if (prompt.getSelectedButton() !== ui.Button.OK) return { status: "CANCELLED" };
  var selected = di3ValidateGitHubBranchName_(prompt.getResponseText());
  if (allowed.indexOf(selected) === -1) throw new Error("Ветка отсутствует в полученном списке GitHub. Обнови список и повтори выбор.");
  var result = di3GetGitHubBranchManifest_(selected);
  PropertiesService.getScriptProperties().setProperties({
    DI3_GITHUB_SELECTED_BRANCH: selected,
    DI3_GITHUB_SELECTED_COMMIT: result.manifest.git_commit
  });
  ui.alert("GitHub · источник выбран", "Ветка: " + selected + "\nCommit: " + result.manifest.git_commit +
    "\nСхема: v" + result.manifest.target_schema_version + "\nЧасовой пояс: " + result.manifest.application_time_zone +
    "\n\nПроверка, preview и установка будут использовать этот commit ветки. Это не опубликованный Stable/Preview релиз.",
    ui.ButtonSet.OK);
  return { status: "SELECTED", branch: selected, commit: result.manifest.git_commit };
}

function di3ClearGitHubSourceBranchSelection() {
  PropertiesService.getScriptProperties().deleteProperty("DI3_GITHUB_SELECTED_BRANCH");
  PropertiesService.getScriptProperties().deleteProperty("DI3_GITHUB_SELECTED_COMMIT");
  var channel = di3GetGitHubDeploymentConfig_().release_channel.toUpperCase();
  try { SpreadsheetApp.getUi().alert("GitHub · источник сброшен",
    "Выбор ветки удалён. Теперь используется настроенный канал " + channel + ".", SpreadsheetApp.getUi().ButtonSet.OK); }
  catch (ignoreUi) {}
  return { status: "CLEARED", release_channel: channel };
}

function di3GetLatestGitHubReleaseManifest_() {
  var config = di3GetGitHubDeploymentConfig_();
  if (config.repository.split("/").length !== 2 || !/^[A-Za-z0-9_.-]+$/.test(config.repository.split("/")[0]) || !/^[A-Za-z0-9_.-]+$/.test(config.repository.split("/")[1])) throw new Error("Некорректный DI3_APP_CONFIG.GITHUB_RELEASE.REPOSITORY.");
  var selectedBranch = di3GetSelectedGitHubBranchSelection_();
  if (selectedBranch) return di3GetGitHubBranchManifest_(selectedBranch.branch, selectedBranch.commit);
  if (config.release_channel !== "stable" && config.release_channel !== "preview") throw new Error("GITHUB_RELEASE.RELEASE_CHANNEL должен быть stable или preview.");
  var apiBase = "https://api.github.com/repos/" + config.repository;
  var release;
  if (config.release_channel === "stable") {
    var stableResult = di3FetchGitHubJson_(apiBase + "/releases/latest");
    if (stableResult.status === "NOT_FOUND") return { status: "NO_RELEASE", message: "Опубликованный Stable-релиз не найден." };
    release = stableResult.data;
    if (!release || release.draft || release.prerelease) throw new Error("GitHub latest release не является стабильным релизом.");
  } else {
    var listResult = di3FetchGitHubJson_(apiBase + "/releases?per_page=100");
    if (listResult.status === "NOT_FOUND" || !Array.isArray(listResult.data)) return { status: "NO_RELEASE", message: "Список GitHub Releases недоступен или Preview-релизов пока нет." };
    var previews = listResult.data.filter(function (item) { return item && !item.draft && item.prerelease && /^dots-inventory-v[0-9]+[.][0-9]+[.][0-9]+-preview[.][0-9]+$/.test(String(item.tag_name || "")); });
    if (!previews.length) return { status: "NO_RELEASE", message: "Опубликованный Preview-релиз не найден." };
    release = previews[0];
  }
  var assets = Array.isArray(release.assets) ? release.assets : [];
  function asset(name) {
    var matches = assets.filter(function (item) { return item && item.name === name && item.id && item.url; });
    if (matches.length !== 1) throw new Error("В релизе должен находиться ровно один asset " + name + ".");
    return matches[0];
  }
  var manifestText = di3FetchGitHubAsset_(asset("release-manifest.json"), "release-manifest.json");
  var checksumText = di3FetchGitHubAsset_(asset("release-manifest.asset.sha256"), "release-manifest.asset.sha256");
  var checksumMatch = checksumText.trim().match(/^([0-9a-f]{64})\s+\*?.*release-manifest[.]json$/i);
  if (!checksumMatch) throw new Error("Файл release-manifest.asset.sha256 имеет неизвестный формат.");
  if (di3Sha256Hex_(manifestText).toLowerCase() !== checksumMatch[1].toLowerCase()) throw new Error("SHA-256 release-manifest.json не совпадает с контрольной суммой из релиза.");
  var manifest;
  try { manifest = JSON.parse(manifestText); } catch (error) { throw new Error("release-manifest.json содержит некорректный JSON: " + (error.message || String(error))); }
  var validation = di3ValidateGitHubReleaseManifest_(manifest, release.tag_name);
  if (Boolean(release.prerelease) !== (manifest.release_channel === "preview")) throw new Error("Тип GitHub Release не совпадает с release_channel манифеста.");
  return { status: "READY", release: { tag_name: release.tag_name, name: String(release.name || release.tag_name),
    html_url: String(release.html_url || ""), published_at: String(release.published_at || ""),
    prerelease: Boolean(release.prerelease), channel: manifest.release_channel, source_branch: manifest.source_branch },
    manifest: manifest, validation: validation };
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
      muteHttpExceptions: true,
      // Never forward the OAuth bearer token through an automatic redirect.
      followRedirects: false
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
  if (content.scriptId && String(content.scriptId) !== scriptId) {
    throw new Error("Apps Script API вернул содержимое другого Script ID; операция остановлена.");
  }
  var hasManifest = content.files.some(function (file) {
    return file && file.type === "JSON" && file.name === "appsscript";
  });
  if (!hasManifest) {
    throw new Error("Apps Script API не вернул appsscript.json. Неполное содержимое проекта нельзя сравнивать или резервировать.");
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
    release_channel: releaseResult.release.channel,
    source_branch: releaseResult.release.source_branch,
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
    "Источник: " + di3GetGitHubSourceLabel_(result.release_channel) + (result.source_branch ? " · ветка: " + result.source_branch : ""),
    "Релиз: " + result.release.tag_name,
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
  var hasManifest = project.content.files.some(function (file) {
    return file && file.type === "JSON" && file.name === "appsscript";
  });
  if (!hasManifest) throw new Error("Source backup остановлен: в содержимом проекта отсутствует appsscript.json.");
  var backupNames = {};
  var files = project.content.files.map(function (file) {
    var name = String(file.name || "");
    var type = String(file.type || "");
    var key = name.toLowerCase();
    if (!name || !type || typeof file.source !== "string") {
      throw new Error("Нельзя создать backup: файл проекта имеет неполные метаданные или не содержит source.");
    }
    if (backupNames[key]) throw new Error("Нельзя создать backup: дублирующееся имя файла между типами " + name + ".");
    backupNames[key] = true;
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
    var key = String(file.name || "").toLowerCase();
    if (!file.name || !file.type || typeof file.source !== "string" || seen[key]) {
      throw new Error("Apps Script source backup содержит некорректный или дублирующийся файл (имя должно быть уникальным между типами).");
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
