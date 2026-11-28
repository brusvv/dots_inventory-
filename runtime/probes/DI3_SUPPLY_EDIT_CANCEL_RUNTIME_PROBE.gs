/**
 * Dots Inventory v3 RC8 — temporary, READ-ONLY supply edit/cancel runtime probe.
 *
 * Run only on a TEST COPY after installing the current production patch and
 * running the normal setup. This probe does not create, edit, send, receive,
 * cancel, or otherwise mutate business documents. Remove this file after use.
 */
function di3TmpSupplyEditCancelRuntimeProbe() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new Error("Не удалось определить активную Google-таблицу.");

  var report = {
    status: "READ_ONLY_PROBE",
    started_at: new Date(),
    spreadsheet: { id: ss.getId(), name: ss.getName(), locale: ss.getSpreadsheetLocale(), time_zone: ss.getSpreadsheetTimeZone() },
    sheets: {},
    form: {},
    register: {},
    data_integrity: {},
    checks: [],
    warnings: [],
    errors: [],
    manual_checks: [
      "Создай тестовый черновик через «Поставки → Новая поставка» и сохрани его. Убедись, что после сохранения M2 показывает «Редактирование: <номер>», а скрытая N2 содержит supply_id.",
      "Для редактирования существующего черновика выбери его номер в B2. Дождись автоматической загрузки. Если триггер не сработал, используй «Поставки → Загрузить выбранный черновик». Сверь B3, M2 и скрытый N2.",
      "Измени продавца, скидку, количество упаковок или цену и нажми «Сохранить черновик». Число строк V3_Supplies не должно измениться; supply_id и номер должны остаться прежними; V3_SupplyItems должны обновиться в рамках этого supply_id.",
      "Переставь две товарные строки местами и сохрани: supply_item_id должен остаться связан с той же парой товар + фасовка. Удали одну строку и добавь новую — изменения должны примениться только к открытому черновику.",
      "Нажми «Поставки → Новая поставка»: B2, B3 и скрытая N2 должны очиститься, M2 показать «Новая поставка». Только после этого сохранение создаёт новый документ.",
      "Для проверки отмены выбери тестовую поставку в реестре и вызови «Поставки → Отменить выбранную поставку…». Введи необязательную причину, подтверди действие. Статус должен стать «Отменена», в DocumentStatusHistory должна появиться запись, StockLedger/StockLots/FIFO не должны измениться.",
      "Повторная отмена должна вернуть ALREADY_CANCELLED и не создавать вторую запись истории. Отмена доступна для Оформлена, Отправлена и Ожидает получения; поставку со статусом Получена или с операцией/движением приёмки отменять нельзя.",
      "Повтори отмену на отдельной тестовой поставке в статусе Отправлена и затем Ожидает получения. Не используй рабочие документы."
    ]
  };

  function check(name, ok, actual, expected) {
    report.checks.push({ name: name, passed: !!ok, actual: actual, expected: expected });
    if (!ok) report.errors.push(name + ": expected " + JSON.stringify(expected) + ", got " + JSON.stringify(actual));
  }
  function value(sheet, a1) { return sheet.getRange(a1).getValue(); }

  ["_AppMeta", "V3_Supplies", "V3_SupplyItems", "DocumentStatusHistory", "Operations", "StockLedger", "StockLots", "Реестр поставок v3", "Поставка v3"].forEach(function (name) {
    report.sheets[name] = !!ss.getSheetByName(name);
  });
  var missing = Object.keys(report.sheets).filter(function (name) { return !report.sheets[name]; });
  if (missing.length) {
    report.status = "BLOCKED";
    report.errors.push("Не найдены обязательные листы: " + missing.join(", "));
    return di3TmpSupplyEditCancelFinish_(report);
  }

  var functionAvailability = {
    di3ResolveSupplyDraftEditTarget_: typeof di3ResolveSupplyDraftEditTarget_ === "function",
    di3SetSupplyDraftEditContext_: typeof di3SetSupplyDraftEditContext_ === "function",
    di3SaveSupplyDraft: typeof di3SaveSupplyDraft === "function",
    di3NewSupplyForm: typeof di3NewSupplyForm === "function",
    di3LoadSelectedSupplyDraft: typeof di3LoadSelectedSupplyDraft === "function",
    di3CancelSupplyByNumber_: typeof di3CancelSupplyByNumber_ === "function",
    di3CancelSelectedSupply: typeof di3CancelSelectedSupply === "function",
    di3ValidateSupplyCancellation_: typeof di3ValidateSupplyCancellation_ === "function",
    di3RefreshSupplyRegister: typeof di3RefreshSupplyRegister === "function"
  };
  var missingFunctions = Object.keys(functionAvailability).filter(function (name) { return !functionAvailability[name]; });
  check("required_supply_edit_cancel_functions_present", missingFunctions.length === 0, missingFunctions, []);
  if (missingFunctions.length) {
    report.status = "BLOCKED";
    return di3TmpSupplyEditCancelFinish_(report);
  }

  var form = ss.getSheetByName("Поставка v3");
  var register = ss.getSheetByName("Реестр поставок v3");
  report.form.max_rows = form.getMaxRows();
  report.form.max_columns = form.getMaxColumns();
  report.form.edit_supply_id = String(value(form, "N2") || "").trim();
  report.form.selector_number = String(value(form, "B2") || "").trim();
  report.form.form_number = String(value(form, "B3") || "").trim();
  report.form.mode = String(value(form, "M2") || "").trim();
  report.form.edit_id_column_hidden = form.isColumnHiddenByUser(14);
  check("supply_form_has_14_columns", form.getMaxColumns() >= 14, form.getMaxColumns(), ">=14");
  check("edit_id_column_N_is_hidden", report.form.edit_id_column_hidden === true, report.form.edit_id_column_hidden, true);
  var editModeConsistent = report.form.edit_supply_id
    ? report.form.mode.indexOf("Редактирование:") === 0 && report.form.form_number !== ""
    : report.form.mode === "Новая поставка" && report.form.selector_number === "" && report.form.form_number === "";
  check("visible_edit_mode_is_consistent", editModeConsistent,
    { mode: report.form.mode, edit_supply_id_present: !!report.form.edit_supply_id, selector_number: report.form.selector_number, form_number: report.form.form_number },
    "either a matching edit context or a clean NEW mode; selected-but-not-loaded draft must be handled manually");

  var headers = DI3_SUPPLY_REGISTER_HEADERS;
  report.register.header_count = headers.length;
  report.register.actual_headers = register.getRange(3, 1, 1, headers.length).getDisplayValues()[0];
  check("supply_register_headers_match_current_14_column_layout",
    report.register.actual_headers.join("|") === headers.join("|"), report.register.actual_headers, headers);

  var supplyRows = di3ReadTableValues_("V3_Supplies");
  var supplyItems = di3ReadTableValues_("V3_SupplyItems");
  var histories = di3ReadTableValues_("DocumentStatusHistory");
  var ledger = di3ReadTableValues_("StockLedger");
  var operations = di3ReadTableValues_("Operations");
  var supplyIds = Object.create(null);
  var supplyNumbers = Object.create(null);
  supplyRows.forEach(function (row) {
    if (row[0]) supplyIds[String(row[0])] = { number: String(row[1] || ""), status: String(row[3] || "") };
    if (row[1]) supplyNumbers[String(row[1])] = String(row[0] || "");
  });
  var orphanItems = supplyItems.filter(function (row) { return row[1] && !supplyIds[String(row[1])]; }).length;
  check("no_orphan_supply_items", orphanItems === 0, orphanItems, 0);
  var duplicateNumbers = Object.keys(supplyNumbers).filter(function (number) {
    return supplyRows.filter(function (row) { return String(row[1] || "") === number; }).length > 1;
  });
  check("supply_numbers_are_unique", duplicateNumbers.length === 0, duplicateNumbers, []);

  var cancelled = supplyRows.filter(function (row) { return String(row[3]) === DI3_SUPPLY_STATUS.CANCELLED; });
  var cancelledWithLedger = [];
  var cancelledWithReceiptOperation = [];
  var cancelledWithoutHistory = [];
  cancelled.forEach(function (row) {
    var id = String(row[0]);
    if (ledger.some(function (movement) { return String(movement[5] || "") === id; })) cancelledWithLedger.push(id);
    if (operations.some(function (operation) { return String(operation[1] || "") === "SUPPLY_RECEIVE:" + id; })) cancelledWithReceiptOperation.push(id);
    if (!histories.some(function (history) { return String(history[1]) === "SUPPLY" && String(history[2]) === id && String(history[4]) === DI3_SUPPLY_STATUS.CANCELLED; })) cancelledWithoutHistory.push(id);
  });
  report.data_integrity = {
    supply_count: supplyRows.length,
    draft_count: supplyRows.filter(function (row) { return String(row[3]) === DI3_SUPPLY_STATUS.CREATED; }).length,
    cancelled_count: cancelled.length,
    supply_item_count: supplyItems.length,
    status_history_count: histories.length,
    ledger_movement_count: ledger.length,
    orphan_supply_items: orphanItems,
    duplicate_supply_numbers: duplicateNumbers,
    cancelled_with_stock_movements: cancelledWithLedger,
    cancelled_with_receipt_operation: cancelledWithReceiptOperation,
    cancelled_without_status_history: cancelledWithoutHistory
  };
  check("cancelled_supply_has_no_stock_movements", cancelledWithLedger.length === 0, cancelledWithLedger, []);
  check("cancelled_supply_has_no_receipt_operation", cancelledWithReceiptOperation.length === 0, cancelledWithReceiptOperation, []);
  check("cancelled_supply_has_status_history", cancelledWithoutHistory.length === 0, cancelledWithoutHistory, []);

  if (report.form.edit_supply_id) {
    var currentEdit = di3GetSupplyById_(report.form.edit_supply_id);
    check("form_edit_id_resolves_to_existing_draft", !!currentEdit && String(currentEdit.status) === DI3_SUPPLY_STATUS.CREATED,
      currentEdit ? { supply_number: currentEdit.supply_number, status: currentEdit.status } : null,
      "existing CREATED draft");
    if (currentEdit) {
      check("form_numbers_match_edit_document",
        report.form.selector_number === String(currentEdit.supply_number) && report.form.form_number === String(currentEdit.supply_number),
        { selector: report.form.selector_number, form: report.form.form_number, document: String(currentEdit.supply_number) },
        String(currentEdit.supply_number));
    }
  }

  var registerRows = register.getLastRow() > 3
    ? register.getRange(4, 1, register.getLastRow() - 3, headers.length).getValues() : [];
  var registerByNumber = Object.create(null);
  registerRows.forEach(function (row) { if (row[1]) registerByNumber[String(row[1])] = row; });
  var missingRegisterRows = supplyRows.filter(function (row) { return row[1] && !registerByNumber[String(row[1])]; }).map(function (row) { return String(row[1]); });
  var projectionMismatches = [];
  supplyRows.forEach(function (row) {
    var registerRow = registerByNumber[String(row[1])];
    if (!registerRow) return;
    if (String(registerRow[11] || "") !== String(row[0] || "")) projectionMismatches.push(String(row[1]) + ":supply_id");
    if (String(registerRow[8] || "") !== di3GetSupplyStatusLabel_(row[3])) projectionMismatches.push(String(row[1]) + ":status");
  });
  report.register.row_count = registerRows.length;
  report.register.missing_documents = missingRegisterRows;
  report.register.projection_mismatches = projectionMismatches;
  check("register_contains_every_supply", missingRegisterRows.length === 0, missingRegisterRows, []);
  check("register_supply_id_and_status_projection_match", projectionMismatches.length === 0, projectionMismatches, []);

  var draftSummary = di3GetSupplyDraftSummary();
  var invalidDraftSummary = draftSummary.filter(function (item) {
    return !supplyIds[String(item.supply_id)] || supplyIds[String(item.supply_id)].status !== DI3_SUPPLY_STATUS.CREATED;
  });
  check("draft_selector_contains_only_existing_created_documents", invalidDraftSummary.length === 0,
    invalidDraftSummary.map(function (item) { return item.supply_number; }), []);

  var triggers = ScriptApp.getProjectTriggers();
  var managedEditTriggers = triggers.filter(function (trigger) { return trigger.getHandlerFunction() === "di3UnifiedOnEdit"; }).length;
  report.form.unified_edit_trigger_count = managedEditTriggers;
  check("exactly_one_unified_edit_trigger_installed", managedEditTriggers === 1, managedEditTriggers, 1);

  report.cancellation_policy = {
    cancellable_internal_statuses: [DI3_SUPPLY_STATUS.CREATED, DI3_SUPPLY_STATUS.SENT, DI3_SUPPLY_STATUS.AWAITING],
    forbidden_internal_statuses: [DI3_SUPPLY_STATUS.RECEIVED],
    terminal_internal_status: DI3_SUPPLY_STATUS.CANCELLED,
    schema_migration_required: false,
    cancellation_timestamp_storage: "DocumentStatusHistory.changed_at",
    cancellation_reason_storage: "DocumentStatusHistory.comment"
  };

  report.status = report.errors.length ? "REVIEW_REQUIRED" : (report.warnings.length ? "PASS_WITH_WARNINGS" : "PASS_READ_ONLY");
  return di3TmpSupplyEditCancelFinish_(report);
}

function di3TmpSupplyEditCancelFinish_(report) {
  report.finished_at = new Date();
  report.passed_checks = report.checks.filter(function (item) { return item.passed; }).length;
  report.failed_checks = report.checks.filter(function (item) { return !item.passed; }).length;
  Logger.log(JSON.stringify(report, null, 2));
  return report;
}
