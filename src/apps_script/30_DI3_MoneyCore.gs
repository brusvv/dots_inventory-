/**
 * Dots Inventory v3 — shared money primitives.
 *
 * The current base currency is RUB (two decimal minor units). FIFO lot total
 * cost and allocation cost are authoritative integer kopeks. A per-unit cost
 * may remain a repeating decimal (for display or estimates only); actual
 * consumption cost is allocated from total_cost_minor by cumulative rounding,
 * so movement chunking cannot change the total allocated amount.
 */
var DI3_MONEY_MINOR_UNIT_SCALE = 100;

/** Convert a finite amount to integer minor units using a single rounding rule. */
function di3MoneyToMinorUnits_(value, fieldName, allowNegative) {
  var amount = Number(value);
  var label = String(fieldName || "Сумма");
  if (!Number.isFinite(amount) || (!allowNegative && amount < 0)) {
    throw new Error(label + (allowNegative ? " должна быть числом." : " должна быть неотрицательным числом."));
  }
  var scaled = amount * DI3_MONEY_MINOR_UNIT_SCALE;
  // Normalize the usual binary floating-point representation noise before
  // applying decimal half-up rounding (e.g. 10.075 * 100 may be 1007.499999…).
  // Keep the exact sign-aware rule for negative values as well; Math.round()
  // alone rounds negative halves toward +Infinity.
  var normalized = Math.abs(scaled) < 1e15 ? Number(scaled.toPrecision(15)) : scaled;
  var magnitude = Math.floor(Math.abs(normalized) + 0.5);
  var minorUnits = normalized < 0 ? -magnitude : magnitude;
  if (!Number.isSafeInteger(minorUnits)) throw new Error(label + " выходит за допустимый денежный диапазон.");
  return minorUnits;
}

/** Convert integer minor units to the current base-currency decimal amount. */
function di3MoneyFromMinorUnits_(minorUnits) {
  var value = Number(minorUnits);
  if (!Number.isSafeInteger(value)) throw new Error("Денежная сумма в копейках должна быть безопасным целым числом.");
  return value / DI3_MONEY_MINOR_UNIT_SCALE;
}

/** Round a decimal amount to the base currency's minor-unit precision. */
function di3MoneyRound_(value) {
  return di3MoneyFromMinorUnits_(di3MoneyToMinorUnits_(value, "Сумма", true));
}


/** Money FIFO schema version. Integer minor-unit fields are the financial source of truth. */
var DI3_MONEY_FIFO_SCHEMA_VERSION = "1";

/**
 * Multiply/divide/round non-negative safe integers without an unsafe intermediate product.
 * Preconditions are intentionally narrower than generic mul-div: 0 <= left < denominator,
 * 0 <= right <= denominator. The quotient is therefore bounded by `left`.
 */
function di3MoneyMulDivRoundHalfUpSafe_(left, right, denominator) {
  var a = Number(left), b = Number(right), d = Number(denominator);
  if (!Number.isSafeInteger(a) || a < 0 || !Number.isSafeInteger(b) || b < 0 ||
      !Number.isSafeInteger(d) || d <= 0 || a >= d || b > d) {
    throw new Error("Некорректные параметры точного целочисленного умножения/деления.");
  }
  if (a === 0 || b === 0) return 0;

  // Process multiplier bits while keeping quotient and remainder separately.
  // The remainder is always below d. Compare against (d - remainder) instead
  // of doubling it, and against (d - a) instead of adding a, to avoid overflow.
  var bits = [];
  var remaining = b;
  while (remaining > 0) {
    bits.push(remaining % 2);
    remaining = Math.floor(remaining / 2);
  }
  var quotient = 0;
  var remainder = 0;
  for (var i = bits.length - 1; i >= 0; i--) {
    var carry = 0;
    if (remainder >= d - remainder) {
      remainder = remainder - (d - remainder);
      carry = 1;
    } else {
      remainder = remainder + remainder;
    }
    quotient = quotient * 2 + carry;
    if (bits[i]) {
      if (remainder >= d - a) {
        remainder = remainder - (d - a);
        quotient += 1;
      } else {
        remainder = remainder + a;
      }
    }
  }
  if (remainder >= Math.ceil(d / 2)) quotient += 1;
  if (!Number.isSafeInteger(quotient)) {
    throw new Error("Результат распределения себестоимости выходит за безопасный диапазон.");
  }
  return quotient;
}

/** Round a non-negative rational amount to the nearest integer minor unit (half up). */
function di3MoneyRoundRatioToInteger_(totalMinor, numerator, denominator) {
  var total = Number(totalMinor), part = Number(numerator), whole = Number(denominator);
  if (!Number.isSafeInteger(total) || total < 0 || !Number.isSafeInteger(part) ||
      !Number.isSafeInteger(whole) || whole <= 0 || part < 0 || part > whole) {
    throw new Error("Некорректные параметры распределения денежной суммы по количеству.");
  }
  var quotient = Math.floor(total / whole);
  var remainder = total - quotient * whole;
  var base = quotient * part;
  if (!Number.isSafeInteger(base)) {
    throw new Error("Распределение себестоимости выходит за безопасный целочисленный диапазон.");
  }
  var fractional = di3MoneyMulDivRoundHalfUpSafe_(remainder, part, whole);
  var result = base + fractional;
  if (!Number.isSafeInteger(result)) throw new Error("Результат распределения себестоимости выходит за безопасный диапазон.");
  return result;
}

/**
 * Allocate one FIFO chunk from a lot using cumulative proportional rounding.
 * The sum of all chunks consumed from a lot is exactly its total_cost_minor,
 * independent of how consumption is split across movements.
 */
function di3MoneyAllocateLotCostMinor_(totalMinor, initialQuantity, consumedBefore, takeQuantity) {
  var total = Number(totalMinor), initial = Number(initialQuantity);
  var consumed = Number(consumedBefore), take = Number(takeQuantity);
  if (!Number.isSafeInteger(initial) || initial <= 0 || !Number.isSafeInteger(consumed) ||
      !Number.isSafeInteger(take) || consumed < 0 || take <= 0 || consumed + take > initial) {
    throw new Error("Некорректное количество при распределении себестоимости FIFO-партии.");
  }
  var before = di3MoneyRoundRatioToInteger_(total, consumed, initial);
  var after = di3MoneyRoundRatioToInteger_(total, consumed + take, initial);
  return after - before;
}

/** Resolve the exact total cost of a FIFO lot, with a compatibility fallback for pre-migration rows. */
function di3MoneyGetLotTotalCostMinor_(lotRow) {
  if (!lotRow) throw new Error("Не передана FIFO-партия для расчёта себестоимости.");
  var status = String(lotRow[10] || "UNKNOWN");
  var quantity = Number(lotRow[8]);
  if (!Number.isSafeInteger(quantity) || quantity <= 0) throw new Error("Некорректное количество FIFO-партии " + String(lotRow[0] || "") + ".");
  var stored = lotRow.length > 14 ? lotRow[14] : "";
  if (status === "UNKNOWN") {
    if (stored !== "" && stored != null) throw new Error("UNKNOWN-партия " + String(lotRow[0] || "") + " не должна содержать total_cost_minor.");
    return null;
  }
  if (status === "FREE") {
    if (stored !== "" && stored != null && (!Number.isSafeInteger(Number(stored)) || Number(stored) !== 0)) {
      throw new Error("FREE-партия " + String(lotRow[0] || "") + " должна иметь total_cost_minor = 0.");
    }
    return 0;
  }
  if (status !== "KNOWN") throw new Error("Неизвестный статус себестоимости FIFO-партии " + String(lotRow[0] || "") + ".");
  if (stored !== "" && stored != null) {
    var minor = Number(stored);
    if (!Number.isSafeInteger(minor) || minor < 0) throw new Error("Некорректное значение total_cost_minor у партии " + String(lotRow[0] || "") + ".");
    return minor;
  }
  var unitCost = Number(lotRow[9]);
  if (!Number.isFinite(unitCost) || unitCost < 0) throw new Error("Некорректная unit_cost у партии " + String(lotRow[0] || "") + ".");
  return di3MoneyToMinorUnits_(unitCost * quantity, "Полная себестоимость партии", false);
}

/** Readiness marker. A non-empty legacy workbook must be explicitly rebuilt before new operations. */
function di3EnsureMoneyMinorUnitsState_() {
  var version = typeof di3GetAppMetaValue_ === "function" ? di3GetAppMetaValue_("money_fifo_schema_version") : null;
  var status = typeof di3GetAppMetaValue_ === "function" ? di3GetAppMetaValue_("money_fifo_migration_status") : null;
  if (String(version || "") === DI3_MONEY_FIFO_SCHEMA_VERSION && String(status || "") === "READY") {
    return { status: "READY", version: String(version) };
  }
  var ledger = di3ReadTableValues_("StockLedger");
  var lots = di3ReadTableValues_("StockLots");
  var allocations = di3ReadTableValues_("StockAllocations");
  if (!ledger.length && !lots.length && !allocations.length) {
    di3SetAppMetaValue_("money_fifo_schema_version", DI3_MONEY_FIFO_SCHEMA_VERSION);
    di3SetAppMetaValue_("money_fifo_migration_status", "READY");
    return { status: "READY", initialized_empty: true, version: DI3_MONEY_FIFO_SCHEMA_VERSION };
  }
  di3SetAppMetaValue_("money_fifo_migration_status", "MIGRATION_REQUIRED");
  return { status: "MIGRATION_REQUIRED", version: String(version || ""), lots: lots.length, allocations: allocations.length, movements: ledger.length };
}

function di3AssertMoneyMinorUnitsReady_() {
  var status = typeof di3GetAppMetaValue_ === "function" ? di3GetAppMetaValue_("money_fifo_migration_status") : null;
  var version = typeof di3GetAppMetaValue_ === "function" ? di3GetAppMetaValue_("money_fifo_schema_version") : null;
  if (String(status || "") !== "READY" || String(version || "") !== DI3_MONEY_FIFO_SCHEMA_VERSION) {
    throw new Error("Денежная модель FIFO ещё не мигрирована. Создай резервную копию и запусти «Система → Пересчитать FIFO в копейках» перед новыми складскими операциями.");
  }
  return true;
}

/** Add StockLots.total_cost_minor without moving any existing columns. */
function di3UpgradeStockLotsMoneySchema_(forceBackfill) {
  var sheet = di3GetSpreadsheet_().getSheetByName("StockLots");
  if (!sheet || sheet.getLastRow() === 0) return { upgraded: false, reason: "SHEET_NOT_CREATED_OR_EMPTY" };
  var header = sheet.getMaxColumns() >= 15 ? di3NormalizeHeader_(sheet.getRange(1, 15).getDisplayValue()) : "";
  if (header && header !== "total_cost_minor") throw new Error("StockLots: колонка O занята заголовком «" + header + "». Миграция остановлена.");
  if (!header && di3PreflightHasBodyValues_(sheet, 15, 1)) throw new Error("StockLots: колонка O содержит данные при пустом заголовке. Миграция остановлена без перезаписи.");
  if (sheet.getMaxColumns() < 15) sheet.insertColumnsAfter(sheet.getMaxColumns(), 15 - sheet.getMaxColumns());
  if (!header) sheet.getRange(1, 15).setValue("total_cost_minor");
  // A complete money schema is checked by the explicit migration and readiness marker.
  // Do not scan all historical lots on every ordinary stock operation.
  if (header === "total_cost_minor" && !forceBackfill) return { upgraded: false, already_current: true, backfill_skipped: true };
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return { upgraded: !header, backfilled: 0 };
  var rows = sheet.getRange(2, 1, lastRow - 1, 15).getValues();
  var updates = [];
  rows.forEach(function (row, index) {
    if (!row[0]) return;
    var status = String(row[10] || "UNKNOWN");
    var current = row[14];
    var expected = status === "UNKNOWN" ? "" : (status === "FREE" ? 0 : di3MoneyGetLotTotalCostMinor_(row));
    if (status !== "KNOWN" && status !== "FREE" && status !== "UNKNOWN") {
      throw new Error("StockLots: неизвестный cost_status в строке " + (index + 2) + ".");
    }
    if (current !== "" && current != null) {
      if (!Number.isSafeInteger(Number(current)) || Number(current) < 0) throw new Error("StockLots: некорректный total_cost_minor в строке " + (index + 2) + ".");
      if (status !== "UNKNOWN" && Number(current) !== Number(expected)) {
        // Existing exact values are authoritative; expected is only a legacy-derived compatibility check.
        if (header === "total_cost_minor") return;
      }
      return;
    }
    if (status === "UNKNOWN") return;
    updates.push({ row_number: index + 2, value: expected });
  });
  updates.forEach(function (item) { sheet.getRange(item.row_number, 15).setValue(item.value); });
  return { upgraded: !header, backfilled: updates.length };
}

/** Add StockAllocations.allocated_cost_minor. Values are populated by the mandatory full FIFO replay. */
function di3UpgradeStockAllocationsMoneySchema_() {
  var sheet = di3GetSpreadsheet_().getSheetByName("StockAllocations");
  if (!sheet || sheet.getLastRow() === 0) return { upgraded: false, reason: "SHEET_NOT_CREATED_OR_EMPTY" };
  var header = sheet.getMaxColumns() >= 14 ? di3NormalizeHeader_(sheet.getRange(1, 14).getDisplayValue()) : "";
  if (header && header !== "allocated_cost_minor") throw new Error("StockAllocations: колонка N занята заголовком «" + header + "». Миграция остановлена.");
  if (!header && di3PreflightHasBodyValues_(sheet, 14, 1)) throw new Error("StockAllocations: колонка N содержит данные при пустом заголовке. Миграция остановлена без перезаписи.");
  if (sheet.getMaxColumns() < 14) sheet.insertColumnsAfter(sheet.getMaxColumns(), 14 - sheet.getMaxColumns());
  if (!header) sheet.getRange(1, 14).setValue("allocated_cost_minor");
  return { upgraded: !header };
}

/** Validate and explicitly rebuild the active FIFO projection using exact integer minor units. */
function di3RunMoneyMinorUnitsMigration() {
  var ui = SpreadsheetApp.getUi();
  var answer = ui.alert(
    "Пересчёт денежных значений и FIFO",
    "Будет запущена предварительная проверка, затем создана полная верифицированная резервная копия. После этого миграция обновит денежные поля FIFO и полностью перестроит активные FIFO-распределения. Это изменяет системные данные и может затронуть расчёт себестоимости заказов. StockLedger не переписывается.\n\nПри ошибке автоматический откат не выполняется; для возврата к исходному состоянию потребуется восстановить проверенную копию.\n\nПродолжить?",
    ui.ButtonSet.YES_NO
  );
  if (answer !== ui.Button.YES) return { status: "CANCELLED_BY_USER", migrated: false };
  return di3WithLock_(function () {
    var dryRun = typeof di3DryRunInstallation === "function" ? di3DryRunInstallation() : { status: "READY", issues: [] };
    if (dryRun.status !== "READY") {
      throw new Error("Миграция денежных значений остановлена предварительной проверкой: " + (dryRun.issues || []).join("; "));
    }
    if (di3GetSpreadsheet_().getSheetByName("Operations")) di3AssertNoPendingStockOperations_();
    // Money migration changes FIFO cost fields and rebuilds historical allocations.
    // A verified full workbook copy is mandatory before the first mutation.
    var migrationBackup = di3CreateSpreadsheetBackupInternal_("MONEY_MINOR_UNITS_MIGRATION");
    di3EnsureCoreFoundationSchemas_();
    di3UpgradeStockLotsMoneySchema_(true);
    di3AssertNoPendingStockOperations_();
    di3SetAppMetaValue_("money_fifo_migration_status", "PREPARED");
    try {
      var lotRows = di3ReadTableValues_("StockLots");
      lotRows.forEach(function (row, index) {
        if (!row[0]) return;
        var expected = String(row[10] || "UNKNOWN") === "UNKNOWN" ? null : di3MoneyGetLotTotalCostMinor_(row);
        var stored = row.length > 14 ? row[14] : "";
        if (expected !== null && (stored === "" || stored == null || Number(stored) !== expected)) {
          throw new Error("Партия " + row[0] + ": total_cost_minor не прошёл проверку миграции.");
        }
      });
      var rebuild = di3RebuildFifoAllocations_("MONEY_MINOR_UNITS_MIGRATION", null);
      var diagnostics = di3GetFifoIntegrityDiagnostics_();
      if (diagnostics.errors.length) throw new Error("После пересчёта FIFO найдены ошибки: " + diagnostics.errors.join("; "));
      di3SetAppMetaValue_("money_fifo_schema_version", DI3_MONEY_FIFO_SCHEMA_VERSION);
      di3SetAppMetaValue_("money_fifo_migration_status", "READY");
      return { status: "READY", backup: migrationBackup, rebuild: rebuild, diagnostics: diagnostics.summary };
    } catch (error) {
      try { di3SetAppMetaValue_("money_fifo_migration_status", "MIGRATION_FAILED"); } catch (ignore) {}
      throw error;
    }
  });
}


/** Resolve an allocation's exact integer amount; legacy fallback is used only before migration rebuild. */
function di3MoneyGetAllocationCostMinor_(allocationRow) {
  if (!allocationRow) throw new Error("Не передана строка FIFO-распределения.");
  var status = String(allocationRow[8] || "UNKNOWN");
  var stored = allocationRow.length > 13 ? allocationRow[13] : "";
  if (status === "UNKNOWN") {
    if (stored !== "" && stored != null) throw new Error("UNKNOWN-распределение не должно содержать allocated_cost_minor.");
    return null;
  }
  if (status === "FREE") {
    if (stored !== "" && stored != null && (!Number.isSafeInteger(Number(stored)) || Number(stored) !== 0)) {
      throw new Error("FREE-распределение должно иметь allocated_cost_minor = 0.");
    }
    return 0;
  }
  if (status !== "KNOWN") throw new Error("Неизвестный статус себестоимости FIFO-распределения.");
  if (stored !== "" && stored != null) {
    var value = Number(stored);
    if (!Number.isSafeInteger(value) || value < 0) throw new Error("Некорректное allocated_cost_minor.");
    return value;
  }
  return di3MoneyToMinorUnits_(Number(allocationRow[9]), "Стоимость FIFO-распределения", false);
}

function di3MoneyGetLotRemainingCostMinor_(lotRow, remainingQuantity) {
  var status = String(lotRow[10] || "UNKNOWN");
  if (status === "UNKNOWN") return null;
  if (status === "FREE") return 0;
  var initial = Number(lotRow[8]);
  var remaining = Number(remainingQuantity);
  if (!Number.isSafeInteger(remaining) || remaining < 0 || remaining > initial) {
    throw new Error("Некорректный остаток для расчёта стоимости партии " + String(lotRow[0] || "") + ".");
  }
  var total = di3MoneyGetLotTotalCostMinor_(lotRow);
  return total - di3MoneyRoundRatioToInteger_(total, initial - remaining, initial);
}
