/**
 * Dots Inventory v3 — historical supply entry.
 * Creates a supply with historical logistics dates and posts exactly one
 * standard SUPPLY_RECEIVE operation through the existing immutable operation
 * payload, stock ledger, FIFO preflight and recovery pipeline.
 */
var DI3_HISTORICAL_SUPPLY_MODE_VALUE = "HISTORICAL_CREATE";

function di3StartHistoricalSupplyEntry() {
  var ui = SpreadsheetApp.getUi();
  var sheet = di3GetSheetOrThrow_(DI3_SUPPLY_FORM_SHEET);
  if (String(sheet.getRange(DI3_SUPPLY_FORM.fullEditMode).getValue() || "") === "FULL_EDIT") {
    throw new Error("Сначала сохрани или отмени полное редактирование поставки. Внесение старой поставки не должно очищать активную корректировку.");
  }
  var currentOrderDate = sheet.getRange("G2").getValue();
  var hasCustomOrderDate = currentOrderDate instanceof Date && !isNaN(currentOrderDate.getTime()) &&
    (currentOrderDate.getFullYear() !== new Date().getFullYear() ||
      currentOrderDate.getMonth() !== new Date().getMonth() || currentOrderDate.getDate() !== new Date().getDate());
  var hasPendingFormData = di3HasUnsavedSupplyFormChanges_(sheet) || hasCustomOrderDate;
  if (hasPendingFormData) {
    var answer = ui.alert(
      "Начать внесение старой поставки?",
      "Текущие данные формы будут очищены. Уже сохранённые документы и складские движения не удаляются. Продолжить?",
      ui.ButtonSet.YES_NO
    );
    if (answer !== ui.Button.YES) return { status: "CANCELLED_BY_USER" };
  }

  di3NewSupplyForm({ skipUnsavedConfirmation: true });
  sheet.getRange(DI3_SUPPLY_FORM.historicalMode).setValue(DI3_HISTORICAL_SUPPLY_MODE_VALUE);
  // Unlike a current order, none of the historical dates should be silently prefilled.
  sheet.getRange("G2:G7").clearContent();
  sheet.getRange("M2").setValue("Внесение старой поставки");
  sheet.getRange("D8").setValue("Режим «Внести старую поставку»: заполни G2, при необходимости G3, а также все фактические даты G5:G7. После проверки и подтверждения будет создан документ и одна складская операция приёмки.");
  di3RefreshSupplyDatePanel_(null);
  di3RefreshSupplyFormValidations();
  // The refresh function respects the mode marker and therefore leaves all G5:G7 editable.
  sheet.getRange("M2").setValue("Внесение старой поставки");
  di3SetSupplyFormStateBaseline_(sheet);
  return { status: "READY", mode: DI3_HISTORICAL_SUPPLY_MODE_VALUE, sheet: DI3_SUPPLY_FORM_SHEET };
}

function di3ValidateHistoricalSupplyDates_(input) {
  input = input || {};
  var orderDate = di3ParseSupplyCalendarDate_(input.order_date, "Дата заказа в магазине");
  if (!orderDate) throw new Error("Для старой поставки обязательно укажи дату заказа в G2.");
  var expectedDate = di3ParseSupplyCalendarDate_(input.expected_date, "Ожидаемая дата прибытия");
  di3ValidateSupplyPlanningDates_(orderDate, expectedDate);

  var sentAt = di3ParseSupplyEffectiveDate_(input.sent_at, null);
  var awaitingAt = di3ParseSupplyEffectiveDate_(input.awaiting_at, null);
  var receivedAt = di3ParseSupplyEffectiveDate_(input.received_at, null);
  var orderStart = new Date(orderDate.getFullYear(), orderDate.getMonth(), orderDate.getDate(), 0, 0, 0, 0);
  var nowLimit = Date.now() + 5 * 60 * 1000;

  if (sentAt.getTime() < orderStart.getTime()) {
    throw new Error("Дата отправки G5 не может быть раньше даты заказа G2.");
  }
  if (awaitingAt.getTime() < sentAt.getTime()) {
    throw new Error("Дата ожидания получения G6 не может быть раньше даты отправки G5.");
  }
  if (receivedAt.getTime() < awaitingAt.getTime()) {
    throw new Error("Дата получения G7 не может быть раньше даты ожидания получения G6.");
  }
  [sentAt, awaitingAt, receivedAt].forEach(function (date, index) {
    if (date.getTime() > nowLimit) {
      throw new Error("Фактическая дата " + ["отправки G5", "ожидания получения G6", "получения G7"][index] + " не может быть в будущем.");
    }
  });
  return {
    order_date: orderDate,
    expected_date: expectedDate,
    sent_at: sentAt,
    awaiting_at: awaitingAt,
    received_at: receivedAt
  };
}

function di3GetHistoricalSupplyFormSnapshot_() {
  var sheet = di3GetSheetOrThrow_(DI3_SUPPLY_FORM_SHEET);
  var dates = di3ValidateHistoricalSupplyDates_({
    order_date: sheet.getRange("G2").getValue(),
    expected_date: sheet.getRange("G3").getValue(),
    sent_at: sheet.getRange("G5").getValue(),
    awaiting_at: sheet.getRange("G6").getValue(),
    received_at: sheet.getRange("G7").getValue()
  });
  var lines = di3ResolveSupplyFormLines_(false);
  if (!lines.length) throw new Error("Добавь хотя бы одну товарную позицию старой поставки.");
  var formValues = sheet.getRange("B5:B7").getValues().map(function (row) { return row[0]; });
  var plan = di3BuildSupplyFinancialPlan_({
    lines: lines,
    seller_discount_amount: formValues[0] === "" ? 0 : formValues[0],
    partner_discount_amount: formValues[1] === "" ? 0 : formValues[1],
    shipping_amount: formValues[2] === "" ? 0 : formValues[2]
  });
  dates.plan = plan;
  return dates;
}

function di3SetSupplyHistoricalPreReceiptState_(supply, sentAt, awaitingAt) {
  var currentStatus = di3NormalizeSupplyStatus_(supply.status);
  if (currentStatus === DI3_SUPPLY_STATUS.AWAITING) {
    if (!supply.sent_at || !supply.awaiting_at ||
        di3ToMillis_(supply.sent_at) !== sentAt.getTime() ||
        di3ToMillis_(supply.awaiting_at) !== awaitingAt.getTime()) {
      throw new Error("Черновик уже перешёл в состояние ожидания с другими датами. Автоматическая перезапись остановлена; проверь поставку по supply_id.");
    }
    return { status: "ALREADY_PREPARED", supply_id: supply.supply_id };
  }
  if (currentStatus !== DI3_SUPPLY_STATUS.CREATED) {
    throw new Error("Историческую приёмку можно продолжить только из нового черновика или состояния «Ожидает получения». Текущий статус: " + di3GetSupplyStatusLabel_(supply.status));
  }
  di3ValidateSupplyStatusTransition_(currentStatus, DI3_SUPPLY_STATUS.SENT);
  di3ValidateSupplyStatusTransition_(DI3_SUPPLY_STATUS.SENT, DI3_SUPPLY_STATUS.AWAITING);
  var headers = DI3_TABLE_SCHEMAS.V3_Supplies;
  var statusColumn = headers.indexOf("status") + 1;
  var updatedColumn = headers.indexOf("updated_at") + 1;
  var sentColumn = headers.indexOf("sent_at") + 1;
  var awaitingColumn = headers.indexOf("awaiting_at") + 1;
  var first = statusColumn;
  var width = updatedColumn - first + 1;
  var range = di3GetSheetOrThrow_("V3_Supplies").getRange(supply.row_number, first, 1, width);
  var row = range.getValues()[0];
  row[0] = DI3_SUPPLY_STATUS.AWAITING;
  row[sentColumn - first] = new Date(sentAt.getTime());
  row[awaitingColumn - first] = new Date(awaitingAt.getTime());
  row[updatedColumn - first] = new Date();
  range.setValues([row]);
  var updatedSupply = di3GetSupplyById_(supply.supply_id);
  if (!updatedSupply) throw new Error("Поставка исчезла после сохранения исторических дат этапов.");
  di3RefreshSupplyRegister();
  var formSheet = di3GetSpreadsheet_().getSheetByName(DI3_SUPPLY_FORM_SHEET);
  if (formSheet && String(formSheet.getRange(DI3_SUPPLY_FORM.editSupplyId).getValue() || "") === String(supply.supply_id)) {
    di3RefreshSupplyDatePanel_(updatedSupply);
    di3SetSupplyFormStateBaseline_(formSheet);
  }
  return { status: "PREPARED", supply_id: supply.supply_id };
}

function di3CommitHistoricalSupplyEntry() {
  return di3WithLock_(function () {
    di3EnsureStockCoreSchemas_();
    var sheet = di3GetSheetOrThrow_(DI3_SUPPLY_FORM_SHEET);
    var mode = String(sheet.getRange(DI3_SUPPLY_FORM.historicalMode).getValue() || "");
    if (mode !== DI3_HISTORICAL_SUPPLY_MODE_VALUE) {
      throw new Error("Сначала выбери «Поставки» → «Внести старую поставку». Эта команда не предназначена для обычных новых или загруженных поставок.");
    }

    var supplyId = String(sheet.getRange(DI3_SUPPLY_FORM.editSupplyId).getValue() || "").trim();
    var supply = supplyId ? di3GetSupplyById_(supplyId) : null;
    var receiptOperation = supply ? di3GetSupplyReceiptOperation_(supply.supply_id) : null;

    // If a receipt operation was already prepared, its verified immutable payload owns G7.
    // Resume it without generating new movement/lot IDs or asking the user to re-enter a date.
    if (supply && receiptOperation && ["PREPARED", "RETRYABLE"].indexOf(String(receiptOperation.values[5])) !== -1) {
      var savedPayload = di3ReadVerifiedOperationPayload_(receiptOperation);
      var resumeDate = new Date(savedPayload.received_at);
      var resumeConfirmation = SpreadsheetApp.getUi().alert(
        "Продолжить незавершённую приёмку",
        "Для поставки " + supply.supply_number + " уже существует подготовленная операция приёмки с неизменяемой датой " +
          Utilities.formatDate(resumeDate, di3GetConfiguredTimeZone_(), "dd.MM.yyyy HH:mm") + ". Будут продолжены именно эта операция и её исходные складские движения. Продолжить?",
        SpreadsheetApp.getUi().ButtonSet.YES_NO
      );
      if (resumeConfirmation !== SpreadsheetApp.getUi().Button.YES) return { status: "CANCELLED_BY_USER", supply_number: supply.supply_number };
      var resumed = di3ReceiveSupply_(supply, resumeDate);
      if (["COMMITTED", "ALREADY_RECEIVED"].indexOf(String(resumed.status)) !== -1) {
        sheet.getRange(DI3_SUPPLY_FORM.historicalMode).clearContent();
        var finalSupply = di3GetSupplyById_(supply.supply_id);
        di3RefreshSupplyDatePanel_(finalSupply);
        sheet.getRange("M2").setValue("Просмотр / этапы: " + finalSupply.supply_number + " — " + di3GetSupplyStatusLabel_(finalSupply.status));
        if (typeof di3RefreshWarehouseViewsAfterCommit_ === "function") di3RefreshWarehouseViewsAfterCommit_("Внесение старой поставки " + supply.supply_number);
      }
      return resumed;
    }

    var status = supply ? di3NormalizeSupplyStatus_(supply.status) : "";
    if (receiptOperation && ["QUARANTINED", "REJECTED"].indexOf(String(receiptOperation.values[5])) !== -1) {
      throw new Error("Операция SUPPLY_RECEIVE находится в терминальном состоянии " + String(receiptOperation.values[5]) + ". Повторное оприходование запрещено; сначала требуется отдельная проверка журнала Operations.");
    }
    if (receiptOperation && String(receiptOperation.values[5]) === "COMMITTED" && status !== DI3_SUPPLY_STATUS.RECEIVED) {
      throw new Error("Операция SUPPLY_RECEIVE уже COMMITTED, но статус документа не «Получена». Автоматическое повторное оприходование запрещено; требуется сверка документа и журнала Operations.");
    }
    if (supply && status === DI3_SUPPLY_STATUS.RECEIVED) {
      if (!receiptOperation || String(receiptOperation.values[5]) !== "COMMITTED") {
        throw new Error("Поставка отмечена как полученная, но подтверждённая операция SUPPLY_RECEIVE не найдена. Автоматическое повторное оприходование запрещено.");
      }
      sheet.getRange(DI3_SUPPLY_FORM.historicalMode).clearContent();
      var alreadyFinalSupply = di3GetSupplyById_(supply.supply_id);
      di3RefreshSupplyDatePanel_(alreadyFinalSupply);
      sheet.getRange("M2").setValue("Просмотр / этапы: " + alreadyFinalSupply.supply_number + " — Получена");
      di3RefreshSupplyFormValidations();
      return { status: "ALREADY_RECEIVED", supply_number: alreadyFinalSupply.supply_number, operation_id: receiptOperation.values[0] };
    }

    var snapshot = di3GetHistoricalSupplyFormSnapshot_();
    // Period locks are checked before any document write. The receipt executor repeats
    // its own guard and FIFO preflight before posting stock movements.
    di3AssertPeriodOpen_(snapshot.sent_at, "Историческая дата отправки");
    di3AssertPeriodOpen_(snapshot.awaiting_at, "Историческая дата ожидания получения");
    di3AssertPeriodOpen_(snapshot.received_at, "Историческая приёмка");

    var totalUnits = snapshot.plan.lines.reduce(function (sum, line) { return sum + Number(line.received_units || 0); }, 0);
    var datesText = [
      "Заказ: " + Utilities.formatDate(snapshot.order_date, di3GetConfiguredTimeZone_(), "dd.MM.yyyy"),
      "Отправка: " + Utilities.formatDate(snapshot.sent_at, di3GetConfiguredTimeZone_(), "dd.MM.yyyy HH:mm"),
      "Ожидание получения: " + Utilities.formatDate(snapshot.awaiting_at, di3GetConfiguredTimeZone_(), "dd.MM.yyyy HH:mm"),
      "Получение: " + Utilities.formatDate(snapshot.received_at, di3GetConfiguredTimeZone_(), "dd.MM.yyyy HH:mm")
    ].join("\n");
    var confirmation = SpreadsheetApp.getUi().alert(
      "Подтверждение внесения старой поставки",
      "Будет создана новая поставка и выполнена одна фактическая складская приёмка.\n\n" + datesText +
        "\n\nТоварных строк: " + snapshot.plan.lines.length +
        "\nКоличество единиц: " + totalUnits +
        "\nТовары: " + snapshot.plan.goods_amount.toFixed(2) + " ₽" +
        "\nСкидки: " + snapshot.plan.discount_total.toFixed(2) + " ₽" +
        "\nДоставка: " + snapshot.plan.shipping_amount.toFixed(2) + " ₽" +
        "\nИтого к учёту: " + snapshot.plan.final_amount.toFixed(2) + " ₽" +
        "\n\nБудут созданы SUPPLY_RECEIVE, StockLedger, FIFO-партии и записи истории себестоимости. Дублирующее оприходование будет заблокировано ключом идемпотентности. Продолжить?",
      SpreadsheetApp.getUi().ButtonSet.YES_NO
    );
    if (confirmation !== SpreadsheetApp.getUi().Button.YES) return { status: "CANCELLED_BY_USER" };

    // First persist the normal supply document and lines. The form-mode flag remains set,
    // preserving all three historical dates if execution is interrupted during this step.
    if (!supply) {
      var saved = di3SaveSupplyDraft({ skipInitialStatusHistory: true });
      supplyId = String(saved.supply_id || sheet.getRange(DI3_SUPPLY_FORM.editSupplyId).getValue() || "");
      supply = supplyId ? di3GetSupplyById_(supplyId) : null;
      if (!supply) throw new Error("Черновик старой поставки не найден после сохранения. Повтори команду; служебный контекст защитит от дублирования.");
      sheet.getRange("M2").setValue("Внесение старой поставки: " + supply.supply_number + " — " + di3GetSupplyStatusLabel_(supply.status));
    } else if (status === DI3_SUPPLY_STATUS.CREATED) {
      di3SaveSupplyDraft({ skipInitialStatusHistory: true });
      supply = di3GetSupplyById_(supplyId);
      sheet.getRange("M2").setValue("Внесение старой поставки: " + supply.supply_number + " — " + di3GetSupplyStatusLabel_(supply.status));
    }

    // Only a CREATED document is moved into the pre-receipt state here. On retry from
    // AWAITING, the saved dates are verified and no status/date is rewritten.
    var currentStatus = di3NormalizeSupplyStatus_(supply.status);
    if (currentStatus === DI3_SUPPLY_STATUS.CREATED) {
      di3SetSupplyHistoricalPreReceiptState_(supply, snapshot.sent_at, snapshot.awaiting_at);
      supply = di3GetSupplyById_(supplyId);
      sheet.getRange("M2").setValue("Внесение старой поставки: " + supply.supply_number + " — " + di3GetSupplyStatusLabel_(supply.status));
    } else if (currentStatus === DI3_SUPPLY_STATUS.AWAITING) {
      if (di3ToMillis_(supply.sent_at) !== snapshot.sent_at.getTime() || di3ToMillis_(supply.awaiting_at) !== snapshot.awaiting_at.getTime()) {
        throw new Error("Сохранённые даты G5/G6 не совпадают с введёнными. Ничего не изменено; загрузи актуальную поставку и сверь даты.");
      }
    } else {
      throw new Error("Нельзя продолжить внесение старой поставки из статуса «" + di3GetSupplyStatusLabel_(supply.status) + "».");
    }

    // Record all historical business stages, preserving the real system created_at separately.
    var orderEffectiveAt = new Date(snapshot.order_date.getTime());
    orderEffectiveAt.setHours(0, 0, 0, 0);
    di3EnsureSupplyStatusHistory_(supplyId, "", DI3_SUPPLY_STATUS.CREATED, orderEffectiveAt, "", "Внесение старой поставки: дата заказа в магазине");
    di3EnsureSupplyStatusHistory_(supplyId, DI3_SUPPLY_STATUS.CREATED, DI3_SUPPLY_STATUS.SENT, snapshot.sent_at, "", "Историческая дата отправки");
    di3EnsureSupplyStatusHistory_(supplyId, DI3_SUPPLY_STATUS.SENT, DI3_SUPPLY_STATUS.AWAITING, snapshot.awaiting_at, "", "Историческая дата ожидания получения");

    var receiptResult = di3ReceiveSupply_(supply, snapshot.received_at);
    if (["COMMITTED", "ALREADY_RECEIVED"].indexOf(String(receiptResult.status)) === -1) {
      throw new Error("Историческая поставка сохранена, но складская приёмка не завершена. Статус документа: " + di3GetSupplyStatusLabel_(di3GetSupplyById_(supplyId).status) + ". Не создавай новую поставку; повтори команду после проверки журнала Operations.");
    }

    sheet.getRange(DI3_SUPPLY_FORM.historicalMode).clearContent();
    var finalSupply = di3GetSupplyById_(supplyId);
    di3RefreshSupplyDatePanel_(finalSupply);
    sheet.getRange("M2").setValue("Просмотр / этапы: " + finalSupply.supply_number + " — " + di3GetSupplyStatusLabel_(finalSupply.status));
    di3RefreshSupplyFormValidations();
    if (typeof di3RefreshWarehouseViewsAfterCommit_ === "function") {
      di3RefreshWarehouseViewsAfterCommit_("Внесение старой поставки " + finalSupply.supply_number);
    }
    di3GetSpreadsheet_().toast("Старая поставка внесена и оприходована", "Поставка " + finalSupply.supply_number, 6);
    return {
      status: receiptResult.status,
      supply_id: supplyId,
      supply_number: finalSupply.supply_number,
      units_received: totalUnits,
      final_amount: snapshot.plan.final_amount,
      receipt: receiptResult
    };
  });
}

function di3DiagnoseHistoricalSupplyMode() {
  var sheet = di3GetSheetOrThrow_(DI3_SUPPLY_FORM_SHEET);
  var supplyId = String(sheet.getRange(DI3_SUPPLY_FORM.editSupplyId).getValue() || "").trim();
  var supply = supplyId ? di3GetSupplyById_(supplyId) : null;
  var receipt = supply ? di3GetSupplyReceiptOperation_(supplyId) : null;
  return {
    mode: String(sheet.getRange(DI3_SUPPLY_FORM.historicalMode).getValue() || "STANDARD"),
    supply_id: supplyId,
    supply_number: supply ? String(supply.supply_number) : String(sheet.getRange(DI3_SUPPLY_FORM.number).getValue() || ""),
    status: supply ? di3NormalizeSupplyStatus_(supply.status) : "UNSAVED",
    has_receipt_operation: !!receipt,
    receipt_operation_status: receipt ? String(receipt.values[5] || "") : "",
    dates: {
      G2: sheet.getRange("G2").getValue(), G3: sheet.getRange("G3").getValue(),
      G5: sheet.getRange("G5").getValue(), G6: sheet.getRange("G6").getValue(), G7: sheet.getRange("G7").getValue()
    },
    read_only: true
  };
}
