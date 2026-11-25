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
      lines: [["Product", 20, 2, 100]],
      reason: "Correction reason"
    });
    equal(Object.keys(payload).join(","), "document,dates,lines,reason");
    equal(payload.dates[0][0], date.toISOString());
    equal(payload.lines[0][1], 20);
    equal(payload.reason, "Correction reason");
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

  var report = { passed: passed, failed: failed.length, failures: failed };
  if (failed.length) throw new Error("Supply Workspace UX tests failed: " + JSON.stringify(failed));
  return report;
}
