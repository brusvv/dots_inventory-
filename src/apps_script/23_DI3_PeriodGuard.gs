/** Dots Inventory v3 — accounting-period guard and controlled backdating policy. */

function di3GetPeriodKey_(dateValue) {
  var date = di3ToDate_(dateValue, "Дата операции");
  return Utilities.formatDate(date, di3GetConfiguredTimeZone_(), "yyyy-MM");
}

function di3GetPeriodBounds_(periodKey) {
  var match = String(periodKey || "").match(/^(\d{4})-(0[1-9]|1[0-2])$/);
  if (!match) throw new Error("Период должен иметь формат ГГГГ-ММ, например 2026-11.");
  var year = Number(match[1]);
  var month = Number(match[2]);
  return {
    period_key: String(periodKey),
    start: new Date(year, month - 1, 1, 0, 0, 0, 0),
    end: new Date(year, month, 0, 23, 59, 59, 999)
  };
}

/**
 * PeriodLocks is an append-only event log. Older RC8 rows are treated as the
 * first event for their period; later LOCKED/REOPENED rows supersede them.
 */
function di3GetLockedPeriods_() {
  if (!di3GetSpreadsheet_().getSheetByName("PeriodLocks")) return [];
  return di3ReadTableValues_("PeriodLocks").map(function (row, index) {
    return {
      period_key: String(row[0] || ""),
      period_start: row[1] ? di3ToDate_(row[1], "PeriodLocks.period_start") : null,
      period_end: row[2] ? di3ToDate_(row[2], "PeriodLocks.period_end") : null,
      status: String(row[3] || ""),
      locked_at: row[4] || "",
      locked_by: String(row[5] || ""),
      reopened_at: row[6] || "",
      reopened_by: String(row[7] || ""),
      reopen_reason: String(row[8] || ""),
      note: String(row[9] || ""),
      row_number: index + 2
    };
  });
}

/** Return the last event for each period, preserving physical append order. */
function di3GetLatestPeriodEvents_() {
  var latestByKey = Object.create(null);
  di3GetLockedPeriods_().forEach(function (item) {
    if (!item.period_key) return;
    var previous = latestByKey[item.period_key];
    if (!previous || item.row_number > previous.row_number) latestByKey[item.period_key] = item;
  });
  return Object.keys(latestByKey).map(function (key) { return latestByKey[key]; });
}

function di3GetLatestPeriodEvent_(periodKey) {
  var key = String(periodKey || "");
  var latest = null;
  di3GetLockedPeriods_().forEach(function (item) {
    if (item.period_key === key && (!latest || item.row_number > latest.row_number)) latest = item;
  });
  return latest;
}

function di3GetLatestLockedPeriod_() {
  var locked = di3GetLatestPeriodEvents_().filter(function (item) {
    return item.status === "LOCKED" && item.period_end;
  });
  if (!locked.length) return null;
  locked.sort(function (a, b) { return a.period_end.getTime() - b.period_end.getTime(); });
  return locked[locked.length - 1];
}

/** Rejects an operation that would change stock/financial history inside or before a closed period. */
function di3AssertPeriodOpen_(effectiveAt, operationLabel) {
  var date = di3ToDate_(effectiveAt, "Дата операции");
  var latest = di3GetLatestLockedPeriod_();
  if (!latest) return { allowed: true, period_key: di3GetPeriodKey_(date), locked_through: null };
  if (date.getTime() <= latest.period_end.getTime()) {
    throw new Error((operationLabel || "Операция") + " датирована " + di3GetPeriodKey_(date) + ", но учёт закрыт по " + latest.period_key + ". Для исправления открой последний закрытый период или создай корректирующую операцию текущей датой.");
  }
  return { allowed: true, period_key: di3GetPeriodKey_(date), locked_through: latest.period_key };
}

function di3AssertNoPendingOperationsBeforePeriodClose_() {
  var rows = di3ReadTableValues_("Operations");
  var pending = rows.filter(function (row) {
    return ["MANUAL_STOCK_MOVEMENT", "SUPPLY_RECEIVE", "ORDER_DISPATCH", "ORDER_RETURN", "STOCK_ADJUSTMENT"].indexOf(String(row[2])) !== -1 &&
      ["PREPARED", "RETRYABLE", "QUARANTINED"].indexOf(String(row[5])) !== -1;
  });
  if (pending.length) throw new Error("Нельзя закрыть период: есть незавершённые складские операции (" + pending.length + "). Сначала восстанови их.");
}

function di3CloseAccountingPeriod(periodKey, note) {
  return di3WithLock_(function () {
    di3EnsureCoreFoundationSchemas_();
    var bounds = di3GetPeriodBounds_(periodKey);
    var now = new Date();
    var currentMonthStart = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
    if (bounds.end.getTime() >= currentMonthStart.getTime()) {
      throw new Error("Можно закрывать только полностью завершившиеся месяцы.");
    }
    var existing = di3GetLatestPeriodEvent_(bounds.period_key);
    if (existing && existing.status === "LOCKED") {
      return { status: "ALREADY_LOCKED", period_key: bounds.period_key, period_end: bounds.end };
    }
    var latest = di3GetLatestLockedPeriod_();
    if (latest) {
      var nextMonth = new Date(latest.period_end.getFullYear(), latest.period_end.getMonth() + 1, 1);
      if (bounds.start.getTime() !== nextMonth.getTime()) {
        throw new Error("Периоды закрываются последовательно. Следующий период для закрытия: " + di3GetPeriodKey_(nextMonth) + ".");
      }
    }
    di3AssertNoPendingOperationsBeforePeriodClose_();
    var actor = "";
    actor = di3GetActorEmail_();
    // Never overwrite a prior LOCKED/REOPENED event. A re-close is a new event.
    var row = [bounds.period_key, bounds.start, bounds.end, "LOCKED", now, actor, "", "", "", String(note || "")];
    di3AppendTableRows_("PeriodLocks", [row]);
    return { status: "LOCKED", period_key: bounds.period_key, period_end: bounds.end, locked_by: actor };
  });
}

/** Reopen only the most recently locked month; the reason is stored as a new immutable event. */
function di3ReopenAccountingPeriod(periodKey, reason) {
  return di3WithLock_(function () {
    di3EnsureCoreFoundationSchemas_();
    var why = di3NormalizeText_(reason);
    if (!why) throw new Error("Укажи причину повторного открытия периода.");
    var latest = di3GetLatestLockedPeriod_();
    if (!latest || latest.period_key !== String(periodKey)) {
      throw new Error("Можно открыть только последний закрытый период.");
    }
    var actor = "";
    actor = di3GetActorEmail_();
    var row = [
      latest.period_key, latest.period_start, latest.period_end, "REOPENED", latest.locked_at,
      latest.locked_by, new Date(), actor, why, latest.note
    ];
    di3AppendTableRows_("PeriodLocks", [row]);
    return { status: "REOPENED", period_key: latest.period_key, reason: why, reopened_by: actor };
  });
}

function di3GetPeriodGuardStatus() {
  var latest = di3GetLatestLockedPeriod_();
  var periods = di3GetLatestPeriodEvents_().sort(function (a, b) {
    return a.period_end && b.period_end ? a.period_end.getTime() - b.period_end.getTime() : String(a.period_key).localeCompare(String(b.period_key));
  });
  return {
    status: latest ? "LOCKED_THROUGH" : "OPEN",
    locked_through: latest ? latest.period_key : null,
    period_end: latest ? latest.period_end : null,
    periods: periods.map(function (item) {
      return {
        period_key: item.period_key, status: item.status, locked_at: item.locked_at,
        locked_by: item.locked_by, reopened_at: item.reopened_at,
        reopened_by: item.reopened_by, reopen_reason: item.reopen_reason, note: item.note
      };
    })
  };
}

function di3ShowPeriodGuardStatus() {
  var status = di3GetPeriodGuardStatus();
  var message = status.status === "OPEN" ? "Закрытых периодов нет. Задние даты разрешены." :
    "Учёт закрыт по " + status.locked_through + ". Более ранние и текущие даты до границы закрытия заблокированы.";
  SpreadsheetApp.getUi().alert("Состояние учётного периода", message, SpreadsheetApp.getUi().ButtonSet.OK);
  return status;
}

function di3PromptCloseAccountingPeriod() {
  var ui = SpreadsheetApp.getUi();
  var response = ui.prompt("Закрыть учётный период", "Укажи месяц в формате ГГГГ-ММ, например 2026-10. Закрытие запретит новые операции с датой в этом месяце и раньше.", ui.ButtonSet.OK_CANCEL);
  if (response.getSelectedButton() !== ui.Button.OK) return { status: "CANCELLED" };
  var result = di3CloseAccountingPeriod(response.getResponseText().trim(), "Закрыт пользователем через меню");
  ui.alert("Период закрыт", result.period_key, ui.ButtonSet.OK);
  return result;
}

function di3PromptReopenAccountingPeriod() {
  var ui = SpreadsheetApp.getUi();
  var status = di3GetPeriodGuardStatus();
  if (!status.locked_through) { ui.alert("Нет закрытых периодов", "Открывать нечего.", ui.ButtonSet.OK); return { status: "NO_LOCKS" }; }
  var response = ui.prompt("Открыть последний закрытый период", "Последний закрытый месяц: " + status.locked_through + ". Укажи причину повторного открытия.", ui.ButtonSet.OK_CANCEL);
  if (response.getSelectedButton() !== ui.Button.OK) return { status: "CANCELLED" };
  var reason = String(response.getResponseText() || "").trim();
  if (!reason) throw new Error("Укажи причину повторного открытия периода.");
  var confirmation = ui.alert(
    "Подтверди повторное открытие периода",
    "Период " + status.locked_through + " будет открыт повторно. Ограничение PeriodGuard для задних дат в этом периоде перестанет блокировать новые операции. Уже существующие документы автоматически не меняются.\n\nПричина: " + reason + "\n\nПродолжить?",
    ui.ButtonSet.YES_NO
  );
  if (confirmation !== ui.Button.YES) return { status: "CANCELLED_BY_USER", period_key: status.locked_through };
  var result = di3ReopenAccountingPeriod(status.locked_through, reason);
  ui.alert("Период открыт", result.period_key + "\nПричина: " + result.reason, ui.ButtonSet.OK);
  return result;
}
