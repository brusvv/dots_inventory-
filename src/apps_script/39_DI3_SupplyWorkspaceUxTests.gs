/** Pure and structural regression tests for Supply Workspace UX protections and FIFO menu safety. */
function di3RunSupplyWorkspaceUxUnitTests() {
  var passed = 0;
  var failed = [];
  function test(name, callback) {
    try { callback(); passed++; }
    catch (error) { failed.push({ name: name, error: error.message || String(error) }); }
  }
  function equal(actual, expected, message) {
    if (actual !== expected) throw new Error((message || "Values differ") + ": expected " + JSON.stringify(expected) + ", got " + JSON.stringify(actual));
  }
  function includes(source, fragment, message) {
    equal(String(source).indexOf(fragment) !== -1, true, message || ("Expected source to contain: " + fragment));
  }

  test("form-state fingerprint payload tracks only editable business inputs", function () {
    var date = new Date("2026-11-25T10:30:00.000Z");
    var payload = di3BuildSupplyFormStatePayload_({
      document: [["SUP-1"], ["Vendor"], [0], [0], [5], ["note"]],
      dates: [[date], [""], [date], [""], [""], [""]],
      times: [["09:30"], [""], [""]],
      lines: [["Product", 20, 2, 100]],
      reason: "Correction reason"
    });
    equal(Object.keys(payload).join(","), "document,dates,times,lines,reason");
    equal(payload.dates[0][0], date.toISOString());
    equal(payload.times[0][0], "09:30");
    equal(payload.lines[0][1], 20);
    equal(payload.reason, "Correction reason");
  });

  test("supply factual event inputs use separate date and mandatory HH:mm cells", function () {
    includes(di3ReadSupplyStageDateTime_.toString(), "di3BuildEffectiveDateTime_");
    includes(di3RefreshSupplyDatePanel_.toString(), 'sheet.getRange("H5:H7")');
    includes(di3ApplySupplyStageInputState_.toString(), 'sheet.getRange("H" + rowNumber)');
    includes(di3ApplyNextSupplyStageFromForm.toString(), "di3ReadSupplyStageDateTime_");
    includes(di3GetHistoricalSupplyFormSnapshot_.toString(), "di3ReadSupplyStageDateTime_");
    includes(di3ParseSupplyFullEditInput_.toString(), "di3ReadSupplyStageDateTime_");
    includes(di3GetSupplyFormStateHash_.toString(), 'times: sheet.getRange("H5:H7")');
    includes(di3HasSupplyFormUserData_.toString(), 'sheet.getRange("H5:H7")');
    var layout = di3EnsureSupplyDatePanelLayout_.toString();
    includes(layout, "previousKnownNote");
    includes(layout, 'parts.time === "00:00" ? "" : parts.time');
  });

  test("supply register next-stage date/time cells are separate and both required", function () {
    equal(DI3_SUPPLY_REGISTER_HEADERS.length, 14);
    equal(DI3_SUPPLY_REGISTER_HEADERS[12], "Дата следующего этапа");
    equal(DI3_SUPPLY_REGISTER_HEADERS[13], "Время следующего этапа (HH:mm)");
    includes(di3GetSelectedSupplyRegisterRow_.toString(), "di3BuildEffectiveDateTime_");
    includes(di3RefreshSupplyRegister.toString(), "input.time");
    includes(di3TransitionSelectedSupply_.toString(), "getRange(selected.row_number, 13, 1, 2).clearContent()");
  });

  test("discard confirmation is requested for dirty forms unless an internal caller explicitly bypasses it", function () {
    equal(di3ShouldConfirmSupplyFormDiscard_(true, {}), true);
    equal(di3ShouldConfirmSupplyFormDiscard_(false, {}), false);
    equal(di3ShouldConfirmSupplyFormDiscard_(true, { skipUnsavedConfirmation: true }), false);
  });

  test("new supply form checks dirty state and asks before any clearing", function () {
    var source = di3NewSupplyForm.toString();
    var guard = source.indexOf("di3ShouldConfirmSupplyFormDiscard_");
    var clear = source.indexOf('sheet.getRange("B2:B8").clearContent()');
    includes(source, "di3HasUnsavedSupplyFormChanges_");
    equal(guard >= 0 && clear > guard, true, "dirty-state guard must precede form clearing");
    includes(source, "CANCELLED_BY_USER");
  });

  test("switching B2 with unsaved data stores the requested document and restores the previous selector", function () {
    var source = di3SupplyFormOnEdit.toString();
    includes(source, "DI3_SUPPLY_FORM.pendingSelector");
    includes(source, "DI3_SUPPLY_FORM.previousSelector");
    includes(source, "setValue(previousNumber)");
    includes(source, "CONFIRMATION_REQUIRED");
    includes(source, "BLOCKED_FULL_EDIT");
  });

  test("explicit load confirms before replacing the form and supports a pending B2 selection", function () {
    var source = di3LoadSelectedSupplyDraft.toString();
    includes(source, "pendingNumber");
    includes(source, "di3ShouldConfirmSupplyFormDiscard_");
    includes(source, "CANCELLED_BY_USER");
    var confirmIndex = source.indexOf("di3ConfirmSupplyFormDiscard_");
    var clearLinesIndex = source.indexOf("DI3_SUPPLY_FORM.firstLine, 1, DI3_SUPPLY_FORM.lineCount, 10).clearContent()");
    equal(confirmIndex >= 0 && clearLinesIndex > confirmIndex, true, "load confirmation must precede item-row replacement");
    includes(source, "setValue(supply.supply_number)");
  });

  test("saving a draft and committing a stage reset the form baseline only after persistence", function () {
    var saveSource = di3SaveSupplyDraft.toString();
    var saveBaseline = saveSource.indexOf("di3SetSupplyFormStateBaseline_(sheet)");
    var saveRefresh = saveSource.indexOf("di3RefreshSupplyDatePanel_");
    equal(saveBaseline > saveRefresh, true);
    var stageSource = di3ApplyNextSupplyStageFromForm.toString();
    includes(stageSource, "di3SetSupplyFormStateBaseline_(sheet)");
  });

  test("menu separates read-only FIFO integrity checking from full rebuild", function () {
    var source = di3BuildMenus_.toString();
    includes(source, '"Проверить целостность FIFO (без изменений)", "di3RunFifoIntegrityCheck"');
    includes(source, '"Перестроить FIFO полностью…", "di3RunFullFifoRebuild"');
    equal(source.indexOf('"Полная сверка FIFO"') === -1, true);
  });

  test("FIFO integrity menu action uses only the read-only diagnostics path", function () {
    var source = di3RunFifoIntegrityCheck.toString();
    includes(source, "di3GetFifoIntegrityDiagnostics_()");
    equal(source.indexOf("di3RunFullFifoRebuild") === -1, true);
    equal(source.indexOf("di3RebuildFifoAllocations_") === -1, true);
    equal(source.indexOf("di3WithLock_") === -1, true);
    includes(source, "mode: \"READ_ONLY\"");
  });

  test("full FIFO rebuild prompts before acquiring the lock or creating a backup", function () {
    var source = di3RunFullFifoRebuild.toString();
    var prompt = source.indexOf("ui.alert(");
    var lock = source.indexOf("di3WithLock_(");
    var backup = source.indexOf("di3CreateSpreadsheetBackupInternal_");
    equal(prompt >= 0 && lock > prompt && backup > lock, true);
    includes(source, "CANCELLED_BY_USER");
  });

  test("full-edit retry compares the current request fingerprint before reusing an immutable operation", function () {
    var source = di3SaveFullSupplyEdit.toString();
    var readPayload = source.indexOf("di3ReadVerifiedOperationPayload_(existingOperation)");
    var compare = source.indexOf("savedPayload.request_fingerprint");
    var execute = source.indexOf("di3ExecutePreparedOperation_(existingOperation)");
    equal(readPayload >= 0 && compare > readPayload && execute > compare, true);
    includes(source, "Форма поставки отличается от неизменяемого payload");
    includes(source, "Автоматическое возобновление остановлено");
  });

  test("full-edit request fingerprint changes when a business input changes but ignores preview pack IDs", function () {
    var plan = {
      input: {
        supplier: "Vendor", seller_discount_amount: 0, partner_discount_amount: 0, shipping_amount: 5,
        notes: "note", supplier_order_date: new Date("2026-01-01T12:00:00Z"),
        expected_received_date: "", sent_at: "", awaiting_at: "", received_at: ""
      },
      plan: { lines: [{ product_id: "P1", pack_variant_id: "PREVIEW:P1:10", units_per_pack: 10, packs: 2, purchase_price_per_pack: 100 }] },
      target_number: "26JA011", status: "Создан", reason: "Fix"
    };
    var first = di3BuildSupplyFullEditRequestFingerprint_(plan);
    var persistedVariantPlan = {
      input: plan.input,
      plan: { lines: [{
        product_id: "P1", pack_variant_id: "PACK-PERSISTED-ID", units_per_pack: 10,
        packs: 2, purchase_price_per_pack: 100
      }] },
      target_number: plan.target_number, status: plan.status, reason: plan.reason
    };
    equal(di3BuildSupplyFullEditRequestFingerprint_(persistedVariantPlan), first);
    persistedVariantPlan.plan.lines[0].packs = 3;
    equal(di3BuildSupplyFullEditRequestFingerprint_(persistedVariantPlan) === first, false);
  });

  test("number preview peeks without reserving a sequence", function () {
    includes(di3RecalculateSupplyNumberInFullEdit.toString(), "di3PeekSupplyNumberForDate_");
    equal(di3PeekSupplyNumberForDate_.toString().indexOf("setProperty") === -1, true);
    includes(di3SupplyNumberForDate_.toString(), "setProperty");
  });

  test("historical entry and full edit modes are mutually exclusive in both directions", function () {
    var source = di3EnableFullSupplyEditMode.toString();
    var guard = source.indexOf("DI3_SUPPLY_FORM.historicalMode");
    var enter = source.indexOf("DI3_SUPPLY_FORM.fullEditMode).setValue");
    equal(guard >= 0 && enter > guard, true);
    includes(source, "взаимоисключают друг друга");
  });

  test("historical supply confirmation dialog is outside the ScriptLock critical section", function () {
    var source = di3CommitHistoricalSupplyEntry.toString();
    var alertAt = source.indexOf("ui.alert(");
    var lockAfterConfirmation = source.indexOf("di3WithLock_(function () { return di3CommitHistoricalSupplyEntryLocked_(preflight); })", alertAt);
    equal(alertAt >= 0 && lockAfterConfirmation > alertAt, true);
    var preflight = di3BuildHistoricalSupplyCommitPreflight_.toString();
    equal(preflight.indexOf("getUi") === -1 && preflight.indexOf("alert(") === -1, true);
    includes(preflight, "di3WithLock_");
    var lockedCommit = di3CommitHistoricalSupplyEntryLocked_.toString();
    equal(lockedCommit.indexOf("getUi") === -1 && lockedCommit.indexOf("alert(") === -1, true);
  });

  test("historical supply commit revalidates the exact form fingerprint and operation identity after confirmation", function () {
    var source = di3CommitHistoricalSupplyEntryLocked_.toString();
    includes(source, "DI3_SUPPLY_FORM.historicalMode");
    includes(source, "preflight.operation_id");
    includes(source, "preflight.payload_hash");
    includes(source, "di3BuildHistoricalSupplySnapshotFingerprint_(snapshot)");
    includes(source, "Состояние поставки или операции приёмки изменилось");
    var fingerprint = di3BuildHistoricalSupplySnapshotFingerprint_.toString();
    includes(fingerprint, "received_at");
    includes(fingerprint, "pack_variant_id");
    includes(fingerprint, "purchase_price_per_pack");
    includes(fingerprint, "final_amount");
  });

  var report = { passed: passed, failed: failed.length, failures: failed };
  if (failed.length) throw new Error("Supply Workspace UX tests failed: " + JSON.stringify(failed));
  return report;
}
