/** Dots Inventory v3 — validated application settings and user-facing settings workspace. */
var DI3_SETTINGS_WORKSPACE_SHEET = "Настройки";
var DI3_SETTINGS_DEFAULT_TIME_ZONE = DI3_APP_CONFIG.TIME_ZONE;
var DI3_SETTINGS_DEFAULT_CURRENCY = "RUB";
var DI3_SETTINGS_DEFAULT_MARGIN = 0.30;
var DI3_DEFAULT_DOCUMENT_MONTH_CODES = Object.freeze(["JR", "FY", "MH", "AL", "MY", "JN", "JY", "AT", "SR", "OR", "NR", "DR"]);
var DI3_SETTINGS_MONTH_NAMES = Object.freeze([
  "Январь", "Февраль", "Март", "Апрель", "Май", "Июнь",
  "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"
]);

var DI3_SETTINGS_DEFINITIONS = Object.freeze({
  target_gross_margin: {
    value_type: "NUMBER", is_editable: true,
    description: "Целевая валовая маржа для минимальной цены и рекомендаций скидки. Диапазон: от 0% до 94,99%."
  },
  currency: {
    value_type: "CURRENCY", is_editable: false,
    description: "Базовая валюта учёта. Сейчас поддерживается только RUB; смена валюты требует отдельной миграции всех денежных данных и форматов."
  },
  time_zone: {
    value_type: "TIME_ZONE", is_editable: false,
    description: "Источник: apps_script/00_DI3_AppConfig.gs → DI3_APP_CONFIG.TIME_ZONE. После изменения выполни node node/sync_manifest_timezone.js; часовой пояс таблицы синхронизируется при setup."
  },
  document_month_codes: {
    value_type: "JSON_ARRAY", is_editable: true,
    description: "12 уникальных двухсимвольных кодов месяцев для новых номеров поставок и заказов. Изменение разрешено только до создания первого документа."
  }
});

function di3SettingsActor_() {
  try {
    return Session.getActiveUser().getEmail() || "";
  } catch (error) {
    return "";
  }
}

function di3GetSettingsRows_() {
  if (!di3GetSpreadsheet_().getSheetByName("Settings")) return [];
  return di3ReadTableValues_("Settings").map(function (row, index) {
    return {
      setting_key: String(row[0] || ""),
      setting_value: String(row[1] == null ? "" : row[1]),
      value_type: String(row[2] || ""),
      is_editable: row[3] === true || String(row[3]).toLowerCase() === "true",
      description: String(row[4] || ""),
      updated_at: row[5] || "",
      updated_by: String(row[6] || ""),
      row_number: index + 2
    };
  });
}

function di3GetSettingValue_(key, fallbackValue) {
  var name = String(key || "");
  var rows = di3GetSettingsRows_().filter(function (row) { return row.setting_key === name; });
  if (!rows.length) return fallbackValue == null ? null : fallbackValue;
  if (rows.length > 1) throw new Error("В Settings найден повторяющийся ключ «" + name + ". Исправь дубликаты до дальнейшей работы.");
  return rows[0].setting_value;
}

function di3ReadLegacyTargetGrossMargin_() {
  var sheet = di3GetSpreadsheet_().getSheetByName("Склад");
  if (!sheet || sheet.getLastRow() < 10) return DI3_SETTINGS_DEFAULT_MARGIN;
  var value = Number(sheet.getRange("B10").getValue());
  return Number.isFinite(value) && value >= 0 && value < 0.95 ? value : DI3_SETTINGS_DEFAULT_MARGIN;
}

function di3BuildDefaultSettingsRows_() {
  var margin = di3ReadLegacyTargetGrossMargin_();
  var values = {
    target_gross_margin: String(margin),
    currency: DI3_SETTINGS_DEFAULT_CURRENCY,
    time_zone: DI3_SETTINGS_DEFAULT_TIME_ZONE,
    document_month_codes: JSON.stringify(DI3_DEFAULT_DOCUMENT_MONTH_CODES)
  };
  var now = new Date();
  return Object.keys(DI3_SETTINGS_DEFINITIONS).map(function (key) {
    var definition = DI3_SETTINGS_DEFINITIONS[key];
    return [key, values[key], definition.value_type, definition.is_editable,
      definition.description, now, di3SettingsActor_()];
  });
}

/** Seed missing defaults once; never overwrite an existing setting or unknown future key. */
function di3EnsureSettingsRepository_() {
  if (!di3GetSpreadsheet_().getSheetByName("Settings")) {
    throw new Error("Системная таблица Settings не создана. Сначала выполни di3EnsureCoreFoundationSchemas_().");
  }
  var rows = di3GetSettingsRows_();
  var seen = Object.create(null);
  rows.forEach(function (row) {
    if (seen[row.setting_key]) throw new Error("В Settings обнаружен дублирующийся ключ «" + row.setting_key + ".");
    seen[row.setting_key] = true;
  });
  var defaults = di3BuildDefaultSettingsRows_();
  var missing = defaults.filter(function (row) { return !seen[row[0]]; });
  if (missing.length) di3AppendTableRows_("Settings", missing);
  // Settings.time_zone is a mirror, not a second configuration source. If the
  // owner changes DI3_APP_CONFIG.TIME_ZONE, setup synchronizes this row safely.
  var timeZoneRow = di3GetSettingsRows_().filter(function (row) { return row.setting_key === "time_zone"; })[0];
  var configuredTimeZone = di3GetConfiguredTimeZone_();
  if (timeZoneRow && timeZoneRow.setting_value !== configuredTimeZone) {
    di3GetSheetOrThrow_("Settings").getRange(timeZoneRow.row_number, 1, 1, 7).setValues([[
      "time_zone", configuredTimeZone, DI3_SETTINGS_DEFINITIONS.time_zone.value_type, false,
      DI3_SETTINGS_DEFINITIONS.time_zone.description, new Date(), di3SettingsActor_()
    ]]);
  }
  var issues = di3ValidateSettingsRepository_().issues;
  if (issues.length) throw new Error("Настройки несовместимы: " + issues.join("; "));
  return { status: "READY", seeded: missing.map(function (row) { return row[0]; }), settings_count: rows.length + missing.length };
}

function di3NormalizeDocumentMonthCodes_(input) {
  var codes = input;
  if (typeof codes === "string") {
    try { codes = JSON.parse(codes); } catch (error) { throw new Error("Коды месяцев должны содержать 12 двухсимвольных значений."); }
  }
  if (!Array.isArray(codes) || codes.length !== 12) {
    throw new Error("Нужно указать ровно 12 кодов месяцев — с января по декабрь.");
  }
  var normalized = codes.map(function (code, index) {
    var value = String(code == null ? "" : code).trim().toUpperCase();
    if (!/^[A-Z0-9]{2}$/.test(value)) {
      throw new Error("Код месяца «" + DI3_SETTINGS_MONTH_NAMES[index] + "» должен состоять ровно из двух латинских букв или цифр.");
    }
    return value;
  });
  if (Object.keys(normalized.reduce(function (map, code) { map[code] = true; return map; }, {})).length !== 12) {
    throw new Error("Коды всех 12 месяцев должны быть уникальными.");
  }
  return normalized;
}

function di3HasNumberedDocuments_() {
  var ss = di3GetSpreadsheet_();
  var orders = ss.getSheetByName("V3_Orders");
  var supplies = ss.getSheetByName("V3_Supplies");
  return !!((orders && orders.getLastRow() > 1) || (supplies && supplies.getLastRow() > 1));
}

function di3NormalizeSettingValue_(key, value) {
  if (key === "target_gross_margin") {
    var margin = Number(value);
    if (!Number.isFinite(margin) || margin < 0 || margin >= 0.95) {
      throw new Error("Целевая маржа должна быть числом от 0% до 94,99%.");
    }
    return String(margin);
  }
  if (key === "currency") {
    if (String(value || "").trim().toUpperCase() !== DI3_SETTINGS_DEFAULT_CURRENCY) {
      throw new Error("В этой версии поддерживается только базовая валюта RUB. Переключение валюты без миграции финансовой истории запрещено.");
    }
    return DI3_SETTINGS_DEFAULT_CURRENCY;
  }
  if (key === "time_zone") {
    if (String(value || "").trim() !== DI3_SETTINGS_DEFAULT_TIME_ZONE) {
      throw new Error("Часовой пояс зафиксирован на " + DI3_SETTINGS_DEFAULT_TIME_ZONE + " и должен совпадать с appsscript.json.");
    }
    return DI3_SETTINGS_DEFAULT_TIME_ZONE;
  }
  if (key === "document_month_codes") {
    if (di3HasNumberedDocuments_()) {
      throw new Error("Коды месяцев нельзя менять после появления поставок или заказов: это может привести к повторению номеров. Создай изменение только до первого документа.");
    }
    return JSON.stringify(di3NormalizeDocumentMonthCodes_(value));
  }
  throw new Error("Неизвестная настройка: " + key);
}

function di3SetSettingValueUnlocked_(key, value) {
  var name = String(key || "");
  var definition = DI3_SETTINGS_DEFINITIONS[name];
  if (!definition) throw new Error("Неизвестная настройка: " + name);
  if (!definition.is_editable) throw new Error("Настройка «" + name + "» доступна только для чтения.");
  var normalized = di3NormalizeSettingValue_(name, value);
  var matches = di3GetSettingsRows_().filter(function (row) { return row.setting_key === name; });
  if (matches.length > 1) throw new Error("В Settings обнаружены дубликаты ключа «" + name + ".");
  var now = new Date();
  var row = [name, normalized, definition.value_type, definition.is_editable,
    definition.description, now, di3SettingsActor_()];
  if (matches.length) {
    di3GetSheetOrThrow_("Settings").getRange(matches[0].row_number, 1, 1, row.length).setValues([row]);
    return { updated: true, key: name, value: normalized };
  }
  di3AppendTableRows_("Settings", [row]);
  return { updated: true, created: true, key: name, value: normalized };
}

function di3SetSettingValue_(key, value) {
  return di3WithLock_(function () { return di3SetSettingValueUnlocked_(key, value); });
}

function di3SetTargetGrossMargin_(value) {
  return di3WithLock_(function () {
    var result = di3SetSettingValue_("target_gross_margin", value);
    var margin = Number(result.value);
    var ss = di3GetSpreadsheet_();
    var settings = ss.getSheetByName(DI3_SETTINGS_WORKSPACE_SHEET);
    if (settings) settings.getRange("B4").setValue(margin);
    var dashboard = ss.getSheetByName("Склад");
    if (dashboard) dashboard.getRange("B10").setValue(margin).setNumberFormat("0%");
    return { updated: true, target_gross_margin: margin };
  });
}

function di3GetBaseCurrency_() {
  var value = String(di3GetSettingValue_("currency", DI3_SETTINGS_DEFAULT_CURRENCY) || "").trim().toUpperCase();
  if (value !== DI3_SETTINGS_DEFAULT_CURRENCY) {
    throw new Error("Неподдерживаемая базовая валюта в Settings: " + value + ". Текущая версия поддерживает только RUB.");
  }
  return value;
}

function di3GetDocumentMonthCodes_() {
  var raw = di3GetSettingValue_("document_month_codes", null);
  if (raw == null || raw === "") return DI3_DEFAULT_DOCUMENT_MONTH_CODES.slice();
  return di3NormalizeDocumentMonthCodes_(raw);
}

function di3SetDocumentMonthCodes_(codes) {
  return di3WithLock_(function () {
    var result = di3SetSettingValue_("document_month_codes", codes);
    if (di3GetSpreadsheet_().getSheetByName(DI3_SETTINGS_WORKSPACE_SHEET)) di3RefreshSettingsWorkspace();
    return { updated: true, codes: JSON.parse(result.value) };
  });
}

function di3PreflightSettingsRepository_() {
  var ss = di3GetSpreadsheet_();
  var sheet = ss.getSheetByName("Settings");
  if (!sheet || sheet.getLastRow() < 2) return { issues: [], warnings: [] };
  var issues = [];
  var warnings = [];
  var rows = di3GetSettingsRows_();
  var map = Object.create(null);
  rows.forEach(function (row) {
    if (!row.setting_key) return;
    if (map[row.setting_key]) issues.push("Settings: повторяется ключ «" + row.setting_key + "».");
    map[row.setting_key] = row;
  });
  Object.keys(DI3_SETTINGS_DEFINITIONS).forEach(function (key) {
    var row = map[key];
    if (!row) return; // missing defaults are safely seeded by setup
    var definition = DI3_SETTINGS_DEFINITIONS[key];
    if (row.value_type !== definition.value_type || row.is_editable !== definition.is_editable) {
      issues.push("Settings: несовместимые метаданные параметра «" + key + "».");
    }
    try {
      if (key === "target_gross_margin") {
        var margin = Number(row.setting_value);
        if (!Number.isFinite(margin) || margin < 0 || margin >= 0.95) throw new Error("значение должно быть от 0% до 94,99%");
      } else if (key === "currency" && row.setting_value !== DI3_SETTINGS_DEFAULT_CURRENCY) {
        throw new Error("поддерживается только RUB");
      } else if (key === "time_zone" && row.setting_value !== DI3_SETTINGS_DEFAULT_TIME_ZONE) {
        warnings.push("Settings.time_zone будет синхронизирован с DI3_APP_CONFIG.TIME_ZONE (" + DI3_SETTINGS_DEFAULT_TIME_ZONE + ").");
      } else if (key === "document_month_codes") {
        di3NormalizeDocumentMonthCodes_(row.setting_value);
      }
    } catch (error) {
      issues.push("Settings." + key + ": " + (error.message || String(error)) + ".");
    }
  });
  var missing = Object.keys(DI3_SETTINGS_DEFINITIONS).filter(function (key) { return !map[key]; });
  if (missing.length) warnings.push("Settings: при установке будут добавлены настройки по умолчанию: " + missing.join(", ") + ".");
  return { issues: issues, warnings: warnings };
}

function di3ValidateSettingsRepository_() {
  var rows = di3GetSettingsRows_();
  var issues = [];
  var map = Object.create(null);
  rows.forEach(function (row) {
    if (!row.setting_key) { issues.push("Есть строка Settings без setting_key."); return; }
    if (map[row.setting_key]) issues.push("Повторяется ключ Settings: " + row.setting_key + ".");
    map[row.setting_key] = row;
    if (DI3_SETTINGS_DEFINITIONS[row.setting_key] && row.value_type !== DI3_SETTINGS_DEFINITIONS[row.setting_key].value_type) {
      issues.push(row.setting_key + ": неверный value_type.");
    }
  });
  Object.keys(DI3_SETTINGS_DEFINITIONS).forEach(function (key) {
    if (!map[key]) { issues.push("Отсутствует обязательная настройка " + key + "."); return; }
    try {
      if (key === "target_gross_margin") di3NormalizeSettingValue_(key, map[key].setting_value);
      else if (key === "currency") di3NormalizeSettingValue_(key, map[key].setting_value);
      else if (key === "time_zone") di3NormalizeSettingValue_(key, map[key].setting_value);
      else if (key === "document_month_codes") di3NormalizeDocumentMonthCodes_(map[key].setting_value);
    } catch (error) { issues.push(key + ": " + (error.message || String(error))); }
    if (map[key].is_editable !== DI3_SETTINGS_DEFINITIONS[key].is_editable) {
      issues.push(key + ": неверный признак is_editable.");
    }
  });
  return {
    issues: issues,
    settings_count: rows.length,
    target_gross_margin: map.target_gross_margin ? Number(map.target_gross_margin.setting_value) : null,
    currency: map.currency ? map.currency.setting_value : "",
    time_zone: map.time_zone ? map.time_zone.setting_value : ""
  };
}

function di3RefreshSettingsWorkspace() {
  var sheet = di3GetSpreadsheet_().getSheetByName(DI3_SETTINGS_WORKSPACE_SHEET);
  if (!sheet) throw new Error("Лист «Настройки» не найден. Запусти setupDotsInventoryV3().");
  var codes = di3GetDocumentMonthCodes_();
  sheet.getRange("B4").setValue(di3GetTargetGrossMargin_()).setNumberFormat("0%");
  sheet.getRange("B5").setValue(di3GetBaseCurrency_());
  sheet.getRange("B6").setValue(di3GetConfiguredTimeZone_());
  sheet.getRange("B10:B21").setValues(codes.map(function (code) { return [code]; }));
  sheet.getRange("B4:B6").setFontColor("#202124");
  sheet.getRange("B10:B21").setFontColor("#202124");
  return { status: "READY", target_gross_margin: di3GetTargetGrossMargin_(), currency: di3GetBaseCurrency_(), time_zone: di3GetConfiguredTimeZone_(), document_month_codes: codes };
}

function di3SetupSettingsWorkspace() {
  di3EnsureCoreFoundationSchemas_();
  di3EnsureSettingsRepository_();
  var ss = di3GetSpreadsheet_();
  var sheet = ss.getSheetByName(DI3_SETTINGS_WORKSPACE_SHEET);
  var created = false;
  if (!sheet) {
    sheet = ss.insertSheet(DI3_SETTINGS_WORKSPACE_SHEET);
    di3PrepareNewSheet_(sheet, 21, 4);
    created = true;
  }
  if (!created && sheet.getLastRow() > 0 && String(sheet.getRange("A1").getDisplayValue()) !== "НАСТРОЙКИ СИСТЕМЫ") {
    throw new Error("Лист «Настройки» существует с неизвестной структурой; автоматическая перезапись запрещена.");
  }
  sheet.getRange("A1:D1").merge();
  sheet.getRange("A1").setValue("НАСТРОЙКИ СИСТЕМЫ");
  sheet.getRange("A2:D2").merge();
  sheet.getRange("A2").setValue("Изменяемые параметры сохраняются в системном репозитории. Валюта и часовой пояс защищены от случайной смены.");
  sheet.getRange("A4:C6").setValues([
    ["Целевая валовая маржа", "", "Используется в рекомендациях минимальной цены и допустимой скидки."],
    ["Базовая валюта", "", "RUB — единственная поддерживаемая валюта текущей версии."],
    ["Часовой пояс", "", "Задаётся в apps_script/00_DI3_AppConfig.gs. Синхронизируй timeZone в appsscript.json; часовой пояс таблицы обновится при setup."]
  ]);
  sheet.getRange("A8:D8").merge();
  sheet.getRange("A8").setValue("КОДЫ МЕСЯЦЕВ В НОМЕРАХ ДОКУМЕНТОВ");
  sheet.getRange("A9:B9").setValues([["Месяц", "Код месяца"]]);
  sheet.getRange("C9:D9").merge();
  sheet.getRange("C9").setValue("Коды должны быть уникальными, по две латинские буквы/цифры.");
  sheet.getRange(10, 1, 12, 1).setValues(DI3_SETTINGS_MONTH_NAMES.map(function (name) { return [name]; }));
  sheet.getRange("C10").setValue("Изменение разрешено только до создания первой поставки или заказа.");
  sheet.getRange("A1:D1").setBackground("#17243A").setFontColor("#FFFFFF").setFontWeight("bold");
  sheet.getRange("A2:D2").setBackground("#EAF0F7").setFontColor("#40516A");
  sheet.getRange("A4:A6").setFontWeight("bold").setFontColor("#40516A");
  sheet.getRange("B4:B6").setBackground("#F1F5F9");
  sheet.getRange("A8:D8").setBackground("#253B59").setFontColor("#FFFFFF").setFontWeight("bold");
  sheet.getRange("A9:B9").setBackground("#DCE6F1").setFontWeight("bold");
  sheet.getRange("C9:D9").setBackground("#EAF0F7").setFontColor("#40516A");
  sheet.getRange("A10:B21").setBackground("#F8FAFC").setFontColor("#202124");
  sheet.getRange("B10:B21").setBackground("#FFF7E6").setFontWeight("bold");
  sheet.getRange("C10:D21").setFontColor("#64748B");
  sheet.getRange("B4").setDataValidation(SpreadsheetApp.newDataValidation().requireNumberBetween(0, 0.9499).setAllowInvalid(false).build());
  sheet.getRange("C4:D4").merge();
  sheet.getRange("C5:D5").merge();
  sheet.getRange("C6:D6").merge();
  di3SetFrozenRowsSafely_(sheet, 9);
  [230, 120, 250, 180].forEach(function (width, index) { sheet.setColumnWidth(index + 1, width); });
  sheet.setHiddenGridlines(true);
  sheet.setTabColor("#64748B");
  di3RefreshSettingsWorkspace();
  di3CompactSheet_(sheet, 21, 4);
  return { status: "READY", created: created, sheet: DI3_SETTINGS_WORKSPACE_SHEET };
}

function di3SettingsOnEdit(e) {
  if (!e || !e.range || typeof e.range.getRow !== "function" || typeof e.range.getColumn !== "function") return;
  var range = e.range;
  var row = range.getRow();
  var column = range.getColumn();
  try {
    if (column === 2 && row === 4) {
      di3SetTargetGrossMargin_(range.getValue());
      di3RefreshWarehouseDashboard();
      di3GetSpreadsheet_().toast("Целевая маржа сохранена.", "Настройки", 5);
      return;
    }
    if (column === 2 && row >= 10 && row <= 21) {
      var codes = di3GetSpreadsheet_().getSheetByName(DI3_SETTINGS_WORKSPACE_SHEET)
        .getRange("B10:B21").getValues().map(function (item) { return item[0]; });
      di3SetDocumentMonthCodes_(codes);
      di3GetSpreadsheet_().toast("Коды месяцев сохранены.", "Настройки", 5);
      return;
    }
    // Read-only settings and labels are restored from the repository on any attempted edit.
    di3RefreshSettingsWorkspace();
  } catch (error) {
    di3RefreshSettingsWorkspace();
    try { di3GetSpreadsheet_().toast(error.message || String(error), "Настройки · ошибка", 8); } catch (toastError) {}
  }
}

function di3OpenSettingsWorkspace() {
  var sheet = di3GetSpreadsheet_().getSheetByName(DI3_SETTINGS_WORKSPACE_SHEET);
  if (!sheet) throw new Error("Лист «Настройки» не найден. Запусти setupDotsInventoryV3().");
  di3GetSpreadsheet_().setActiveSheet(sheet);
  return { opened: true, sheet: DI3_SETTINGS_WORKSPACE_SHEET };
}
