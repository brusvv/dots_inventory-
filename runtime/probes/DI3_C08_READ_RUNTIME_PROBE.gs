/**
 * Dots Inventory v3 RC8 — temporary read-only C-08 TextFinder/read-cost probe.
 *
 * Run on a TEST COPY after installing the current RC8 production modules.
 * This script does not write to Sheets, create documents, update settings,
 * rebuild FIFO, run setup, or change triggers.
 * Remove this file after saving the JSON report.
 */
function di3TmpC08ReadRuntimeProbe(options) {
  options = options || {};
  var rounds = Math.max(1, Math.min(5, Number(options.rounds) || 3));
  // Allow 26+ distinct keys so the real runtime probe can exercise the exact-per-key fallback.
  // Keep the default small; use sample_keys: 30 for the >25 branch acceptance run.
  var sampleLimit = Math.max(2, Math.min(40, Number(options.sample_keys) || 5));
  var directScanMaxRows = Math.max(500, Math.min(10000, Number(options.direct_scan_max_rows) || 5000));
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new Error("Не удалось определить активную Google-таблицу.");

  var report = {
    probe: "C08_READ_RUNTIME_PROBE",
    mode: "READ_ONLY",
    started_at: new Date(),
    spreadsheet: {
      locale: ss.getSpreadsheetLocale(),
      time_zone: ss.getSpreadsheetTimeZone(),
      configured_time_zone: typeof di3GetConfiguredTimeZone_ === "function" ? di3GetConfiguredTimeZone_() : "UNAVAILABLE"
    },
    parameters: {
      rounds: rounds,
      sample_keys: sampleLimit,
      direct_scan_max_rows: directScanMaxRows,
      warmup_rounds: 1,
      measurement_order: "ALTERNATING_DIRECT_FIRST_AND_TEXTFINDER_FIRST"
    },
    tables: [],
    branch_coverage: {
      multi_key_findall_tables: [],
      exact_per_key_fallback_tables: [],
      fallback_threshold_exercised: false
    },
    full_view_sizes: {},
    errors: [],
    warnings: [
      "TextFinder elapsed_ms — время вызова в текущем Apps Script запуске; это не стабильный SLA и зависит от нагрузки Google.",
      "Перед замерами каждая стратегия выполняется один раз без учёта времени; порядок замеров чередуется между DIRECT_FIRST и TEXTFINDER_FIRST, чтобы уменьшить систематическое смещение от порядка вызова.",
      "direct_scan_cells — число ячеек ключевой колонки, которое пришлось бы передать через getValues при старом multi-key сканировании; это не число всех внутренних серверных операций.",
      "Никакие полные реестры, FIFO rebuild или бизнес-операции probe не запускает."
    ]
  };

  if (typeof DI3_TABLE_SCHEMAS === "undefined" ||
      typeof di3ReadRowsByColumnValue_ !== "function" ||
      typeof di3ReadRowsByColumnValues_ !== "function" ||
      typeof di3ReadRowsByColumnValuesViaTextFinder_ !== "function") {
    report.status = "BLOCKED";
    report.errors.push("Не найдены актуальные схемы/репозитории RC8. Установи согласованный набор production-модулей.");
    return di3TmpC08ProbeFinish_(report);
  }

  // Column indexes are zero-based and correspond to the key fields used by RC8 paths.
  var specs = [
    { sheet: "StockLedger", column: "event_key" },
    { sheet: "StockMovementDetails", column: "movement_id" },
    { sheet: "StockLots", column: "source_movement_id" },
    { sheet: "StockAllocations", column: "movement_id" },
    { sheet: "Operations", column: "idempotency_key" },
    { sheet: "OperationPayloads", column: "operation_id" },
    { sheet: "OperationAttempts", column: "operation_id" },
    { sheet: "V3_OrderItems", column: "order_id" },
    { sheet: "OrderCostSnapshots", column: "order_item_id" },
    { sheet: "_AppMeta", column: "key" }
  ];

  ["V3_Supplies", "V3_Orders", "StockLedger", "StockMovementDetails", "StockLots", "StockAllocations", "FifoAllocationRuns"]
    .forEach(function (name) {
      var sheet = ss.getSheetByName(name);
      report.full_view_sizes[name] = sheet ? Math.max(0, sheet.getLastRow() - 1) : null;
    });

  specs.forEach(function (spec) {
    try {
      var tableResult = di3TmpC08ProbeTable_(spec, rounds, sampleLimit, directScanMaxRows);
      report.tables.push(tableResult);
      if (tableResult && tableResult.status !== "SKIPPED" && tableResult.status !== "ERROR") {
        if (tableResult.multi_key_textfinder && tableResult.multi_key_textfinder.strategy === "MULTI_KEY_FINDALL") {
          report.branch_coverage.multi_key_findall_tables.push(spec.sheet);
        }
        if (tableResult.multi_key_textfinder && tableResult.multi_key_textfinder.strategy === "EXACT_PER_KEY_FALLBACK") {
          report.branch_coverage.exact_per_key_fallback_tables.push(spec.sheet);
          if (Number(tableResult.distinct_sample_keys) > 25) report.branch_coverage.fallback_threshold_exercised = true;
        }
      }
    } catch (error) {
      report.errors.push(spec.sheet + ": " + String(error && error.message || error));
      report.tables.push({ sheet: spec.sheet, status: "ERROR", error: String(error && error.message || error) });
    }
  });

  var failed = report.tables.filter(function (item) { return item.status === "FAIL" || item.status === "ERROR"; });
  if (sampleLimit > 25 && !report.branch_coverage.fallback_threshold_exercised) {
    report.warnings.push("Порог >25 не был фактически проверен: ни одна таблица не дала более 25 различных ключей в выбранном хвостовом sample. Повтори на таблице с достаточным количеством уникальных ключей или используй другую тестовую копию.");
  }
  report.status = failed.length ? "REVIEW_REQUIRED" : "COMPLETED_READ_ONLY";
  return di3TmpC08ProbeFinish_(report);
}

function di3TmpC08ProbeTable_(spec, rounds, sampleLimit, directScanMaxRows) {
  var schema = DI3_TABLE_SCHEMAS[spec.sheet];
  if (!schema) return { sheet: spec.sheet, status: "SKIPPED", reason: "NO_SCHEMA" };
  var columnIndex = schema.indexOf(spec.column);
  if (columnIndex < 0) return { sheet: spec.sheet, status: "FAIL", reason: "KEY_COLUMN_NOT_IN_SCHEMA", key_column: spec.column };
  var sheet = di3GetSheetOrThrow_(spec.sheet);
  var lastRow = sheet.getLastRow();
  var dataRows = Math.max(0, lastRow - 1);
  if (dataRows === 0) return { sheet: spec.sheet, status: "SKIPPED", reason: "EMPTY", key_column: spec.column };

  // Read only a small tail sample to discover real keys; the probe never exposes key values.
  var sampleRows = Math.min(Math.max(sampleLimit * 3, 12), dataRows);
  var sampleStart = lastRow - sampleRows + 1;
  var sampleValues = sheet.getRange(sampleStart, columnIndex + 1, sampleRows, 1).getValues();
  var keySet = Object.create(null);
  var keys = [];
  for (var i = sampleValues.length - 1; i >= 0 && keys.length < sampleLimit; i--) {
    var value = sampleValues[i][0];
    if (value == null || String(value) === "") continue;
    var key = String(value);
    if (!keySet[key]) { keySet[key] = true; keys.push(key); }
  }
  if (!keys.length) return { sheet: spec.sheet, status: "SKIPPED", reason: "NO_NONEMPTY_SAMPLE_KEYS", data_rows: dataRows, key_column: spec.column };
  keys.reverse();

  var directTimes = [], finderTimes = [], roundSamples = [];
  var directRows = null, finderRows = null;
  var finderCallsPerRound = keys.length <= 25 ? 1 : keys.length;
  var finderSearchCells = dataRows * rounds * finderCallsPerRound;
  var directEnabled = dataRows <= directScanMaxRows && keys.length > 1;

  // One untimed warm-up per available strategy reduces first-call/JIT/setup bias.
  // Warm-up results are discarded; correctness is verified against the independent
  // exact-key reference after the measured rounds.
  if (directEnabled) directRows = di3TmpC08DirectMultiKeyScan_(sheet, schema.length, columnIndex, keys);
  finderRows = di3ReadRowsByColumnValuesViaTextFinder_(spec.sheet, columnIndex, keys);

  for (var round = 0; round < rounds; round++) {
    var directFirst = directEnabled && round % 2 === 0;
    var sample = {
      round: round + 1,
      first_method: directEnabled ? (directFirst ? "DIRECT_SCAN" : "TEXTFINDER") : "TEXTFINDER",
      direct_elapsed_ms: null,
      textfinder_elapsed_ms: null
    };

    if (directFirst) {
      var directStarted = Date.now();
      directRows = di3TmpC08DirectMultiKeyScan_(sheet, schema.length, columnIndex, keys);
      sample.direct_elapsed_ms = Date.now() - directStarted;
      directTimes.push(sample.direct_elapsed_ms);

      var finderStarted = Date.now();
      finderRows = di3ReadRowsByColumnValuesViaTextFinder_(spec.sheet, columnIndex, keys);
      sample.textfinder_elapsed_ms = Date.now() - finderStarted;
      finderTimes.push(sample.textfinder_elapsed_ms);
    } else {
      var finderStartedFirst = Date.now();
      finderRows = di3ReadRowsByColumnValuesViaTextFinder_(spec.sheet, columnIndex, keys);
      sample.textfinder_elapsed_ms = Date.now() - finderStartedFirst;
      finderTimes.push(sample.textfinder_elapsed_ms);

      if (directEnabled) {
        var directStartedSecond = Date.now();
        directRows = di3TmpC08DirectMultiKeyScan_(sheet, schema.length, columnIndex, keys);
        sample.direct_elapsed_ms = Date.now() - directStartedSecond;
        directTimes.push(sample.direct_elapsed_ms);
      }
    }
    roundSamples.push(sample);
  }

  // Independent per-key exact lookups form a reference set for multi-key TextFinder.
  var referenceRows = [];
  keys.forEach(function (key) {
    var matches = di3ReadRowsByColumnValue_(spec.sheet, columnIndex, key);
    matches.forEach(function (match) { referenceRows.push(match.row_number); });
  });
  referenceRows = di3TmpC08UniqueSortedNumbers_(referenceRows);
  var finderRowNumbers = di3TmpC08UniqueSortedNumbers_(finderRows.map(function (match) { return match.row_number; }));
  var finderMatchesReference = JSON.stringify(referenceRows) === JSON.stringify(finderRowNumbers);
  var directMatchesReference = directEnabled
    ? JSON.stringify(referenceRows) === JSON.stringify(di3TmpC08UniqueSortedNumbers_(directRows.map(function (match) { return match.row_number; })))
    : null;

  var finderReturnedRows = finderRows.length;
  var directTransferCells = directEnabled ? rounds * (dataRows + directRows.reduce(function (sum, match) {
    return sum + (match.values ? match.values.length : schema.length);
  }, 0)) : null;

  return {
    sheet: spec.sheet,
    status: finderMatchesReference && (directMatchesReference === null || directMatchesReference) ? "PASS" : "FAIL",
    key_column: spec.column,
    key_column_index_zero_based: columnIndex,
    data_rows: dataRows,
    schema_width: schema.length,
    search_range_rows_per_finder_call: dataRows,
    distinct_sample_keys: keys.length,
    matches: finderReturnedRows,
    rounds: rounds,
    warmup_rounds: 1,
    measurement_order: "ALTERNATING_DIRECT_FIRST_AND_TEXTFINDER_FIRST",
    round_samples: roundSamples,
    multi_key_textfinder: {
      strategy: keys.length <= 25 ? "MULTI_KEY_FINDALL" : "EXACT_PER_KEY_FALLBACK",
      threshold_key_count: 25,
      fallback_threshold_exercised: keys.length > 25,
      elapsed_ms: finderTimes,
      median_elapsed_ms: di3TmpC08Median_(finderTimes),
      calls_per_round: finderCallsPerRound,
      calls_across_rounds: rounds * finderCallsPerRound,
      search_cells_across_rounds: finderSearchCells,
      exact_reference_lookup_calls: keys.length,
      matched_row_transfer_cells_per_round_approx: finderReturnedRows * schema.length,
      matches_exact_reference: finderMatchesReference
    },
    legacy_key_column_scan: {
      measured: directEnabled,
      elapsed_ms: directEnabled ? directTimes : null,
      median_elapsed_ms: directEnabled ? di3TmpC08Median_(directTimes) : null,
      transferred_cells_across_rounds: directTransferCells,
      key_column_cells_per_round: directEnabled ? dataRows : null,
      matches_exact_reference: directMatchesReference,
      skipped_reason: directEnabled ? "" : (keys.length <= 1 ? "NEED_AT_LEAST_TWO_DISTINCT_KEYS" : "DATA_ROWS_ABOVE_DIRECT_SCAN_LIMIT")
    },
    reference_exact_matches: referenceRows.length
  };
}

function di3TmpC08DirectMultiKeyScan_(sheet, schemaWidth, columnIndex, keys) {
  // Reproduce the prior repository strategy fairly: one key-column transfer,
  // then full-row reads grouped into contiguous blocks. Avoid per-row RPCs.
  var targets = Object.create(null);
  keys.forEach(function (key) { targets[String(key)] = true; });
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  var keyValues = sheet.getRange(2, columnIndex + 1, lastRow - 1, 1).getValues();
  var rowNumbers = [];
  keyValues.forEach(function (row, index) {
    if (Object.prototype.hasOwnProperty.call(targets, String(row[0]))) rowNumbers.push(index + 2);
  });
  if (!rowNumbers.length) return [];
  var results = [];
  var groupStart = rowNumbers[0];
  var previousRow = rowNumbers[0];
  function flush(start, end) {
    var block = sheet.getRange(start, 1, end - start + 1, schemaWidth).getValues();
    block.forEach(function (row, offset) {
      if (Object.prototype.hasOwnProperty.call(targets, String(row[columnIndex]))) {
        results.push({ row_number: start + offset, values: row });
      }
    });
  }
  for (var i = 1; i < rowNumbers.length; i++) {
    if (rowNumbers[i] !== previousRow + 1) {
      flush(groupStart, previousRow);
      groupStart = rowNumbers[i];
    }
    previousRow = rowNumbers[i];
  }
  flush(groupStart, previousRow);
  return results;
}

function di3TmpC08UniqueSortedNumbers_(values) {
  var seen = Object.create(null);
  return values.map(Number).filter(function (value) {
    if (!Number.isInteger(value) || seen[value]) return false;
    seen[value] = true;
    return true;
  }).sort(function (a, b) { return a - b; });
}

function di3TmpC08Median_(values) {
  if (!values || !values.length) return null;
  var sorted = values.slice().sort(function (a, b) { return a - b; });
  var middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function di3TmpC08ProbeFinish_(report) {
  report.finished_at = new Date();
  report.elapsed_ms = report.finished_at.getTime() - new Date(report.started_at).getTime();
  var json = JSON.stringify(report, function (key, value) {
    if (key === "started_at" || key === "finished_at") return value instanceof Date ? value.toISOString() : value;
    return value;
  }, 2);
  Logger.log(json);
  return report;
}
