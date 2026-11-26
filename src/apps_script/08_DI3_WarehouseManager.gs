/**
 * Dots Inventory v3 — manual warehouse manager UI.
 * Sheet: "Управление складом". Product selection comes from the v3 Products repository.
 */
var DI3_WAREHOUSE_MANAGEMENT_SHEET = "Управление складом";
var DI3_WAREHOUSE_MANAGER_SHEET = DI3_WAREHOUSE_MANAGEMENT_SHEET;
var DI3_LEGACY_WAREHOUSE_MANAGER_SHEET = "Менеджер склада";
var DI3_WAREHOUSE_MANAGER_CELLS = Object.freeze({
  direction: "B3", effective_at: "B4", effective_time: "C4", product: "B5", reason: "B6",
  quantity: "B7", cost_status: "B8", unit_cost: "B9", unit_sale_price: "B10", note: "B11"
});

function di3SetWarehouseManagerListValidation_(sheet, cellA1, values) {
  if (!values || !values.length) {
    sheet.getRange(cellA1).clearDataValidations();
    return;
  }
  var rule = SpreadsheetApp.newDataValidation()
    .requireValueInList(values, true)
    .setAllowInvalid(false)
    .build();
  sheet.getRange(cellA1).setDataValidation(rule);
}

function di3GetWarehouseReasonLabels_(directionLabel) {
  var direction = directionLabel === "Приход" ? "IN" : (directionLabel === "Расход" ? "OUT" : "");
  if (!direction) return [];
  var reasons = DI3_STOCK_REASON_LABELS[direction];
  return Object.keys(reasons).map(function (key) { return reasons[key]; });
}

function di3GetWarehouseReasonCode_(directionLabel, label) {
  var direction = directionLabel === "Приход" ? "IN" : (directionLabel === "Расход" ? "OUT" : "");
  if (!direction) return "";
  var reasons = DI3_STOCK_REASON_LABELS[direction];
  var keys = Object.keys(reasons);
  for (var i = 0; i < keys.length; i++) if (reasons[keys[i]] === label) return keys[i];
  return "";
}

function di3RefreshWarehouseManagerValidations() {
  var sheet = di3GetSpreadsheet_().getSheetByName(DI3_WAREHOUSE_MANAGER_SHEET);
  if (!sheet) throw new Error('Сначала создай лист через di3SetupWarehouseManagement().');
  var direction = String(sheet.getRange(DI3_WAREHOUSE_MANAGER_CELLS.direction).getValue() || "Приход");
  di3SetWarehouseManagerListValidation_(sheet, DI3_WAREHOUSE_MANAGER_CELLS.reason, di3GetWarehouseReasonLabels_(direction));
  var products = di3ListActiveProductsForWarehouse_();
  di3EnsureProductPublicCodes_();
  var codeMap = di3GetProductPublicCodeMap_();
  var options = products.map(function (product) { return di3GetProductOptionLabelWithMap_(product, codeMap); });
  di3SetWarehouseManagerListValidation_(sheet, DI3_WAREHOUSE_MANAGER_CELLS.product, options);
  di3SetWarehouseManagerListValidation_(sheet, DI3_WAREHOUSE_MANAGER_CELLS.direction, ["Приход", "Расход"]);
  di3SetWarehouseManagerListValidation_(sheet, DI3_WAREHOUSE_MANAGER_CELLS.cost_status, ["Известна", "Бесплатно", "Неизвестна"]);

  // Cell-level validation mirrors the domain rules; submit-time validation remains authoritative.
  var dateRule = SpreadsheetApp.newDataValidation().requireDate().setAllowInvalid(false).build();
  var quantityRule = di3BuildPositiveIntegerValidation_(DI3_WAREHOUSE_MANAGER_CELLS.quantity);
  var nonnegativeMoneyRule = di3BuildOptionalNonnegativeNumberValidation_();
  sheet.getRange(DI3_WAREHOUSE_MANAGER_CELLS.effective_at).setDataValidation(dateRule)
    .setNumberFormat("dd.mm.yyyy")
    .setNote("Выбери календарную дату операции. Время вводится отдельно в C4.");
  sheet.getRange(DI3_WAREHOUSE_MANAGER_CELLS.effective_time).setNumberFormat("@")
    .setNote("Обязательное местное время операции в формате HH:mm (24 часа). Изменение даты не должно менять это значение.");
  sheet.getRange(DI3_WAREHOUSE_MANAGER_CELLS.quantity).setDataValidation(quantityRule)
    .setNumberFormat("#,##0")
    .setNote("Укажи положительное целое количество. Дробные значения не допускаются.");
  sheet.getRange(DI3_WAREHOUSE_MANAGER_CELLS.unit_cost).setDataValidation(nonnegativeMoneyRule)
    .setNumberFormat("#,##0.00 ₽")
    .setNote("Для прихода с состоянием себестоимости «Известна» укажи сумму от 0 ₽. Для «Бесплатно» и «Неизвестна» значение не используется.");
  sheet.getRange(DI3_WAREHOUSE_MANAGER_CELLS.unit_sale_price).setDataValidation(nonnegativeMoneyRule)
    .setNumberFormat("#,##0.00 ₽")
    .setNote("Для основания «Продажа вне системы» цена обязательна и должна быть больше 0 ₽. В остальных случаях поле можно оставить пустым.");
  return { products: products.length, reasons: di3GetWarehouseReasonLabels_(direction), validations: [
    DI3_WAREHOUSE_MANAGER_CELLS.effective_at, DI3_WAREHOUSE_MANAGER_CELLS.quantity,
    DI3_WAREHOUSE_MANAGER_CELLS.unit_cost, DI3_WAREHOUSE_MANAGER_CELLS.unit_sale_price
  ] };
}

function di3WarehouseManagerOnEdit(e) {
  if (!e || !e.range) return;
  var sheet = e.range.getSheet();
  if (sheet.getName() !== DI3_WAREHOUSE_MANAGER_SHEET) return;
  if (e.range.getA1Notation() === DI3_WAREHOUSE_MANAGER_CELLS.direction) {
    di3SetWarehouseManagerListValidation_(
      sheet,
      DI3_WAREHOUSE_MANAGER_CELLS.reason,
      di3GetWarehouseReasonLabels_(String(e.range.getValue() || ""))
    );
    sheet.getRange(DI3_WAREHOUSE_MANAGER_CELLS.reason).clearContent();
  }
}

function di3InstallWarehouseManagerTrigger_() {
  if (typeof ScriptApp === "undefined") return false;
  di3InstallUnifiedEditTrigger_();

  // Keep exactly one installable onOpen trigger for all top-level menus.
  var triggers = ScriptApp.getProjectTriggers();
  var openTriggers = triggers.filter(function (trigger) {
    var handler = trigger.getHandlerFunction();
    return handler === "di3WarehouseManagerOnOpen" || handler === "di3SupplyOnOpen";
  });
  var keeper = openTriggers.filter(function (trigger) {
    return trigger.getHandlerFunction() === "di3SupplyOnOpen";
  })[0] || null;
  openTriggers.forEach(function (trigger) {
    if (trigger === keeper) return;
    ScriptApp.deleteTrigger(trigger);
  });
  if (!keeper) {
    ScriptApp.newTrigger("di3SupplyOnOpen")
      .forSpreadsheet(di3GetSpreadsheet_())
      .onOpen()
      .create();
  }
  return true;
}

function di3WarehouseManagerOnOpen() {
  // Backward-compatible wrapper for projects that still have the old trigger.
  return di3SupplyOnOpen();
}

function di3ShowWarehouseSummary() {
  var summary = di3GetInventoryValuationSummary();
  var ui = SpreadsheetApp.getUi();
  var valueText = summary.inventory_value == null
    ? "неполная оценка: есть товары с неизвестной себестоимостью (известная часть " + summary.known_inventory_value.toFixed(2) + " ₽)"
    : summary.inventory_value.toFixed(2) + " ₽";
  ui.alert("Склад Dots Inventory v3",
    "Товаров: " + summary.active_products +
    "\nОстаток: " + summary.total_quantity + " шт." +
    "\nИзвестная себестоимость: " + summary.known_quantity + " шт." +
    "\nНеизвестная себестоимость: " + summary.unknown_quantity + " шт." +
    "\nСтоимость склада: " + valueText,
    ui.ButtonSet.OK);
  return summary;
}

function di3SetupWarehouseManager() {
  di3EnsureStockCoreSchemas_();
  var ss = di3GetSpreadsheet_();
  var sheet = ss.getSheetByName(DI3_WAREHOUSE_MANAGER_SHEET);
  var legacySheet = ss.getSheetByName(DI3_LEGACY_WAREHOUSE_MANAGER_SHEET);
  if (!sheet && legacySheet) {
    legacySheet.setName(DI3_WAREHOUSE_MANAGER_SHEET);
    // Rename only known user-facing labels; preserve form values, movement history and formatting.
    var oldHeading = String(legacySheet.getRange("A1").getDisplayValue() || "").trim();
    if (oldHeading === "МЕНЕДЖЕР СКЛАДА" || oldHeading === "Менеджер склада") {
      legacySheet.getRange("A1").setValue("УПРАВЛЕНИЕ СКЛАДОМ");
    }
    var instruction = String(legacySheet.getRange("A13").getDisplayValue() || "");
    if (instruction.indexOf("Менеджер склада") !== -1) {
      legacySheet.getRange("A13").setValue("После заполнения формы выбери меню «Склад» → «Провести приход / расход».");
    }
    sheet = legacySheet;
  } else if (sheet && legacySheet && sheet.getSheetId() !== legacySheet.getSheetId()) {
    throw new Error('Одновременно существуют листы «Управление складом» и «Менеджер склада». Проверь их вручную, автоматическое объединение небезопасно.');
  }
  var created = false;
  if (!sheet) {
    sheet = ss.insertSheet(DI3_WAREHOUSE_MANAGER_SHEET);
    di3PrepareNewSheet_(sheet, 13, 5);
    created = true;
  }
  if (created || sheet.getLastRow() === 0) {
    sheet.getRange("A1:E1").merge();
    sheet.getRange("A1").setValue("УПРАВЛЕНИЕ СКЛАДОМ");
    sheet.getRange("A2:E2").merge();
    sheet.getRange("A2").setValue("Ручное оформление прихода и расхода товаров. Все движения проходят через FIFO.");
    sheet.getRange("A3:A11").setValues([
      ["Тип движения"], ["Дата операции"], ["Товар"], ["Основание"],
      ["Количество, шт."], ["Состояние себестоимости (для прихода)"],
      ["Себестоимость единицы, ₽ (для прихода)"], ["Цена продажи за единицу, ₽ (для продажи)"], ["Комментарий"]
    ]);
    sheet.getRange("B3").setValue("Приход");
    var initialNow = new Date();
    var initialParts = di3SplitEffectiveDateTime_(initialNow, "Дата ручного движения");
    sheet.getRange("B4").setValue(initialParts.date).setNumberFormat("dd.mm.yyyy");
    sheet.getRange("C3").setValue("Время (HH:mm)").setFontWeight("bold").setBackground("#EEF2F7");
    sheet.getRange("C4").setNumberFormat("@").setValue(initialParts.time);
    sheet.getRange("A13:E13").merge();
    sheet.getRange("A13").setValue("После заполнения формы выбери меню «Склад» → «Провести приход / расход».");
    sheet.getRange("A1:E1").setFontWeight("bold").setFontSize(14).setBackground("#17243A").setFontColor("#FFFFFF");
    sheet.getRange("A2:E2").setBackground("#EAF0F7").setFontColor("#40516A");
    sheet.getRange("A3:A11").setFontWeight("bold").setBackground("#F3F6FA");
    sheet.getRange("B3:B11").setBackground("#FFFFFF");
    sheet.getRange("A1:E13").setVerticalAlignment("middle");
    sheet.setColumnWidth(1, 270);
    sheet.setColumnWidth(2, 340);
    sheet.setColumnWidth(3, 145);
    sheet.setColumnWidth(4, 28);
    sheet.setColumnWidth(5, 28);
    sheet.setRowHeight(1, 34);
    sheet.setRowHeight(2, 32);
    sheet.setRowHeights(3, 9, 30);
    di3SetFrozenRowsSafely_(sheet, 2);
  } else {
    var expected = ["Тип движения", "Дата операции", "Товар", "Основание", "Количество, шт."];
    var actual = sheet.getRange("A3:A7").getDisplayValues().map(function (r) { return r[0]; });
    if (actual[0] !== expected[0] ||
        (actual[1] !== expected[1] && actual[1] !== "Дата и время операции") ||
        actual[2] !== expected[2] || actual[3] !== expected[3] || actual[4] !== expected[4]) {
      throw new Error('Лист «Управление складом» уже существует, но имеет другую структуру. Автоматическое перезаписывание запрещено.');
    }
    // One-time, non-destructive upgrade of the old combined B4 timestamp.
    var oldDateValue = sheet.getRange("B4").getValue();
    var oldTimeValue = String(sheet.getRange("C4").getDisplayValue() || "").trim();
    if (oldDateValue instanceof Date && !isNaN(oldDateValue.getTime()) && !oldTimeValue) {
      var oldParts = di3SplitEffectiveDateTime_(oldDateValue, "Существующая дата ручного движения");
      sheet.getRange("B4").setValue(oldParts.date);
      sheet.getRange("C4").setNumberFormat("@").setValue(oldParts.time === "00:00" ? "" : oldParts.time);
    }
    sheet.getRange("A4").setValue("Дата операции");
    sheet.getRange("C3").setValue("Время (HH:mm)").setFontWeight("bold").setBackground("#EEF2F7");
    sheet.getRange("B4").setNumberFormat("dd.mm.yyyy");
    sheet.getRange("C4").setNumberFormat("@")
      .setNote("Обязательное местное время операции в формате HH:mm (24 часа).");
  }
  if (created) di3GetFormRequestToken_("WAREHOUSE");
  else if (sheet.getMaxColumns() >= 14) di3AdoptLegacyFormRequestToken_("WAREHOUSE", sheet, "N2");
  else di3GetFormRequestToken_("WAREHOUSE");
  di3CompactSheet_(sheet, 13, 5);
  sheet.setHiddenGridlines(true);
  di3RefreshWarehouseManagerValidations();
  di3InstallWarehouseManagerTrigger_();
  return {
    status: "READY",
    sheet: DI3_WAREHOUSE_MANAGER_SHEET,
    products: di3ListActiveProductsForWarehouse_().length,
    submit_function: "di3SubmitWarehouseManagementForm"
  };
}

function di3BuildWarehouseManualMovementConfirmationText_(payload, productLabel, reasonLabel, note) {
  payload = payload || {};
  var inbound = String(payload.direction) === "IN";
  var date = new Date(payload.effective_at);
  var lines = [
    "Движение: " + (inbound ? "Приход" : "Расход"),
    "Товар: " + String(productLabel || payload.product_id || ""),
    "Основание: " + String(reasonLabel || payload.reason_code || ""),
    "Дата и время: " + (isNaN(date.getTime()) ? String(payload.effective_at || "") : Utilities.formatDate(date, di3GetConfiguredTimeZone_(), "dd.MM.yyyy HH:mm")),
    "Количество: " + Number(payload.quantity || 0) + " шт."
  ];
  if (inbound) {
    lines.push("Себестоимость: " + String(payload.cost_status || "не указана"));
    if (payload.unit_cost !== "" && payload.unit_cost != null) lines.push("Себестоимость за единицу: " + Number(payload.unit_cost).toFixed(2) + " ₽");
    lines.push("Эффект: будет добавлено движение StockLedger и новая FIFO-партия StockLots; FIFO-распределения и оценка товара будут пересчитаны.");
  } else {
    lines.push("Эффект: количество будет списано со склада; будут записаны движение StockLedger и FIFO-распределения расхода, а себестоимость движения будет рассчитана по FIFO.");
    if (payload.reason_code === "OFFLINE_SALE" && payload.unit_sale_price !== "" && payload.unit_sale_price != null) {
      lines.push("Цена продажи за единицу: " + Number(payload.unit_sale_price).toFixed(2) + " ₽");
      lines.push("Выручка вне системы: " + (Number(payload.unit_sale_price) * Number(payload.quantity)).toFixed(2) + " ₽");
    }
  }
  if (note) lines.push("Комментарий: " + String(note));
  lines.push("", "Продолжить?");
  return lines.join("\n");
}

function di3SubmitWarehouseManagerForm() {
  var sheet = di3GetSpreadsheet_().getSheetByName(DI3_WAREHOUSE_MANAGER_SHEET);
  if (!sheet) throw new Error('Лист «Управление складом» не найден. Запусти di3SetupWarehouseManagement().');
  var values = sheet.getRange("B3:B11").getValues().map(function (row) { return row[0]; });
  var directionLabel = String(values[0] || "");
  var direction = directionLabel === "Приход" ? "IN" : (directionLabel === "Расход" ? "OUT" : "");
  if (!direction) throw new Error("Выбери тип движения: Приход или Расход.");
  var productLabel = String(values[2] || "");
  if (!productLabel) throw new Error("Выбери товар.");
  var products = di3ListActiveProductsForWarehouse_();
  var codeMap = di3GetProductPublicCodeMap_();
  var selected = products.filter(function (product) { return di3GetProductOptionLabelWithMap_(product, codeMap) === productLabel; });
  if (selected.length !== 1) throw new Error("Не удалось однозначно определить товар. Обнови список товаров.");
  var reasonCode = di3GetWarehouseReasonCode_(directionLabel, String(values[3] || ""));
  if (!reasonCode) throw new Error("Выбери основание, соответствующее типу движения.");
  var command = {
    direction: direction,
    effective_at: di3BuildEffectiveDateTime_(values[1], sheet.getRange("C4").getDisplayValue(), "Ручное складское движение"),
    product_id: selected[0].product_id,
    reason_code: reasonCode,
    quantity: values[4],
    cost_status: values[5],
    unit_cost: values[6],
    unit_sale_price: values[7],
    note: values[8],
    request_token: di3GetFormRequestToken_("WAREHOUSE")
  };
  // Validate and normalize the read-only command before asking the user to confirm.
  // The posting function rebuilds and validates the payload again under the shared lock.
  var normalized = di3BuildManualMovementCommand_(command);
  var ui = SpreadsheetApp.getUi();
  var answer = ui.alert(
    "Подтверждение ручного складского движения",
    di3BuildWarehouseManualMovementConfirmationText_(normalized, productLabel, String(values[3] || ""), normalized.note),
    ui.ButtonSet.YES_NO
  );
  if (answer !== ui.Button.YES) return { status: "CANCELLED_BY_USER", direction: direction, quantity: normalized.quantity };

  var result;
  try {
    result = di3PostManualStockMovement(command);
  } catch (error) {
    var rejected = di3FindRowByColumnValue_("Operations", 1, "MANUAL_STOCK:" + String(command.request_token || ""));
    if (rejected && String(rejected.values[5]) === "REJECTED") {
      di3RotateFormRequestToken_("WAREHOUSE");
    }
    throw error;
  }
  sheet.getRange("B5:B11").clearContent();
  var nextNow = di3SplitEffectiveDateTime_(new Date(), "Дата следующего ручного движения");
  sheet.getRange("B4").setValue(nextNow.date).setNumberFormat("dd.mm.yyyy");
  sheet.getRange("C4").setNumberFormat("@").setValue(nextNow.time);
  di3RotateFormRequestToken_("WAREHOUSE");
  if (typeof di3RefreshWarehouseViewsAfterCommit_ === "function") di3RefreshWarehouseViewsAfterCommit_("Управление складом");
  di3GetSpreadsheet_().toast(
    (result.direction === "IN" ? "Приход" : "Расход") + " проведён: " + result.movement_code + ", " + result.quantity + " шт.",
    "Управление складом",
    6
  );
  return result;
}

function di3CreateProductFromWarehouseManager(command) {
  return di3CreateProduct(command || {});
}

/** Preferred public setup name. The old function remains as a compatibility alias. */
function di3SetupWarehouseManagement() {
  return di3SetupWarehouseManager();
}

function di3OpenWarehouseManagement() {
  var sheet = di3GetSpreadsheet_().getSheetByName(DI3_WAREHOUSE_MANAGER_SHEET);
  if (!sheet) throw new Error('Лист «Управление складом» не найден. Запусти di3SetupWarehouseManagement().');
  di3GetSpreadsheet_().setActiveSheet(sheet);
  return { opened: true, sheet: DI3_WAREHOUSE_MANAGER_SHEET };
}

function di3SubmitWarehouseManagementForm() {
  return di3SubmitWarehouseManagerForm();
}

function di3RefreshWarehouseManagementValidations() {
  return di3RefreshWarehouseManagerValidations();
}
