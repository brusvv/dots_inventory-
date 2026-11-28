/**
 * Google Sheets formula argument separators follow the spreadsheet locale.
 * Apps Script formulas still use English function names, but locales with a
 * decimal comma (for example fi_FI / ru_RU) require semicolons between args.
 */
function di3GetFormulaArgumentSeparator_() {
  var locale = "";
  try {
    var spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
    if (spreadsheet && typeof spreadsheet.getSpreadsheetLocale === "function") {
      locale = String(spreadsheet.getSpreadsheetLocale() || "").trim();
    }
  } catch (error) {
    locale = "";
  }

  if (locale && typeof Intl !== "undefined" && typeof Intl.NumberFormat === "function") {
    try {
      var numberFormat = new Intl.NumberFormat(locale.replace(/_/g, "-"));
      if (typeof numberFormat.formatToParts === "function") {
        var parts = numberFormat.formatToParts(1.1);
        for (var i = 0; i < parts.length; i++) {
          if (parts[i].type === "decimal") return parts[i].value === "." ? "," : ";";
        }
      }
      var decimalSample = numberFormat.format(1.1);
      if (decimalSample.indexOf(",") !== -1) return ";";
      if (decimalSample.indexOf(".") !== -1) return ",";
    } catch (error) {
      // Fall through to the language-based compatibility map below.
    }
  }

  var language = locale.toLowerCase().replace(/-/g, "_").split("_")[0];
  var decimalCommaLanguages = [
    "af", "sq", "az", "be", "bg", "bs", "ca", "cs", "da", "de", "el", "es",
    "et", "eu", "fi", "fr", "hr", "hu", "id", "is", "it", "kk", "lt", "lv",
    "mk", "nl", "no", "pl", "pt", "ro", "ru", "sk", "sl", "sr", "sv", "tr",
    "uk", "uz", "vi"
  ];
  return decimalCommaLanguages.indexOf(language) !== -1 ? ";" : ",";
}

/** Build a required positive-integer validation for a single input cell. */
function di3BuildPositiveIntegerValidation_(cellA1, maxValue) {
  var cell = String(cellA1 || "").trim().toUpperCase();
  if (!/^[A-Z]+[1-9][0-9]*$/.test(cell)) throw new Error("Для проверки целого числа нужна корректная ссылка на ячейку.");
  var limit = Number(maxValue == null ? 100000000 : maxValue);
  if (!Number.isFinite(limit) || limit < 1 || Math.floor(limit) !== limit) throw new Error("Некорректный верхний предел целого числа.");
  var separator = di3GetFormulaArgumentSeparator_();
  var formula = '=AND(ISNUMBER(' + cell + ')' + separator + cell + '=INT(' + cell + ')' + separator + cell + '>=1' + separator + cell + '<=' + limit + ')';
  return SpreadsheetApp.newDataValidation().requireFormulaSatisfied(formula).setAllowInvalid(false).build();
}

/** Build a validation for an optional positive integer in the target cell. */
function di3BuildOptionalPositiveIntegerValidation_(cellA1, maxValue) {
  var cell = String(cellA1 || "").trim().toUpperCase();
  if (!/^[A-Z]+[1-9][0-9]*$/.test(cell)) throw new Error("Для проверки целого числа нужна корректная ссылка на ячейку.");
  var limit = Number(maxValue == null ? 100000000 : maxValue);
  if (!Number.isFinite(limit) || limit < 1 || Math.floor(limit) !== limit) throw new Error("Некорректный верхний предел целого числа.");
  var separator = di3GetFormulaArgumentSeparator_();
  var formula = '=OR(' + cell + '=""' + separator + 'AND(ISNUMBER(' + cell + ')' + separator + cell + '=INT(' + cell + ')' + separator + cell + '>=1' + separator + cell + '<=' + limit + '))';
  return SpreadsheetApp.newDataValidation().requireFormulaSatisfied(formula).setAllowInvalid(false).build();
}

/** Build a non-negative numeric validation for optional amounts. */
function di3BuildOptionalNonnegativeNumberValidation_(maxValue) {
  var limit = Number(maxValue == null ? 1000000000 : maxValue);
  if (!Number.isFinite(limit) || limit < 0) throw new Error("Некорректный верхний предел суммы.");
  return SpreadsheetApp.newDataValidation().requireNumberBetween(0, limit).setAllowInvalid(false).build();
}

/** Apply a light alternating row pattern with an explicit readable body-text color. */
function di3ApplyLightBandingWithDarkText_(range) {
  if (!range) throw new Error("Для оформления строк нужен диапазон.");
  range.applyRowBanding(SpreadsheetApp.BandingTheme.LIGHT_GREY);
  range.setFontColor("#202124");
  return { status: "READY", font_color: "#202124" };
}

/**
 * Dots Inventory v3 — shared UI menus and safe Google Sheets filter resizing.
 * A Filter has no setRange() method. To resize its range, recreate it while
 * preserving criteria for columns that remain inside the new range.
 */
function di3SetFilterRangePreservingCriteria_(sheet, targetRange) {
  if (!sheet || !targetRange) throw new Error("Для обновления фильтра нужны лист и целевой диапазон.");

  var existing = sheet.getFilter();
  var criteriaByColumn = {};
  var oldRange = existing && typeof existing.getRange === "function" ? existing.getRange() : null;
  var targetStart = targetRange.getColumn();
  var targetEnd = targetStart + targetRange.getNumColumns() - 1;

  if (existing && oldRange) {
    var oldStart = oldRange.getColumn();
    var oldEnd = oldStart + oldRange.getNumColumns() - 1;
    var overlapStart = Math.max(oldStart, targetStart);
    var overlapEnd = Math.min(oldEnd, targetEnd);
    for (var column = overlapStart; column <= overlapEnd; column++) {
      var criteria = existing.getColumnFilterCriteria(column);
      if (criteria != null) criteriaByColumn[column] = criteria && typeof criteria.copy === "function" ? criteria.copy().build() : criteria;
    }

    var sameRange = oldRange.getRow() === targetRange.getRow() &&
      oldRange.getColumn() === targetRange.getColumn() &&
      oldRange.getNumRows() === targetRange.getNumRows() &&
      oldRange.getNumColumns() === targetRange.getNumColumns();
    if (sameRange) return { changed: false, criteria_preserved: Object.keys(criteriaByColumn).length };

    existing.remove();
  }

  var replacement = targetRange.createFilter();
  var restored = 0;
  var restoreErrors = [];
  Object.keys(criteriaByColumn).forEach(function (columnKey) {
    var column = Number(columnKey);
    try {
      replacement.setColumnFilterCriteria(column, criteriaByColumn[columnKey]);
      restored++;
    } catch (error) {
      restoreErrors.push("Столбец " + column + ": " + (error && error.message ? error.message : String(error)));
    }
  });

  return {
    changed: true,
    criteria_preserved: restored,
    criteria_restore_errors: restoreErrors
  };
}

/** Create several short top-level menus instead of one oversized command list. */
function di3BuildMenus_() {
  var ui = SpreadsheetApp.getUi();
  var menus = [];

  function addMenu(name, build) {
    var menu = ui.createMenu(name);
    build(menu);
    menu.addToUi();
    menus.push(name);
  }

  addMenu("Продукты", function (menu) {
    menu.addItem("Открыть каталог", "di3OpenProductsSheet")
      .addItem("Обновить каталог", "di3RefreshProductsSheet")
      .addSeparator()
      .addItem("Новый товар", "di3NewProductForm")
      .addItem("Открыть карточку продукта", "di3OpenProductForm")
      .addItem("Загрузить выбранный товар…", "di3LoadSelectedProductToForm")
      .addItem("Сохранить товар", "di3SaveNewProductForm");
  });

  addMenu("Поставки", function (menu) {
    // Menus follow the user's workflow: create -> select -> edit -> advance/receive.
    function subMenu(name, build) {
      var child = ui.createMenu(name);
      build(child);
      return child;
    }

    menu.addSubMenu(subMenu("Создание", function (child) {
      child.addItem("Новая поставка", "di3NewSupplyForm")
        .addItem("Внести старую поставку", "di3StartHistoricalSupplyEntry")
        .addItem("Сохранить и оприходовать старую поставку", "di3CommitHistoricalSupplyEntry");
    }));

    menu.addSubMenu(subMenu("Выбор и просмотр", function (child) {
      child.addItem("Загрузить выбранную поставку…", "di3LoadSelectedSupplyDraft")
        .addItem("Открыть реестр поставок", "di3OpenSupplyRegister")
        .addItem("Обновить реестр", "di3RefreshSupplyRegister");
    }));

    menu.addSubMenu(subMenu("Редактирование", function (child) {
      child.addItem("Рассчитать поставку", "di3PreviewSupplyForm")
        .addItem("Сохранить поставку", "di3SaveSupplyDraft")
        .addItem("Обновить черновик", "di3UpdateSupplyDraft")
        .addSeparator()
        .addItem("Включить полное редактирование", "di3EnableFullSupplyEditMode")
        .addItem("Предварительно проверить изменения", "di3PreviewFullSupplyEdit")
        .addItem("Пересчитать номер по дате G2", "di3RecalculateSupplyNumberInFullEdit")
        .addItem("Сохранить изменения поставки", "di3SaveFullSupplyEdit")
        .addItem("Отменить корректировку", "di3CancelFullSupplyEditMode");
    }));

    menu.addSubMenu(subMenu("Проведение и отмена", function (child) {
      child.addItem("Применить следующий этап из формы", "di3ApplyNextSupplyStageFromForm")
        .addItem("Отменить выбранную поставку…", "di3CancelSelectedSupply")
        .addSeparator()
        .addItem("Обновить списки формы", "di3RefreshSupplyFormValidations");
    }));
  });

  addMenu("Склад", function (menu) {
    menu.addItem("Открыть Dashboard", "di3OpenWarehouseDashboard")
      .addItem("Обновить Dashboard", "di3RefreshWarehouseDashboard")
      .addSeparator()
      .addItem("Открыть «Управление складом»", "di3OpenWarehouseManagement")
      .addItem("Провести приход / расход", "di3SubmitWarehouseManagementForm")
      .addItem("Обновить списки товаров", "di3RefreshWarehouseManagementValidations")
      .addSeparator()
      .addItem("Открыть журнал движений", "di3OpenStockJournal")
      .addItem("Обновить журнал", "di3RefreshStockJournal")
      .addItem("Сбросить фильтры журнала", "di3ClearStockJournalFilters")
      .addSeparator()
      .addItem("Открыть историю FIFO", "di3OpenFifoHistorySheet")
      .addItem("Обновить историю FIFO", "di3RefreshFifoHistorySheet")
      .addItem("Обновить все складские представления", "di3RefreshWarehouseViews");
  });

  addMenu("Заказы", function (menu) {
    menu.addItem("Новый заказ", "di3NewOrderForm")
      .addItem("Рассчитать заказ", "di3PreviewOrderForm")
      .addItem("Создать заказ", "di3SaveOrderForm")
      .addSeparator()
      .addItem("Открыть форму исторической продажи", "di3OpenHistoricalSaleForm")
      .addItem("Рассчитать историческую продажу", "di3PreviewHistoricalSaleForm")
      .addItem("Провести историческую продажу", "di3SaveHistoricalSaleForm")
      .addItem("Обновить списки исторической формы", "di3RefreshHistoricalSaleFormValidations")
      .addSeparator()
      .addItem("Обновить списки формы", "di3RefreshOrderFormValidations")
      .addSeparator()
      .addItem("Открыть реестр заказов", "di3OpenOrderRegister")
      .addItem("Обновить реестр", "di3RefreshOrderRegister")
      .addSeparator()
      .addItem("Отправить выбранный заказ (Новый → В пути)…", "di3DispatchSelectedOrder")
      .addItem("Завершить выбранный заказ (В пути → Завершен)…", "di3CompleteSelectedOrder")
      .addItem("Отметить «Возвращается» (из «В пути»)…", "di3MarkSelectedOrderReturning")
      .addItem("Принять возврат (из «Возвращается»)…", "di3ReturnSelectedOrder")
      .addItem("Отменить заказ (только «Новый»)…", "di3CancelSelectedOrder");
  });

  addMenu("Финансы", function (menu) {
    menu.addItem("Открыть финансовый Dashboard", "di3OpenFinanceDashboard")
      .addItem("Обновить финансовый Dashboard", "di3RefreshFinanceDashboard")
      .addItem("Обновить список товаров", "di3RefreshFinanceDashboardProductOptions");
  });

  addMenu("Система", function (menu) {
    function subMenu(name, build) {
      var child = ui.createMenu(name);
      build(child);
      return child;
    }
    menu.addSubMenu(subMenu("Настройки", function (child) {
      child.addItem("Открыть настройки", "di3OpenSettingsWorkspace")
        .addItem("Обновить настройки", "di3RefreshSettingsWorkspace");
    }));
    menu.addSubMenu(subMenu("Установка и диагностика", function (child) {
      child.addItem("Предварительная проверка установки (Dry Run)", "di3RunInstallationDryRun")
        .addItem("Проверить установку и систему", "di3RunInstallationDiagnostics")
        .addItem("Показать размеры строк и столбцов", "di3LogSheetGridReport")
        .addItem("Проверить часовой пояс конфигурации", "di3ShowTimeZoneConfiguration")
        .addItem("Переустановить триггеры после копирования", "di3RepairInstallableTriggersAfterRestore");
    }));
    menu.addSubMenu(subMenu("Учётный период", function (child) {
      child.addItem("Состояние учётного периода", "di3ShowPeriodGuardStatus")
        .addItem("Закрыть учётный месяц…", "di3PromptCloseAccountingPeriod")
        .addItem("Открыть последний закрытый месяц…", "di3PromptReopenAccountingPeriod");
    }));
    menu.addSubMenu(subMenu("Операции и FIFO", function (child) {
      child.addItem("Отчёт по состоянию операций", "di3ShowOperationRecoveryReport")
        .addItem("Восстановить незавершённые операции…", "di3RecoverAllPendingOperations")
        .addItem("Снять карантин операции после ручной сверки…", "di3PromptRequeueQuarantinedOperation")
        .addItem("Разрешить FIFO quarantine после ручной сверки…", "di3PromptResolveQuarantinedFifoReplay")
        .addSeparator()
        .addItem("Пересчитать FIFO в копейках…", "di3RunMoneyMinorUnitsMigration")
        .addItem("Проверить целостность FIFO (без изменений)", "di3RunFifoIntegrityCheck")
        .addItem("Перестроить FIFO полностью…", "di3RunFullFifoRebuild");
    }));
    menu.addSubMenu(subMenu("Резервное копирование", function (child) {
      child.addItem("Создать резервную копию сейчас", "di3CreateSpreadsheetBackupFromMenu")
        .addItem("Показать резервные копии", "di3ShowSpreadsheetBackups")
        .addItem("Открыть папку резервных копий", "di3OpenSpreadsheetBackupFolder")
        .addItem("Восстановить в новую таблицу…", "di3PromptRestoreSpreadsheetBackup");
    }));
    menu.addSubMenu(subMenu("GitHub и обновления", function (child) {
      child.addItem("Выбрать ветку GitHub для Preview…", "di3SelectGitHubSourceBranch")
        .addItem("Сбросить выбор ветки (Stable / Preview)", "di3ClearGitHubSourceBranchSelection")
        .addSeparator()
        .addItem("Проверить релиз / выбранную ветку и сравнить код", "di3CheckGitHubRelease")
        .addItem("Предварительно собрать обновление (без установки)", "di3PrepareGitHubInstallPreviewFromMenu")
        .addItem("Установить релиз… (с подтверждением)", "di3InstallLatestGitHubReleaseFromMenu")
        .addItem("Откатить код из резервной копии…", "di3RollbackAppsScriptCodeFromMenu")
        .addItem("Создать резервную копию кода Apps Script", "di3CreateAppsScriptSourceBackupFromMenu");
    }));
  });

  return { status: "READY", menus: menus };
}


function di3OpenSupplyRegister() {
  var sheet = di3GetSpreadsheet_().getSheetByName(DI3_SUPPLY_REGISTER_SHEET);
  if (!sheet) throw new Error('Лист «Реестр поставок v3» не найден. Запусти setupDotsInventoryV3().');
  di3GetSpreadsheet_().setActiveSheet(sheet);
  return { opened: true, sheet: DI3_SUPPLY_REGISTER_SHEET };
}

function di3OpenOrderRegister() {
  var sheet = di3GetSpreadsheet_().getSheetByName(DI3_ORDER_REGISTER_SHEET);
  if (!sheet) throw new Error('Лист «Реестр заказов v3» не найден. Запусти setupDotsInventoryV3().');
  di3GetSpreadsheet_().setActiveSheet(sheet);
  return { opened: true, sheet: DI3_ORDER_REGISTER_SHEET };
}


function di3OpenHistoricalSaleForm() {
  var sheet = di3GetSpreadsheet_().getSheetByName("Историческая продажа");
  if (!sheet) throw new Error("Лист «Историческая продажа» не найден. Запусти setupDotsInventoryV3().");
  di3GetSpreadsheet_().setActiveSheet(sheet);
  return { opened: true, sheet: "Историческая продажа" };
}
