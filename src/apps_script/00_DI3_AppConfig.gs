/**
 * Dots Inventory v3 — single application configuration entry point.
 *
 * To change the business time zone, edit TIME_ZONE here, then run
 * `node node/sync_manifest_timezone.js` to synchronize the required Apps Script
 * manifest field. All runtime date formatting, document numbering and setup
 * read this value; setup also synchronizes the spreadsheet timezone.
 */
var DI3_APP_CONFIG = Object.freeze({
  TIME_ZONE: "Europe/Moscow",
  OPERATION_RECOVERY: Object.freeze({
    MAX_ATTEMPTS: 5,
    RETRY_BASE_DELAY_MS: 30000,
    RETRY_MAX_DELAY_MS: 1800000,
    STALE_ATTEMPT_MS: 900000
  }),
  BACKUP: Object.freeze({
    FOLDER_NAME: "Dots Inventory Backups",
    FILE_PREFIX: "DotsInventoryV3_BACKUP_",
    VERIFY_CHUNK_ROWS: 100,
    FULL_HASH_MAX_CELLS_PER_SHEET: 250000,
    FULL_HASH_MAX_CELLS_TOTAL: 750000
  }),
  GITHUB_RELEASE: Object.freeze({
    REPOSITORY: "brusvv/dots_inventory-",
    // stable = only verified main releases; preview = prereleases from feature/release branches.
    RELEASE_CHANNEL: "stable",
    TOKEN_PROPERTY: "DI3_GITHUB_READ_TOKEN",
    SOURCE_BACKUP_PREFIX: "DotsInventory_AppsScript_Source_",
    MAX_SOURCE_BACKUP_BYTES: 10000000
  })
});

function di3GetConfiguredTimeZone_() {
  var value = String(DI3_APP_CONFIG && DI3_APP_CONFIG.TIME_ZONE || "").trim();
  if (!value) throw new Error("DI3_APP_CONFIG.TIME_ZONE не задан. Укажи часовой пояс IANA, например Europe/Moscow.");
  try {
    Utilities.formatDate(new Date(), value, "yyyy-MM-dd HH:mm:ss");
  } catch (error) {
    throw new Error("Некорректный часовой пояс DI3_APP_CONFIG.TIME_ZONE: " + value + ". Используй идентификатор IANA, например Europe/Helsinki. " + (error.message || String(error)));
  }
  return value;
}

function di3GetScriptTimeZone_() {
  try {
    return typeof Session.getScriptTimeZone === "function" ? String(Session.getScriptTimeZone() || "") : "";
  } catch (error) {
    return "";
  }
}

/** Read-only timezone preflight. Spreadsheet timezone is synchronized by setup;
 * Apps Script manifest timezone must be edited by the project owner. */
function di3PreflightTimeZoneConfig_() {
  var issues = [];
  var warnings = [];
  var plannedChanges = [];
  var configured = "";
  try { configured = di3GetConfiguredTimeZone_(); }
  catch (error) { issues.push(error.message || String(error)); }

  var scriptTimeZone = di3GetScriptTimeZone_();
  if (configured && scriptTimeZone && scriptTimeZone !== configured) {
    issues.push("Часовой пояс проекта Apps Script (appsscript.json): " + scriptTimeZone + ". Он должен совпадать с DI3_APP_CONFIG.TIME_ZONE: " + configured + ". Измени поле timeZone в манифесте перед установкой.");
  } else if (configured && !scriptTimeZone) {
    warnings.push("Не удалось прочитать часовой пояс проекта Apps Script. Проверь appsscript.json: timeZone должен быть " + configured + ".");
  }

  var spreadsheetTimeZone = "";
  try { spreadsheetTimeZone = di3GetSpreadsheet_().getSpreadsheetTimeZone(); } catch (ignoreSpreadsheetTimeZone) {}
  if (configured && spreadsheetTimeZone && spreadsheetTimeZone !== configured) {
    plannedChanges.push({ type: "SET_SPREADSHEET_TIME_ZONE", from: spreadsheetTimeZone, to: configured });
    warnings.push("Часовой пояс таблицы будет синхронизирован с DI3_APP_CONFIG.TIME_ZONE: " + spreadsheetTimeZone + " → " + configured + ".");
  }
  return {
    status: issues.length ? "BLOCKED" : "READY",
    configured_time_zone: configured,
    script_time_zone: scriptTimeZone,
    spreadsheet_time_zone: spreadsheetTimeZone,
    issues: issues, warnings: warnings, planned_changes: plannedChanges
  };
}

function di3ShowTimeZoneConfiguration() {
  var report = di3PreflightTimeZoneConfig_();
  var message = "Конфигурация: " + (report.configured_time_zone || "не задана") +
    " · проект: " + (report.script_time_zone || "неизвестен") +
    " · таблица: " + (report.spreadsheet_time_zone || "неизвестен") +
    (report.issues.length ? " · BLOCKED: " + report.issues.join("; ") : " · READY");
  try { di3GetSpreadsheet_().toast(message, "Часовой пояс", 10); } catch (ignoreToast) {}
  return report;
}
