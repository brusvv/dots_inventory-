/**
 * Dots Inventory v3 RC8 — temporary, MUTATING supply-cancellation recovery probe.
 *
 * Use only on an isolated TEST COPY with a recent Drive backup.
 * Two existing, unreceived test supplies are cancelled by this probe:
 *  1) status write is committed, then its acknowledgement is lost;
 *  2) status write succeeds, history append fails before commit, then retry repairs history.
 * No stock movements or FIFO rows are created. Cancellation is permanent in the test copy.
 */
function di3TmpSupplyCancelFaultProbe(options) {
  options = options || {};
  if (String(options.confirmation || "") !== "TEST_COPY_ONLY") {
    throw new Error("Запуск заблокирован. Нужна отдельная тестовая копия и backup; передай confirmation='TEST_COPY_ONLY'.");
  }
  var lostAckNumber = String(options.lost_ack_supply_number || "").trim();
  var historyRetryNumber = String(options.history_retry_supply_number || "").trim();
  if (!lostAckNumber || !historyRetryNumber || lostAckNumber === historyRetryNumber) {
    throw new Error("Укажи два разных номера тестовых поставок: lost_ack_supply_number и history_retry_supply_number.");
  }
  if (typeof di3CancelSupplyByNumber_ !== "function" || typeof di3FindSupplyByNumber_ !== "function" ||
      typeof di3GetSupplyReceiptOperation_ !== "function" || typeof di3ReadRowsByColumnValue_ !== "function") {
    throw new Error("Не найдены production-компоненты отмены поставки. Установи согласованную текущую сборку RC8.");
  }

  var ss = di3GetSpreadsheet_();
  ["V3_Supplies", "V3_SupplyItems", "DocumentStatusHistory", "StockLedger", "Operations"]
    .forEach(function (name) {
      if (!ss.getSheetByName(name)) throw new Error("Отсутствует системный лист " + name + ". Сначала выполни штатную установку на тестовой копии.");
    });

  function requireEligibleSupply_(number) {
    var supply = di3FindSupplyByNumber_(number);
    if (!supply) throw new Error("Тестовая поставка не найдена: " + number);
    if ([DI3_SUPPLY_STATUS.CREATED, DI3_SUPPLY_STATUS.SENT, DI3_SUPPLY_STATUS.AWAITING].indexOf(String(supply.status)) === -1) {
      throw new Error("Поставка " + number + " должна быть не получена и не отменена. Текущий статус: " + supply.status);
    }
    if (di3GetSupplyReceiptOperation_(supply.supply_id)) {
      throw new Error("У поставки " + number + " уже есть операция приёмки; probe остановлен без изменений.");
    }
    if (di3ReadRowsByColumnValue_("StockLedger", 5, supply.supply_id).length) {
      throw new Error("У поставки " + number + " уже есть складские движения; probe остановлен без изменений.");
    }
    return supply;
  }

  var lostAckSupply = requireEligibleSupply_(lostAckNumber);
  var retrySupply = requireEligibleSupply_(historyRetryNumber);
  var ledgerBefore = di3ReadTableValues_("StockLedger").length;
  var report = {
    probe: "SUPPLY_CANCEL_FAULT_INJECTION_V1",
    mode: "MUTATING_TEST_COPY_ONLY",
    status: "RUNNING",
    supplies: { lost_ack: lostAckNumber, history_retry: historyRetryNumber },
    scenarios: [],
    stock_ledger_rows_before: ledgerBefore,
    warnings: [
      "Probe permanently cancels the two supplied test documents in this test copy.",
      "No stock movements are expected; cancellation is not reversible through this probe.",
      "Run only after a recent verified backup of an isolated workbook copy."
    ]
  };

  // Scenario 1: the production status writer commits, then its acknowledgement is lost.
  // Wrapping the application function is safer than monkey-patching Apps Script host objects.
  var originalSetCancelled = di3SetSupplyCancelledCell_;
  var statusAckInjected = false;
  di3SetSupplyCancelledCell_ = function (supply, cancelledAt) {
    var result = originalSetCancelled(supply, cancelledAt);
    statusAckInjected = true;
    throw new Error("Injected cancellation status acknowledgement loss after commit");
  };
  var lostAckResult = null;
  var lostAckError = "";
  try {
    lostAckResult = di3CancelSupplyByNumber_(lostAckNumber, "C04 fault probe: lost status acknowledgement");
  } catch (error) {
    lostAckError = String(error && error.message || error);
  } finally {
    di3SetSupplyCancelledCell_ = originalSetCancelled;
  }
  var lostAckAfter = di3FindSupplyByNumber_(lostAckNumber);
  var lostAckHistory = di3ReadRowsByColumnValue_("DocumentStatusHistory", 2, lostAckSupply.supply_id)
    .filter(function (row) { return String(row.values[1]) === "SUPPLY" && String(row.values[4]) === DI3_SUPPLY_STATUS.CANCELLED; });
  var lostAckPass = statusAckInjected && !lostAckError && lostAckResult &&
    String(lostAckResult.status) === "CANCELLED_ACK_RECOVERED" &&
    lostAckAfter && String(lostAckAfter.status) === DI3_SUPPLY_STATUS.CANCELLED && lostAckHistory.length === 1;
  report.scenarios.push({
    name: "STATUS_WRITE_COMMITTED_ACK_LOST",
    status: lostAckPass ? "PASS" : "FAIL",
    injection_reached: statusAckInjected,
    error: lostAckError,
    result_status: lostAckResult && lostAckResult.status || null,
    persisted_status: lostAckAfter && lostAckAfter.status || null,
    cancellation_history_rows: lostAckHistory.length
  });

  // Scenario 2: cancellation status commits; DocumentStatusHistory append fails before writing.
  var originalAppendRows = di3AppendTableRows_;
  var historyFailureInjected = false;
  di3AppendTableRows_ = function (sheetName, rows) {
    if (sheetName === "DocumentStatusHistory" && !historyFailureInjected) {
      historyFailureInjected = true;
      throw new Error("Injected DocumentStatusHistory append failure before commit");
    }
    return originalAppendRows(sheetName, rows);
  };
  var historyFailure = "";
  try {
    di3CancelSupplyByNumber_(historyRetryNumber, "C04 fault probe: history retry");
  } catch (error) {
    historyFailure = String(error && error.message || error);
  } finally {
    di3AppendTableRows_ = originalAppendRows;
  }
  var retryAfterFailure = di3FindSupplyByNumber_(historyRetryNumber);
  var historyBeforeRetry = di3ReadRowsByColumnValue_("DocumentStatusHistory", 2, retrySupply.supply_id)
    .filter(function (row) { return String(row.values[1]) === "SUPPLY" && String(row.values[4]) === DI3_SUPPLY_STATUS.CANCELLED; });
  var statusCommittedHistoryMissing = historyFailureInjected && /Injected DocumentStatusHistory append failure/.test(historyFailure) &&
    retryAfterFailure && String(retryAfterFailure.status) === DI3_SUPPLY_STATUS.CANCELLED && historyBeforeRetry.length === 0;
  var retryResult = null;
  var retryError = "";
  try {
    retryResult = di3CancelSupplyByNumber_(historyRetryNumber, "Повтор отмены после сбоя истории");
  } catch (error) {
    retryError = String(error && error.message || error);
  }
  var retryHistory = di3ReadRowsByColumnValue_("DocumentStatusHistory", 2, retrySupply.supply_id)
    .filter(function (row) { return String(row.values[1]) === "SUPPLY" && String(row.values[4]) === DI3_SUPPLY_STATUS.CANCELLED; });
  var retryPass = statusCommittedHistoryMissing && !retryError && retryResult &&
    String(retryResult.status) === "ALREADY_CANCELLED" && retryHistory.length === 1;
  report.scenarios.push({
    name: "STATUS_COMMITTED_HISTORY_APPEND_FAILED_THEN_RETRIED",
    status: retryPass ? "PASS" : "FAIL",
    injection_reached: historyFailureInjected,
    first_attempt_error: historyFailure,
    status_committed_history_missing_before_retry: statusCommittedHistoryMissing,
    retry_result_status: retryResult && retryResult.status || null,
    cancellation_history_rows_after_retry: retryHistory.length,
    repaired_history_comment: retryHistory.length ? String(retryHistory[0].values[8] || "") : null
  });

  var ledgerAfter = di3ReadTableValues_("StockLedger").length;
  report.stock_ledger_rows_after = ledgerAfter;
  report.stock_ledger_unchanged = ledgerAfter === ledgerBefore;
  report.status = report.scenarios.every(function (scenario) { return scenario.status === "PASS"; }) && report.stock_ledger_unchanged
    ? "PASS" : "REVIEW_REQUIRED";
  report.finished_at = new Date();
  Logger.log(JSON.stringify(report, null, 2));
  return report;
}
