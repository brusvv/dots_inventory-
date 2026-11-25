/**
 * Dots Inventory v3 RC8 — temporary read-only Supply + Product Catalog runtime probe.
 *
 * Run only on a COPY of the workbook after installing the current RC8 patch and
 * completing setup. This function only reads; it does not change cells,
 * validations, filters, documents, settings, triggers, or schema migrations.
 * Remove this temporary file after the acceptance run.
 */
function di3TmpSupplyCatalogRuntimeProbe() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new Error("Не удалось определить активную Google-таблицу.");

  var report = {
    status: "READ_ONLY_PROBE",
    started_at: new Date(),
    spreadsheet: {
      locale: ss.getSpreadsheetLocale(),
      time_zone: ss.getSpreadsheetTimeZone(),
      app_time_zone: typeof di3GetConfiguredTimeZone_ === "function"
        ? di3GetConfiguredTimeZone_() : "UNAVAILABLE"
    },
    required_sheets: {},
    schema: {},
    supply: {},
    catalogue: {},
    checks: {},
    warnings: [],
    errors: [],
    manual_checks: [
      "В форме «Поставка v3» создай тестовый черновик с датой заказа в магазине, отличной от сегодняшней; сохрани и открой его повторно. Префикс нового номера должен соответствовать дате оформления, а не дате записи в системе. Затем исправь G2 у сохранённого черновика: номер должен остаться неизменным, а место в сортировке — измениться.",
      "Убедись, что G2 — дата создания заказа в магазине, G4 — автоматически записанная дата/время регистрации в Dots Inventory; изменение G2 не меняет G4.",
      "Создай второй черновик с более новой датой заказа и проверь, что он выше первого в списке и реестре независимо от created_at.",
      "Проверь, что статусы в реестре и списке черновиков показываются как Оформлена → Отправлена → Ожидает получения → Получена; после каждого перехода подпись должна соответствовать фактическому этапу.",
      "На тестовой поставке последовательно проверь переходы Оформлена → Отправлена → Ожидает получения → Получена; финальный переход выполняй только как тест фактической приёмки, поскольку он создаёт складские движения и FIFO-партии.",
      "Проверь, что сохранение черновика не меняет статус и складской остаток; остаток меняется только после фактической приёмки.",
      "В «Карточка продукта» выбери существующий товар в B4 и подтверди, что срабатывает загрузка карточки, а диаметр в B8 остаётся текстом (например, 6,5), не превращаясь в дату."
    ]
  };

  var required = [
    "_AppMeta", "SchemaMigrations", "V3_Supplies", "Поставка v3",
    "Реестр поставок v3", "Products", "Продукты", "Карточка продукта"
  ];
  required.forEach(function (name) {
    report.required_sheets[name] = !!ss.getSheetByName(name);
  });
  var missing = required.filter(function (name) { return !report.required_sheets[name]; });
  if (missing.length) {
    report.status = "BLOCKED";
    report.errors.push("Отсутствуют обязательные листы: " + missing.join(", "));
    return di3TmpSupplyCatalogProbeFinish_(report);
  }

  var functionAvailability = {
    di3GetSchemaVersion_: typeof di3GetSchemaVersion_ === "function",
    di3GetSchemaMigrationRows_: typeof di3GetSchemaMigrationRows_ === "function",
    di3GetSupplyDraftSummary: typeof di3GetSupplyDraftSummary === "function",
    di3GetSupplyStatusLabel_: typeof di3GetSupplyStatusLabel_ === "function",
    di3CompareSupplyOrderChronology_: typeof di3CompareSupplyOrderChronology_ === "function",
    di3ListAllProductsForWarehouse_: typeof di3ListAllProductsForWarehouse_ === "function",
    di3GetProductPublicCodeMap_: typeof di3GetProductPublicCodeMap_ === "function",
    di3GetProductOptionLabelWithMap_: typeof di3GetProductOptionLabelWithMap_ === "function",
    DI3_SCHEMA_VERSION: typeof DI3_SCHEMA_VERSION !== "undefined",
    DI3_TABLE_SCHEMAS: typeof DI3_TABLE_SCHEMAS !== "undefined",
    DI3_SUPPLY_REGISTER_HEADERS: typeof DI3_SUPPLY_REGISTER_HEADERS !== "undefined"
  };
  var missingFunctions = Object.keys(functionAvailability).filter(function (name) { return !functionAvailability[name]; });
  if (missingFunctions.length) {
    report.status = "BLOCKED";
    report.errors.push("Не найдены функции/константы текущей сборки: " + missingFunctions.join(", ") + ". Проверь, что установлены согласованные версии RC8-модулей.");
    return di3TmpSupplyCatalogProbeFinish_(report);
  }

  // Schema version and migration journal.
  var schemaVersion = di3GetSchemaVersion_();
  var migrations = di3GetSchemaMigrationRows_();
  var baseline = migrations.filter(function (item) { return item.migration_key === "RC8_SCHEMA_BASELINE_ADOPTION"; });
  var planning = migrations.filter(function (item) { return item.migration_key === "RC8_SUPPLY_PLANNING_DATES_V2"; });
  report.schema.version = schemaVersion;
  report.schema.target_version = DI3_SCHEMA_VERSION;
  report.schema.baseline_status = baseline.length ? baseline[baseline.length - 1].status : "MISSING";
  report.schema.planning_dates_migration_status = planning.length ? planning[planning.length - 1].status : "MISSING";
  report.schema.planning_dates_backup_file_id_present = !!(planning.length && planning[planning.length - 1].backup_file_id);
  di3TmpSupplyCatalogProbeCheck_(report, "schema_version_is_2", schemaVersion === 2, schemaVersion, 2);
  di3TmpSupplyCatalogProbeCheck_(report, "schema_baseline_is_completed",
    report.schema.baseline_status === "COMPLETED", report.schema.baseline_status, "COMPLETED");
  di3TmpSupplyCatalogProbeCheck_(report, "supply_planning_migration_is_completed",
    report.schema.planning_dates_migration_status === "COMPLETED",
    report.schema.planning_dates_migration_status, "COMPLETED");
  if (!report.schema.planning_dates_backup_file_id_present) {
    report.warnings.push("В журнале миграции нет backup_file_id. Для непустой книги перед v1→v2 должна быть подтверждённая резервная копия; проверь журнал установки и Drive отдельно.");
  }

  // Core supply table: exact 19-column schema, date types, chronology.
  var supplySheet = ss.getSheetByName("V3_Supplies");
  var supplyHeaders = DI3_TABLE_SCHEMAS.V3_Supplies;
  var actualSupplyHeaders = supplySheet.getRange(1, 1, 1, supplyHeaders.length).getDisplayValues()[0]
    .map(function (value) { return String(value || "").trim(); });
  var supplyHeaderMatch = supplyHeaders.every(function (value, index) { return actualSupplyHeaders[index] === value; });
  di3TmpSupplyCatalogProbeCheck_(report, "v3_supplies_has_current_19_column_schema", supplyHeaderMatch,
    actualSupplyHeaders.join(" | "), supplyHeaders.join(" | "));

  var supplyRows = supplySheet.getLastRow() > 1
    ? supplySheet.getRange(2, 1, supplySheet.getLastRow() - 1, supplyHeaders.length).getValues() : [];
  var supplyIndex = {};
  supplyHeaders.forEach(function (header, index) { supplyIndex[header] = index; });
  var invalidSystemCreated = 0;
  var invalidOrderDate = 0;
  var invalidExpectedDate = 0;
  supplyRows.forEach(function (row) {
    if (row[supplyIndex.created_at] && !(row[supplyIndex.created_at] instanceof Date)) invalidSystemCreated++;
    if (row[supplyIndex.supplier_order_date] && !(row[supplyIndex.supplier_order_date] instanceof Date)) invalidOrderDate++;
    if (row[supplyIndex.expected_received_date] && !(row[supplyIndex.expected_received_date] instanceof Date)) invalidExpectedDate++;
  });
  report.supply.document_count = supplyRows.length;
  report.supply.order_date_count = supplyRows.filter(function (row) { return row[supplyIndex.supplier_order_date] instanceof Date; }).length;
  report.supply.system_created_at_count = supplyRows.filter(function (row) { return row[supplyIndex.created_at] instanceof Date; }).length;
  report.supply.expected_date_count = supplyRows.filter(function (row) { return row[supplyIndex.expected_received_date] instanceof Date; }).length;
  di3TmpSupplyCatalogProbeCheck_(report, "system_created_at_values_are_timestamps", invalidSystemCreated === 0,
    invalidSystemCreated, 0);
  di3TmpSupplyCatalogProbeCheck_(report, "store_order_dates_are_calendar_dates", invalidOrderDate === 0,
    invalidOrderDate, 0);
  di3TmpSupplyCatalogProbeCheck_(report, "expected_dates_are_calendar_dates", invalidExpectedDate === 0,
    invalidExpectedDate, 0);

  var invalidChronology = supplyRows.filter(function (row) {
    var orderDate = row[supplyIndex.supplier_order_date];
    var expectedDate = row[supplyIndex.expected_received_date];
    return orderDate instanceof Date && expectedDate instanceof Date &&
      new Date(orderDate.getFullYear(), orderDate.getMonth(), orderDate.getDate()).getTime() >
      new Date(expectedDate.getFullYear(), expectedDate.getMonth(), expectedDate.getDate()).getTime();
  }).length;
  di3TmpSupplyCatalogProbeCheck_(report, "expected_date_not_before_store_order_date", invalidChronology === 0,
    invalidChronology, 0);
  var orderNumberPrefixMatches = 0;
  var orderNumberPrefixMismatch = 0;
  supplyRows.forEach(function (row) {
    var orderDate = row[supplyIndex.supplier_order_date];
    var number = String(row[supplyIndex.supply_number] || "");
    if (!(orderDate instanceof Date) || !number) return;
    var tz = di3GetConfiguredTimeZone_();
    var prefix = Utilities.formatDate(orderDate, tz, "yy") +
      di3GetDocumentMonthCodes_()[Number(Utilities.formatDate(orderDate, tz, "M")) - 1] +
      Utilities.formatDate(orderDate, tz, "dd");
    if (number.indexOf(prefix) === 0) orderNumberPrefixMatches++;
    else orderNumberPrefixMismatch++;
  });
  report.supply.order_number_prefix_matches = orderNumberPrefixMatches;
  report.supply.order_number_prefix_nonmatches_historical_or_pre_patch = orderNumberPrefixMismatch;

  // Draft repository must sort by store order date, not system created_at.
  var drafts = di3GetSupplyDraftSummary();
  var draftsSorted = drafts.every(function (item, index) {
    if (!index) return true;
    var previous = drafts[index - 1];
    return di3CompareSupplyOrderChronology_(previous.supplier_order_date, previous.created_at, previous.supply_number,
      item.supplier_order_date, item.created_at, item.supply_number) <= 0;
  });
  report.supply.draft_count = drafts.length;
  di3TmpSupplyCatalogProbeCheck_(report, "draft_list_is_sorted_by_store_order_date", draftsSorted,
    draftsSorted ? "sorted" : "out_of_order", "newest store order first; system timestamp tie-breaker");

  // Visible date panel and independent date labels.
  var supplyForm = ss.getSheetByName("Поставка v3");
  var expectedLabels = [
    "Дата создания заказа в магазине", "Ожидаемая дата прибытия", "Запись создана в системе",
    "Отправлена", "Ожидает получения", "Получена"
  ];
  var actualLabels = supplyForm.getRange("D2:D7").getDisplayValues().map(function (row) { return String(row[0] || "").trim(); });
  var labelsMatch = expectedLabels.every(function (label, index) { return actualLabels[index] === label; });
  di3TmpSupplyCatalogProbeCheck_(report, "supply_form_labels_distinguish_store_and_system_dates", labelsMatch,
    actualLabels.join(" | "), expectedLabels.join(" | "));
  var plannedValues = supplyForm.getRange("G2:G3").getValues().map(function (row) { return row[0]; });
  var plannedValid = plannedValues.every(function (value) { return value === "" || value == null || value instanceof Date; });
  di3TmpSupplyCatalogProbeCheck_(report, "planned_date_inputs_are_date_values_or_blank", plannedValid,
    plannedValues.map(function (value) { return value instanceof Date ? "DATE" : (value === "" || value == null ? "BLANK" : typeof value); }).join(", "),
    "DATE or BLANK");
  var plannedValidation = supplyForm.getRange("G2:G3").getDataValidation();
  di3TmpSupplyCatalogProbeCheck_(report, "planned_date_inputs_have_date_validation", !!plannedValidation,
    plannedValidation ? String(plannedValidation.getCriteriaType()) : "MISSING", "date validation present");
  var factualValues = supplyForm.getRange("G4:G7").getValues().map(function (row) { return row[0]; });
  var factualValid = factualValues.every(function (value) { return value === "" || value == null || value instanceof Date; });
  di3TmpSupplyCatalogProbeCheck_(report, "factual_event_dates_are_timestamps_or_blank", factualValid,
    factualValues.map(function (value) { return value instanceof Date ? "DATE" : (value === "" || value == null ? "BLANK" : typeof value); }).join(", "),
    "DATE or BLANK");
  var selectedSupplyNumber = String(supplyForm.getRange("B3").getDisplayValue() || "").trim();
  var selectedSupply = selectedSupplyNumber ? supplyRows.filter(function (row) {
    return String(row[supplyIndex.supply_number] || "") === selectedSupplyNumber;
  })[0] : null;
  if (selectedSupply) {
    var storedCreatedAt = selectedSupply[supplyIndex.created_at];
    var formCreatedAt = factualValues[0];
    var createdMatches = storedCreatedAt instanceof Date && formCreatedAt instanceof Date &&
      storedCreatedAt.getTime() === formCreatedAt.getTime();
    di3TmpSupplyCatalogProbeCheck_(report, "selected_supply_system_timestamp_matches_storage", createdMatches,
      formCreatedAt instanceof Date ? formCreatedAt.toISOString() : String(formCreatedAt),
      storedCreatedAt instanceof Date ? storedCreatedAt.toISOString() : String(storedCreatedAt));
  } else {
    report.warnings.push("В форме не выбрана существующая поставка; сопоставление G4 с created_at пропущено.");
  }

  // Register headers, physical ordering and optional next-stage dates.
  var register = ss.getSheetByName("Реестр поставок v3");
  var expectedRegisterHeaders = DI3_SUPPLY_REGISTER_HEADERS;
  var actualRegisterHeaders = register.getRange(3, 1, 1, expectedRegisterHeaders.length).getDisplayValues()[0]
    .map(function (value) { return String(value || "").trim(); });
  var registerHeadersMatch = expectedRegisterHeaders.every(function (value, index) { return actualRegisterHeaders[index] === value; });
  di3TmpSupplyCatalogProbeCheck_(report, "supply_register_has_reordered_13_column_schema", registerHeadersMatch,
    actualRegisterHeaders.join(" | "), expectedRegisterHeaders.join(" | "));
  var registerFirstColumnIsSystemDate = actualRegisterHeaders[0] === "Запись создана в системе";
  var registerLifecycleColumnsMatch = actualRegisterHeaders.slice(3, 7).join("|") === "Оформлена|Отправлена|Ожидает получения|Получена";
  di3TmpSupplyCatalogProbeCheck_(report, "register_system_created_at_is_first_column", registerFirstColumnIsSystemDate,
    actualRegisterHeaders[0], "Запись создана в системе");
  di3TmpSupplyCatalogProbeCheck_(report, "register_lifecycle_dates_follow_supply_sequence", registerLifecycleColumnsMatch,
    actualRegisterHeaders.slice(3, 7).join(" | "), "Оформлена | Отправлена | Ожидает получения | Получена");

  var registerRows = register.getLastRow() > 3
    ? register.getRange(4, 1, register.getLastRow() - 3, expectedRegisterHeaders.length).getValues() : [];
  var expectedRows = supplyRows.map(function (row) {
    return {
      id: String(row[supplyIndex.supply_id] || ""),
      order_date: row[supplyIndex.supplier_order_date] || "",
      system_created_at: row[supplyIndex.created_at] || "",
      number: row[supplyIndex.supply_number]
    };
  }).sort(function (a, b) {
    return di3CompareSupplyOrderChronology_(a.order_date, a.system_created_at, a.number,
      b.order_date, b.system_created_at, b.number);
  });
  var actualIds = registerRows.map(function (row) { return String(row[11] || ""); }).filter(Boolean);
  var expectedIds = expectedRows.map(function (row) { return row.id; }).filter(Boolean);
  var registerOrderMatches = actualIds.length === expectedIds.length &&
    actualIds.every(function (id, index) { return id === expectedIds[index]; });
  var sourceRowsById = {};
  supplyRows.forEach(function (row) { sourceRowsById[String(row[supplyIndex.supply_id] || "")] = row; });
  var registerSystemDatesMatch = registerRows.every(function (row) {
    var source = sourceRowsById[String(row[11] || "")];
    return !!source && row[0] instanceof Date && source[supplyIndex.created_at] instanceof Date &&
      row[0].getTime() === source[supplyIndex.created_at].getTime();
  });
  var registerNumbersMatch = registerRows.every(function (row) {
    var source = sourceRowsById[String(row[11] || "")];
    return !!source && String(row[1] || "") === String(source[supplyIndex.supply_number] || "");
  });
  var registerOrderDatesMatch = registerRows.every(function (row) {
    var source = sourceRowsById[String(row[11] || "")];
    if (!source) return false;
    var projected = row[3];
    var stored = source[supplyIndex.supplier_order_date];
    if (!projected && !stored) return true;
    return projected instanceof Date && stored instanceof Date && projected.getTime() === stored.getTime();
  });
  report.supply.register_rows = registerRows.length;
  report.supply.register_next_stage_dates = registerRows.filter(function (row) { return row[12] instanceof Date; }).length;
  di3TmpSupplyCatalogProbeCheck_(report, "supply_register_is_sorted_by_store_order_date", registerOrderMatches,
    actualIds.length + " rows; ordered=" + registerOrderMatches,
    expectedIds.length + " rows sorted by supplier_order_date");
  di3TmpSupplyCatalogProbeCheck_(report, "register_first_column_matches_system_created_at", registerSystemDatesMatch,
    registerSystemDatesMatch ? "all visible system timestamps match V3_Supplies.created_at" : "system timestamp projection mismatch",
    "column A equals created_at");
  di3TmpSupplyCatalogProbeCheck_(report, "register_number_column_matches_supply_records", registerNumbersMatch,
    registerNumbersMatch ? "all column B numbers match supply_number" : "supply number projection mismatch",
    "column B equals V3_Supplies.supply_number");
  di3TmpSupplyCatalogProbeCheck_(report, "register_order_date_column_matches_store_order_date", registerOrderDatesMatch,
    registerOrderDatesMatch ? "all column D dates match supplier_order_date" : "store order-date projection mismatch",
    "column D equals V3_Supplies.supplier_order_date");
  var sourceById = sourceRowsById;
  var statusesMatch = registerRows.every(function (row) {
    var source = sourceById[String(row[11] || "")];
    return !!source && String(row[8] || "") === di3GetSupplyStatusLabel_(source[supplyIndex.status]);
  });
  di3TmpSupplyCatalogProbeCheck_(report, "supply_register_uses_consistent_status_labels", statusesMatch,
    statusesMatch ? "all visible statuses match stored document states" : "status projection mismatch",
    "Оформлена / Отправлена / Ожидает получения / Получена");
  var invalidNextStageDates = registerRows.filter(function (row) {
    return row[12] !== "" && row[12] != null && !(row[12] instanceof Date);
  }).length;
  di3TmpSupplyCatalogProbeCheck_(report, "register_next_stage_values_are_date_or_blank", invalidNextStageDates === 0,
    invalidNextStageDates, 0);

  // Product catalogue: selector list, diameter-as-text field and existing product labels.
  var products = di3ListAllProductsForWarehouse_();
  var codeMap = di3GetProductPublicCodeMap_();
  var productOptions = products.map(function (product) {
    return di3GetProductOptionLabelWithMap_(product, codeMap);
  });
  var uniqueOptions = Object.keys(productOptions.reduce(function (map, option) {
    map[String(option)] = true;
    return map;
  }, {})).length;
  report.catalogue.product_count = products.length;
  report.catalogue.selector_option_count = productOptions.length;
  var productForm = ss.getSheetByName("Карточка продукта");
  var selectorValidation = productForm.getRange("B4").getDataValidation();
  var selectorValues = selectorValidation && selectorValidation.getCriteriaType() === SpreadsheetApp.DataValidationCriteria.VALUE_IN_LIST
    ? selectorValidation.getCriteriaValues()[0] : [];
  var selectorOptionsMatch = productOptions.length === 0
    ? !selectorValidation || selectorValues.length === 0
    : !!selectorValidation && selectorValues.length === productOptions.length &&
      selectorValues.every(function (value, index) { return String(value) === String(productOptions[index]); });
  di3TmpSupplyCatalogProbeCheck_(report, "product_selector_b4_matches_current_product_options", selectorOptionsMatch,
    selectorValues.length + " validation options", productOptions.length + " current product options");
  di3TmpSupplyCatalogProbeCheck_(report, "product_selector_labels_are_unique", uniqueOptions === productOptions.length,
    uniqueOptions, productOptions.length);
  var diameterFormat = productForm.getRange("B8").getNumberFormat();
  di3TmpSupplyCatalogProbeCheck_(report, "product_diameter_input_is_plain_text", diameterFormat === "@",
    diameterFormat, "@");
  var selectedProductLabel = String(productForm.getRange("B4").getDisplayValue() || "").trim();
  if (selectedProductLabel) {
    var selectedMatches = productOptions.filter(function (value) { return String(value) === selectedProductLabel; }).length;
    di3TmpSupplyCatalogProbeCheck_(report, "selected_product_is_unique", selectedMatches === 1,
      selectedMatches, 1);
  } else {
    report.warnings.push("В карточке продукта сейчас не выбран товар; фактическую работу onEdit/B4→B8 нужно проверить вручную по чек-листу.");
  }

  var failed = Object.keys(report.checks).filter(function (key) { return !report.checks[key].pass; });
  if (failed.length) {
    report.status = "CHECKS_FAILED";
    report.errors.push("Не прошли проверки: " + failed.join(", "));
  } else {
    report.status = report.warnings.length ? "READY_WITH_WARNINGS" : "READY";
  }
  report.read_only = true;
  report.note = "Проба проверяет структуру, сохранённые значения, порядок и правила выбора. Она не выполняет setup/migration, не создаёт тестовые документы и не заменяет визуальную проверку onEdit и поведения формы.";
  return di3TmpSupplyCatalogProbeFinish_(report);
}

function di3TmpSupplyCatalogProbeCheck_(report, name, pass, actual, expected) {
  report.checks[name] = { pass: !!pass, actual: actual, expected: expected };
}

function di3TmpSupplyCatalogProbeFinish_(report) {
  report.finished_at = new Date();
  if (typeof console !== "undefined" && console.log) console.log(JSON.stringify(report, null, 2));
  if (typeof Logger !== "undefined" && Logger.log) Logger.log(JSON.stringify(report, null, 2));
  return report;
}
