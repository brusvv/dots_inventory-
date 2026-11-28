/**
 * Dots Inventory v3 — compact product workspace.
 * "Продукты" is a read-mostly register; "Карточка продукта" is the editor.
 * Technical product_id is stored in hidden column H and never shown to users.
 */
var DI3_PRODUCTS_UI_SHEET = "Продукты";
var DI3_PRODUCT_FORM_SHEET = "Карточка продукта";
var DI3_PRODUCTS_UI_HEADERS = [
  "Код", "Бренд", "Модель", "Категория", "Диаметр, мм", "Толщина, мм",
  "Форма", "Материал", "Наличие пены", "Цена продажи, ₽", "Статус", "product_id"
];
var DI3_PRODUCTS_UI_HEADERS_LEGACY_17 = [
  "Код", "Бренд", "Модель", "Диаметр, мм", "Категория", "Цена продажи, ₽", "Статус", "product_id"
];
var DI3_PRODUCTS_UI_HEADERS_LEGACY_14 = DI3_PRODUCTS_UI_HEADERS_LEGACY_17;
var DI3_PRODUCTS_UI_COLUMN_COUNT = 21;
var DI3_PRODUCTS_FIFO_HEADERS = [
  "Остаток, шт.", "Средняя FIFO, ₽/шт.", "Стоимость остатка, ₽",
  "Мин. цена по средней, ₽", "Макс. скидка по средней, ₽/шт.", "Покрытие себестоимости, %",
  "След. FIFO, ₽/шт.", "Мин. цена след. FIFO, ₽", "Макс. скидка след. FIFO, ₽/шт."
];
var DI3_PRODUCTS_UI_CELLS = Object.freeze({
  selected: "B4", brand: "B6", model: "B7", diameter: "B8", category: "B9",
  shape: "B10", material: "B11", thickness: "B12", foam: "B13", salePrice: "B14", unitsPerPack: "B15"
});
var DI3_PRODUCT_FORM_FIELD_CELLS = Object.freeze([
  "B6", "B7", "B8", "B9", "B10", "B11", "B12", "B13", "B14", "B15"
]);

function di3ProductUiOption_(product, codeMap) {
  return di3GetProductOptionLabelWithMap_(product, codeMap);
}

/** User-facing diameter text: keep locale decimal commas and never expose date serials. */
function di3ProductDiameterForUi_(value) {
  var normalized = di3NormalizeDiameter_(value, value);
  if (normalized.invalidDate) return "ПРОВЕРИТЬ ДИАМЕТР";
  return normalized.value ? String(normalized.value).replace(".", ",") : "";
}

/** Compact product register: 12 product columns (including hidden ID) + 9 FIFO metrics. */
function di3SetupProductsSheet() {
  di3EnsureStockCoreSchemas_();
  var ss = di3GetSpreadsheet_();
  var sheet = ss.getSheetByName(DI3_PRODUCTS_UI_SHEET);
  var created = false;
  if (!sheet) {
    sheet = ss.insertSheet(DI3_PRODUCTS_UI_SHEET);
    di3PrepareNewSheet_(sheet, 4, DI3_PRODUCTS_UI_COLUMN_COUNT);
    created = true;
  }
  if (created || sheet.getLastRow() === 0) {
    di3BuildProductRegisterLayout_(sheet);
  } else {
    di3EnsureSheetCapacity_(sheet, Math.max(4, sheet.getLastRow()), DI3_PRODUCTS_UI_COLUMN_COUNT);
    var currentHeaders = sheet.getRange(4, 1, 1, DI3_PRODUCTS_UI_COLUMN_COUNT).getDisplayValues()[0];
    var expectedHeaders = DI3_PRODUCTS_UI_HEADERS.concat(DI3_PRODUCTS_FIFO_HEADERS);
    var currentMatches = currentHeaders.length === DI3_PRODUCTS_UI_COLUMN_COUNT &&
      currentHeaders.every(function (header, index) { return String(header || "") === expectedHeaders[index]; });

    var legacy17 = sheet.getRange(4, 1, 1, 17).getDisplayValues()[0];
    var expectedLegacy17 = DI3_PRODUCTS_UI_HEADERS_LEGACY_17.concat(DI3_PRODUCTS_FIFO_HEADERS);
    var legacy17Matches = legacy17.length === 17 &&
      legacy17.every(function (header, index) { return String(header || "") === expectedLegacy17[index]; });

    var legacy14 = sheet.getRange(4, 1, 1, 14).getDisplayValues()[0];
    var expectedLegacy14 = DI3_PRODUCTS_UI_HEADERS_LEGACY_14.concat(DI3_PRODUCTS_FIFO_HEADERS.slice(0, 6));
    var legacy14Matches = legacy14.length === 14 &&
      legacy14.every(function (header, index) { return String(header || "") === expectedLegacy14[index]; });

    var legacyRegister = sheet.getMaxRows() >= 14 && sheet.getMaxColumns() >= 18 &&
      sheet.getRange("A14").getDisplayValue() === DI3_PRODUCTS_UI_HEADERS_LEGACY_17[0];

    if (!currentMatches && (legacy17Matches || legacy14Matches)) {
      // This sheet is a derived register; source-of-truth records live in Products.
      // Rebuilding its view is safe and avoids moving or rewriting product IDs.
      var oldFilter = sheet.getFilter();
      if (oldFilter && typeof oldFilter.remove === "function") oldFilter.remove();
      sheet.getBandings().forEach(function (banding) { banding.remove(); });
      di3BuildProductRegisterLayout_(sheet);
      currentMatches = true;
    }
    if (!currentMatches && legacyRegister) {
      di3MigrateLegacyProductRegisterLayout_(sheet);
      currentMatches = true;
    }
    if (!currentMatches) {
      throw new Error('Лист «Продукты» имеет неизвестную структуру. Автоматическая перезапись запрещена; используй резервную копию и проверь заголовки.');
    }
  }
  di3EnsureSheetCapacity_(sheet, Math.max(4, sheet.getLastRow()), DI3_PRODUCTS_UI_COLUMN_COUNT);
  di3SetFrozenRowsSafely_(sheet, 4);
  sheet.setHiddenGridlines(true);
  di3RefreshProductsSheet();
  di3CompactSheet_(sheet, Math.max(4, sheet.getLastRow()), DI3_PRODUCTS_UI_COLUMN_COUNT);
  return { status: "READY", sheet: DI3_PRODUCTS_UI_SHEET, rows: Math.max(0, sheet.getLastRow() - 4),
    columns: DI3_PRODUCTS_UI_COLUMN_COUNT, max_rows: sheet.getMaxRows(), max_columns: sheet.getMaxColumns() };
}

function di3BuildProductRegisterLayout_(sheet) {
  di3EnsureSheetCapacity_(sheet, Math.max(4, sheet.getLastRow()), DI3_PRODUCTS_UI_COLUMN_COUNT);
  // Older releases merged shorter title ranges; release them before expanding to U.
  sheet.getRange("A1:U3").breakApart();
  sheet.getRange("A1:I1").merge();
  sheet.getRange("A1").setValue("КАТАЛОГ ПРОДУКТОВ");
  sheet.getRange("A2:U2").merge();
  sheet.getRange("A2").setValue("Единый реестр товаров · остатки и оценка по FIFO");
  sheet.getRange("A3:U3").merge();
  sheet.getRange("A3").setValue("Каталог · выбери товар в листе «Карточка продукта» для редактирования");
  sheet.getRange(4, 1, 1, DI3_PRODUCTS_UI_COLUMN_COUNT)
    .setValues([DI3_PRODUCTS_UI_HEADERS.concat(DI3_PRODUCTS_FIFO_HEADERS)]);
  sheet.getRange("A1:I1").setBackground("#17243A").setFontColor("#FFFFFF").setFontWeight("bold").setFontSize(14);
  sheet.getRange("A2:U3").setBackground("#EAF0F7").setFontColor("#334155");
  sheet.getRange("A4:L4").setBackground("#253B59").setFontColor("#FFFFFF").setFontWeight("bold");
  sheet.getRange("M4:R4").setBackground("#1F6B62").setFontColor("#FFFFFF").setFontWeight("bold");
  sheet.getRange("S4:U4").setBackground("#475569").setFontColor("#FFFFFF").setFontWeight("bold");
  sheet.setRowHeight(1, 34);
  sheet.setRowHeight(2, 25);
  sheet.setRowHeight(3, 27);
  sheet.setRowHeight(4, 36);
  [105, 175, 165, 135, 100, 100, 135, 135, 120, 135, 100, 180].forEach(function (width, index) {
    sheet.setColumnWidth(index + 1, width);
  });
  sheet.setColumnWidth(13, 105);
  sheet.setColumnWidths(14, 4, 145);
  sheet.setColumnWidth(18, 135);
  sheet.setColumnWidths(19, 3, 150);
  sheet.showColumns(1, DI3_PRODUCTS_UI_COLUMN_COUNT);
  sheet.hideColumns(12);
}

/** Upgrade helper for the previous RC layout where the editor occupied rows 1–12. */
function di3MigrateLegacyProductRegisterLayout_(sheet) {
  var ss = di3GetSpreadsheet_();
  var oldValues = sheet.getRange("B2:B12").getValues().map(function (row) { return row[0]; });
  var form = ss.getSheetByName(DI3_PRODUCT_FORM_SHEET);
  if (!form) {
    form = ss.insertSheet(DI3_PRODUCT_FORM_SHEET);
    di3PrepareNewSheet_(form, 17, 2);
    di3BuildProductFormLayout_(form);
  }
  var existingFormValues = form.getRange("B4:B15").getValues().map(function (row) { return row[0]; });
  var existingFormIsBlank = existingFormValues.every(function (value) { return value === "" || value == null; });
  if (existingFormIsBlank) {
    form.getRange("B4").setValue(oldValues[0] || "");
    form.getRange("B6:B15").setValues(oldValues.slice(1, 11).map(function (value) { return [value]; }));
  }
  var lastRow = Math.max(sheet.getLastRow(), 14);
  var oldFilter = sheet.getFilter();
  if (oldFilter && typeof oldFilter.remove === "function") oldFilter.remove();
  sheet.getBandings().forEach(function (banding) { banding.remove(); });
  sheet.getRange(1, 1, lastRow, Math.min(DI3_PRODUCTS_UI_COLUMN_COUNT, sheet.getMaxColumns())).clearContent();
  di3BuildProductRegisterLayout_(sheet);
  di3SetFrozenRowsSafely_(sheet, 4);
  return { migrated: true, preserved_form_values: oldValues.filter(function (v) { return v !== "" && v != null; }).length };
}

/** Compact 2-column product editor; no long form area frozen above the catalogue. */
function di3SetupProductFormSheet() {
  var ss = di3GetSpreadsheet_();
  var sheet = ss.getSheetByName(DI3_PRODUCT_FORM_SHEET);
  var created = false;
  if (!sheet) {
    sheet = ss.insertSheet(DI3_PRODUCT_FORM_SHEET);
    di3PrepareNewSheet_(sheet, 17, 2);
    created = true;
  }
  if (created || sheet.getLastRow() === 0) di3BuildProductFormLayout_(sheet);
  else {
    di3EnsureSheetCapacity_(sheet, Math.max(17, sheet.getLastRow()), 2);
    var expected = ["Карточка продукта", "Выбери существующий товар для редактирования или оставь поле пустым для нового", "Товар для редактирования"];
    if (String(sheet.getRange("A1").getValue()) !== expected[0] || String(sheet.getRange("A4").getValue()) !== expected[2]) {
      throw new Error('Лист «Карточка продукта» имеет неизвестную структуру. Автоматическая перезапись запрещена.');
    }
    // Add the read-only pack summary to existing earlier-release cards without clearing user input.
    if (String(sheet.getRange("A16").getValue() || "") !== "Имеющиеся фасовки") {
      sheet.getRange("A16").setValue("Имеющиеся фасовки");
      sheet.getRange("A16").setBackground("#EEF2F7").setFontWeight("bold");
    }
    if (!sheet.getRange("B16").getValue()) {
      sheet.getRange("B16").setValue("Появятся после выбора существующего товара");
      sheet.getRange("B16").setBackground("#F8FAFC").setFontColor("#475569");
    }
    sheet.getRange("A17").setValue("После сохранения товар появится в каталоге. Фасовка — это размер упаковки, а не складской остаток. Склад меняется только через приход и расход.");
    sheet.getRange("A17:B17").setBackground("#F8FAFC").setFontColor("#64748B");
  }
  // Plain text prevents Google Sheets locale auto-parsing 6.5 / 6,5 as a date.
  sheet.getRange("B8").setNumberFormat("@");
  sheet.setHiddenGridlines(true);
  di3SetFrozenRowsSafely_(sheet, 4);
  di3RefreshProductFormValidations();
  di3InstallProductCatalogTrigger_();
  di3CompactSheet_(sheet, 17, 2);
  return { status: "READY", sheet: DI3_PRODUCT_FORM_SHEET, rows: 17, columns: 2 };
}

function di3BuildProductFormLayout_(sheet) {
  sheet.getRange("A1:B1").merge();
  sheet.getRange("A1").setValue("Карточка продукта");
  sheet.getRange("A2:B2").merge();
  sheet.getRange("A2").setValue("Выбери существующий товар для редактирования или оставь поле пустым для нового");
  sheet.getRange("A4").setValue("Товар для редактирования");
  sheet.getRange("A6:A15").setValues([
    ["Бренд *"], ["Модель"], ["Диаметр, мм"], ["Категория"], ["Форма"],
    ["Материал"], ["Толщина"], ["Пена"], ["Цена продажи, ₽"], ["Добавить фасовку, шт. (необязательно)"]
  ]);
  sheet.getRange("A16").setValue("Имеющиеся фасовки");
  sheet.getRange("B16").setValue("Появятся после выбора существующего товара");
  sheet.getRange("A17:B17").merge();
  sheet.getRange("A17").setValue("После сохранения товар появится в каталоге. Фасовка — это размер упаковки, а не складской остаток. Склад меняется только через приход и расход.");
  sheet.getRange("A1:B1").setBackground("#17243A").setFontColor("#FFFFFF").setFontWeight("bold").setFontSize(14);
  sheet.getRange("A2:B2").setBackground("#EAF0F7").setFontColor("#334155");
  sheet.getRange("A4:A4").setBackground("#EAF0F7").setFontWeight("bold");
  sheet.getRange("A6:A15").setBackground("#EEF2F7").setFontWeight("bold");
  sheet.getRange("B4:B15").setBackground("#FFFFFF");
  sheet.getRange("A16:A16").setBackground("#EEF2F7").setFontWeight("bold");
  sheet.getRange("B16").setBackground("#F8FAFC").setFontColor("#475569");
  sheet.getRange("A17:B17").setBackground("#F8FAFC").setFontColor("#64748B");
  sheet.setColumnWidth(1, 285);
  sheet.setColumnWidth(2, 390);
  sheet.setRowHeight(1, 36);
  sheet.setRowHeight(2, 38);
  sheet.setRowHeights(4, 12, 29);
  sheet.getRange("B8").setNumberFormat("@");
  sheet.getRange("B14").setNumberFormat("#,##0.00 ₽");
  sheet.getRange("B15").setNumberFormat("0");
  di3SetFrozenRowsSafely_(sheet, 4);
}

function di3RefreshProductFormValidations() {
  var ss = di3GetSpreadsheet_();
  var sheet = ss.getSheetByName(DI3_PRODUCT_FORM_SHEET);
  if (!sheet) return { refreshed: false, reason: "SHEET_MISSING" };
  // Keep the edit selector self-healing even after bulk imports that bypass the
  // normal product form. Public codes must exist before building option labels.
  di3EnsureProductPublicCodes_();
  var products = di3ListAllProductsForWarehouse_();
  var codeMap = di3GetProductPublicCodeMap_();
  var options = products.map(function (product) { return di3ProductUiOption_(product, codeMap); });
  var selector = sheet.getRange(DI3_PRODUCTS_UI_CELLS.selected);
  if (options.length) selector.setDataValidation(
    SpreadsheetApp.newDataValidation().requireValueInList(options, true).setAllowInvalid(false).build()
  );
  else selector.clearDataValidations();
  sheet.getRange("B14").setDataValidation(di3BuildOptionalNonnegativeNumberValidation_());
  sheet.getRange("B15").setDataValidation(di3BuildOptionalPositiveIntegerValidation_("B15"));
  sheet.getRange("B14").setNote("Необязательно. Цена должна быть числом от 0 и выше; пустое значение допустимо.");
  sheet.getRange("B15").setNote("Необязательно. Фасовка — положительное целое количество штук; пустое значение допустимо.");
  return { refreshed: true, options: options.length, numeric_validations: 2 };
}

function di3OpenProductsSheet() {
  var ss = di3GetSpreadsheet_();
  var sheet = ss.getSheetByName(DI3_PRODUCTS_UI_SHEET);
  if (!sheet) throw new Error('Лист «Продукты» не найден. Запусти setupDotsInventoryV3().');
  di3RefreshProductsSheet();
  ss.setActiveSheet(sheet);
  return { opened: true, sheet: DI3_PRODUCTS_UI_SHEET };
}

function di3OpenProductForm() {
  var ss = di3GetSpreadsheet_();
  var sheet = ss.getSheetByName(DI3_PRODUCT_FORM_SHEET);
  if (!sheet) throw new Error('Лист «Карточка продукта» не найден. Запусти setupDotsInventoryV3().');
  var selector = di3RefreshProductFormValidations();
  ss.setActiveSheet(sheet);
  return { opened: true, sheet: DI3_PRODUCT_FORM_SHEET, product_options: selector.options || 0 };
}

function di3NewProductForm(options) {
  options = options || {};
  var sheet = di3GetSpreadsheet_().getSheetByName(DI3_PRODUCT_FORM_SHEET);
  if (!sheet) throw new Error('Лист «Карточка продукта» не найден.');
  if (di3HasUnsavedProductFormChanges_(sheet) && options.skipUnsavedConfirmation !== true) {
    var confirmed = di3ConfirmProductFormDiscard_("Очистить карточку продукта?",
      "В карточке есть несохранённые изменения. Команда «Новый товар» очистит выбранный товар и поля B6:B15. Продолжить?");
    if (!confirmed) return { status: "CANCELLED_BY_USER", cleared: false };
  }
  sheet.getRange("B4:B16").clearContent();
  sheet.getRange("B16").setValue("Появятся после выбора существующего товара");
  di3SetProductFormStateBaseline_(sheet);
  di3OpenProductForm();
  return { status: "READY", cleared: true, mode: "CREATE" };
}

function di3RefreshProductsSheet() {
  var ss = di3GetSpreadsheet_();
  var sheet = ss.getSheetByName(DI3_PRODUCTS_UI_SHEET);
  if (!sheet) throw new Error('Сначала запусти di3SetupProductsSheet().');
  di3EnsureProductPublicCodes_();
  var products = di3ListAllProductsForWarehouse_();
  var codeMap = di3GetProductPublicCodeMap_();
  var margin = typeof di3GetTargetGrossMargin_ === "function" ? di3GetTargetGrossMargin_() : 0.30;
  var dashboard = null;
  var metricsError = "";
  try { dashboard = di3GetWarehouseDashboardData(margin); }
  catch (dashboardError) { metricsError = dashboardError && dashboardError.message ? dashboardError.message : String(dashboardError); }
  var valuationById = {};
  if (dashboard && dashboard.products) dashboard.products.forEach(function (row) { valuationById[String(row.product_id)] = row; });
  var rows = products.map(function (p) {
    return [
      codeMap[String(p.product_id)] || "", p.brand || "", p.model || "", p.category || "",
      di3ProductDiameterForUi_(p.diameter), p.thickness || "", p.shape || "", p.material || "", p.foam || "",
      p.current_sale_price === "" ? "" : p.current_sale_price,
      p.active === false || String(p.active).toLowerCase() === "false" ? "Неактивен" : "Активен",
      p.product_id
    ];
  });
  var metricRows = products.map(function (p) {
    var v = valuationById[String(p.product_id)] || {};
    return [
      v.stock_quantity || 0,
      v.average_fifo_cost == null ? "" : v.average_fifo_cost,
      v.inventory_value == null ? "" : v.inventory_value,
      v.minimum_sale_price == null ? "" : v.minimum_sale_price,
      v.maximum_discount_per_unit == null ? "" : v.maximum_discount_per_unit,
      v.stock_quantity > 0 ? (v.known_quantity / v.stock_quantity) : "",
      v.next_fifo_unit_cost == null ? "" : v.next_fifo_unit_cost,
      v.next_fifo_minimum_sale_price == null ? "" : v.next_fifo_minimum_sale_price,
      v.next_fifo_maximum_discount_per_unit == null ? "" : v.next_fifo_maximum_discount_per_unit
    ];
  });
  var startRow = 5;
  var requiredRows = Math.max(4, startRow + rows.length - 1);
  di3EnsureSheetCapacity_(sheet, requiredRows, DI3_PRODUCTS_UI_COLUMN_COUNT);
  var oldCount = Math.max(0, sheet.getLastRow() - 4);
  if (oldCount) sheet.getRange(startRow, 1, oldCount, DI3_PRODUCTS_UI_COLUMN_COUNT).clearContent();
  if (rows.length) {
    // Apply text formats before writing, so locale parsing cannot turn 6.5 into a calendar date.
    sheet.getRange(startRow, 5, rows.length, 2).setNumberFormat("@");
    sheet.getRange(startRow, 1, rows.length, 12).setValues(rows);
    if (dashboard) sheet.getRange(startRow, 13, metricRows.length, 9).setValues(metricRows);
    sheet.getRange(startRow, 10, rows.length, 1).setNumberFormat("#,##0.00 ₽");
    sheet.getRange(startRow, 13, rows.length, 1).setNumberFormat("#,##0");
    if (dashboard) {
      sheet.getRange(startRow, 14, rows.length, 4).setNumberFormat("#,##0.00 ₽");
      sheet.getRange(startRow, 18, rows.length, 1).setNumberFormat("0.0%");
      sheet.getRange(startRow, 19, rows.length, 3).setNumberFormat("#,##0.00 ₽");
    }
  }
  sheet.getRange("A4:L4").setBackground("#253B59").setFontColor("#FFFFFF").setFontWeight("bold");
  sheet.getRange("M4:R4").setBackground("#1F6B62").setFontColor("#FFFFFF").setFontWeight("bold");
  sheet.getRange("S4:U4").setBackground("#475569").setFontColor("#FFFFFF").setFontWeight("bold");
  di3SetFrozenRowsSafely_(sheet, 4);
  sheet.getBandings().forEach(function (banding) { banding.remove(); });
  if (rows.length) {
    var productBodyRange = sheet.getRange(startRow, 1, rows.length, DI3_PRODUCTS_UI_COLUMN_COUNT);
    di3ApplyLightBandingWithDarkText_(productBodyRange);
  }
  var filter = sheet.getFilter();
  if (rows.length) {
    var filterRange = sheet.getRange(4, 1, rows.length + 1, DI3_PRODUCTS_UI_COLUMN_COUNT);
    if (filter) di3SetFilterRangePreservingCriteria_(sheet, filterRange);
    else filterRange.createFilter();
  } else if (filter && typeof filter.remove === "function") {
    filter.remove();
  }
  // Column H used to contain the hidden ID in the previous layout; unhide all
  // catalogue columns first, then hide only the new technical ID column L.
  sheet.showColumns(1, DI3_PRODUCTS_UI_COLUMN_COUNT);
  sheet.hideColumns(12);
  di3CompactSheet_(sheet, requiredRows, DI3_PRODUCTS_UI_COLUMN_COUNT);

  // B4 is a static VALUE_IN_LIST validation, not a live formula over Products.
  // Refresh it whenever the catalogue register refreshes so bulk imports and
  // repository-driven changes cannot leave the edit selector stale.
  var productFormOptions = null;
  if (ss.getSheetByName(DI3_PRODUCT_FORM_SHEET)) {
    productFormOptions = di3RefreshProductFormValidations();
  }
  return {
    products: rows.length, metrics_refreshed: !!dashboard, metrics_error: metricsError,
    first_data_row: startRow, columns: DI3_PRODUCTS_UI_COLUMN_COUNT,
    product_form_options: productFormOptions ? productFormOptions.options : null
  };
}

var DI3_PRODUCT_FORM_STATE_KEYS = Object.freeze({
  baseline: "DI3_PRODUCT_FORM_STATE_BASELINE",
  selected: "DI3_PRODUCT_FORM_SELECTED_OPTION",
  pending: "DI3_PRODUCT_FORM_PENDING_OPTION",
  previous: "DI3_PRODUCT_FORM_PREVIOUS_OPTION",
  selectedProductId: "DI3_PRODUCT_FORM_SELECTED_PRODUCT_ID"
});

function di3BuildProductFormStatePayload_(fields) {
  fields = fields || {};
  return { fields: fields.fields || [] }; // B6:B15; selector and read-only summary are excluded.
}

function di3GetProductFormStateHash_(sheet) {
  sheet = sheet || di3GetSheetOrThrow_(DI3_PRODUCT_FORM_SHEET);
  return di3BuildManualOperationPayloadHash_(di3BuildProductFormStatePayload_({
    fields: sheet.getRange("B6:B15").getValues()
  }));
}

function di3HasProductFormUserData_(sheet) {
  sheet = sheet || di3GetSheetOrThrow_(DI3_PRODUCT_FORM_SHEET);
  return sheet.getRange("B6:B15").getValues().some(function (row) {
    return row[0] !== "" && row[0] !== null && typeof row[0] !== "undefined";
  });
}

function di3HasUnsavedProductFormChanges_(sheet) {
  sheet = sheet || di3GetSheetOrThrow_(DI3_PRODUCT_FORM_SHEET);
  var baseline = di3DocumentProperties_().getProperty(DI3_PRODUCT_FORM_STATE_KEYS.baseline);
  return baseline ? di3GetProductFormStateHash_(sheet) !== baseline : di3HasProductFormUserData_(sheet);
}

function di3SetProductFormStateBaseline_(sheet, productId) {
  sheet = sheet || di3GetSheetOrThrow_(DI3_PRODUCT_FORM_SHEET);
  var properties = di3DocumentProperties_();
  var selected = String(sheet.getRange(DI3_PRODUCTS_UI_CELLS.selected).getValue() || "");
  properties.setProperty(DI3_PRODUCT_FORM_STATE_KEYS.baseline, di3GetProductFormStateHash_(sheet));
  properties.setProperty(DI3_PRODUCT_FORM_STATE_KEYS.selected, selected);
  if (productId) properties.setProperty(DI3_PRODUCT_FORM_STATE_KEYS.selectedProductId, String(productId));
  else properties.deleteProperty(DI3_PRODUCT_FORM_STATE_KEYS.selectedProductId);
  properties.deleteProperty(DI3_PRODUCT_FORM_STATE_KEYS.pending);
  properties.deleteProperty(DI3_PRODUCT_FORM_STATE_KEYS.previous);
  return { baseline_set: true, selected: selected, product_id: productId ? String(productId) : "" };
}

function di3ConfirmProductFormDiscard_(title, message) {
  var ui = SpreadsheetApp.getUi();
  return ui.alert(title, message, ui.ButtonSet.YES_NO) === ui.Button.YES;
}

function di3LoadSelectedProductToForm(options) {
  options = options || {};
  var sheet = di3GetSpreadsheet_().getSheetByName(DI3_PRODUCT_FORM_SHEET);
  if (!sheet) throw new Error('Лист «Карточка продукта» не найден.');
  var properties = di3DocumentProperties_();
  var pending = String(properties.getProperty(DI3_PRODUCT_FORM_STATE_KEYS.pending) || "");
  var selected = String(options.requestedOption || pending || sheet.getRange(DI3_PRODUCTS_UI_CELLS.selected).getValue() || "");
  if (!selected) return { loaded: false };
  var previous = String(properties.getProperty(DI3_PRODUCT_FORM_STATE_KEYS.previous) || properties.getProperty(DI3_PRODUCT_FORM_STATE_KEYS.selected) || "");
  if (di3HasUnsavedProductFormChanges_(sheet) && options.skipUnsavedConfirmation !== true) {
    var confirmed = di3ConfirmProductFormDiscard_("Заменить данные карточки продукта?",
      "В карточке есть несохранённые изменения. Загрузка товара «" + selected + "» заменит значения полей B6:B15. Продолжить?");
    if (!confirmed) {
      sheet.getRange(DI3_PRODUCTS_UI_CELLS.selected).setValue(previous);
      properties.deleteProperty(DI3_PRODUCT_FORM_STATE_KEYS.pending);
      properties.deleteProperty(DI3_PRODUCT_FORM_STATE_KEYS.previous);
      return { status: "CANCELLED_BY_USER", loaded: false };
    }
  }
  var products = di3ListAllProductsForWarehouse_();
  var codeMap = di3GetProductPublicCodeMap_();
  var matches = products.filter(function (p) { return di3ProductUiOption_(p, codeMap) === selected; });
  if (matches.length !== 1) throw new Error('Не удалось однозначно найти выбранный товар. Обнови каталог.');
  var p = matches[0];
  var storedDiameter = di3NormalizeDiameter_(p.diameter, p.diameter);
  var diameterForForm = storedDiameter.invalidDate ? "" : String(storedDiameter.value || "").replace(".", ",");
  sheet.getRange(DI3_PRODUCTS_UI_CELLS.selected).setValue(selected);
  sheet.getRange("B8").setNumberFormat("@");
  sheet.getRange("B6:B15").setValues([
    [p.brand || ""], [p.model || ""], [diameterForForm], [p.category || ""], [p.shape || ""],
    [p.material || ""], [p.thickness || ""], [p.foam || ""], [p.current_sale_price == null ? "" : p.current_sale_price], [""]
  ]);
  sheet.getRange("B16").setValue(di3GetProductPackVariantsSummary_(String(p.product_id)));
  sheet.getRange("B8").setNote(storedDiameter.invalidDate
    ? "Ранее сохранено значение, похожее на дату/серийный номер Google Sheets. Укажи фактический диаметр текстом или оставь поле пустым."
    : "Введи диаметр как текст, например 6,5. Поле не преобразует значение в дату.");
  di3SetProductFormStateBaseline_(sheet, p.product_id);
  return { loaded: true, product_id: p.product_id, label: di3GetProductLabel_(p), diameter_needs_review: storedDiameter.invalidDate };
}

function di3GetProductPackVariantsSummary_(productId) {
  var index = di3LoadPackVariantIndex_();
  var variants = Object.keys(index.byId).map(function (id) { return index.byId[id]; })
    .filter(function (variant) {
      return String(variant.product_id) === String(productId) &&
        variant.active !== false && String(variant.active).toLowerCase() !== "false";
    })
    .sort(function (a, b) { return Number(a.units_per_pack) - Number(b.units_per_pack); });
  if (!variants.length) return "Фасовки ещё не добавлены";
  return variants.map(function (variant) { return String(variant.units_per_pack) + " шт."; }).join(" · ");
}

function di3SaveProductForm() {
  return di3WithLock_(function () {
    di3EnsureStockCoreSchemas_();
    var sheet = di3GetSpreadsheet_().getSheetByName(DI3_PRODUCT_FORM_SHEET);
    if (!sheet) throw new Error('Лист «Карточка продукта» не найден. Запусти di3SetupProductFormSheet().');
    var selectedValue = String(sheet.getRange(DI3_PRODUCTS_UI_CELLS.selected).getValue() || "");
    if (!selectedValue) throw new Error('Для редактирования сначала выбери товар в поле «Товар для редактирования».');
    var form = sheet.getRange("B6:B15").getValues().map(function (r) { return r[0]; });
    var command = {
      brand: form[0], model: form[1], diameter: form[2], category: form[3], shape: form[4],
      material: form[5], thickness: form[6], foam: form[7], current_sale_price: form[8], units_per_pack: form[9]
    };
    if (!di3NormalizeText_(command.brand)) throw new Error('Заполни обязательное поле «Бренд».');
    var products = di3ListAllProductsForWarehouse_();
    var codeMap = di3GetProductPublicCodeMap_();
    var properties = di3DocumentProperties_();
    var trackedOption = String(properties.getProperty(DI3_PRODUCT_FORM_STATE_KEYS.selected) || "");
    var trackedProductId = String(properties.getProperty(DI3_PRODUCT_FORM_STATE_KEYS.selectedProductId) || "");
    var selected = trackedProductId && selectedValue === trackedOption
      ? products.filter(function (p) { return String(p.product_id) === trackedProductId; })
      : products.filter(function (p) { return di3ProductUiOption_(p, codeMap) === selectedValue; });
    if (selected.length !== 1) throw new Error('Не удалось определить редактируемый товар. Обнови список.');
    var oldProduct = selected[0];
    var normalizedDiameter = di3NormalizeDiameter_(command.diameter, command.diameter);
    if (normalizedDiameter.invalidDate) throw new Error('Диаметр похож на дату. Укажи корректный диаметр или оставь поле пустым.');
    var newIdentity = di3BuildIdentityKey_(command.brand, command.model, normalizedDiameter.value);
    var index = di3LoadProductsIndex_();
    var duplicate = index.byIdentity[newIdentity];
    if (duplicate && String(duplicate.product_id) !== String(oldProduct.product_id)) {
      throw new Error('Товар с такой комбинацией бренда, модели и диаметра уже существует.');
    }
    var parsed = {
      identity_key: newIdentity, brand: di3NormalizeText_(command.brand), model: di3NormalizeText_(command.model),
      diameter: normalizedDiameter.value,
      category: di3NormalizeText_(command.category), shape: di3NormalizeText_(command.shape),
      material: di3NormalizeText_(command.material), thickness: di3NormalizeText_(command.thickness),
      foam: di3NormalizeText_(command.foam), current_sale_price: command.current_sale_price === "" ? "" : Number(command.current_sale_price),
      source_row: ""
    };
    if (parsed.current_sale_price !== "" && (!Number.isFinite(parsed.current_sale_price) || parsed.current_sale_price < 0)) {
      throw new Error('Цена продажи должна быть неотрицательным числом.');
    }
    var units = di3NormalizeProductPackInput_(command.units_per_pack);
    var now = new Date();
    var row = di3ProductToRow_(parsed, String(oldProduct.product_id), now, oldProduct);
    // Validate/create the optional pack before changing product fields. If the
    // variant is invalid or disabled, the product edit remains untouched.
    var variant = units == null ? null : di3GetOrCreatePackVariant_(String(oldProduct.product_id), units, "PRODUCT_CATALOG");
    di3ApplyContiguousRowUpdates_("Products", [{ row_number: oldProduct.row_number, values: row }]);
    di3RefreshProductsSheet();
    if (typeof di3RefreshDependentCatalogViews_ === "function") di3RefreshDependentCatalogViews_();
    sheet.getRange(DI3_PRODUCTS_UI_CELLS.selected).clearContent();
    sheet.getRange("B6:B15").clearContent();
    sheet.getRange("B16").setValue(di3GetProductPackVariantsSummary_(String(oldProduct.product_id)));
    di3SetProductFormStateBaseline_(sheet);
    return { updated: true, product_id: oldProduct.product_id, pack_variant: variant };
  });
}

function di3NormalizeProductPackInput_(value) {
  if (value === "" || value == null) return null;
  var units = Number(value);
  if (!Number.isInteger(units) || units <= 0) throw new Error('Вариант фасовки должен содержать положительное целое количество единиц.');
  return units;
}

/** New-product submit delegates to the repository service without holding an outer lock. */
function di3SaveNewProductForm() {
  var sheet = di3GetSpreadsheet_().getSheetByName(DI3_PRODUCT_FORM_SHEET);
  if (!sheet) throw new Error('Лист «Карточка продукта» не найден.');
  var selected = String(sheet.getRange(DI3_PRODUCTS_UI_CELLS.selected).getValue() || "");
  if (selected) {
    var updated = di3SaveProductForm();
    var message = "Карточка товара обновлена";
    if (updated.pack_variant) {
      message += updated.pack_variant.created
        ? ". Добавлена фасовка " + updated.pack_variant.units_per_pack + " шт."
        : ". Фасовка " + updated.pack_variant.units_per_pack + " шт. уже существует";
    }
    di3GetSpreadsheet_().toast(message, "Продукты", 6);
    return updated;
  }
  var form = sheet.getRange("B6:B15").getValues().map(function (r) { return r[0]; });
  var command = {
    brand: form[0], model: form[1], diameter: form[2], category: form[3], shape: form[4],
    material: form[5], thickness: form[6], foam: form[7], current_sale_price: form[8], units_per_pack: form[9]
  };
  var normalizedDiameter = di3NormalizeDiameter_(command.diameter, command.diameter);
  if (!di3NormalizeText_(command.brand)) throw new Error('Заполни обязательное поле «Бренд».');
  if (normalizedDiameter.invalidDate) throw new Error('Диаметр похож на дату. Укажи корректный диаметр или оставь поле пустым.');
  var identityKey = di3BuildIdentityKey_(command.brand, command.model, normalizedDiameter.value);
  var existing = di3LoadProductByIdentity_(identityKey);
  if (existing) {
    var existingOption = di3GetProductOptionLabel_(existing);
    sheet.getRange(DI3_PRODUCTS_UI_CELLS.selected).setValue(existingOption);
    var loadResult = di3LoadSelectedProductToForm({ requestedOption: existingOption });
    if (loadResult && loadResult.status === "CANCELLED_BY_USER") return loadResult;
    di3GetSpreadsheet_().toast(
      'Товар ' + existingOption + ' уже существует. Карточка загружена; для добавления фасовки укажи её размер в B15 и сохрани.',
      "Товар уже существует",
      8
    );
    return { created: false, existing: true, product_id: existing.product_id, display_code: di3GetShortProductCode_(existing.product_id), label: di3GetProductLabel_(existing) };
  }
  var result = di3CreateProduct(command);
  if (!result.created) {
    throw new Error(result.message || "Не удалось создать товар.");
  }
  di3RefreshProductsSheet();
  di3RefreshProductFormValidations();
  if (typeof di3RefreshDependentCatalogViews_ === "function") di3RefreshDependentCatalogViews_();
  sheet.getRange("B4:B15").clearContent();
  sheet.getRange("B16").setValue("Создано: " + result.display_code + ". Фасовки можно добавить при редактировании товара.");
  di3SetProductFormStateBaseline_(sheet);
  di3GetSpreadsheet_().toast(result.display_code + " · " + result.label, "Товар создан", 5);
  return result;
}

function di3InstallProductCatalogTrigger_() {
  return di3InstallUnifiedEditTrigger_();
}

function di3ProductCatalogOnEdit(e) {
  if (!e || !e.range || !e.range.getSheet) return;
  var sheet = e.range.getSheet();
  if (sheet.getName() !== DI3_PRODUCT_FORM_SHEET || e.range.getA1Notation() !== DI3_PRODUCTS_UI_CELLS.selected) return;
  var properties = di3DocumentProperties_();
  var attempted = String(typeof e.value === "undefined" ? sheet.getRange(DI3_PRODUCTS_UI_CELLS.selected).getValue() || "" : e.value || "").trim();
  var previous = typeof e.oldValue !== "undefined"
    ? String(e.oldValue || "")
    : String(properties.getProperty(DI3_PRODUCT_FORM_STATE_KEYS.selected) || "");
  if (!attempted) {
    sheet.getRange(DI3_PRODUCTS_UI_CELLS.selected).setValue(previous);
    properties.deleteProperty(DI3_PRODUCT_FORM_STATE_KEYS.pending);
    properties.deleteProperty(DI3_PRODUCT_FORM_STATE_KEYS.previous);
    return { status: "IGNORED_EMPTY_SELECTOR" };
  }
  if (attempted === previous) return { status: "UNCHANGED_SELECTION" };
  if (di3HasUnsavedProductFormChanges_(sheet)) {
    properties.setProperty(DI3_PRODUCT_FORM_STATE_KEYS.pending, attempted);
    properties.setProperty(DI3_PRODUCT_FORM_STATE_KEYS.previous, previous);
    sheet.getRange(DI3_PRODUCTS_UI_CELLS.selected).setValue(previous);
    di3GetSpreadsheet_().toast("В карточке есть несохранённые изменения. Они сохранены в форме. Для загрузки нового товара запусти «Продукты → Загрузить выбранный товар…» и подтверди замену.", "Загрузка товара не выполнена", 10);
    return { status: "CONFIRMATION_REQUIRED", requested_product: attempted };
  }
  properties.setProperty(DI3_PRODUCT_FORM_STATE_KEYS.selected, attempted);
  properties.deleteProperty(DI3_PRODUCT_FORM_STATE_KEYS.pending);
  properties.deleteProperty(DI3_PRODUCT_FORM_STATE_KEYS.previous);
  return di3LoadSelectedProductToForm({ skipUnsavedConfirmation: true, requestedOption: attempted });
}
