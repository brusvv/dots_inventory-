/** Dots Inventory v3 — explicit schema version and migration journal. */
var DI3_SCHEMA_VERSION = 4;
var DI3_SCHEMA_BASELINE_MIGRATION_KEY = "RC8_SCHEMA_BASELINE_ADOPTION";
var DI3_CLEAN_BASELINE_MIGRATION_KEY = "CLEAN_FINAL_BASELINE_ADOPTION";
var DI3_SCHEMA_MIGRATION_DEFINITIONS = Object.freeze([
  { key: "RC8_SUPPLY_PLANNING_DATES_V2", from: 1, to: 2,
    details: "Append supplier_order_date and expected_received_date to V3_Supplies; preserve all legacy columns and rows." },
  { key: "RC8_ORDER_COMMISSION_PAYER_V3", from: 2, to: 3,
    details: "Append commission_payer to V3_Orders; backfill existing orders as BUYER to preserve the previous settlement policy." },
  { key: "RC8_ORDER_BUSINESS_DATE_V4", from: 3, to: 4,
    details: "Append business_date to V3_Orders and backfill the local calendar date from created_at without changing historical timestamps." }
]);

function di3ApplyOrderBusinessDateMigration_() {
  var sheet = di3GetSheetOrThrow_("V3_Orders");
  var expectedPrefix = DI3_TABLE_SCHEMAS.V3_Orders.slice(0, 29);
  var targetHeader = "business_date";
  if (sheet.getMaxColumns() < 30) sheet.insertColumnsAfter(sheet.getMaxColumns(), 30 - sheet.getMaxColumns());
  var actual = sheet.getRange(1, 1, 1, 30).getDisplayValues()[0].map(di3NormalizeHeader_);
  if (!expectedPrefix.every(function (header, index) { return actual[index] === header; })) {
    throw new Error("F-02 migration остановлена: V3_Orders!A:AC не соответствует проверенной схеме v3.");
  }
  if (actual[29] && actual[29] !== targetHeader) {
    throw new Error("F-02 migration остановлена: V3_Orders!AD1 занята неизвестным заголовком.");
  }
  var lastRow = sheet.getLastRow();
  var rowCount = Math.max(0, lastRow - 1);
  var createdValues = rowCount ? sheet.getRange(2, 3, rowCount, 1).getValues() : [];
  var businessRange = rowCount ? sheet.getRange(2, 30, rowCount, 1) : null;
  var businessDates = rowCount ? businessRange.getValues() : [];
  var formulas = rowCount ? businessRange.getFormulas() : [];
  if (!actual[29] && di3PreflightHasBodyValues_(sheet, 30, 1)) {
    throw new Error("F-02 migration остановлена: V3_Orders!AD содержит данные при пустом заголовке.");
  }
  if (formulas.some(function (row) { return String(row[0] || "") !== ""; })) {
    throw new Error("F-02 migration остановлена: V3_Orders!AD содержит формулы; автоматическая перезапись запрещена.");
  }
  // Validate every source timestamp before changing the header or any business row.
  createdValues.forEach(function (row, index) {
    if (!row[0]) throw new Error("F-02 migration остановлена: у заказа в строке " + (index + 2) + " отсутствует created_at.");
    di3ToDate_(row[0], "created_at заказа в строке " + (index + 2));
    if (businessDates[index][0] !== "" && businessDates[index][0] != null) {
      di3FormatBusinessDate_(businessDates[index][0]);
    }
  });
  if (!actual[29]) sheet.getRange(1, 30).setValue(targetHeader).setFontWeight("bold");
  var timezone = di3GetConfiguredTimeZone_();
  var backfilled = 0;
  var updates = businessDates.map(function (cell, index) {
    if (cell[0] !== "" && cell[0] != null) return [cell[0]];
    var createdAt = di3ToDate_(createdValues[index][0], "created_at заказа в строке " + (index + 2));
    var dateText = Utilities.formatDate(createdAt, timezone, "yyyy-MM-dd");
    backfilled++;
    return [Utilities.parseDate(dateText, timezone, "yyyy-MM-dd")];
  });
  if (backfilled) sheet.getRange(2, 30, updates.length, 1).setValues(updates);
  di3CompactSheet_(sheet, Math.max(1, lastRow), 30);
  return { status: "APPLIED", orders: rowCount, rows_backfilled: backfilled, header: targetHeader };
}
function di3GetSchemaVersion_() {
  var raw = di3GetAppMetaValue_("schema_version");
  if (raw === null || raw === undefined || String(raw).trim() === "") return 0;
  var value = Number(raw);
  if (!Number.isInteger(value) || value < 0) {
    throw new Error("Некорректное значение _AppMeta.schema_version: " + String(raw) + ". Ожидается целое неотрицательное число.");
  }
  return value;
}

function di3GetSchemaMigrationRows_() {
  return di3ReadTableValues_("SchemaMigrations").map(function (values, index) {
    return {
      row_number: index + 2,
      migration_id: String(values[0] || ""),
      migration_key: String(values[1] || ""),
      from_schema_version: Number(values[2]),
      to_schema_version: Number(values[3]),
      status: String(values[4] || ""),
      started_at: values[5] || "",
      completed_at: values[6] || "",
      backup_file_id: String(values[7] || ""),
      details: String(values[8] || ""),
      error: String(values[9] || ""),
      actor: String(values[10] || "")
    };
  });
}

/**
 * A clean baseline is either a genuinely empty, unversioned workbook or a
 * workbook already carrying the single clean-baseline journal record.
 * Existing business rows and legacy headers can never enter this path.
 */
function di3GetCleanBaselineState_() {
  var ss = di3GetSpreadsheet_();
  var metaSheet = ss.getSheetByName("_AppMeta");
  var currentVersion = 0;
  var migrations = [];
  var issues = [];
  try { currentVersion = metaSheet ? di3GetSchemaVersion_() : 0; }
  catch (versionError) { issues.push(versionError.message || String(versionError)); }
  try {
    var migrationSheet = ss.getSheetByName("SchemaMigrations");
    migrations = migrationSheet ? di3GetSchemaMigrationRows_() : [];
  } catch (migrationError) {
    issues.push("Не удалось прочитать SchemaMigrations: " + (migrationError.message || String(migrationError)));
  }
  var cleanRows = migrations.filter(function (row) { return row.migration_key === DI3_CLEAN_BASELINE_MIGRATION_KEY; });
  var otherRows = migrations.filter(function (row) { return row.migration_key !== DI3_CLEAN_BASELINE_MIGRATION_KEY; });
  if (cleanRows.length > 1) issues.push("В SchemaMigrations обнаружены дубли CLEAN_FINAL_BASELINE_ADOPTION.");
  if (otherRows.length) issues.push("Обнаружены записи legacy-миграций; clean baseline не может использоваться.");
  var record = cleanRows.length === 1 ? cleanRows[0] : null;
  if (record && record.status !== "STARTED" && record.status !== "COMPLETED") issues.push("Clean baseline имеет недопустимый статус " + record.status + ".");
  if (record && (record.from_schema_version !== 0 || record.to_schema_version !== DI3_SCHEMA_VERSION)) issues.push("Параметры clean baseline не соответствуют текущей целевой версии схемы.");
  if (record && currentVersion !== 0 && currentVersion !== DI3_SCHEMA_VERSION) issues.push("schema_version не согласован с clean baseline.");
  if (record && record.status === "COMPLETED" && currentVersion !== DI3_SCHEMA_VERSION) issues.push("Завершённый clean baseline требует schema_version целевой версии.");
  if (!record && currentVersion !== 0) issues.push("Версия схемы уже установлена без записи clean baseline.");
  if (record && (!metaSheet || !ss.getSheetByName("SchemaMigrations"))) {
    issues.push("После регистрации clean baseline отсутствует обязательная таблица _AppMeta или SchemaMigrations.");
  }
  DI3_CORE_TABLE_NAMES.forEach(function (name) {
    var sheet = ss.getSheetByName(name);
    if (!sheet) {
      if (record) issues.push(name + ": системная таблица отсутствует после регистрации clean baseline.");
      return;
    }
    var expected = DI3_TABLE_SCHEMAS[name];
    var width = Math.min(expected.length, sheet.getMaxColumns());
    var actual = width ? sheet.getRange(1, 1, 1, width).getDisplayValues()[0].map(di3NormalizeHeader_) : [];
    while (actual.length < expected.length) actual.push("");
    if (sheet.getLastColumn() > expected.length) {
      issues.push(name + ": найдены данные за пределами целевой схемы.");
    }
    var blank = actual.every(function (value) { return value === ""; });
    var exact = expected.every(function (header, index) { return actual[index] === header; });
    if (record && blank) issues.push(name + ": после регистрации clean baseline строка заголовков очищена; требуется восстановить точную целевую схему.");
    else if (!blank && !exact) issues.push(name + ": обнаружена нецелостная или legacy-схема; clean baseline запрещён.");
    if (!record && sheet.getLastRow() > 1) issues.push(name + ": найдены строки данных без clean-baseline identity.");
  });
  return { eligible: issues.length === 0, current_version: currentVersion, record: record,
    migrations_count: migrations.length, issues: issues };
}

function di3GetCleanBaselineVersioningReport_(state) {
  var warnings = [];
  var planned = [];
  if (!state.record) {
    warnings.push("Обнаружена новая пустая книга. Будет зарегистрирован единый clean baseline без исторических RC8-миграций.");
    planned.push({ type: "ADOPT_CLEAN_FINAL_BASELINE", migration_key: DI3_CLEAN_BASELINE_MIGRATION_KEY,
      from_schema_version: 0, to_schema_version: DI3_SCHEMA_VERSION });
  } else if (state.record.status === "STARTED") {
    warnings.push("Clean baseline был прерван; setup повторно проверит конечные заголовки и завершит регистрацию.");
    planned.push({ type: "RESUME_CLEAN_FINAL_BASELINE", migration_key: DI3_CLEAN_BASELINE_MIGRATION_KEY,
      from_schema_version: 0, to_schema_version: DI3_SCHEMA_VERSION });
  }
  return { status: "READY", installation_path: "CLEAN_FINAL_BASELINE",
    current_version: state.current_version, target_version: DI3_SCHEMA_VERSION,
    migrations_count: state.migrations_count, baseline_migration: state.record,
    schema_migrations: [], issues: [], warnings: warnings, planned_changes: planned };
}

function di3GetSchemaVersioningReport_() {
  var issues = [];
  var warnings = [];
  var plannedChanges = [];
  var currentVersion = 0;
  var spreadsheet = di3GetSpreadsheet_();
  var metaSheet = spreadsheet.getSheetByName("_AppMeta");
  if (metaSheet) {
    try { currentVersion = di3GetSchemaVersion_(); }
    catch (error) { issues.push(error.message || String(error)); }
  }
  var migrations = [];
  if (spreadsheet.getSheetByName("SchemaMigrations")) {
    try { migrations = di3GetSchemaMigrationRows_(); }
    catch (error) { issues.push("Не удалось прочитать SchemaMigrations: " + (error.message || String(error))); }
  }
  var cleanState = di3GetCleanBaselineState_();
  if (cleanState.eligible) return di3GetCleanBaselineVersioningReport_(cleanState);
  var hasCleanBaselineIdentity = migrations.some(function (row) { return row.migration_key === DI3_CLEAN_BASELINE_MIGRATION_KEY; });
  var hasLegacyMigrationIdentity = migrations.some(function (row) {
    return row.migration_key === DI3_SCHEMA_BASELINE_MIGRATION_KEY ||
      DI3_SCHEMA_MIGRATION_DEFINITIONS.some(function (definition) { return row.migration_key === definition.key; });
  });
  if (hasCleanBaselineIdentity || (currentVersion === 0 && !hasLegacyMigrationIdentity)) {
    issues.push("Книга не прошла проверку clean baseline и не имеет подтверждённой legacy migration identity. Автоматическая установка/миграция заблокирована; данные и заголовки не будут изменены.");
    cleanState.issues.forEach(function (issue) { issues.push(issue); });
    return { status: "BLOCKED", installation_path: "UNRECOGNIZED_OR_DAMAGED",
      current_version: currentVersion, target_version: DI3_SCHEMA_VERSION,
      migrations_count: migrations.length, baseline_migration: null, schema_migrations: [],
      issues: issues, warnings: warnings, planned_changes: [] };
  }
  var baselineRows = migrations.filter(function (row) { return row.migration_key === DI3_SCHEMA_BASELINE_MIGRATION_KEY; });
  var baseline = baselineRows.length === 1 ? baselineRows[0] : null;
  if (baselineRows.length > 1) issues.push("В SchemaMigrations обнаружены дубли записей базовой миграции схемы.");
  if (currentVersion > DI3_SCHEMA_VERSION) {
    issues.push("Книга создана более новой версией схемы (" + currentVersion + "), чем поддерживает этот код (" + DI3_SCHEMA_VERSION + "). Установка заблокирована.");
  }
  if (currentVersion >= 1 && !baseline) issues.push("schema_version установлен, но запись базовой миграции отсутствует. Требуется ручная сверка журнала миграций.");
  if (baseline && baseline.status !== "COMPLETED" && baseline.status !== "STARTED") {
    issues.push("Базовая миграция схемы имеет статус " + baseline.status + ". Автоматическое продолжение небезопасно.");
  }
  if (baseline && baseline.status === "STARTED") warnings.push("Базовая миграция схемы прервана; setup безопасно завершит её.");
  if (currentVersion === 0) {
    if (!baseline) {
      warnings.push("Версия схемы ещё не зарегистрирована. После проверки будет создан baseline v1 и применены последовательные миграции.");
      plannedChanges.push({ type: "INITIALIZE_SCHEMA_VERSION", migration_key: DI3_SCHEMA_BASELINE_MIGRATION_KEY, from_schema_version: 0, to_schema_version: 1 });
    } else if (baseline.status === "STARTED") {
      plannedChanges.push({ type: "RESUME_SCHEMA_MIGRATION", migration_key: DI3_SCHEMA_BASELINE_MIGRATION_KEY, from_schema_version: 0, to_schema_version: 1 });
    }
  }
  if (currentVersion < DI3_SCHEMA_VERSION) {
    DI3_SCHEMA_MIGRATION_DEFINITIONS.forEach(function (definition) {
      var matches = migrations.filter(function (row) { return row.migration_key === definition.key; });
      if (matches.length > 1) {
        issues.push("В SchemaMigrations обнаружены дубли миграции " + definition.key + ".");
        return;
      }
      var record = matches[0] || null;
      if (!record) {
        if (currentVersion === definition.from || currentVersion === 0) {
          warnings.push("Требуется миграция схемы " + definition.key + " (v" + definition.from + " → v" + definition.to + ").");
          plannedChanges.push({ type: "APPLY_SCHEMA_MIGRATION", migration_key: definition.key, from_schema_version: definition.from, to_schema_version: definition.to });
        }
      } else if (record.status === "STARTED") {
        warnings.push("Миграция схемы " + definition.key + " была прервана; setup завершит её после проверки структуры.");
        plannedChanges.push({ type: "RESUME_SCHEMA_MIGRATION", migration_key: definition.key, from_schema_version: definition.from, to_schema_version: definition.to });
      } else if (record.status === "COMPLETED") {
        if (currentVersion < definition.to) {
          warnings.push("Миграция " + definition.key + " завершена, но версия _AppMeta ещё не обновлена; setup согласует версию.");
          plannedChanges.push({ type: "RESUME_SCHEMA_MIGRATION", migration_key: definition.key, from_schema_version: definition.from, to_schema_version: definition.to });
        }
      } else {
        issues.push("Миграция схемы " + definition.key + " имеет статус " + record.status + ". Автоматическое продолжение небезопасно.");
      }
    });
  }
  if (currentVersion === DI3_SCHEMA_VERSION) {
    DI3_SCHEMA_MIGRATION_DEFINITIONS.forEach(function (definition) {
      var matches = migrations.filter(function (row) { return row.migration_key === definition.key; });
      if (matches.length !== 1) {
        issues.push("Версия схемы v" + DI3_SCHEMA_VERSION + " не согласована с журналом миграции " + definition.key + ".");
      } else if (matches[0].status === "STARTED" && matches[0].to_schema_version === definition.to) {
        warnings.push("Миграция " + definition.key + " уже обновила версию схемы, но её запись осталась STARTED; setup завершит журнал.");
        plannedChanges.push({ type: "RESUME_SCHEMA_MIGRATION", migration_key: definition.key, from_schema_version: definition.from, to_schema_version: definition.to });
      } else if (matches[0].status !== "COMPLETED" || matches[0].to_schema_version !== definition.to) {
        issues.push("Версия схемы v" + DI3_SCHEMA_VERSION + " не согласована с журналом миграции " + definition.key + ".");
      }
    });
  }
  if (currentVersion > 0 && currentVersion < DI3_SCHEMA_VERSION && !issues.length && !plannedChanges.length) {
    issues.push("Нет зарегистрированного пути миграции схемы от версии " + currentVersion + " до " + DI3_SCHEMA_VERSION + ".");
  }
  return {
    status: issues.length ? "BLOCKED" : "READY",
    current_version: currentVersion,
    target_version: DI3_SCHEMA_VERSION,
    migrations_count: migrations.length,
    baseline_migration: baseline,
    schema_migrations: DI3_SCHEMA_MIGRATION_DEFINITIONS.map(function (definition) {
      var record = migrations.filter(function (row) { return row.migration_key === definition.key; })[0] || null;
      return { migration_key: definition.key, from_schema_version: definition.from, to_schema_version: definition.to, status: record ? record.status : "PENDING" };
    }),
    issues: issues,
    warnings: warnings,
    planned_changes: plannedChanges
  };
}

function di3SetSchemaMigrationStatus_(rowNumber, status, errorText) {
  var sheet = di3GetSheetOrThrow_("SchemaMigrations");
  var row = sheet.getRange(Number(rowNumber), 1, 1, DI3_TABLE_SCHEMAS.SchemaMigrations.length).getValues()[0];
  row[4] = status;
  if (!row[5]) row[5] = new Date();
  row[6] = status === "COMPLETED" ? new Date() : "";
  row[9] = String(errorText || "");
  sheet.getRange(Number(rowNumber), 1, 1, row.length).setValues([row]);
  return rowNumber;
}

function di3CreateSchemaMigrationRecord_(definition, backup) {
  var actor = di3GetActorEmail_();
  var backupId = backup && backup.backup_file_id ? String(backup.backup_file_id) : "";
  di3AppendTableRows_("SchemaMigrations", [[
    di3MakeUuid_(), definition.key, definition.from, definition.to,
    "STARTED", new Date(), "", backupId, definition.details, "", actor
  ]]);
  return di3GetSchemaMigrationRows_().filter(function (row) { return row.migration_key === definition.key; })[0];
}

/** Register/upgrade the validated schema baseline and execute ordered additive migrations. */
function di3EnsureSchemaVersioning_(backup) {
  var report = di3GetSchemaVersioningReport_();
  if (report.issues.length) throw new Error("Schema Versioning заблокирован: " + report.issues.join("; "));
  var schemaIssues = di3ValidateExistingCoreSchemas_();
  if (schemaIssues.length) throw new Error("Нельзя зарегистрировать schema_version до подтверждения всех заголовков: " + schemaIssues.join("; "));
  var missingSheets = DI3_CORE_TABLE_NAMES.filter(function (name) { return !di3GetSpreadsheet_().getSheetByName(name); });
  if (missingSheets.length) throw new Error("Нельзя зарегистрировать schema_version: отсутствуют системные таблицы " + missingSheets.join(", ") + ".");

  var cleanState = di3GetCleanBaselineState_();
  if (cleanState.eligible) {
    var record = cleanState.record;
    var changed = false;
    var createdCleanBaselineRecord = false;
    if (!record) {
      di3CreateSchemaMigrationRecord_({
        key: DI3_CLEAN_BASELINE_MIGRATION_KEY, from: 0, to: DI3_SCHEMA_VERSION,
        details: "Adopt the fully validated final schema directly; no legacy migration chain was executed."
      }, null);
      changed = true;
      createdCleanBaselineRecord = true;
    }
    var currentCleanVersion = di3GetSchemaVersion_();
    if (currentCleanVersion === 0) {
      di3SetAppMetaValue_("schema_version", DI3_SCHEMA_VERSION);
      currentCleanVersion = di3GetSchemaVersion_();
      changed = true;
    }
    if (currentCleanVersion !== DI3_SCHEMA_VERSION) throw new Error("Clean baseline остановлен: ожидалась schema_version=" + DI3_SCHEMA_VERSION + ", получено " + currentCleanVersion + ".");
    if (!record || record.status !== "COMPLETED") {
      var latestRecord = di3GetSchemaMigrationRows_().filter(function (row) { return row.migration_key === DI3_CLEAN_BASELINE_MIGRATION_KEY; })[0];
      if (!latestRecord) throw new Error("Не найдена запись clean baseline после её создания.");
      di3SetSchemaMigrationStatus_(latestRecord.row_number, "COMPLETED", "");
      changed = true;
    }
    return { status: createdCleanBaselineRecord ? "INITIALIZED_CLEAN_BASELINE" :
        (changed ? "RESUMED_CLEAN_BASELINE" : "CURRENT"),
      installation_path: "CLEAN_FINAL_BASELINE", schema_version: DI3_SCHEMA_VERSION,
      migrations_count: di3GetSchemaMigrationRows_().length, changed: changed };
  }

  // Legacy path is retained only for explicitly recognized earlier workbooks.
  var current = di3GetSchemaVersion_();
  var initializedBaseline = current === 0;
  var baseline = di3GetSchemaMigrationRows_().filter(function (row) { return row.migration_key === DI3_SCHEMA_BASELINE_MIGRATION_KEY; })[0] || null;
  var changed = false;
  if (!baseline) {
    var baselineDefinition = { key: DI3_SCHEMA_BASELINE_MIGRATION_KEY, from: 0, to: 1,
      details: "Adopt the already validated RC8 schema baseline." };
    baseline = di3CreateSchemaMigrationRecord_(baselineDefinition, backup);
    changed = true;
  }
  if (baseline.status !== "COMPLETED") {
    if (current === 0) { di3SetAppMetaValue_("schema_version", 1); current = 1; }
    else if (current !== 1) throw new Error("Невозможно продолжить baseline migration: текущая версия " + current + ".");
    di3SetSchemaMigrationStatus_(baseline.row_number, "COMPLETED", "");
    changed = true;
  }
  if (current === 0) current = di3GetSchemaVersion_();
  DI3_SCHEMA_MIGRATION_DEFINITIONS.forEach(function (definition) {
    var record = di3GetSchemaMigrationRows_().filter(function (row) { return row.migration_key === definition.key; })[0] || null;
    if (!record) { record = di3CreateSchemaMigrationRecord_(definition, backup); changed = true; }
    if (record.status !== "STARTED" && record.status !== "COMPLETED") throw new Error("Нельзя продолжить миграцию " + definition.key + " со статусом " + record.status + ".");
    if (definition.key === "RC8_SUPPLY_PLANNING_DATES_V2") {
      var supplySheet = di3GetSheetOrThrow_("V3_Supplies");
      var expectedSupplyTail = ["supplier_order_date", "expected_received_date"];
      var actualSupplyTail = supplySheet.getRange(1, 18, 1, 2).getDisplayValues()[0].map(di3NormalizeHeader_);
      if (actualSupplyTail.join("|") !== expectedSupplyTail.join("|")) throw new Error("Миграция " + definition.key + " не завершена: заголовки V3_Supplies!R:S не готовы.");
    } else if (definition.key === "RC8_ORDER_COMMISSION_PAYER_V3") {
      var orderSheet = di3GetSheetOrThrow_("V3_Orders");
      var payerHeader = di3NormalizeHeader_(orderSheet.getRange(1, 29).getDisplayValue());
      if (payerHeader !== "commission_payer") throw new Error("Миграция " + definition.key + " не завершена: заголовок V3_Orders!AC1 не готов.");
    } else if (definition.key === "RC8_ORDER_BUSINESS_DATE_V4") {
      var businessDateResult = di3ApplyOrderBusinessDateMigration_();
      if (businessDateResult.status !== "APPLIED") throw new Error("Миграция " + definition.key + " не подтвердила применение.");
    } else {
      throw new Error("Неизвестная миграция схемы: " + definition.key);
    }
    if (di3GetSchemaVersion_() < definition.to) { di3SetAppMetaValue_("schema_version", definition.to); changed = true; }
    if (record.status !== "COMPLETED") { di3SetSchemaMigrationStatus_(record.row_number, "COMPLETED", ""); changed = true; }
  });
  var finalVersion = di3GetSchemaVersion_();
  if (finalVersion !== DI3_SCHEMA_VERSION) throw new Error("После миграции ожидалась schema_version=" + DI3_SCHEMA_VERSION + ", получено " + finalVersion + ".");
  return { status: initializedBaseline ? "INITIALIZED" : (changed ? "UPGRADED" : "CURRENT"),
    installation_path: "LEGACY_UPGRADE", schema_version: finalVersion,
    migrations_count: di3GetSchemaMigrationRows_().length, changed: changed };
}
