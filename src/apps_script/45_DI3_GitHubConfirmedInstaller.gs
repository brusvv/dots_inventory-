/**
 * Dots Inventory — explicitly confirmed GitHub Apps Script installer.
 *
 * This is the only module in the release manager that calls projects.updateContent.
 * It always verifies a Drive source backup and asks for an explicit YES before
 * replacing the complete Apps Script project file set. It never deploys a version,
 * runs setup, migrates schema, rebuilds FIFO or changes spreadsheet data.
 */
var DI3_GITHUB_INSTALL_FORMAT = "dots-inventory-confirmed-install/v1";

function di3AppsScriptFilesFingerprint_(files) {
  if (!Array.isArray(files) || !files.length) throw new Error("Нельзя вычислить fingerprint пустого набора файлов Apps Script.");
  var seen = {};
  var normalized = files.map(function (file) {
    if (!file || !String(file.name || "").trim() || !String(file.type || "").trim() || typeof file.source !== "string") {
      throw new Error("Fingerprint остановлен: файл Apps Script имеет неполные поля.");
    }
    var name = String(file.name), type = String(file.type);
    var key = type + "|" + name.toLowerCase();
    if (seen[key]) throw new Error("Fingerprint остановлен: дублирующийся файл " + name + " (" + type + ").");
    seen[key] = true;
    return { name: name, type: type, source: file.source };
  });
  normalized.sort(function (a, b) {
    var ak = a.type.toLowerCase() + "|" + a.name.toLowerCase();
    var bk = b.type.toLowerCase() + "|" + b.name.toLowerCase();
    return ak < bk ? -1 : ak > bk ? 1 : 0;
  });
  return di3Sha256Hex_(JSON.stringify(normalized));
}

function di3VerifyInstallBackupMatches_(envelope, expectedScriptId, expectedFingerprint) {
  var verified = di3VerifyAppsScriptSourceBackupEnvelope_(envelope);
  if (String(verified.script_id) !== String(expectedScriptId)) {
    throw new Error("Резервная копия относится к другому Script ID; установка заблокирована.");
  }
  var backupFingerprint = di3AppsScriptFilesFingerprint_(envelope.payload.files);
  if (backupFingerprint !== expectedFingerprint) {
    throw new Error("Содержимое резервной копии не совпадает с исходным проектом; установка заблокирована.");
  }
  return { status: "VERIFIED", script_id: verified.script_id, file_count: verified.file_count, fingerprint: backupFingerprint };
}

function di3ReadAndVerifyInstallBackup_(backup, expectedScriptId, expectedFingerprint) {
  if (!backup || backup.status !== "VERIFIED" || !backup.file_id) {
    throw new Error("Установка заблокирована: резервная копия Apps Script не подтверждена.");
  }
  var file;
  try { file = DriveApp.getFileById(String(backup.file_id)); }
  catch (error) { throw new Error("Не удалось повторно открыть source backup в Drive: " + (error.message || String(error))); }
  var text = file.getBlob().getDataAsString("UTF-8");
  var envelope;
  try { envelope = JSON.parse(text); }
  catch (error) { throw new Error("Source backup в Drive содержит некорректный JSON; установка заблокирована."); }
  var verified = di3VerifyInstallBackupMatches_(envelope, expectedScriptId, expectedFingerprint);
  if (String(file.getName()) !== String(backup.file_name || "")) {
    throw new Error("Имя файла резервной копии изменилось после создания; установка заблокирована.");
  }
  return { file_id: backup.file_id, file_name: file.getName(), url: file.getUrl(), verification: verified };
}

function di3AssertAppsScriptContentMatches_(expectedFiles, actualFiles) {
  var expected = di3AppsScriptFilesFingerprint_(expectedFiles);
  var actual = di3AppsScriptFilesFingerprint_(actualFiles);
  if (expected !== actual) {
    throw new Error("Проверка после записи не пройдена: фактический набор файлов Apps Script отличается от подготовленного. Резервная копия сохранена; автоматический откат не выполнялся.");
  }
  return { status: "VERIFIED", file_count: actualFiles.length, fingerprint: actual };
}

function di3UpdateAppsScriptProjectContent_(scriptId, files) {
  if (!scriptId || !Array.isArray(files) || !files.length) throw new Error("projects.updateContent: Script ID или полный набор файлов отсутствует.");
  var token = "";
  try { token = String(ScriptApp.getOAuthToken() || ""); }
  catch (error) { throw new Error("Не удалось получить OAuth token для записи Apps Script: " + (error.message || String(error))); }
  if (!token) throw new Error("OAuth token пуст; запись Apps Script запрещена.");
  var url = "https://script.googleapis.com/v1/projects/" + encodeURIComponent(scriptId) + "/content";
  var response;
  try {
    response = UrlFetchApp.fetch(url, {
      method: "put",
      contentType: "application/json",
      payload: JSON.stringify({ files: files }),
      headers: { Authorization: "Bearer " + token, Accept: "application/json" },
      muteHttpExceptions: true
    });
  } catch (error) {
    throw new Error("Вызов Apps Script API projects.updateContent завершился ошибкой. Source backup сохранён. " +
      (error.message || String(error)));
  }
  var code = Number(response.getResponseCode());
  var body = String(response.getContentText() || "");
  if (code !== 200) {
    throw new Error("Apps Script API projects.updateContent вернул HTTP " + code +
      ". Source backup сохранён; проверь проект перед повторной попыткой. Ответ: " + body.slice(0, 700));
  }
  try { return JSON.parse(body); }
  catch (error) { throw new Error("projects.updateContent вернул HTTP 200, но некорректный JSON. Source backup сохранён; требуется ручная проверка."); }
}

function di3InstallLatestGitHubReleaseWithConfirmation() {
  var preview = di3PrepareGitHubInstallPreview();
  if (!preview || preview.status !== "PREVIEW_READY") return { status: "BLOCKED", reason: "PREVIEW_NOT_READY", preview: preview || null };
  if (preview.summary.removed !== 0) throw new Error("Установка заблокирована: preview содержит удаления файлов.");

  // Capture a fresh baseline and ensure it is exactly the project used by preview.
  var baseline = di3GetAppsScriptProjectContent_();
  var baselineFingerprint = di3AppsScriptFilesFingerprint_(baseline.content.files);
  if (baseline.script_id !== preview.project_id || baselineFingerprint !== preview.source_project_fingerprint) {
    throw new Error("Проект изменился после предварительного просмотра. Повтори preview; резервная копия и установка не выполнялись.");
  }

  // The existing D-04 routine writes a source snapshot, reads it back and verifies
  // every source hash. Reopen that exact Drive file and compare it to our baseline.
  var backup = di3CreateAppsScriptSourceBackup();
  var verifiedBackup = di3ReadAndVerifyInstallBackup_(backup, baseline.script_id, baselineFingerprint);

  var ui = SpreadsheetApp.getUi();
  var changedNames = preview.diff.added.concat(preview.diff.changed);
  var message = [
    "Релиз: " + preview.release_tag,
    "Commit: " + preview.commit,
    "Проект: " + baseline.script_id,
    "Файлов в полном наборе: " + preview.summary.target_file_count,
    "Новых: " + preview.summary.added + " · изменённых: " + preview.summary.changed +
      " · без изменений: " + preview.summary.unchanged,
    "Сохранено локальных модулей: " + preview.summary.preserved_unmanaged,
    "Сохранено файлов других типов: " + preview.summary.preserved_non_server,
    "Удалений: 0",
    "",
    "Проверенная резервная копия: " + verifiedBackup.file_name,
    "Drive: " + verifiedBackup.url,
    "",
    "Подтверждение заменит ПОЛНОСТЬЮ всё содержимое проекта Apps Script указанным набором файлов.",
    "После записи будет выполнено повторное чтение и сравнение каждого файла.",
    "Развёртывания версий, миграции схемы, setup и перестройка FIFO не запускаются.",
    "",
    "Файлы к добавлению/замене:",
    changedNames.length ? changedNames.slice(0, 30).join("\n") : "Нет — исходники уже совпадают.",
    "",
    "Продолжить установку?"
  ].join("\n");
  var answer = ui.alert("GitHub · подтверждение установки", message, ui.ButtonSet.YES_NO);
  if (answer !== ui.Button.YES) {
    return { status: "CANCELLED", write_performed: false, backup: verifiedBackup, release_tag: preview.release_tag };
  }

  // Last-moment concurrency guard: do not overwrite edits made while the dialog
  // was open, and do not proceed if the project identity changed.
  var immediatelyBeforeWrite = di3GetAppsScriptProjectContent_();
  if (immediatelyBeforeWrite.script_id !== baseline.script_id ||
      di3AppsScriptFilesFingerprint_(immediatelyBeforeWrite.content.files) !== baselineFingerprint) {
    throw new Error("Установка отменена: Apps Script проект изменился после подтверждения резервной копии. Повтори preview и подтверждение.");
  }

  var updateResult;
  try {
    updateResult = di3UpdateAppsScriptProjectContent_(baseline.script_id, preview.target_files);
  } catch (updateError) {
    var updateFailure = {
      status: "UPDATE_RESULT_UNCERTAIN",
      write_performed: "UNKNOWN",
      backup: verifiedBackup,
      release_tag: preview.release_tag,
      error: updateError.message || String(updateError)
    };
    try { ui.alert("GitHub · результат записи не подтверждён", updateFailure.error +
      "\nНе запускай установку повторно, пока не проверишь текущее содержимое проекта.\nРезервная копия: " +
      verifiedBackup.url, ui.ButtonSet.OK); } catch (ignoreUpdateAlert) {}
    return updateFailure;
  }

  var after;
  try {
    after = di3GetAppsScriptProjectContent_();
  } catch (readAfterError) {
    var readFailure = {
      status: "POST_WRITE_VERIFICATION_UNAVAILABLE",
      write_performed: true,
      backup: verifiedBackup,
      release_tag: preview.release_tag,
      error: readAfterError.message || String(readAfterError)
    };
    try { ui.alert("GitHub · не удалось проверить результат", readFailure.error +
      "\nЗапись была принята API, но повторное чтение не удалось. Резервная копия: " +
      verifiedBackup.url, ui.ButtonSet.OK); } catch (ignoreReadAfterAlert) {}
    return readFailure;
  }
  if (after.script_id !== baseline.script_id) {
    var wrongProjectError = "После записи API вернул другой Script ID.";
    try { ui.alert("GitHub · требуется проверка", wrongProjectError +
      "\\nРезервная копия: " + verifiedBackup.url, ui.ButtonSet.OK); } catch (ignoreWrongProjectAlert) {}
    return { status: "POST_WRITE_VERIFICATION_FAILED", write_performed: true, backup: verifiedBackup,
      release_tag: preview.release_tag, error: wrongProjectError };
  }
  var verification;
  try { verification = di3AssertAppsScriptContentMatches_(preview.target_files, after.content.files); }
  catch (verifyError) {
    try { ui.alert("GitHub · требуется проверка", (verifyError.message || String(verifyError)) +
      "\nРезервная копия: " + verifiedBackup.url, ui.ButtonSet.OK); } catch (ignoreVerifyAlert) {}
    return { status: "POST_WRITE_VERIFICATION_FAILED", write_performed: true, backup: verifiedBackup,
      release_tag: preview.release_tag, error: verifyError.message || String(verifyError) };
  }

  try {
    PropertiesService.getScriptProperties().setProperty("DI3_INSTALLED_RELEASE_TAG", preview.release_tag);
    PropertiesService.getScriptProperties().setProperty("DI3_INSTALLED_RELEASE_COMMIT", preview.commit);
  } catch (ignoreInstalledTag) {}
  var result = {
    status: "INSTALLED_AND_VERIFIED",
    write_performed: true,
    release_tag: preview.release_tag,
    commit: preview.commit,
    project_id: baseline.script_id,
    file_count: verification.file_count,
    fingerprint: verification.fingerprint,
    backup: verifiedBackup,
    api_update_time: updateResult.updateTime || null,
    verification: verification
  };
  try {
    ui.alert("GitHub · установка проверена", "Исходники релиза установлены и повторно сверены с Apps Script API.\n" +
      "Релиз: " + result.release_tag + "\nФайлов: " + result.file_count +
      "\nРезервная копия: " + verifiedBackup.url +
      "\n\nНикакое развёртывание или изменение данных таблицы не выполнялось.", ui.ButtonSet.OK);
  } catch (ignoreSuccessAlert) {}
  return result;
}

function di3InstallLatestGitHubReleaseFromMenu() {
  return di3InstallLatestGitHubReleaseWithConfirmation();
}
