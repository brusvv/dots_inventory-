/** Dots Inventory v3 — order calculator, delivery method reference and register. */
var DI3_ORDER_REGISTER_HEADERS = [
  "Номер заказа", "Создан", "Статус", "Товары, ₽", "Доплата площадке (расчёт), ₽",
  "Скидка продавца, ₽", "Сумма покупателю (расчёт), ₽", "Оценка FIFO, ₽",
  "Фактический FIFO, ₽", "Выручка продавца, ₽", "Комиссия площадки (факт), ₽",
  "Оплачено покупателем, ₽", "Прибыль продавца, ₽", "Статус расчёта",
  "Метод доставки", "Дата следующего этапа", "order_id", "Дата оформления"
];
var DI3_ORDER_REGISTER_LEGACY_HEADERS = [
  "Номер заказа", "Создан", "Статус", "Товары, ₽", "Комиссия, ₽",
  "Скидка, ₽", "К оплате, ₽", "Оценка FIFO, ₽", "Фактический FIFO, ₽",
  "Прибыль, ₽", "Метод доставки", "Дата следующего этапа", "order_id"
];

function di3SetupDeliveryMethodsSheet() {
  var ss = di3GetSpreadsheet_();
  var sheet = ss.getSheetByName("V3_DeliveryMethods");
  if (!sheet) { sheet = ss.insertSheet("V3_DeliveryMethods"); di3PrepareNewSheet_(sheet, 11, 6); }
  var headers = DI3_TABLE_SCHEMAS.V3_DeliveryMethods;
  var actual = sheet.getRange(1, 1, 1, headers.length).getDisplayValues()[0].map(di3NormalizeHeader_);
  if (actual.every(function (value) { return !value; })) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  } else {
    headers.forEach(function (header, index) {
      if (actual[index] !== header) throw new Error("V3_DeliveryMethods: неверный заголовок в колонке " + (index + 1) + ".");
    });
  }
  di3SetFrozenRowsSafely_(sheet, 1);
  sheet.getRange(1, 1, 1, headers.length).setBackground("#253B59").setFontColor("#FFFFFF").setFontWeight("bold");
  sheet.setColumnWidth(2, 260);
  sheet.setColumnWidth(3, 100);
  di3CompactSheet_(sheet, Math.max(11, sheet.getLastRow()), 6);
  return { status: "READY", sheet: "V3_DeliveryMethods", active_methods: di3GetDeliveryMethodNames_().length };
}

function di3GetOrderProductOptionIndex_() {
  di3EnsureProductPublicCodes_();
  var products = di3ListActiveProductsForWarehouse_();
  var codes = di3GetProductPublicCodeMap_();
  var byOption = {};
  var options = products.map(function (product) {
    var option = di3GetProductOptionLabelWithMap_(product, codes);
    byOption[option] = product;
    return option;
  }).sort();
  return { options: options, byOption: byOption };
}

function di3RefreshOrderFormValidations() {
  var sheet = di3GetSpreadsheet_().getSheetByName(DI3_ORDER_FORM_SHEET);
  if (!sheet) throw new Error("Сначала запусти di3SetupOrderWorkspace().");
  var products = di3GetOrderProductOptionIndex_();
  if (products.options.length) {
    sheet.getRange(DI3_ORDER_FORM.firstLine, 1, DI3_ORDER_FORM.lineCount, 1).setDataValidation(
      SpreadsheetApp.newDataValidation().requireValueInList(products.options, true).setAllowInvalid(false).build()
    );
  } else {
    sheet.getRange(DI3_ORDER_FORM.firstLine, 1, DI3_ORDER_FORM.lineCount, 1).clearDataValidations();
  }
  var methods = di3GetDeliveryMethodNames_();
  if (methods.length) {
    sheet.getRange(DI3_ORDER_FORM.deliveryMethod).setDataValidation(
      SpreadsheetApp.newDataValidation().requireValueInList(methods, true).setAllowInvalid(false).build()
    );
  } else {
    sheet.getRange(DI3_ORDER_FORM.deliveryMethod).clearDataValidations();
  }
  var quantityValidation = di3BuildOptionalPositiveIntegerValidation_("B" + DI3_ORDER_FORM.firstLine);
  var priceValidation = di3BuildOptionalNonnegativeNumberValidation_();
  sheet.getRange(DI3_ORDER_FORM.firstLine, 2, DI3_ORDER_FORM.lineCount, 1)
    .setDataValidation(quantityValidation).setNumberFormat("0");
  sheet.getRange(DI3_ORDER_FORM.firstLine, 3, DI3_ORDER_FORM.lineCount, 1)
    .setDataValidation(priceValidation).setNumberFormat("#,##0.00 ₽");
  sheet.getRange(DI3_ORDER_FORM.firstLine, 2)
    .setNote("Для заполненной строки: количество товара — положительное целое число.");
  sheet.getRange(DI3_ORDER_FORM.firstLine, 3)
    .setNote("Необязательно. Цена за штуку должна быть неотрицательной; пусто = цена из каталога.");
  return { products: products.options.length, delivery_methods: methods.length, numeric_validation_ranges: 2 };
}

function di3SetupOrderForm() {
  di3EnsureCoreFoundationSchemas_();
  var ss = di3GetSpreadsheet_();
  var sheet = ss.getSheetByName(DI3_ORDER_FORM_SHEET);
  var created = false;
  if (!sheet) { sheet = ss.insertSheet(DI3_ORDER_FORM_SHEET); di3PrepareNewSheet_(sheet, DI3_ORDER_FORM.firstLine + DI3_ORDER_FORM.lineCount - 1, 7); created = true; }
  if (created || sheet.getLastRow() === 0) {
    sheet.getRange("A1:G1").merge();
    sheet.getRange("A1").setValue("КАЛЬКУЛЯТОР ЗАКАЗА");
    sheet.getRange("A2:G2").merge();
    sheet.getRange("A2").setValue("Создание заказа не меняет склад. Списание выполняется только при переходе в статус «В пути».");
    sheet.getRange("A3:A8").setValues([
      ["Комиссию оплачивает покупатель"], ["Комиссия площадки, %"], ["Учитывать скидку продавца"],
      ["Скидка покупателю, %"], ["Метод доставки"], ["Комментарий"]
    ]);
    sheet.getRange("B3").insertCheckboxes().setValue(true);
    sheet.getRange("B4").setValue(0);
    sheet.getRange("B5").insertCheckboxes().setValue(false);
    sheet.getRange("B6").setValue(0);
    sheet.getRange("B7").setValue("");
    sheet.getRange("B8").setValue("");
    sheet.getRange("A10:C10").merge();
    sheet.getRange("A10").setValue("ТОВАРНЫЕ ПОЗИЦИИ");
    sheet.getRange("A11:C11").setValues([["Товар", "Количество, шт.", "Цена продажи, ₽ / шт. (пусто = цена каталога)"]]);
    sheet.getRange("F3:G3").merge();
    sheet.getRange("F3").setValue("РАСЧЁТ ЗАКАЗА");
    sheet.getRange("F4:F11").setValues([
      ["Стоимость товаров"], ["Доплата площадке"], ["Скидка продавца"], ["Сумма покупателю"],
      ["Выручка продавца (до себестоимости)"], ["Оценка себестоимости FIFO"],
      ["Оценка прибыли продавца"], ["Статус оценки FIFO"]
    ]);
    sheet.getRange("G4:G11").clearContent();
    sheet.getRange("A1:G1").setBackground("#17243A").setFontColor("#FFFFFF").setFontWeight("bold").setFontSize(14);
    sheet.getRange("A2:G2").setBackground("#EAF0F7").setFontColor("#40516A");
    sheet.getRange("A3:A8").setBackground("#F3F6FA").setFontWeight("bold");
    sheet.getRange("A10:C10").setBackground("#EAF0F7").setFontWeight("bold");
    sheet.getRange("A11:C11").setBackground("#253B59").setFontColor("#FFFFFF").setFontWeight("bold");
    sheet.getRange("F3:G3").setBackground("#17243A").setFontColor("#FFFFFF").setFontWeight("bold");
    sheet.getRange("F4:F11").setBackground("#F3F6FA").setFontWeight("bold");
    di3SetFrozenRowsSafely_(sheet, 11);
    sheet.setColumnWidth(1, 330);
    sheet.setColumnWidth(2, 135);
    sheet.setColumnWidth(3, 245);
    sheet.setColumnWidth(4, 26);
    sheet.setColumnWidth(5, 26);
    sheet.setColumnWidth(6, 210);
    sheet.setColumnWidth(7, 155);
    sheet.setRowHeight(1, 36);
    sheet.setRowHeight(2, 30);
    sheet.setRowHeight(10, 28);
    sheet.setRowHeight(11, 38);
  } else {
    var expected = ["Товар", "Количество, шт.", "Цена продажи, ₽ / шт. (пусто = цена каталога)"];
    var actual = sheet.getRange("A11:C11").getDisplayValues()[0];
    expected.forEach(function (header, index) {
      if (actual[index] !== header) throw new Error("Лист «Калькулятор заказа v3» имеет несовместимые заголовки.");
    });
  }
  sheet.getRange("A2").setValue("Комиссия рассчитывается от стоимости товаров до скидки. Если галочка установлена, комиссию оплачивает покупатель; если снята — комиссия удерживается из выручки продавца. Списание склада — при «В пути».");
  sheet.getRange("A3:A8").setValues([
    ["Комиссию оплачивает покупатель"], ["Комиссия площадки, %"], ["Учитывать скидку продавца"],
    ["Скидка покупателю, %"], ["Метод доставки"], ["Комментарий"]
  ]);
  sheet.getRange("F4:F11").setValues([
    ["Стоимость товаров"], ["Комиссия площадке (расчёт)"], ["Скидка продавца"], ["Сумма покупателю (расчёт)"],
    ["Выручка продавца после комиссии"], ["Оценка себестоимости FIFO"],
    ["Прибыль продавца после комиссии"], ["Статус оценки FIFO"]
  ]);
  sheet.getRange("B4").setNumberFormat('0.00"%"');
  sheet.getRange("B6").setNumberFormat('0.00"%"');
  var percentageValidation = SpreadsheetApp.newDataValidation().requireNumberBetween(0, 100).setAllowInvalid(false).build();
  sheet.getRange("B4").setDataValidation(percentageValidation);
  sheet.getRange("B6").setDataValidation(percentageValidation);
  if (created) di3GetFormRequestToken_("ORDER");
  else if (sheet.getMaxColumns() >= 27) di3AdoptLegacyFormRequestToken_("ORDER", sheet, "AA2");
  else di3GetFormRequestToken_("ORDER");
  di3CompactSheet_(sheet, DI3_ORDER_FORM.firstLine + DI3_ORDER_FORM.lineCount - 1, 7);
  sheet.setHiddenGridlines(true);
  di3RefreshOrderFormValidations();
  if (!di3DocumentProperties_().getProperty("DI3_ORDER_FORM_STATE_BASELINE") && !di3HasOrderFormUserData_(sheet)) {
    di3SetOrderFormStateBaseline_(sheet);
  }
  return { status: "READY", sheet: DI3_ORDER_FORM_SHEET, product_options: di3GetOrderProductOptionIndex_().options.length };
}

function di3ReadOrderFormCommand_() {
  var sheet = di3GetSheetOrThrow_(DI3_ORDER_FORM_SHEET);
  var optionIndex = di3GetOrderProductOptionIndex_();
  var formRows = sheet.getRange(DI3_ORDER_FORM.firstLine, 1, DI3_ORDER_FORM.lineCount, 3).getValues();
  var lines = formRows.map(function (row, index) {
    var label = di3NormalizeText_(row[0]);
    var quantity = row[1];
    var price = row[2];
    if (!label && (quantity === "" || quantity == null) && (price === "" || price == null)) return null;
    if (!label) throw new Error("Строка " + (DI3_ORDER_FORM.firstLine + index) + ": выбери товар.");
    var product = optionIndex.byOption[label];
    if (!product) throw new Error("Товар «" + label + "» отсутствует в текущем каталоге. Обнови список.");
    return {
      product_id: String(product.product_id), quantity: quantity,
      sale_unit_price: price === "" || price == null ? "" : price
    };
  }).filter(Boolean);
  return {
    lines: lines,
    commission_paid_by_buyer: sheet.getRange(DI3_ORDER_FORM.commissionPaidByBuyer).getValue() === true,
    commission_rate: di3NormalizeOrderPercentInput_(
      sheet.getRange(DI3_ORDER_FORM.commissionPercent).getValue(),
      sheet.getRange(DI3_ORDER_FORM.commissionPercent).getNumberFormat(),
      "Комиссия"
    ),
    discount_enabled: sheet.getRange(DI3_ORDER_FORM.discountEnabled).getValue() === true,
    discount_rate: di3NormalizeOrderPercentInput_(
      sheet.getRange(DI3_ORDER_FORM.discountPercent).getValue(),
      sheet.getRange(DI3_ORDER_FORM.discountPercent).getNumberFormat(),
      "Скидка"
    ),
    delivery_method: sheet.getRange(DI3_ORDER_FORM.deliveryMethod).getValue(),
    notes: sheet.getRange(DI3_ORDER_FORM.notes).getValue(),
    request_token: di3GetFormRequestToken_("ORDER")
  };
}

function di3BuildOrderPreviewPlan_(command) {
  var products = di3LoadProductsIndex_();
  var lines = [];
  var quantities = {};
  (command.lines || []).forEach(function (raw, index) {
    if (!raw || (!raw.product_id && (raw.quantity === "" || raw.quantity == null))) return;
    var product = products.byId[String(raw.product_id || "")];
    if (!product) throw new Error("Позиция " + (index + 1) + ": товар не найден в каталоге.");
    var quantity = Number(raw.quantity);
    if (!Number.isInteger(quantity) || quantity <= 0) throw new Error("Позиция " + (index + 1) + ": количество должно быть положительным целым числом.");
    var hasPriceOverride = raw.sale_unit_price !== "" && raw.sale_unit_price != null;
    var catalogPriceMissing = product.current_sale_price === "" || product.current_sale_price == null;
    if (!hasPriceOverride && catalogPriceMissing) {
      throw new Error("Позиция " + (index + 1) + ": цена продажи не указана ни в заказе, ни в карточке товара.");
    }
    var price = hasPriceOverride ? Number(raw.sale_unit_price) : Number(product.current_sale_price);
    if (!Number.isFinite(price) || price < 0) throw new Error("Позиция " + (index + 1) + ": цена продажи некорректна.");
    var valuation = di3GetProductFifoValuation(product.product_id);
    if (valuation.total_quantity <= 0) throw new Error("«" + di3GetProductLabel_(product) + ": нет товара в наличии.");
    quantities[product.product_id] = (quantities[product.product_id] || 0) + quantity;
    lines.push({
      product_id: String(product.product_id), product_label: di3GetProductLabel_(product),
      quantity: quantity, sale_unit_price: price,
      estimated_unit_cost: valuation.valuation_status === "COMPLETE" ? valuation.average_unit_cost : null,
      estimated_cost_status: valuation.valuation_status
    });
  });
  Object.keys(quantities).forEach(function (productId) {
    var valuation = di3GetProductFifoValuation(productId);
    if (quantities[productId] > valuation.total_quantity) throw new Error("Недостаточно товара для заказа: требуется " + quantities[productId] + ", в наличии " + valuation.total_quantity + ".");
  });
  return di3BuildOrderFinancialPlan_({
    lines: lines,
    commission_paid_by_buyer: command.commission_paid_by_buyer === true,
    commission_rate: command.commission_rate,
    discount_enabled: command.discount_enabled === true,
    discount_rate: command.discount_rate
  });
}

function di3PreviewOrderForm() {
  var sheet = di3GetSheetOrThrow_(DI3_ORDER_FORM_SHEET);
  var command = di3ReadOrderFormCommand_();
  var plan = di3BuildOrderPreviewPlan_(command);
  sheet.getRange("F5").setValue("Комиссия площадке (" + (plan.commission_payer === "BUYER" ? "покупатель" : "продавец") + ")");
  sheet.getRange("F8").setValue(plan.commission_payer === "SELLER"
    ? "Выручка продавца после комиссии" : "Выручка продавца");
  sheet.getRange("F10").setValue(plan.commission_payer === "SELLER"
    ? "Прибыль продавца после комиссии" : "Прибыль продавца");
  var display = [
    [plan.goods_amount], [plan.commission_amount], [plan.discount_amount], [plan.payable_total],
    [plan.seller_revenue_estimate],
    [plan.estimated_fifo_cost_total === "" ? "Не оценена" : plan.estimated_fifo_cost_total],
    [plan.estimated_profit === "" ? "Не оценена" : plan.estimated_profit],
    [plan.estimated_fifo_cost_status]
  ];
  sheet.getRange("G4:G11").setValues(display);
  sheet.getRange("G4:G10").setNumberFormat("#,##0.00 ₽");
  return plan;
}

function di3BuildOrderFormStatePayload_(fields) {
  fields = fields || {};
  return {
    settings: fields.settings || [], // B3:B8
    lines: fields.lines || [] // A12:C31
  };
}

function di3GetOrderFormStateHash_(sheet) {
  sheet = sheet || di3GetSheetOrThrow_(DI3_ORDER_FORM_SHEET);
  return di3BuildManualOperationPayloadHash_(di3BuildOrderFormStatePayload_({
    settings: sheet.getRange("B3:B8").getValues(),
    lines: sheet.getRange(DI3_ORDER_FORM.firstLine, 1, DI3_ORDER_FORM.lineCount, 3).getValues()
  }));
}

function di3HasOrderFormUserData_(sheet) {
  sheet = sheet || di3GetSheetOrThrow_(DI3_ORDER_FORM_SHEET);
  var settings = sheet.getRange("B3:B8").getValues().map(function (row) { return row[0]; });
  var enabled = settings[0] === true || settings[2] === true;
  var rates = Number(settings[1] || 0) !== 0 || Number(settings[3] || 0) !== 0;
  var deliveryOrNotes = settings[4] !== "" && settings[4] != null || settings[5] !== "" && settings[5] != null;
  var lines = sheet.getRange(DI3_ORDER_FORM.firstLine, 1, DI3_ORDER_FORM.lineCount, 3).getValues();
  return enabled || rates || deliveryOrNotes || lines.some(function (row) {
    return row.some(function (value) { return value !== "" && value !== null && typeof value !== "undefined"; });
  });
}

function di3HasUnsavedOrderFormChanges_(sheet) {
  sheet = sheet || di3GetSheetOrThrow_(DI3_ORDER_FORM_SHEET);
  var baseline = di3DocumentProperties_().getProperty("DI3_ORDER_FORM_STATE_BASELINE");
  return baseline ? di3GetOrderFormStateHash_(sheet) !== baseline : di3HasOrderFormUserData_(sheet);
}

function di3SetOrderFormStateBaseline_(sheet) {
  sheet = sheet || di3GetSheetOrThrow_(DI3_ORDER_FORM_SHEET);
  var hash = di3GetOrderFormStateHash_(sheet);
  di3DocumentProperties_().setProperty("DI3_ORDER_FORM_STATE_BASELINE", hash);
  return hash;
}

function di3ConfirmOrderFormDiscard_() {
  var ui = SpreadsheetApp.getUi();
  return ui.alert("Очистить калькулятор заказа?",
    "В форме есть несохранённые изменения. Команда «Новый заказ» очистит параметры заказа и товарные строки. Созданные ранее заказы и складские движения не удаляются. Продолжить?",
    ui.ButtonSet.YES_NO) === ui.Button.YES;
}

function di3NewOrderForm(options) {
  options = options || {};
  var sheet = di3GetSheetOrThrow_(DI3_ORDER_FORM_SHEET);
  if (di3HasUnsavedOrderFormChanges_(sheet) && options.skipUnsavedConfirmation !== true && !di3ConfirmOrderFormDiscard_()) {
    return { status: "CANCELLED_BY_USER", cleared: false };
  }
  sheet.getRange("B3:B8").clearContent();
  sheet.getRange("B3").insertCheckboxes().setValue(true);
  sheet.getRange("B4").setValue(0);
  sheet.getRange("B5").insertCheckboxes().setValue(false);
  sheet.getRange("B6").setValue(0);
  sheet.getRange(DI3_ORDER_FORM.firstLine, 1, DI3_ORDER_FORM.lineCount, 3).clearContent();
  sheet.getRange("G4:G11").clearContent();
  di3RotateFormRequestToken_("ORDER");
  di3RefreshOrderFormValidations();
  di3SetOrderFormStateBaseline_(sheet);
  return { status: "READY", cleared: true };
}

function di3SaveOrderForm() {
  var command = di3ReadOrderFormCommand_();
  var result = di3CreateOrder(command);
  di3NewOrderForm({ skipUnsavedConfirmation: true });
  di3GetSpreadsheet_().toast("Заказ " + result.order_number + " создан. Остатки пока не изменились.", "Заказ создан", 7);
  return result;
}

function di3SetupOrderRegister() {
  var ss = di3GetSpreadsheet_();
  var sheet = ss.getSheetByName(DI3_ORDER_REGISTER_SHEET);
  var created = false;
  var preservedDates = {};
  if (!sheet) { sheet = ss.insertSheet(DI3_ORDER_REGISTER_SHEET); di3PrepareNewSheet_(sheet, 3, 18); created = true; }
  if (created || sheet.getLastRow() === 0) {
    sheet.getRange("A1:R1").merge();
    sheet.getRange("A1").setValue("РЕЕСТР ЗАКАЗОВ");
    sheet.getRange("A2:R2").merge();
    sheet.getRange("A2").setValue("Комиссия — доплата покупателя площадке. Выручка и прибыль продавца учитываются отдельно. Выбери строку заказа для смены статуса; дату укажи в колонке P.");
  } else {
    var currentWidth = Math.max(17, sheet.getLastColumn());
    di3EnsureSheetCapacity_(sheet, Math.max(3, sheet.getLastRow()), 18);
    var oldHeader = sheet.getRange(3, 1, 1, 13).getDisplayValues()[0].map(di3NormalizeHeader_);
    var newHeader = sheet.getRange(3, 1, 1, 18).getDisplayValues()[0].map(di3NormalizeHeader_);
    var previousCurrentHeader = DI3_ORDER_REGISTER_HEADERS.slice(0, 17);
    if (di3PreflightHasBodyValues_(sheet, 18, 1)) {
      throw new Error("Реестр заказов: колонка R содержит данные без заголовка. Добавление даты оформления остановлено без перезаписи.");
    }
    if (oldHeader.join("|") === DI3_ORDER_REGISTER_LEGACY_HEADERS.join("|")) {
      var legacyRows = sheet.getLastRow() >= 4 ? sheet.getRange(4, 1, sheet.getLastRow() - 3, 13).getValues() : [];
      legacyRows.forEach(function (row) { if (row[12]) preservedDates[String(row[12])] = row[11] || ""; });
      if (typeof sheet.getFilter === "function" && sheet.getFilter()) sheet.getFilter().remove();
      if (typeof sheet.getRange("A1:M1").breakApart === "function") sheet.getRange("A1:M1").breakApart();
      if (typeof sheet.getRange("A2:M2").breakApart === "function") sheet.getRange("A2:M2").breakApart();
      if (sheet.getLastRow() >= 4) sheet.getRange(4, 1, sheet.getLastRow() - 3, 18).clearContent();
      sheet.getRange("A1:R1").merge();
      sheet.getRange("A2:R2").merge();
    } else if (newHeader.slice(0, 17).join("|") !== previousCurrentHeader.join("|") ||
        (newHeader[17] && newHeader[17] !== DI3_ORDER_REGISTER_HEADERS[17])) {
      throw new Error("Лист «Реестр заказов v3» имеет несовместимые заголовки.");
    }
  }
  if (sheet.getRange("A1:R1").isPartOfMerge()) sheet.getRange("A1:R1").breakApart();
  if (sheet.getRange("A2:R2").isPartOfMerge()) sheet.getRange("A2:R2").breakApart();
  sheet.getRange("A1:R1").merge();
  sheet.getRange("A2:R2").merge();
  sheet.getRange(3, 1, 1, 18).setValues([DI3_ORDER_REGISTER_HEADERS]);
  sheet.getRange("A1:R1").setBackground("#17243A").setFontColor("#FFFFFF").setFontWeight("bold").setFontSize(14);
  sheet.getRange("A2:R2").setBackground("#EAF0F7").setFontColor("#40516A");
  sheet.getRange("A3:R3").setBackground("#253B59").setFontColor("#FFFFFF").setFontWeight("bold");
  di3SetFrozenRowsSafely_(sheet, 3);
  [145, 145, 130, 120, 155, 125, 155, 135, 135, 140, 160, 155, 140, 130, 190, 190, 180, 125].forEach(function (width, index) { sheet.setColumnWidth(index + 1, width); });
  if (typeof sheet.showColumns === "function") sheet.showColumns(13);
  sheet.hideColumns(17);
  di3CompactSheet_(sheet, Math.max(3, sheet.getLastRow()), 18);
  sheet.setHiddenGridlines(true);
  di3RefreshOrderRegister(preservedDates);
  return { status: "READY", sheet: DI3_ORDER_REGISTER_SHEET, columns: 18, migrated_legacy_layout: Object.keys(preservedDates).length > 0 };
}

function di3RefreshOrderRegister(preservedDatesOverride) {
  var sheet = di3GetSpreadsheet_().getSheetByName(DI3_ORDER_REGISTER_SHEET);
  if (!sheet) return { refreshed: false, reason: "SHEET_MISSING" };
  di3RefreshAllOrderFifoSnapshots_();
  var oldRows = sheet.getLastRow() >= 4 ? sheet.getRange(4, 1, sheet.getLastRow() - 3, 18).getValues() : [];
  var datesById = preservedDatesOverride || {};
  oldRows.forEach(function (row) { if (row[16] && datesById[String(row[16])] == null) datesById[String(row[16])] = row[15]; });
  var rows = di3ReadTableValues_("V3_Orders").map(function (row) {
    var orderId = String(row[0] || "");
    return [
      row[1], row[2], row[3], row[4], row[6], row[8], row[9], row[10], row[12],
      row[23], row[24], row[25], row[14], row[26], row[16], datesById[orderId] || "", orderId, row[29] || ""
    ];
  }).sort(function (a, b) { return di3ToMillis_(b[1]) - di3ToMillis_(a[1]); });
  var oldCount = Math.max(0, sheet.getLastRow() - 3);
  di3EnsureSheetCapacity_(sheet, Math.max(3, 3 + rows.length), 18);
  if (oldCount) sheet.getRange(4, 1, oldCount, 18).clearContent();
  if (rows.length) {
    sheet.getRange(4, 1, rows.length, 18).setValues(rows);
    sheet.getRange(4, 2, rows.length, 1).setNumberFormat("dd.mm.yyyy hh:mm");
    sheet.getRange(4, 4, rows.length, 10).setNumberFormat("#,##0.00 ₽");
    sheet.getRange(4, 16, rows.length, 1).setNumberFormat("dd.mm.yyyy hh:mm");
    sheet.getRange(4, 18, rows.length, 1).setNumberFormat("dd.mm.yyyy");
    sheet.getBandings().forEach(function (banding) { banding.remove(); });
    di3ApplyLightBandingWithDarkText_(sheet.getRange(4, 1, rows.length, 18));
    var filter = sheet.getFilter();
    var filterRange = sheet.getRange(3, 1, rows.length + 1, 18);
    if (filter) di3SetFilterRangePreservingCriteria_(sheet, filterRange); else filterRange.createFilter();
  } else {
    sheet.getBandings().forEach(function (banding) { banding.remove(); });
    var emptyFilter = sheet.getFilter();
    if (emptyFilter && typeof emptyFilter.remove === "function") emptyFilter.remove();
  }
  di3SetFrozenRowsSafely_(sheet, 3);
  if (typeof sheet.showColumns === "function") sheet.showColumns(13);
  sheet.hideColumns(17);
  di3CompactSheet_(sheet, Math.max(3, 3 + rows.length), 18);
  return { refreshed: true, orders: rows.length, max_rows: sheet.getMaxRows(), max_columns: sheet.getMaxColumns() };
}

function di3SetupOrderWorkspace() {
  di3EnsureCoreFoundationSchemas_();
  var methods = di3SetupDeliveryMethodsSheet();
  var form = di3SetupOrderForm();
  var register = di3SetupOrderRegister();
  var historicalSale = di3SetupHistoricalSaleForm();
  return { status: "READY", delivery_methods: methods, form: form, register: register, historical_sale: historicalSale };
}

function di3GetSelectedOrderRegisterRow_() {
  var ss = di3GetSpreadsheet_();
  var sheet = ss.getSheetByName(DI3_ORDER_REGISTER_SHEET);
  var activeSheet = ss.getActiveSheet ? ss.getActiveSheet() : null;
  var activeRange = ss.getActiveRange ? ss.getActiveRange() : null;
  if (!sheet || !activeSheet || activeSheet.getName() !== DI3_ORDER_REGISTER_SHEET || !activeRange) {
    throw new Error("Выбери ячейку в строке нужного заказа на листе «Реестр заказов v3».");
  }
  var row = activeRange.getRow();
  if (row < 4 || row > sheet.getLastRow()) throw new Error("Выбери строку заказа начиная с 4-й строки.");
  var number = String(sheet.getRange(row, 1).getValue() || "").trim();
  if (!number) throw new Error("В выбранной строке отсутствует номер заказа.");
  return { order_number: number, row_number: row, effective_at: sheet.getRange(row, 16).getValue() };
}

function di3GetOrderTransitionConfirmationText_(order, nextStatus, effectiveAt) {
  order = order || {};
  var action = "Статус заказа изменится с «" + String(order.status || "неизвестен") + "» на «" + String(nextStatus || "") + "».";
  var effect = "";
  if (nextStatus === DI3_ORDER_STATUS.IN_TRANSIT) {
    effect = "Будут созданы складские движения расхода: позиции заказа спишутся со склада, FIFO-распределения и себестоимость будут пересчитаны.";
  } else if (nextStatus === DI3_ORDER_STATUS.RETURNED) {
    effect = "Будет принят фактический возврат: создадутся складские движения прихода и FIFO-партии, после чего пересчитаются FIFO и себестоимость.";
  } else if (nextStatus === DI3_ORDER_STATUS.COMPLETED) {
    effect = "Изменится только статус заказа. Складское списание уже произошло при переходе в «В пути» и повторяться не будет.";
  } else if (nextStatus === DI3_ORDER_STATUS.RETURNING) {
    effect = "Изменится только статус заказа. Фактическое поступление товара на склад выполняется отдельной командой «Принять возврат».";
  } else if (nextStatus === DI3_ORDER_STATUS.CANCELLED) {
    effect = "Заказ будет отменён. Отмена разрешена только до отправки и не создаёт складских движений.";
  }
  var when = effectiveAt instanceof Date && !isNaN(effectiveAt.getTime())
    ? Utilities.formatDate(effectiveAt, di3GetConfiguredTimeZone_(), "dd.MM.yyyy HH:mm")
    : (effectiveAt ? String(effectiveAt) : "текущими датой и временем");
  return action + "\n\n" + effect + "\n\nДата перехода: " + when + ".\n\nПродолжить?";
}

function di3TransitionSelectedOrder_(status) {
  var selected = di3GetSelectedOrderRegisterRow_();
  var order = di3FindOrderByNumber_(selected.order_number);
  if (!order) throw new Error("Заказ больше не найден: " + selected.order_number);
  var answer = SpreadsheetApp.getUi().alert(
    "Подтверждение перехода заказа " + selected.order_number,
    di3GetOrderTransitionConfirmationText_(order, status, selected.effective_at),
    SpreadsheetApp.getUi().ButtonSet.YES_NO
  );
  if (answer !== SpreadsheetApp.getUi().Button.YES) {
    return { status: "CANCELLED_BY_USER", order_number: selected.order_number };
  }
  var result = di3AdvanceOrderStatus(selected.order_number, status, selected.effective_at);
  // The date in column P is a one-shot effective-date input for the next transition.
  // Clear it only when the status actually changed or a PREPARED movement was recovered.
  if (["UPDATED", "COMMITTED"].indexOf(String(result.status)) !== -1) {
    var sheet = di3GetSheetOrThrow_(DI3_ORDER_REGISTER_SHEET);
    sheet.getRange(selected.row_number, 16).clearContent();
    di3RefreshOrderRegister();
    if (typeof di3RefreshWarehouseViewsAfterCommit_ === "function") di3RefreshWarehouseViewsAfterCommit_("Заказ " + selected.order_number);
  }
  di3GetSpreadsheet_().toast("Заказ " + selected.order_number + ": " + (result.new_status || status), "Статус заказа", 6);
  return result;
}
function di3DispatchSelectedOrder() { return di3TransitionSelectedOrder_(DI3_ORDER_STATUS.IN_TRANSIT); }
function di3CompleteSelectedOrder() { return di3TransitionSelectedOrder_(DI3_ORDER_STATUS.COMPLETED); }
function di3MarkSelectedOrderReturning() { return di3TransitionSelectedOrder_(DI3_ORDER_STATUS.RETURNING); }
function di3ReturnSelectedOrder() { return di3TransitionSelectedOrder_(DI3_ORDER_STATUS.RETURNED); }
function di3CancelSelectedOrder() { return di3TransitionSelectedOrder_(DI3_ORDER_STATUS.CANCELLED); }


/** Dedicated, explicit workflow for recording a sale that was already dispatched and completed. */
function di3SetupHistoricalSaleForm() {
  di3EnsureCoreFoundationSchemas_();
  var ss = di3GetSpreadsheet_();
  var name = "Историческая продажа";
  var sheet = ss.getSheetByName(name);
  var created = false;
  if (!sheet) { sheet = ss.insertSheet(name); di3PrepareNewSheet_(sheet, 36, 7); created = true; }
  if (created || sheet.getLastRow() === 0) {
    sheet.getRange("A1:G1").merge().setValue("ВНЕСТИ ИСТОРИЧЕСКУЮ ПРОДАЖУ");
    sheet.getRange("A2:G2").merge().setValue("Создаёт заказ и проводит фактическое FIFO-списание по указанной дате отправки, затем завершает продажу по фактической дате. Используй только для уже состоявшихся продаж.");
    sheet.getRange("A4:A12").setValues([
      ["Дата оформления покупателем"], ["Фактическая дата отправки"], ["Фактическая дата завершения"],
      ["Комиссию оплачивает покупатель"], ["Комиссия площадки, %"], ["Учитывать скидку продавца"],
      ["Скидка покупателю, %"], ["Метод доставки"], ["Комментарий"]
    ]);
    sheet.getRange("C5").setValue("Время отправки (HH:mm)");
    sheet.getRange("C6").setValue("Время завершения (HH:mm)");
    sheet.getRange("B7").insertCheckboxes().setValue(true);
    sheet.getRange("B9").insertCheckboxes().setValue(false);
    sheet.getRange("B8").setValue(0);
    sheet.getRange("B10").setValue(0);
    sheet.getRange("B11").setValue("");
    sheet.getRange("B12").setValue("");
    sheet.getRange("A16:C16").merge().setValue("ТОВАРНЫЕ ПОЗИЦИИ");
    sheet.getRange("A17:C17").setValues([["Товар", "Количество, шт.", "Цена продажи, ₽ / шт. (пусто = цена каталога)"]]);
    sheet.getRange("F3:G3").merge().setValue("ПРОВЕРКА СУММ");
    sheet.getRange("F4:F8").setValues([["Товары"], ["Комиссия"], ["Скидка"], ["К оплате"], ["Выручка продавца"]]);
    sheet.getRange("G4:G8").clearContent();
    sheet.getRange("A1:G1").setBackground("#17243A").setFontColor("#FFFFFF").setFontWeight("bold");
    sheet.getRange("A2:G2").setBackground("#EAF0F7").setFontColor("#40516A");
    sheet.getRange("A4:A14").setFontWeight("bold").setBackground("#F3F6FA");
    sheet.getRange("A16:C16").setBackground("#EAF0F7").setFontWeight("bold");
    sheet.getRange("A17:C17").setBackground("#253B59").setFontColor("#FFFFFF").setFontWeight("bold");
    sheet.getRange("F3:G3").setBackground("#17243A").setFontColor("#FFFFFF").setFontWeight("bold");
    sheet.getRange("F4:F8").setBackground("#F3F6FA").setFontWeight("bold");
    [330, 140, 245, 24, 24, 190, 150].forEach(function (width, index) { sheet.setColumnWidth(index + 1, width); });
    sheet.setFrozenRows(17);
  } else {
    var headers = sheet.getRange("A17:C17").getDisplayValues()[0];
    if (headers.join("|") !== ["Товар", "Количество, шт.", "Цена продажи, ₽ / шт. (пусто = цена каталога)"].join("|")) {
      throw new Error("Лист «Историческая продажа» имеет несовместимые заголовки.");
    }
  }
  sheet.getRange("B4:B6").setNumberFormat("dd.mm.yyyy");
  sheet.getRange("D5:D6").setNumberFormat("@");
  sheet.getRange("B8").setNumberFormat('0.00"%"');
  sheet.getRange("B10").setNumberFormat('0.00"%"');
  sheet.getRange("B4:B6").setDataValidation(SpreadsheetApp.newDataValidation().requireDate().setAllowInvalid(false).build());
  sheet.getRange("D5:D6").setNote("Укажи точное местное время в формате HH:mm.");
  if (created) di3GetFormRequestToken_("HISTORICAL_ORDER");
  else di3GetFormRequestToken_("HISTORICAL_ORDER");
  di3RefreshHistoricalSaleFormValidations();
  di3CompactSheet_(sheet, 36, 7);
  sheet.setHiddenGridlines(true);
  return { status: "READY", sheet: name };
}

function di3RefreshHistoricalSaleFormValidations() {
  var sheet = di3GetSheetOrThrow_("Историческая продажа");
  var products = di3GetOrderProductOptionIndex_();
  if (products.options.length) {
    sheet.getRange("A18:A36").setDataValidation(
      SpreadsheetApp.newDataValidation().requireValueInList(products.options, true).setAllowInvalid(false).build()
    );
  } else sheet.getRange("A18:A36").clearDataValidations();
  var methods = di3GetDeliveryMethodNames_();
  if (methods.length) sheet.getRange("B11").setDataValidation(
    SpreadsheetApp.newDataValidation().requireValueInList(methods, true).setAllowInvalid(false).build()
  );
  else sheet.getRange("B11").clearDataValidations();
  sheet.getRange("B18:B36").setDataValidation(di3BuildOptionalPositiveIntegerValidation_("B18")).setNumberFormat("0");
  sheet.getRange("C18:C36").setDataValidation(di3BuildOptionalNonnegativeNumberValidation_()).setNumberFormat("#,##0.00 ₽");
  return { products: products.options.length, delivery_methods: methods.length };
}

function di3BuildHistoricalDateTime_(dateValue, timeValue, label) {
  if (!(dateValue instanceof Date) || !Number.isFinite(dateValue.getTime())) throw new Error(label + ": укажи дату.");
  var time = String(timeValue == null ? "" : timeValue).trim();
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new Error(label + ": время должно быть в формате HH:mm.");
  var timezone = di3GetConfiguredTimeZone_();
  var value = Utilities.formatDate(dateValue, timezone, "yyyy-MM-dd") + " " + time;
  var parsed = Utilities.parseDate(value, timezone, "yyyy-MM-dd HH:mm");
  if (Utilities.formatDate(parsed, timezone, "yyyy-MM-dd HH:mm") !== value) throw new Error(label + ": некорректные дата или время.");
  return parsed;
}

function di3ReadHistoricalSaleFormCommand_() {
  var sheet = di3GetSheetOrThrow_("Историческая продажа");
  var options = di3GetOrderProductOptionIndex_();
  var rows = sheet.getRange("A18:C36").getValues();
  var lines = rows.map(function (row, index) {
    var label = di3NormalizeText_(row[0]);
    if (!label && (row[1] === "" || row[1] == null) && (row[2] === "" || row[2] == null)) return null;
    var product = options.byOption[label];
    if (!product) throw new Error("Строка " + (index + 18) + ": выбери товар из списка.");
    return { product_id: String(product.product_id), quantity: row[1], sale_unit_price: row[2] === "" || row[2] == null ? "" : row[2] };
  }).filter(Boolean);
  if (!lines.length) throw new Error("Добавь хотя бы одну товарную позицию.");
  return {
    historical_mode: true,
    business_date: di3FormatBusinessDate_(sheet.getRange("B4").getValue()),
    historical_dispatched_at: di3BuildHistoricalDateTime_(sheet.getRange("B5").getValue(), sheet.getRange("D5").getDisplayValue(), "Отправка"),
    historical_completed_at: di3BuildHistoricalDateTime_(sheet.getRange("B6").getValue(), sheet.getRange("D6").getDisplayValue(), "Завершение"),
    commission_paid_by_buyer: sheet.getRange("B7").getValue() === true,
    commission_rate: di3NormalizeOrderPercentInput_(sheet.getRange("B8").getValue(), sheet.getRange("B8").getNumberFormat(), "Комиссия"),
    discount_enabled: sheet.getRange("B9").getValue() === true,
    discount_rate: di3NormalizeOrderPercentInput_(sheet.getRange("B10").getValue(), sheet.getRange("B10").getNumberFormat(), "Скидка"),
    delivery_method: sheet.getRange("B11").getValue(),
    notes: sheet.getRange("B12").getValue(),
    lines: lines,
    request_token: di3GetFormRequestToken_("HISTORICAL_ORDER")
  };
}

function di3SaveHistoricalSaleForm() {
  var command = di3ReadHistoricalSaleFormCommand_();
  var timezone = di3GetConfiguredTimeZone_();
  var units = command.lines.reduce(function (sum, line) { return sum + Number(line.quantity || 0); }, 0);
  var ui = SpreadsheetApp.getUi();
  var confirmation = ui.alert(
    "Подтвердить историческую продажу?",
    "Дата оформления: " + command.business_date + "\\n" +
    "Фактическая отправка: " + Utilities.formatDate(command.historical_dispatched_at, timezone, "dd.MM.yyyy HH:mm") + "\\n" +
    "Фактическое завершение: " + Utilities.formatDate(command.historical_completed_at, timezone, "dd.MM.yyyy HH:mm") + "\\n" +
    "Товарных строк: " + command.lines.length + "; количество единиц: " + units + "\\n\\n" +
    "Будет создан заказ, выполнено FIFO-списание по указанному времени отправки и завершена продажа. Проверь даты и резервную копию перед подтверждением.",
    ui.ButtonSet.YES_NO
  );
  if (confirmation !== ui.Button.YES) return { status: "CANCELLED_BY_USER", created: false };
  var result = di3CreateHistoricalSale(command);
  var sheet = di3GetSheetOrThrow_("Историческая продажа");
  sheet.getRange("B4:B6").clearContent();
  sheet.getRange("D5:D6").clearContent();
  sheet.getRange("B8").setValue(0);
  sheet.getRange("B9").setValue(false);
  sheet.getRange("B10").setValue(0);
  sheet.getRange("B11:B12").clearContent();
  sheet.getRange("A18:C36").clearContent();
  sheet.getRange("G4:G8").clearContent();
  di3RotateFormRequestToken_("HISTORICAL_ORDER");
  SpreadsheetApp.getActiveSpreadsheet().toast("Историческая продажа " + result.order_number + " проведена.", "Продажа завершена", 7);
  return result;
}
