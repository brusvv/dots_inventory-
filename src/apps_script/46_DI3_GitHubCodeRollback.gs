/**
 * Dots Inventory — explicitly confirmed Apps Script code rollback (D-06).
 *
 * Rollback restores a verified D-04 source snapshot. The target project's
 * current appsscript.json is deliberately preserved to avoid silently changing
 * OAuth scopes, timezone or runtime settings. No deployment or spreadsheet data
 * is restored by this operation.
 */
var DI3_GITHUB_ROLLBACK_FORMAT = "dots-inventory-code-rollback/v1";
var DI3_SOURCE_BACKUP_DESCRIPTION_PREFIX = "DI3_APPS_SCRIPT_SOURCE_BACKUP_V1:";

function di3BuildRollbackTargetFiles_(envelope, currentProject) {
  if (!currentProject || !currentProject.script_id || !currentProject.content ||
      !Array.isArray(currentProject.content.files) || !currentProject.content.files.length) {
    throw new Error("Откат заблокирован: текущее содержимое Apps Script проекта неполное.");
  }
  var verified = di3VerifyAppsScriptSourceBackupEnvelope_(envelope);
  if (String(verified.script_id) !== String(currentProject.script_id)) {
    throw new Error("Откат заблокирован: резервная копия принадлежит другому Script ID.");
  }
  var backupFiles = envelope.payload.files.map(function (file) {
    return { name: String(file.name), type: String(file.type), source: String(file.source) };
  });
  var currentFiles = currentProject.content.files;
  var backupManifests = backupFiles.filter(function (file) { return file.type === "JSON" && file.name === "appsscript"; });
  var currentManifests = currentFiles.filter(function (file) { return file.type === "JSON" && file.name === "appsscript"; });
  if (backupManifests.length !== 1 || currentManifests.length !== 1) {
    throw new Error("Откат заблокирован: нужен ровно один фактический appsscript.json в backup и целевом проекте.");
  }
  // Preserve the current target manifest, including its currently authorized
  // OAuth scopes. All other files are restored exactly as recorded in backup.
  var currentManifest = currentManifests[0];
  var target = backupFiles.map(function (file) {
    if (file.type === "JSON" && file.name === "appsscript") {
      return { name: currentManifest.name, type: "JSON", source: String(currentManifest.source) };
    }
    return file;
  });
  var fingerprint = di3AppsScriptFilesFingerprint_(target);
  return {
    format: DI3_GITHUB_ROLLBACK_FORMAT,
    status: "ROLLBACK_PREVIEW_READY",
    target_files: target,
    target_fingerprint: fingerprint,
    backup_fingerprint: di3AppsScriptFilesFingerprint_(backupFiles),
    preserved_current_manifest: true,
    target_file_count: target.length,
    restored_file_count: target.length - 1
  };
}

function di3ReadVerifiedRollbackBackup_(fileId, expectedScriptId) {
  var id = String(fileId || "").trim();
  if (!/^[A-Za-z0-9_-]{10,}$/.test(id)) throw new Error("Укажи корректный ID файла source backup из Google Drive.");
  var file;
  try { file = DriveApp.getFileById(id); }
  catch (error) { throw new Error("Не удалось открыть backup в Google Drive: " + (error.message || String(error))); }
  var config = di3GetGitHubDeploymentConfig_();
  var fileName = String(file.getName() || "");
  if (fileName.indexOf(config.source_backup_prefix) !== 0) {
    throw new Error("Выбранный файл не имеет ожидаемого префикса Apps Script source backup.");
  }
  var description = String(file.getDescription() || "");
  if (description.indexOf(DI3_SOURCE_BACKUP_DESCRIPTION_PREFIX) !== 0) {
    throw new Error("В описании файла отсутствует маркер VERIFIED Apps Script source backup.");
  }
  var metadata;
  try { metadata = JSON.parse(description.slice(DI3_SOURCE_BACKUP_DESCRIPTION_PREFIX.length)); }
  catch (error) { throw new Error("Метаданные source backup повреждены."); }
  if (!metadata || metadata.status !== "VERIFIED" || String(metadata.script_id) !== String(expectedScriptId)) {
    throw new Error("Метаданные backup не подтверждают VERIFIED статус для текущего Script ID.");
  }
  var parents = file.getParents();
  var expectedFolderId = di3GetBackupFolder_().getId();
  var inExpectedFolder = false;
  while (parents.hasNext()) {
    if (String(parents.next().getId()) === String(expectedFolderId)) inExpectedFolder = true;
  }
  if (!inExpectedFolder) throw new Error("Source backup находится вне папки резервных копий Dots Inventory.");
  var envelope;
  try { envelope = JSON.parse(file.getBlob().getDataAsString("UTF-8")); }
  catch (error) { throw new Error("Файл source backup содержит некорректный JSON."); }
  var verified = di3VerifyAppsScriptSourceBackupEnvelope_(envelope);
  if (verified.status !== "VERIFIED" || String(verified.script_id) !== String(expectedScriptId) ||
      Number(metadata.file_count) !== verified.file_count || metadata.payload_sha256 !== envelope.payload_sha256) {
    throw new Error("Файл backup не прошёл сверку с VERIFIED метаданными.");
  }
  return { file_id: id, file_name: fileName, url: file.getUrl(), envelope: envelope,
    verification: verified, created_at_utc: envelope.payload.created_at_utc,
    payload_sha256: envelope.payload_sha256 };
}

function di3AssertRollbackBackupUnchanged_(initialBackup, recheckedBackup) {
  if (!initialBackup || !recheckedBackup ||
      String(initialBackup.file_id) !== String(recheckedBackup.file_id) ||
      String(initialBackup.file_name) !== String(recheckedBackup.file_name) ||
      String(initialBackup.payload_sha256 || initialBackup.envelope && initialBackup.envelope.payload_sha256 || "") !==
        String(recheckedBackup.payload_sha256 || recheckedBackup.envelope && recheckedBackup.envelope.payload_sha256 || "") ||
      String(initialBackup.verification && initialBackup.verification.script_id || initialBackup.envelope && initialBackup.envelope.payload && initialBackup.envelope.payload.script_id || "") !==
        String(recheckedBackup.verification && recheckedBackup.verification.script_id || recheckedBackup.envelope && recheckedBackup.envelope.payload && recheckedBackup.envelope.payload.script_id || "")) {
    throw new Error("Откат остановлен: выбранная резервная копия изменилась после подтверждения. Повтори выбор backup.");
  }
  return true;
}

function di3RollbackAppsScriptCodeWithConfirmation() {
  var ui = SpreadsheetApp.getUi();
  var prompt = ui.prompt("GitHub · откат кода Apps Script",
    "Вставь ID проверенной резервной копии Apps Script из папки Dots Inventory Backups. " +
    "ID находится в URL файла Drive. Откат не восстанавливает данные таблицы, триггеры, свойства или развёртывания.",
    ui.ButtonSet.OK_CANCEL);
  if (prompt.getSelectedButton() !== ui.Button.OK) return { status: "CANCELLED", write_performed: false };
  var selectedId = String(prompt.getResponseText() || "").trim();
  var baseline = di3GetAppsScriptProjectContent_();
  var selectedBackup = di3ReadVerifiedRollbackBackup_(selectedId, baseline.script_id);
  var rollbackPreview = di3BuildRollbackTargetFiles_(selectedBackup.envelope, baseline);
  var baselineFingerprint = di3AppsScriptFilesFingerprint_(baseline.content.files);

  // Protect the current state as well: the user can return to it if the rollback
  // was selected incorrectly. Verify that this D-04 backup is exact.
  var currentBackup = di3CreateAppsScriptSourceBackup();
  var verifiedCurrentBackup = di3ReadAndVerifyInstallBackup_(currentBackup, baseline.script_id, baselineFingerprint);

  var message = [
    "Целевой проект: " + baseline.script_id,
    "Выбранный backup: " + selectedBackup.file_name,
    "Дата backup: " + String(selectedBackup.created_at_utc || "не указана"),
    "Файлов в восстановленном наборе: " + rollbackPreview.target_file_count,
    "Файлов из backup восстановится: " + rollbackPreview.restored_file_count,
    "Текущий appsscript.json будет сохранён без изменений.",
    "",
    "Перед откатом создана и проверена резервная копия текущего состояния:",
    verifiedCurrentBackup.file_name,
    verifiedCurrentBackup.url,
    "",
    "Откат заменит полное содержимое проекта Apps Script (кроме сохранённого текущего appsscript.json).",
    "Таблица, складские данные, триггеры и развёртывания не восстанавливаются.",
    "",
    "Продолжить откат?"
  ].join("\n");
  var answer = ui.alert("GitHub · подтверждение отката", message, ui.ButtonSet.YES_NO);
  if (answer !== ui.Button.YES) {
    return { status: "CANCELLED", write_performed: false, selected_backup: selectedBackup,
      current_backup: verifiedCurrentBackup };
  }

  // Re-open and fully revalidate the selected Drive backup after YES. This closes
  // the confirmation-dialog window in which the file, its metadata or its folder
  // membership could have changed after the initial selection.
  var recheckedSelectedBackup = di3ReadVerifiedRollbackBackup_(selectedId, baseline.script_id);
  di3AssertRollbackBackupUnchanged_(selectedBackup, recheckedSelectedBackup);
  var recheckedRollbackPreview = di3BuildRollbackTargetFiles_(recheckedSelectedBackup.envelope, baseline);
  if (recheckedRollbackPreview.target_fingerprint !== rollbackPreview.target_fingerprint) {
    throw new Error("Откат остановлен: состав выбранной резервной копии изменился после подтверждения.");
  }

  var immediatelyBeforeWrite = di3GetAppsScriptProjectContent_();
  if (immediatelyBeforeWrite.script_id !== baseline.script_id ||
      di3AppsScriptFilesFingerprint_(immediatelyBeforeWrite.content.files) !== baselineFingerprint) {
    throw new Error("Откат отменён: проект изменился после создания резервной копии. Повтори операцию.");
  }

  var updateResult;
  try {
    updateResult = di3UpdateAppsScriptProjectContent_(baseline.script_id, rollbackPreview.target_files);
  } catch (updateError) {
    var updateFailure = { status: "ROLLBACK_RESULT_UNCERTAIN", write_performed: "UNKNOWN",
      selected_backup: selectedBackup, current_backup: verifiedCurrentBackup,
      error: updateError.message || String(updateError) };
    try { ui.alert("GitHub · результат отката не подтверждён", updateFailure.error +
      "\nПроверь проект вручную. Backup текущего состояния: " + verifiedCurrentBackup.url, ui.ButtonSet.OK); } catch (ignoreRollbackUpdateAlert) {}
    return updateFailure;
  }

  var after;
  try { after = di3GetAppsScriptProjectContent_(); }
  catch (readError) {
    var readFailure = { status: "ROLLBACK_VERIFICATION_UNAVAILABLE", write_performed: true,
      selected_backup: selectedBackup, current_backup: verifiedCurrentBackup,
      error: readError.message || String(readError) };
    try { ui.alert("GitHub · не удалось проверить откат", readFailure.error +
      "\nBackup текущего состояния: " + verifiedCurrentBackup.url, ui.ButtonSet.OK); } catch (ignoreRollbackReadAlert) {}
    return readFailure;
  }
  var verification;
  try { verification = di3AssertAppsScriptContentMatches_(rollbackPreview.target_files, after.content.files); }
  catch (verifyError) {
    var verifyFailure = { status: "ROLLBACK_VERIFICATION_FAILED", write_performed: true,
      selected_backup: selectedBackup, current_backup: verifiedCurrentBackup,
      error: verifyError.message || String(verifyError) };
    try { ui.alert("GitHub · откат требует проверки", verifyFailure.error +
      "\nBackup текущего состояния: " + verifiedCurrentBackup.url, ui.ButtonSet.OK); } catch (ignoreRollbackVerifyAlert) {}
    return verifyFailure;
  }
  try {
    PropertiesService.getScriptProperties().deleteProperty("DI3_INSTALLED_RELEASE_TAG");
    PropertiesService.getScriptProperties().deleteProperty("DI3_INSTALLED_RELEASE_COMMIT");
  } catch (ignoreInstalledReleaseProperties) {}
  var result = {
    status: "ROLLED_BACK_AND_VERIFIED",
    write_performed: true,
    project_id: baseline.script_id,
    selected_backup: { file_id: selectedBackup.file_id, file_name: selectedBackup.file_name, url: selectedBackup.url },
    current_backup: verifiedCurrentBackup,
    preserved_current_manifest: true,
    file_count: verification.file_count,
    fingerprint: verification.fingerprint,
    api_update_time: updateResult.updateTime || null,
    verification: verification
  };
  try { ui.alert("GitHub · откат проверен", "Код Apps Script восстановлен и повторно сверён.\n" +
    "Файлов: " + result.file_count + "\nТекущий appsscript.json сохранён.\n" +
    "Backup состояния до отката: " + verifiedCurrentBackup.url +
    "\n\nДанные таблицы и развёртывания не затронуты.", ui.ButtonSet.OK); } catch (ignoreRollbackSuccessAlert) {}
  return result;
}

function di3RollbackAppsScriptCodeFromMenu() {
  return di3RollbackAppsScriptCodeWithConfirmation();
}
