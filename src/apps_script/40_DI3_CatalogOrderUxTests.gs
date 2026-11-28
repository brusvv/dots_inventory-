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
    var retryGuard = source.indexOf('["CREATED", "ALREADY_CREATED"]');
    var reset = source.indexOf("di3NewOrderForm({ skipUnsavedConfirmation: true })");
    equal(create >= 0 && retryGuard > create && reset > retryGuard, true);
    includes(source, "RETRY_DEFERRED");
    includes(source, "Форма сохранена");
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
  test("order register uses adjacent date and HH:mm inputs for lifecycle transitions", function () {
    equal(DI3_ORDER_REGISTER_HEADERS.length, 19);
    equal(DI3_ORDER_REGISTER_HEADERS[15], "Дата следующего этапа");
    equal(DI3_ORDER_REGISTER_HEADERS[16], "Время следующего этапа (HH:mm)");
    var setup = di3SetupOrderRegister.toString();
    includes(setup, "DI3_ORDER_REGISTER_PREVIOUS_CURRENT_HEADERS");
    includes(setup, "di3SplitRegisterEffectiveInput_");
    var selected = di3GetSelectedOrderRegisterRow_.toString();
    includes(selected, "di3BuildEffectiveDateTime_");
    includes(selected, "sheet.getRange(row, 17).getDisplayValue()");
    includes(selected, "sheet.getRange(row, 18).getValue()");
    var transition = di3TransitionSelectedOrder_.toString();
    includes(transition, "di3FindOrderRegisterRowById_(sheet, selected.order_id)");
    equal(transition.indexOf("selected.row_number") === -1, true);
    equal(transition.indexOf("di3RefreshOrderRegister()") === -1, true);
    var registerRefresh = di3RefreshOrderRegister.toString();
    includes(registerRefresh, "options.refreshFifoSnapshots !== false");
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

  test("historical-sale confirmation uses the same form snapshot as creation", function () {
    var preview = di3PreviewHistoricalSaleForm.toString();
    var save = di3SaveHistoricalSaleForm.toString();
    includes(preview, "command = command || di3ReadHistoricalSaleFormCommand_({ readOnly: true })");
    var readCommand = di3ReadHistoricalSaleFormCommand_.toString();
    includes(readCommand, 'sheet.getRange("C5").getDisplayValue()');
    includes(readCommand, 'sheet.getRange("C6").getDisplayValue()');
    var read = save.indexOf("di3ReadHistoricalSaleFormCommand_()");
    var plan = save.indexOf("di3PreviewHistoricalSaleForm(command)");
    var confirm = save.indexOf("ui.alert(");
    var create = save.indexOf("di3CreateHistoricalSale(command)");
    equal(read >= 0 && plan > read && confirm > plan && create > confirm, true);
    includes(save, 'sheet.getRange("C5:C6").clearContent()');
    includes(save, 'sheet.getRange("B7").setValue(true)');
    equal(save.indexOf('sheet.getRange("D5:D6").clearContent()') === -1, true);
  });


  test("order and historical previews use read-only product option indexes", function () {
    includes(di3PreviewOrderForm.toString(), "di3ReadOrderFormCommand_({ readOnly: true })");
    includes(di3PreviewHistoricalSaleForm.toString(), "di3ReadHistoricalSaleFormCommand_({ readOnly: true })");
    includes(di3GetOrderProductOptionIndex_.toString(), "options.readOnly !== true");
  });

  test("order preview caches each product FIFO valuation", function () {
    var originalLoad = di3LoadProductsIndex_;
    var originalValuation = di3GetProductFifoValuation;
    var originalPlan = di3BuildOrderFinancialPlan_;
    var calls = {};
    try {
      di3LoadProductsIndex_ = function () {
        return { byId: {
          P1: { product_id: "P1", brand: "Brand", model: "One", current_sale_price: 10 },
          P2: { product_id: "P2", brand: "Brand", model: "Two", current_sale_price: 20 }
        } };
      };
      di3GetProductFifoValuation = function (id) {
        calls[id] = (calls[id] || 0) + 1;
        return { total_quantity: 10, valuation_status: "COMPLETE", average_unit_cost: 2 };
      };
      di3BuildOrderFinancialPlan_ = function (input) { return input.lines; };
      di3BuildOrderPreviewPlan_({ lines: [
        { product_id: "P1", quantity: 1, sale_unit_price: 10 },
        { product_id: "P2", quantity: 1, sale_unit_price: 20 }
      ] });
      equal(calls.P1, 1);
      equal(calls.P2, 1);
    } finally {
      di3LoadProductsIndex_ = originalLoad;
      di3GetProductFifoValuation = originalValuation;
      di3BuildOrderFinancialPlan_ = originalPlan;
    }
  });

  test("product edit resolves a previously selected product by immutable ID on retry", function () {
    var source = di3SaveProductForm.toString();
    includes(source, "DI3_PRODUCT_FORM_STATE_KEYS.selectedProductId");
    includes(source, "trackedProductId");
    includes(di3SetProductFormStateBaseline_.toString(), "properties.setProperty(DI3_PRODUCT_FORM_STATE_KEYS.selectedProductId");
  });

  test("pack variant is validated before product fields are written", function () {
    var source = di3SaveProductForm.toString();
    var variant = source.indexOf("di3GetOrCreatePackVariant_");
    var write = source.indexOf('di3ApplyContiguousRowUpdates_("Products"');
    equal(variant >= 0 && write > variant, true);
  });

  test("duplicate product path returns when replacement was cancelled", function () {
    var source = di3SaveNewProductForm.toString();
    var load = source.indexOf("var loadResult = di3LoadSelectedProductToForm");
    var cancel = source.indexOf('loadResult.status === "CANCELLED_BY_USER"');
    var toast = source.indexOf('di3GetSpreadsheet_().toast(');
    equal(load >= 0 && cancel > load && toast > cancel, true);
  });

  var report = { passed: passed, failed: failed.length, failures: failed };
  if (failed.length) throw new Error("Catalog/Order UX tests failed: " + JSON.stringify(failed));
  return report;
}
