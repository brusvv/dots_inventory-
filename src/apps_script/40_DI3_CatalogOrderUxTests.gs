/** Local structural regression tests for product/order editor UX and menu discoverability. */
function di3RunCatalogOrderUxUnitTests() {
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

  test("order form fingerprint contains only settings and editable line rows", function () {
    var payload = di3BuildOrderFormStatePayload_({ settings: [[false], [5], [true]], lines: [["Mousepad", 2, 100]] });
    equal(Object.keys(payload).join(","), "settings,lines");
    equal(payload.lines[0][1], 2);
  });
  test("new order form confirms before clearing dirty data", function () {
    var source = di3NewOrderForm.toString();
    var guard = source.indexOf("di3HasUnsavedOrderFormChanges_");
    var clear = source.indexOf('sheet.getRange("B3:B8").clearContent()');
    equal(guard >= 0 && clear > guard, true);
    includes(source, "CANCELLED_BY_USER");
  });
  test("successful order save bypasses the second discard prompt only after creation", function () {
    var source = di3SaveOrderForm.toString();
    var create = source.indexOf("di3CreateOrder(command)");
    var reset = source.indexOf("di3NewOrderForm({ skipUnsavedConfirmation: true })");
    equal(create >= 0 && reset > create, true);
  });
  test("product fingerprint excludes selector and read-only pack summary", function () {
    var source = di3GetProductFormStateHash_.toString();
    includes(source, 'getRange("B6:B15")');
    equal(source.indexOf("B4") === -1, true);
    equal(source.indexOf("B16") === -1, true);
  });
  test("new product form protects dirty card before clearing", function () {
    var source = di3NewProductForm.toString();
    var guard = source.indexOf("di3HasUnsavedProductFormChanges_");
    var clear = source.indexOf('sheet.getRange("B4:B16").clearContent()');
    equal(guard >= 0 && clear > guard, true);
    includes(source, "CANCELLED_BY_USER");
  });
  test("product selector defers replacement while the current card is dirty", function () {
    var source = di3ProductCatalogOnEdit.toString();
    includes(source, "DI3_PRODUCT_FORM_STATE_KEYS.pending");
    includes(source, "DI3_PRODUCT_FORM_STATE_KEYS.previous");
    includes(source, "CONFIRMATION_REQUIRED");
    includes(source, "Загрузить выбранный товар");
  });
  test("explicit product load asks before writing replacement fields", function () {
    var source = di3LoadSelectedProductToForm.toString();
    var confirm = source.indexOf("di3ConfirmProductFormDiscard_");
    var write = source.indexOf('sheet.getRange("B6:B15").setValues');
    equal(confirm >= 0 && write > confirm, true);
    includes(source, "CANCELLED_BY_USER");
  });
  test("duplicate identity path does not bypass unsaved-card confirmation", function () {
    var source = di3SaveNewProductForm.toString();
    var duplicate = source.indexOf("if (existing)");
    var load = source.indexOf("di3LoadSelectedProductToForm({ requestedOption: existingOption })");
    equal(duplicate >= 0 && load > duplicate, true);
    equal(source.indexOf("skipUnsavedConfirmation: true") === -1, true);
  });
  test("system menu is grouped by settings, diagnostics, period, operations and backups", function () {
    var source = di3BuildMenus_.toString();
    ["Настройки", "Установка и диагностика", "Учётный период", "Операции и FIFO", "Резервное копирование"].forEach(function (name) {
      includes(source, 'subMenu("' + name + '"');
    });
  });
  test("order menu names required source and target statuses for transitions", function () {
    var source = di3BuildMenus_.toString();
    includes(source, "Отправить выбранный заказ (Новый → В пути)…");
    includes(source, "Завершить выбранный заказ (В пути → Завершен)…");
    includes(source, "Принять возврат (из «Возвращается»)…");
    includes(source, "Отменить заказ (только «Новый»)…");
  });
  test("order transitions require YES before domain transition executes", function () {
    var source = di3TransitionSelectedOrder_.toString();
    var prompt = source.indexOf("SpreadsheetApp.getUi().alert");
    var advance = source.indexOf("di3AdvanceOrderStatus(");
    equal(prompt >= 0 && advance > prompt, true);
    includes(source, "CANCELLED_BY_USER");
  });
  test("order transition confirmation describes stock effects separately", function () {
    var source = di3GetOrderTransitionConfirmationText_.toString();
    includes(source, "DI3_ORDER_STATUS.IN_TRANSIT");
    includes(source, "DI3_ORDER_STATUS.RETURNED");
    includes(source, "складские движения расхода");
    includes(source, "складские движения прихода");
    includes(source, "Фактическое поступление товара на склад");
  });

  var report = { passed: passed, failed: failed.length, failures: failed };
  if (failed.length) throw new Error("Catalog/Order UX tests failed: " + JSON.stringify(failed));
  return report;
}
