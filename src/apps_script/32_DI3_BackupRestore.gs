/**
 * Dots Inventory v3 — non-destructive full-spreadsheet backup and restore.
 * Google Sheets native copies include the container-bound Apps Script project.
 * Installable triggers are revalidated/reinstalled separately after restore.
 * Restore ALWAYS creates a new spreadsheet; it never overwrites the active one.
 */
var DI3_BACKUP_MANIFEST_MARKER_V1 = "DI3_BACKUP_V1:";
var DI3_BACKUP_MANIFEST_MARKER_V2 = "DI3_BACKUP_V2:";
var DI3_BACKUP_MANIFEST_MARKER = DI3_BACKUP_MANIFEST_MARKER_V2;
var DI3_BACKUP_MANIFEST_VERSION = 2;
var DI3_BACKUP_HASH_MODE_FULL = "FULL_CHUNKED_SHA256_V2";
var DI3_BACKUP_HASH_MODE_SAMPLED = "SAMPLED_SHA256_V2";
var DI3_BACKUP_HASH_MODE_LEGACY = "SAMPLED_SHA256_V1";
var DI3_BACKUP_HASH_PRIORITY_SHEETS = Object.freeze([
  "StockLedger", "StockMovementDetails", "StockLots", "StockAllocations",
  "FifoProductState", "FifoAllocationRuns", "FifoAllocationArchive", "FifoLotCacheArchive", "FifoReplayEvents", "Operations", "OperationPayloads",
  "OperationAttempts", "OrderCostSnapshots", "V3_Orders", "V3_OrderItems",
  "V3_Supplies", "V3_SupplyItems", "_AppMeta", "SchemaMigrations", "Settings"
]);

function di3GetBackupConfig_() {
  var config = DI3_APP_CONFIG && DI3_APP_CONFIG.BACKUP ? DI3_APP_CONFIG.BACKUP : {};
  return {
    folder_name: String(config.FOLDER_NAME || "Dots Inventory Backups"),
    file_prefix: String(config.FILE_PREFIX || "DotsInventoryV3_BACKUP_"),
    verify_chunk_rows: Math.max(10, Math.min(500, Math.floor(Number(config.VERIFY_CHUNK_ROWS) || 100))),
    full_hash_max_cells_per_sheet: Math.max(1000, Math.floor(Number(config.FULL_HASH_MAX_CELLS_PER_SHEET) || 250000)),
    full_hash_max_cells_total: Math.max(10000, Math.floor(Number(config.FULL_HASH_MAX_CELLS_TOTAL) || 750000))
  };
}

function di3GetBackupFolder_() {
  if (typeof DriveApp === "undefined") throw new Error("Для резервного копирования требуется разрешение Google Drive. Запусти команду ещё раз и предоставь доступ.");
  var properties = PropertiesService.getScriptProperties();
  var storedId = properties.getProperty("DI3_BACKUP_FOLDER_ID");
  // A stale/inaccessible configured folder is an error, not a reason to silently
  // create a second folder and split the backup history.
  if (storedId) return DriveApp.getFolderById(storedId);
  var folder = DriveApp.getRootFolder().createFolder(di3GetBackupConfig_().folder_name);
  properties.setProperty("DI3_BACKUP_FOLDER_ID", folder.getId());
  return folder;
}

function di3BackupHashText_(value) {
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(value), Utilities.Charset.UTF_8);
  return bytes.map(function (byte) { return (byte < 0 ? byte + 256 : byte).toString(16).padStart(2, "0"); }).join("");
}

function di3BackupNormalizeCell_(value) {
  if (value instanceof Date) return { type: "DATE", value: value.toISOString() };
  if (value === null || value === undefined || value === "") return { type: "EMPTY", value: "" };
  if (typeof value === "number") return { type: "NUMBER", value: String(value) };
  if (typeof value === "boolean") return { type: "BOOLEAN", value: value };
  return { type: "STRING", value: String(value) };
}

/** Legacy v1 checksum: deterministic sample rows only. Kept for old backup compatibility. */
function di3GetLegacySheetBackupContentHash_(sheet) {
  var lastRow = Number(sheet.getLastRow()) || 0;
  var lastColumn = Number(sheet.getLastColumn()) || 0;
  if (!lastRow || !lastColumn) return di3BackupHashText_("EMPTY_SHEET");
  var candidates = [1, Math.min(2, lastRow), Math.ceil(lastRow / 2), Math.max(1, lastRow - 1), lastRow];
  var sampleRows = [];
  var seen = {};
  candidates.forEach(function (rowNumber) {
    if (seen[rowNumber]) return;
    seen[rowNumber] = true;
    sampleRows.push(rowNumber);
  });
  var samples = sampleRows.map(function (rowNumber) {
    var range = sheet.getRange(rowNumber, 1, 1, lastColumn);
    var values = range.getValues()[0];
    var formulas = range.getFormulas()[0];
    return {
      row: rowNumber,
      cells: values.map(function (value, index) {
        return { value: di3BackupNormalizeCell_(value), formula: String(formulas[index] || "") };
      })
    };
  });
  return di3BackupHashText_(JSON.stringify({ last_row: lastRow, last_column: lastColumn, samples: samples }));
}

/**
 * Hash a complete used range in bounded row chunks. Formula cells are represented
 * by formula text rather than cached result so volatile formulas (NOW/RAND) do not
 * make a correct native copy fail verification merely because recalculation ran.
 */
function di3GetFullSheetBackupContentHash_(sheet) {
  var lastRow = Number(sheet.getLastRow()) || 0;
  var lastColumn = Number(sheet.getLastColumn()) || 0;
  var config = di3GetBackupConfig_();
  if (!lastRow || !lastColumn) {
    return { hash: di3BackupHashText_(JSON.stringify({ mode: DI3_BACKUP_HASH_MODE_FULL, rows: lastRow, columns: lastColumn, chunks: [] })), hashed_cell_count: 0 };
  }
  var chunkHashes = [];
  var hashedCellCount = 0;
  for (var startRow = 1; startRow <= lastRow; startRow += config.verify_chunk_rows) {
    var rowCount = Math.min(config.verify_chunk_rows, lastRow - startRow + 1);
    var range = sheet.getRange(startRow, 1, rowCount, lastColumn);
    var values = range.getValues();
    var formulas = range.getFormulas();
    var normalizedRows = values.map(function (row, rowIndex) {
      return row.map(function (value, columnIndex) {
        var formula = String((formulas[rowIndex] || [])[columnIndex] || "");
        return formula ? { type: "FORMULA", formula: formula } : di3BackupNormalizeCell_(value);
      });
    });
    var chunkPayload = JSON.stringify({ start_row: startRow, row_count: rowCount, cells: normalizedRows });
    chunkHashes.push(di3BackupHashText_(chunkPayload));
    hashedCellCount += rowCount * lastColumn;
  }
  var finalPayload = JSON.stringify({
    mode: DI3_BACKUP_HASH_MODE_FULL,
    last_row: lastRow,
    last_column: lastColumn,
    chunk_rows: config.verify_chunk_rows,
    chunk_hashes: chunkHashes
  });
  return { hash: di3BackupHashText_(finalPayload), hashed_cell_count: hashedCellCount };
}

function di3GetSampledSheetBackupContentHashV2_(sheet) {
  var lastRow = Number(sheet.getLastRow()) || 0;
  var lastColumn = Number(sheet.getLastColumn()) || 0;
  if (!lastRow || !lastColumn) {
    return { hash: di3BackupHashText_(JSON.stringify({ mode: DI3_BACKUP_HASH_MODE_SAMPLED, rows: lastRow, columns: lastColumn, samples: [] })), hashed_cell_count: 0 };
  }
  var candidates = [1, Math.min(2, lastRow), Math.ceil(lastRow / 2), Math.max(1, lastRow - 1), lastRow];
  var sampleRows = [];
  var seen = {};
  candidates.forEach(function (rowNumber) {
    if (seen[rowNumber]) return;
    seen[rowNumber] = true;
    sampleRows.push(rowNumber);
  });
  var samples = sampleRows.map(function (rowNumber) {
    var range = sheet.getRange(rowNumber, 1, 1, lastColumn);
    var values = range.getValues()[0];
    var formulas = range.getFormulas()[0];
    return {
      row: rowNumber,
      cells: values.map(function (value, index) {
        var formula = String(formulas[index] || "");
        return formula ? { type: "FORMULA", formula: formula } : di3BackupNormalizeCell_(value);
      })
    };
  });
  var payload = JSON.stringify({ mode: DI3_BACKUP_HASH_MODE_SAMPLED, last_row: lastRow, last_column: lastColumn, samples: samples });
  return { hash: di3BackupHashText_(payload), hashed_cell_count: sampleRows.length * lastColumn };
}

function di3GetSheetBackupHashPlan_(sheet, remainingFullHashCells) {
  var lastRow = Number(sheet.getLastRow()) || 0;
  var lastColumn = Number(sheet.getLastColumn()) || 0;
  var cellCount = lastRow * lastColumn;
  var config = di3GetBackupConfig_();
  var fullAllowed = cellCount <= config.full_hash_max_cells_per_sheet && cellCount <= remainingFullHashCells;
  return {
    last_row: lastRow,
    last_column: lastColumn,
    cell_count: cellCount,
    mode: fullAllowed ? DI3_BACKUP_HASH_MODE_FULL : DI3_BACKUP_HASH_MODE_SAMPLED
  };
}

function di3GetSheetBackupHashInfo_(sheet, requestedMode) {
  var mode = String(requestedMode || DI3_BACKUP_HASH_MODE_FULL);
  var lastRow = Number(sheet.getLastRow()) || 0;
  var lastColumn = Number(sheet.getLastColumn()) || 0;
  var cellCount = lastRow * lastColumn;
  if (mode === DI3_BACKUP_HASH_MODE_LEGACY) {
    return { mode: mode, hash: di3GetLegacySheetBackupContentHash_(sheet), cell_count: cellCount, hashed_cell_count: Math.min(cellCount, 5 * lastColumn) };
  }
  if (mode === DI3_BACKUP_HASH_MODE_SAMPLED) {
    var sampled = di3GetSampledSheetBackupContentHashV2_(sheet);
    return { mode: mode, hash: sampled.hash, cell_count: cellCount, hashed_cell_count: sampled.hashed_cell_count };
  }
  if (mode !== DI3_BACKUP_HASH_MODE_FULL) throw new Error("Неизвестный режим проверки backup: " + mode);
  var full = di3GetFullSheetBackupContentHash_(sheet);
  return { mode: mode, hash: full.hash, cell_count: cellCount, hashed_cell_count: full.hashed_cell_count };
}

function di3GetSheetBackupContentHash_(sheet, mode) {
  return di3GetSheetBackupHashInfo_(sheet, mode).hash;
}

function di3GetSpreadsheetBackupSnapshot_(spreadsheet, expectedHashModes) {
  var sheets = spreadsheet.getSheets();
  var sheetMetadata = sheets.map(function (sheet, index) {
    return {
      sheet: sheet,
      index: index + 1,
      name: String(sheet.getName()),
      max_rows: Number(sheet.getMaxRows()),
      max_columns: Number(sheet.getMaxColumns()),
      last_row: Number(sheet.getLastRow()),
      last_column: Number(sheet.getLastColumn()),
      frozen_rows: Number(typeof sheet.getFrozenRows === "function" ? sheet.getFrozenRows() : 0),
      frozen_columns: Number(typeof sheet.getFrozenColumns === "function" ? sheet.getFrozenColumns() : 0),
      hidden: !!(typeof sheet.isSheetHidden === "function" && sheet.isSheetHidden())
    };
  });

  var modeByName = {};
  if (expectedHashModes) {
    Object.keys(expectedHashModes).forEach(function (name) { modeByName[name] = expectedHashModes[name]; });
  } else {
    var config = di3GetBackupConfig_();
    var remaining = config.full_hash_max_cells_total;
    // Prioritize financial/stock ledgers before user-facing views when the workbook
    // exceeds the bounded full-hash budget. The returned snapshot keeps original tab order.
    var priority = DI3_BACKUP_HASH_PRIORITY_SHEETS;
    var ordered = sheetMetadata.slice().sort(function (a, b) {
      var ai = priority.indexOf(a.name); var bi = priority.indexOf(b.name);
      ai = ai < 0 ? priority.length : ai;
      bi = bi < 0 ? priority.length : bi;
      return ai - bi || a.index - b.index;
    });
    ordered.forEach(function (meta) {
      var plan = di3GetSheetBackupHashPlan_(meta.sheet, remaining);
      modeByName[meta.name] = plan.mode;
      if (plan.mode === DI3_BACKUP_HASH_MODE_FULL) remaining -= plan.cell_count;
    });
  }

  return sheetMetadata.map(function (meta) {
    var hashInfo = di3GetSheetBackupHashInfo_(meta.sheet, modeByName[meta.name] || DI3_BACKUP_HASH_MODE_FULL);
    return {
      index: meta.index,
      name: meta.name,
      content_hash: hashInfo.hash,
      content_hash_mode: hashInfo.mode,
      cell_count: hashInfo.cell_count,
      hashed_cell_count: hashInfo.hashed_cell_count,
      sheet_id: String(typeof meta.sheet.getSheetId === "function" ? meta.sheet.getSheetId() : ""),
      max_rows: meta.max_rows,
      max_columns: meta.max_columns,
      last_row: meta.last_row,
      last_column: meta.last_column,
      frozen_rows: meta.frozen_rows,
      frozen_columns: meta.frozen_columns,
      hidden: meta.hidden
    };
  });
}

function di3VerifySpreadsheetBackupSnapshot_(spreadsheet, expectedSheets) {
  var expected = expectedSheets || [];
  var expectedModes = {};
  expected.forEach(function (item) {
    // Missing hash mode identifies a legacy v1 sample-only backup.
    expectedModes[item.name] = item.content_hash_mode || DI3_BACKUP_HASH_MODE_LEGACY;
  });
  var actual = di3GetSpreadsheetBackupSnapshot_(spreadsheet, expectedModes);
  var issues = [];
  if (actual.length !== expected.length) issues.push("Количество листов отличается: ожидалось " + expected.length + ", найдено " + actual.length + ".");
  var count = Math.min(actual.length, expected.length);
  for (var i = 0; i < count; i++) {
    var a = actual[i], e = expected[i];
    if (a.name !== e.name) issues.push("Порядок/имя листа " + (i + 1) + " отличается: ожидалось «" + e.name + "», найдено «" + a.name + "».");
    if (a.max_rows !== e.max_rows || a.max_columns !== e.max_columns) issues.push("Физический размер листа «" + e.name + "» отличается.");
    if (a.last_row !== e.last_row || a.last_column !== e.last_column) issues.push("Границы данных листа «" + e.name + "» отличаются.");
    if (a.frozen_rows !== e.frozen_rows || a.frozen_columns !== e.frozen_columns) issues.push("Закреплённые области листа «" + e.name + "» отличаются.");
    if (a.hidden !== e.hidden) issues.push("Состояние видимости листа «" + e.name + "» отличается.");
    if (a.content_hash !== e.content_hash) issues.push("Контрольная сумма значений/формул листа «" + e.name + "» отличается.");
  }
  var modes = {};
  var totalCells = 0;
  var hashedCells = 0;
  actual.forEach(function (item) {
    modes[item.content_hash_mode] = true;
    totalCells += Number(item.cell_count) || 0;
    hashedCells += Number(item.hashed_cell_count) || 0;
  });
  var modeNames = Object.keys(modes);
  var fullOnly = modeNames.length === 1 && modeNames[0] === DI3_BACKUP_HASH_MODE_FULL;
  var sampledOnly = modeNames.length === 1 && modeNames[0] === DI3_BACKUP_HASH_MODE_SAMPLED;
  var legacyOnly = modeNames.length === 1 && modeNames[0] === DI3_BACKUP_HASH_MODE_LEGACY;
  var verificationLevel = fullOnly ? "FULL" : sampledOnly ? "SAMPLED" : legacyOnly ? "LEGACY_SAMPLED" : "MIXED_FULL_AND_SAMPLED";
  return {
    passed: issues.length === 0,
    issues: issues,
    actual_sheet_count: actual.length,
    verification_level: verificationLevel,
    verification_modes: modeNames,
    total_used_cells: totalCells,
    hashed_cells: hashedCells,
    full_hash_coverage_ratio: totalCells ? Math.round((hashedCells / totalCells) * 10000) / 10000 : 1
  };
}

function di3GetBackupWorkbookMetadata_() {
  function safeMeta(key) {
    try { return typeof di3GetAppMetaValue_ === "function" ? di3GetAppMetaValue_(key) : null; }
    catch (ignore) { return null; }
  }
  var pendingCount = null;
  try { pendingCount = typeof di3GetPendingStockOperations_ === "function" ? di3GetPendingStockOperations_().length : null; }
  catch (ignorePending) {}
  return {
    application_version: safeMeta("application_version"),
    schema_version: safeMeta("schema_version"),
    money_fifo_schema_version: safeMeta("money_fifo_schema_version"),
    money_fifo_migration_status: safeMeta("money_fifo_migration_status"),
    fifo_state_version: safeMeta("fifo_state_version"),
    pending_stock_operations: pendingCount
  };
}

function di3SerializeBackupManifest_(manifest) {
  return DI3_BACKUP_MANIFEST_MARKER_V2 + JSON.stringify(manifest);
}

function di3ParseBackupManifestFromDescription_(description) {
  var value = String(description || "");
  var marker = value.indexOf(DI3_BACKUP_MANIFEST_MARKER_V2) === 0 ? DI3_BACKUP_MANIFEST_MARKER_V2 :
    value.indexOf(DI3_BACKUP_MANIFEST_MARKER_V1) === 0 ? DI3_BACKUP_MANIFEST_MARKER_V1 : "";
  if (!marker) return null;
  try { return JSON.parse(value.slice(marker.length)); }
  catch (error) { throw new Error("Манифест резервной копии повреждён: " + (error.message || String(error))); }
}

function di3WorkbookHasExistingContent_() {
  return di3GetSpreadsheet_().getSheets().some(function (sheet) {
    return Number(sheet.getLastRow()) > 0 || Number(sheet.getLastColumn()) > 0;
  });
}

/** Internal implementation. Caller may already hold the shared mutation lock. */
function di3CreateSpreadsheetBackupInternal_(reason) {
  if (typeof DriveApp === "undefined") throw new Error("Backup остановлен: Google Drive недоступен или разрешение не предоставлено.");
  var startedAtMs = Date.now();
  var startedAt = new Date(startedAtMs);
  var spreadsheet = di3GetSpreadsheet_();
  if (!spreadsheet || typeof spreadsheet.getId !== "function" || !spreadsheet.getId()) {
    throw new Error("Backup остановлен: не удалось определить текущую Google-таблицу.");
  }
  var timezone = di3GetConfiguredTimeZone_();
  var stamp = Utilities.formatDate(startedAt, timezone, "yyyyMMdd_HHmmss");
  var token = Utilities.getUuid().replace(/-/g, "").slice(0, 10).toUpperCase();
  var config = di3GetBackupConfig_();
  var folder = di3GetBackupFolder_();
  var sourceFile = DriveApp.getFileById(spreadsheet.getId());

  if (typeof SpreadsheetApp.flush !== "function") {
    throw new Error("Backup остановлен: SpreadsheetApp.flush() недоступен; нельзя подтвердить фиксацию ожидающих записей перед копированием.");
  }
  var flushStartedAt = Date.now();
  SpreadsheetApp.flush();
  var flushMs = Date.now() - flushStartedAt;

  var snapshotStartedAt = Date.now();
  var sourceSheets = di3GetSpreadsheetBackupSnapshot_(spreadsheet);
  var snapshotMs = Date.now() - snapshotStartedAt;

  var backupName = config.file_prefix + stamp + "_" + token;
  var copyStartedAt = Date.now();
  var backupFile = sourceFile.makeCopy(backupName, folder);
  var copyMs = Date.now() - copyStartedAt;
  var backupCreatedAt = new Date();
  var copiedSpreadsheet;
  try { copiedSpreadsheet = SpreadsheetApp.openById(backupFile.getId()); }
  catch (openError) {
    throw new Error("Резервная копия создана, но её невозможно открыть для проверки. Файл сохранён: " + backupFile.getId() + ". " + (openError.message || String(openError)));
  }

  var verificationStartedAt = Date.now();
  var verification = di3VerifySpreadsheetBackupSnapshot_(copiedSpreadsheet, sourceSheets);
  var verificationMs = Date.now() - verificationStartedAt;
  if (!verification.passed) {
    try { backupFile.setDescription("DI3_BACKUP_FAILED: " + verification.issues.join("; ")); } catch (ignoreDescription) {}
    throw new Error("Резервная копия не прошла проверку структуры. Файл сохранён для расследования: " + backupFile.getId() + ". " + verification.issues.join("; "));
  }

  var warnings = [];
  if (verification.verification_level !== "FULL") {
    warnings.push("Проверка резервной копии выполнена частично из-за лимита контрольной суммы. Уровень: " + verification.verification_level + "; покрытие: " + Math.round(verification.full_hash_coverage_ratio * 100) + "%.");
  }
  var manifest = {
    format_version: DI3_BACKUP_MANIFEST_VERSION,
    backup_kind: "DI3_SPREADSHEET_FULL_COPY",
    verification_status: "VERIFIED",
    backup_file_id: backupFile.getId(),
    backup_file_name: backupFile.getName(),
    backup_folder_id: folder.getId(),
    backup_folder_url: folder.getUrl(),
    source_spreadsheet_id: spreadsheet.getId(),
    source_spreadsheet_name: spreadsheet.getName(),
    source_spreadsheet_url: spreadsheet.getUrl(),
    backup_started_at_utc: startedAt.toISOString(),
    created_at_utc: backupCreatedAt.toISOString(),
    created_at_local: Utilities.formatDate(backupCreatedAt, timezone, "yyyy-MM-dd HH:mm:ss"),
    time_zone: timezone,
    reason: String(reason || "MANUAL"),
    workbook_metadata: di3GetBackupWorkbookMetadata_(),
    sheet_count: sourceSheets.length,
    sheets: sourceSheets,
    verification: verification,
    verification_level: verification.verification_level,
    total_used_cells: verification.total_used_cells,
    hashed_cells: verification.hashed_cells,
    verification_mode: "CHUNKED_SHA256_FULL_WHERE_WITHIN_CONFIGURED_BUDGET",
    hash_algorithm: "SHA-256",
    verification_budget: {
      chunk_rows: config.verify_chunk_rows,
      full_hash_max_cells_per_sheet: config.full_hash_max_cells_per_sheet,
      full_hash_max_cells_total: config.full_hash_max_cells_total
    },
    timing: {
      flush_ms: flushMs,
      source_snapshot_ms: snapshotMs,
      drive_copy_ms: copyMs,
      verification_ms: verificationMs,
      elapsed_before_manifest_ms: Date.now() - startedAtMs
    },
    restore_mode: "CREATE_NEW_SPREADSHEET",
    bound_script_source_included: true,
    bound_script_source_copy_expected: true,
    installable_triggers_require_revalidation: true
  };

  var manifestWriteStartedAt = Date.now();
  // Embed manifest before writing the optional sidecar: the copy remains
  // discoverable if sidecar creation fails.
  backupFile.setDescription(di3SerializeBackupManifest_(manifest));
  var sidecar = null;
  try {
    sidecar = folder.createFile(backupName + ".manifest.json", JSON.stringify(manifest, null, 2), "application/json");
    manifest.manifest_file_id = sidecar.getId();
    if (typeof sidecar.setContent === "function") sidecar.setContent(JSON.stringify(manifest, null, 2));
  } catch (manifestError) {
    warnings.push("Не удалось создать/обновить JSON sidecar; манифест сохранён в описании файла backup: " + (manifestError.message || String(manifestError)));
  }
  manifest.finalized_at_utc = new Date().toISOString();
  manifest.timing.manifest_write_ms_before_final_update = Date.now() - manifestWriteStartedAt;
  manifest.timing.total_ms_before_final_manifest_update = Date.now() - startedAtMs;
  try {
    backupFile.setDescription(di3SerializeBackupManifest_(manifest));
    if (sidecar && typeof sidecar.setContent === "function") sidecar.setContent(JSON.stringify(manifest, null, 2));
  } catch (finalManifestError) {
    warnings.push("Не удалось обновить финальные timing-поля манифеста; первоначальный VERIFIED-манифест сохранён: " + (finalManifestError.message || String(finalManifestError)));
  }

  PropertiesService.getScriptProperties().setProperty("DI3_LAST_BACKUP_FILE_ID", backupFile.getId());
  var resultTiming = Object.assign({}, manifest.timing, { total_ms: Date.now() - startedAtMs });
  return {
    status: "VERIFIED",
    backup_file_id: backupFile.getId(),
    backup_file_name: backupFile.getName(),
    backup_url: backupFile.getUrl(),
    backup_folder_id: folder.getId(),
    backup_folder_url: folder.getUrl(),
    manifest_file_id: sidecar ? sidecar.getId() : "",
    sheet_count: sourceSheets.length,
    verification: verification,
    verification_level: verification.verification_level,
    timing: resultTiming,
    warnings: warnings,
    reason: manifest.reason
  };
}

function di3CreateSpreadsheetBackup() {
  var lockWaitStartedAt = Date.now();
  var lockAcquiredAt = 0;
  var result = di3WithLock_(function () {
    lockAcquiredAt = Date.now();
    return di3CreateSpreadsheetBackupInternal_("MANUAL");
  });
  var lockReleasedAt = Date.now();
  result.timing = result.timing || {};
  result.timing.lock_wait_ms = lockAcquiredAt ? lockAcquiredAt - lockWaitStartedAt : null;
  result.timing.lock_held_ms = lockAcquiredAt ? lockReleasedAt - lockAcquiredAt : null;
  // Toast is deliberately outside the critical section so UI latency does not
  // extend the global mutation lock.
  try {
    di3GetSpreadsheet_().toast(
      "Резервная копия: " + result.backup_file_name + " · " + result.verification_level +
      " · lock " + result.timing.lock_held_ms + " ms",
      "Backup · VERIFIED", 10
    );
  } catch (ignoreToast) {}
  return result;
}

function di3CreateSpreadsheetBackupFromMenu() {
  return di3CreateSpreadsheetBackup();
}

function di3ListSpreadsheetBackups_(limit) {
  var folder = di3GetBackupFolder_();
  var config = di3GetBackupConfig_();
  var iterator = folder.getFiles();
  var backups = [];
  while (iterator.hasNext()) {
    var file = iterator.next();
    if (String(file.getName()).indexOf(config.file_prefix) !== 0) continue;
    if (String(file.getMimeType()) !== "application/vnd.google-apps.spreadsheet") continue;
    var manifest = di3ParseBackupManifestFromDescription_(file.getDescription());
    if (!manifest || ![1, 2].includes(Number(manifest.format_version)) || manifest.backup_kind !== "DI3_SPREADSHEET_FULL_COPY" ||
        manifest.verification_status !== "VERIFIED" || manifest.backup_file_id !== file.getId()) continue;
    backups.push({
      file_id: file.getId(), file_name: file.getName(), url: file.getUrl(),
      created_at_utc: manifest.created_at_utc, created_at_local: manifest.created_at_local,
      time_zone: manifest.time_zone, reason: manifest.reason,
      sheet_count: manifest.sheet_count, manifest_file_id: manifest.manifest_file_id || "",
      verification_level: manifest.verification_level || (manifest.verification && manifest.verification.verification_level) || (Number(manifest.format_version) === 1 ? "LEGACY_SAMPLED" : "UNKNOWN"),
      full_hash_coverage_ratio: manifest.verification && manifest.verification.full_hash_coverage_ratio,
      source_spreadsheet_id: manifest.source_spreadsheet_id
    });
  }
  backups.sort(function (a, b) { return String(b.created_at_utc).localeCompare(String(a.created_at_utc)); });
  var max = Math.max(1, Math.min(100, Number(limit) || 20));
  return { status: "READY", folder_id: folder.getId(), folder_url: folder.getUrl(), backups: backups.slice(0, max), total: backups.length };
}

function di3ShowSpreadsheetBackups() {
  var report = di3ListSpreadsheetBackups_(10);
  var message = report.backups.length ? report.backups.map(function (item, index) {
    return (index + 1) + ". " + item.created_at_local + " · " + item.reason + " · проверка: " + item.verification_level + "\nID: " + item.file_id;
  }).join("\n\n") : "Резервных копий пока нет.";
  SpreadsheetApp.getUi().alert("Резервные копии", message + "\n\nПапка: " + report.folder_url, SpreadsheetApp.getUi().ButtonSet.OK);
  return report;
}

function di3OpenSpreadsheetBackupFolder() {
  var folder = di3GetBackupFolder_();
  SpreadsheetApp.getUi().alert("Резервные копии", "Папка резервных копий:\n" + folder.getUrl(), SpreadsheetApp.getUi().ButtonSet.OK);
  return { status: "READY", folder_id: folder.getId(), folder_url: folder.getUrl() };
}

function di3GetVerifiedBackupFile_(backupFileId) {
  var id = String(backupFileId || "").trim();
  if (!id) throw new Error("Не указан ID резервной копии.");
  var file = DriveApp.getFileById(id);
  if (String(file.getMimeType()) !== "application/vnd.google-apps.spreadsheet") {
    throw new Error("Выбранный файл не является Google-таблицей.");
  }
  var manifest = di3ParseBackupManifestFromDescription_(file.getDescription());
  if (!manifest || ![1, 2].includes(Number(manifest.format_version)) || manifest.backup_kind !== "DI3_SPREADSHEET_FULL_COPY" ||
      manifest.verification_status !== "VERIFIED" || manifest.backup_file_id !== file.getId() ||
      !Array.isArray(manifest.sheets) || !manifest.sheets.length) {
    throw new Error("Файл не является проверенной резервной копией Dots Inventory или его манифест повреждён.");
  }
  return { file: file, manifest: manifest };
}

function di3GetCurrentSpreadsheetParentFolder_() {
  var currentFile = DriveApp.getFileById(di3GetSpreadsheet_().getId());
  var parents = currentFile.getParents();
  return parents.hasNext() ? parents.next() : DriveApp.getRootFolder();
}

/** Restore a verified backup as a NEW spreadsheet; the current workbook is never overwritten. */
function di3RestoreSpreadsheetBackup(backupFileId) {
  return di3WithLock_(function () {
    var verified = di3GetVerifiedBackupFile_(backupFileId);
    var current = di3GetSpreadsheet_();
    if (verified.file.getId() === current.getId()) throw new Error("Нельзя восстанавливать текущую рабочую таблицу из самой себя.");
    var folder = di3GetCurrentSpreadsheetParentFolder_();
    var timezone = di3GetConfiguredTimeZone_();
    var stamp = Utilities.formatDate(new Date(), timezone, "yyyyMMdd_HHmmss");
    var name = "RESTORED_" + current.getName() + "_" + stamp;
    var restoredFile = verified.file.makeCopy(name, folder);
    var restoredSpreadsheet;
    try { restoredSpreadsheet = SpreadsheetApp.openById(restoredFile.getId()); }
    catch (error) { throw new Error("Файл восстановления создан, но не прошёл открытие. Текущая таблица не затронута. ID: " + restoredFile.getId() + ". " + (error.message || String(error))); }
    var verification = di3VerifySpreadsheetBackupSnapshot_(restoredSpreadsheet, verified.manifest.sheets);
    if (!verification.passed) {
      try { restoredFile.setDescription("DI3_RESTORE_FAILED_FROM:" + verified.file.getId() + " " + verification.issues.join("; ")); } catch (ignoreDescription) {}
      throw new Error("Новая восстановленная копия не прошла проверку структуры. Текущая таблица не затронута. ID: " + restoredFile.getId() + ". " + verification.issues.join("; "));
    }
    var restoreManifest = {
      format_version: 1,
      restore_kind: "DI3_RESTORE_AS_NEW_SPREADSHEET",
      verification_status: "VERIFIED",
      restored_file_id: restoredFile.getId(),
      restored_file_name: restoredFile.getName(),
      restored_at_utc: new Date().toISOString(),
      restored_from_backup_file_id: verified.file.getId(),
      restored_from_backup_created_at_utc: verified.manifest.created_at_utc,
      backup_folder_id: verified.manifest.backup_folder_id || "",
      backup_folder_url: verified.manifest.backup_folder_url || "",
      source_spreadsheet_id: verified.manifest.source_spreadsheet_id,
      verification: verification,
      verification_level: verification.verification_level,
      source_backup_format_version: Number(verified.manifest.format_version) || 1,
      current_spreadsheet_left_untouched: true,
      bound_script_source_included: true,
      bound_script_source_copy_expected: true,
      installable_triggers_require_revalidation: true
    };
    restoredFile.setDescription("DI3_RESTORE_V1:" + JSON.stringify(restoreManifest));
    return {
      status: "RESTORED_AS_NEW_FILE",
      restored_file_id: restoredFile.getId(),
      restored_file_name: restoredFile.getName(),
      restored_url: restoredFile.getUrl(),
      source_backup_file_id: verified.file.getId(),
      verification: verification,
      verification_level: verification.verification_level || "UNKNOWN",
      full_hash_coverage_ratio: Number(verification.full_hash_coverage_ratio) || 0,
      current_spreadsheet_modified: false,
      bound_script_source_included: true,
      bound_script_source_copy_expected: true,
      installable_triggers_require_revalidation: true
    };
  });
}

/** Recreate/normalize the managed installable triggers in a restored copy. */
function di3RestoreBackupFolderBindingFromCurrentFile_() {
  var warnings = [];
  if (typeof DriveApp === "undefined") {
    return { status: "NOT_AVAILABLE", folder_id: "", warnings: ["Google Drive недоступен; папка резервных копий не привязана."] };
  }
  var currentFile = DriveApp.getFileById(di3GetSpreadsheet_().getId());
  var description = String(currentFile.getDescription() || "");
  if (description.indexOf("DI3_RESTORE_V1:") !== 0) {
    return { status: "NOT_RESTORED_COPY", folder_id: "", warnings: warnings };
  }
  var restoreManifest;
  try { restoreManifest = JSON.parse(description.slice("DI3_RESTORE_V1:".length)); }
  catch (error) {
    throw new Error("Манифест восстановления повреждён; настройки backup не изменены. " + (error.message || String(error)));
  }
  var folderId = String(restoreManifest.backup_folder_id || "").trim();
  if (!folderId) {
    return { status: "LEGACY_BACKUP_NO_FOLDER_BINDING", folder_id: "", warnings: ["В манифесте старой резервной копии нет backup_folder_id. Укажи DI3_BACKUP_FOLDER_ID вручную после проверки папки Drive."] };
  }
  // Rebind the copied project to the original backup folder. Script Properties
  // are project-scoped and must not be assumed to carry over with file copying.
  var folder;
  try { folder = DriveApp.getFolderById(folderId); }
  catch (error) {
    // Persist the intended ID even while inaccessible. The regular backup path
    // will then fail closed on getFolderById instead of creating a second folder.
    PropertiesService.getScriptProperties().setProperty("DI3_BACKUP_FOLDER_ID", folderId);
    return { status: "FOLDER_NOT_ACCESSIBLE", folder_id: folderId, warnings: ["Исходная папка backup недоступна из восстановленной копии. Её ID сохранён, поэтому новые копии будут останавливаться до восстановления доступа: " + (error.message || String(error))] };
  }
  if (!folder || String(folder.getId()) !== folderId) {
    return { status: "FOLDER_NOT_ACCESSIBLE", folder_id: folderId, warnings: ["Не удалось подтвердить исходную папку backup; DI3_BACKUP_FOLDER_ID не изменён."] };
  }
  PropertiesService.getScriptProperties().setProperty("DI3_BACKUP_FOLDER_ID", folderId);
  return { status: "REBOUND", folder_id: folderId, folder_url: folder.getUrl(), warnings: warnings };
}

function di3RepairInstallableTriggersAfterRestore() {
  if (typeof di3InstallWarehouseManagerTrigger_ !== "function") {
    throw new Error("Не найден установщик триггеров. Проверь версию bound Apps Script проекта.");
  }
  var backupFolder = di3RestoreBackupFolderBindingFromCurrentFile_();
  di3InstallWarehouseManagerTrigger_();
  var diagnostics = typeof di3RunInstallationDiagnostics === "function"
    ? di3RunInstallationDiagnostics() : { status: "NOT_AVAILABLE", warnings: [] };
  var triggers = typeof ScriptApp !== "undefined" && ScriptApp.getProjectTriggers
    ? ScriptApp.getProjectTriggers().map(function (trigger) { return trigger.getHandlerFunction(); }) : [];
  var required = ["di3UnifiedOnEdit", "di3SupplyOnOpen"];
  var missing = required.filter(function (handler) { return triggers.indexOf(handler) === -1; });
  if (missing.length) throw new Error("Не удалось восстановить installable triggers: " + missing.join(", "));
  var result = {
    status: "READY", installed_triggers: required, all_trigger_handlers: triggers,
    backup_folder_binding: backupFolder, diagnostics: diagnostics,
    warnings: backupFolder.warnings || []
  };
  try { di3GetSpreadsheet_().toast("Общие триггеры установлены и проверены.", "Dots Inventory · Triggers", 8); } catch (ignoreToast) {}
  return result;
}

/** Lightweight server endpoint used by the non-blocking restore dialog. */
function di3GetSpreadsheetBackupsForRestoreDialog() {
  var report = di3ListSpreadsheetBackups_(10);
  return {
    status: report.status,
    folder_url: report.folder_url,
    backups: report.backups.map(function (item) {
      return {
        file_id: item.file_id,
        file_name: item.file_name,
        created_at_local: item.created_at_local,
        reason: item.reason,
        verification_level: item.verification_level,
        full_hash_coverage_ratio: item.full_hash_coverage_ratio
      };
    })
  };
}

/** Restore endpoint called asynchronously by the HTML dialog. */
function di3RestoreSpreadsheetBackupFromDialog(backupFileId) {
  return di3RestoreSpreadsheetBackup(backupFileId);
}

/**
 * Open an asynchronous HTML dialog instead of ui.prompt().
 * SpreadsheetApp UI prompts suspend the server execution while waiting for user
 * input; leaving the prompt open can consume the entire Apps Script runtime.
 */
function di3PromptRestoreSpreadsheetBackup() {
  var html = HtmlService.createHtmlOutput(di3BuildRestoreDialogHtml_())
    .setWidth(680)
    .setHeight(560);
  SpreadsheetApp.getUi().showModalDialog(html, "Восстановление из резервной копии");
  return { status: "DIALOG_OPENED" };
}

function di3BuildRestoreDialogHtml_() {
  return String.raw`<!DOCTYPE html>
<html><head><base target="_top"><meta charset="utf-8">
<style>
  body{font:13px Arial,sans-serif;color:#202124;margin:18px;background:#fff}
  h2{font-size:18px;margin:0 0 8px} .hint{color:#5f6368;line-height:1.45;margin:0 0 14px}
  .item{border:1px solid #dadce0;border-radius:8px;padding:12px;margin:9px 0}
  .meta{color:#5f6368;font-size:12px;margin:5px 0 9px;overflow-wrap:anywhere}
  button{border:0;border-radius:5px;padding:8px 12px;background:#1a73e8;color:white;cursor:pointer}
  button:disabled{background:#9aa0a6;cursor:default}.status{margin:12px 0;white-space:pre-wrap;line-height:1.45}
  .danger{color:#b3261e}.success{color:#137333}.warning{color:#b06000}a{color:#1a73e8}
</style></head><body>
<h2>Восстановление из резервной копии</h2>
<p class="hint">Будет создана <b>НОВАЯ таблица</b>. Текущая рабочая таблица не перезаписывается. После восстановления проверь данные и отдельно переустанови installable triggers в новой копии.</p>
<div id="status" class="status">Загружаю список резервных копий…</div>
<div id="list"></div>
<script>
(function(){
  var status=document.getElementById('status'), list=document.getElementById('list');
  function setStatus(message,kind){status.className='status '+(kind||'');status.textContent=message;}
  function load(){
    google.script.run.withSuccessHandler(function(report){
      list.textContent='';
      if(!report.backups||!report.backups.length){setStatus('Проверенных резервных копий нет. Сначала создай резервную копию.');return;}
      setStatus('Найдено резервных копий: '+report.backups.length+'. Папка: '+(report.folder_url||''));
      report.backups.forEach(function(item,index){
        var card=document.createElement('div');card.className='item';
        var title=document.createElement('b');title.textContent=(index+1)+'. '+(item.created_at_local||item.file_name||'Резервная копия');card.appendChild(title);
        var meta=document.createElement('div');meta.className='meta';
        var ratio=Number(item.full_hash_coverage_ratio);
        meta.textContent=(item.reason||'')+' · Проверка: '+(item.verification_level||'UNKNOWN')+(Number.isFinite(ratio)?' · Coverage: '+Math.round(ratio*100)+'%':'')+' · ID: '+item.file_id;
        card.appendChild(meta);
        var button=document.createElement('button');button.textContent='Восстановить в новую таблицу';
        button.addEventListener('click',function(){restore(item.file_id,button);});card.appendChild(button);list.appendChild(card);
      });
    }).withFailureHandler(function(error){setStatus('Не удалось загрузить резервные копии: '+(error&&error.message?error.message:String(error)),'danger');})
      .di3GetSpreadsheetBackupsForRestoreDialog();
  }
  function restore(id,button){
    if(!window.confirm('Создать отдельную новую таблицу из выбранной резервной копии? Исходная таблица останется без изменений.'))return;
    var buttons=list.querySelectorAll('button');buttons.forEach(function(b){b.disabled=true;});
    setStatus('Создаю новую таблицу и проверяю её. Не закрывай окно до завершения…');
    google.script.run.withSuccessHandler(function(result){
      var verification=result.verification||{};
      var level=result.verification_level||verification.verification_level||'UNKNOWN';
      var ratioValue=result.full_hash_coverage_ratio!==undefined?Number(result.full_hash_coverage_ratio):Number(verification.full_hash_coverage_ratio);
      var ratioText=Number.isFinite(ratioValue)?Math.round(ratioValue*100)+'%':'не указано';
      var isFull=level==='FULL';
      var details=[
        'Восстановление завершено: '+(result.restored_file_name||'новая таблица'),
        'Проверка целостности: '+level+' · Coverage: '+ratioText,
        isFull?'Все используемые ячейки прошли полную SHA-256 проверку.':'ВНИМАНИЕ: это не полная проверка всех используемых ячеек. Не считай копию полностью проверенной.',
        'ID восстановленной таблицы: '+(result.restored_file_id||'не указан'),
        'Текущая таблица не изменена. Проверь данные и переустанови триггеры из Apps Script editor восстановленной копии.'
      ];
      setStatus(details.join('\n'),isFull?'success':'warning');
      var link=document.createElement('a');link.href=result.restored_url;link.target='_blank';link.rel='noopener';link.textContent='Открыть восстановленную таблицу';
      var p=document.createElement('p');p.appendChild(link);list.insertBefore(p,list.firstChild);
    }).withFailureHandler(function(error){
      setStatus('Восстановление не завершилось: '+(error&&error.message?error.message:String(error))+'\nТекущая таблица не перезаписывается. Проверь Drive: копия могла быть создана до ошибки.','danger');
      buttons.forEach(function(b){b.disabled=false;});
    }).di3RestoreSpreadsheetBackupFromDialog(id);
  }
  load();
})();
</script></body></html>`;
}
