/** Dots Inventory v3 — supply domain, cost allocation and draft repository. */
// Stored values remain stable for compatibility with existing V3_Supplies and status-history rows.
// User-facing labels are normalized separately and may evolve without a data migration.
var DI3_SUPPLY_STATUS = Object.freeze({ CREATED: "Создан", SENT: "Отправлен", AWAITING: "Ожидает получения", RECEIVED: "Доставлен", CANCELLED: "Отменен" });

function di3GetSupplyStatusLabel_(status) {
  var labels = {
    "Создан": "Оформлена",
    "Создана": "Оформлена",
    "Оформлена": "Оформлена",
    "Отправлен": "Отправлена",
    "Отправлена": "Отправлена",
    "Ожидает получения": "Ожидает получения",
    "Доставлен": "Получена",
    "Доставлена": "Получена",
    "Получена": "Получена",
    "Отменен": "Отменена",
    "Отменена": "Отменена"
  };
  var key = String(status || "").trim();
  return labels[key] || key;
}

/** Normalize legacy/internal and user-facing labels to stable stored status values. */
function di3NormalizeSupplyStatus_(status) {
  var key = String(status || "").trim();
  var label = di3GetSupplyStatusLabel_(key);
  if (label === "Оформлена") return DI3_SUPPLY_STATUS.CREATED;
  if (label === "Отправлена") return DI3_SUPPLY_STATUS.SENT;
  if (label === "Ожидает получения") return DI3_SUPPLY_STATUS.AWAITING;
  if (label === "Получена") return DI3_SUPPLY_STATUS.RECEIVED;
  if (label === "Отменена") return DI3_SUPPLY_STATUS.CANCELLED;
  return key;
}
var DI3_SUPPLY_FORM_SHEET = "Поставка v3";
var DI3_SUPPLY_FORM = Object.freeze({
  selector: "B2", number: "B3", supplier: "B4", sellerDiscount: "B5",
  partnerDiscount: "B6", shipping: "B7", notes: "B8",
  orderCreatedInStoreDate: "G2", expectedReceivedDate: "G3",
  editSupplyId: "N2", historicalMode: "N3",
  fullEditMode: "N4", fullEditBaselineHash: "N5", fullEditRevisionId: "N6", fullEditRecalculateNumber: "N7",
  formStateBaseline: "N8", pendingSelector: "N9", previousSelector: "N10",
  firstLine: 12, lineCount: 20
});
var DI3_SUPPLY_LINE_COLUMNS = 10;
var DI3_SUPPLY_LINE_HEADERS = [
  "Товар", "Шт. в упаковке", "Упаковок", "Цена закупки за упаковку, ₽",
  "Стоимость товаров, ₽", "Скидка продавца, ₽", "Скидка партнёров, ₽",
  "Доставка, ₽", "Итог за упаковку, ₽", "Получено единиц"
];

function di3RoundMoney_(value) {
  return di3MoneyRound_(value);
}

function di3ToCents_(value, fieldName) {
  return di3MoneyToMinorUnits_(value, fieldName || "Сумма", false);
}

/** Allocate an amount in integer kopeks using largest-remainder distribution. */
function di3AllocateSupplyAmount_(amount, weights) {
  var amountCents = di3ToCents_(amount, "Распределяемая сумма");
  if (!Array.isArray(weights) || !weights.length) {
    if (amountCents === 0) return [];
    throw new Error("Нельзя распределить сумму без товарных строк.");
  }
  var cleanWeights = weights.map(function (weight) {
    var n = Number(weight);
    if (!Number.isFinite(n) || n < 0) throw new Error("Вес распределения должен быть неотрицательным.");
    return n;
  });
  var totalWeight = cleanWeights.reduce(function (sum, value) { return sum + value; }, 0);
  if (totalWeight <= 0) {
    if (amountCents === 0) return cleanWeights.map(function () { return 0; });
    throw new Error("Невозможно распределить расходы: сумма весов равна нулю.");
  }
  var shares = cleanWeights.map(function (weight, index) {
    var exact = amountCents * weight / totalWeight;
    var floor = Math.floor(exact);
    return { index: index, cents: floor, remainder: exact - floor };
  });
  var assigned = shares.reduce(function (sum, share) { return sum + share.cents; }, 0);
  var remainderCents = amountCents - assigned;
  shares.slice().sort(function (a, b) {
    if (b.remainder !== a.remainder) return b.remainder - a.remainder;
    return a.index - b.index;
  }).slice(0, remainderCents).forEach(function (share) {
    shares[share.index].cents += 1;
  });
  shares.sort(function (a, b) { return a.index - b.index; });
  return shares.map(function (share) { return share.cents / 100; });
}

/** Allocate an amount without allowing any line to receive more discount than its base. */
function di3AllocateSupplyAmountWithCaps_(amount, weights, capacityAmounts) {
  var targetCents = di3ToCents_(amount, "Распределяемая сумма");
  if (!Array.isArray(weights) || !Array.isArray(capacityAmounts) || weights.length !== capacityAmounts.length) {
    throw new Error("Для распределения со связанными лимитами нужны одинаковые массивы весов и лимитов.");
  }
  var capacities = capacityAmounts.map(function (value) { return di3ToCents_(value, "Лимит распределения"); });
  var totalCapacity = capacities.reduce(function (sum, value) { return sum + value; }, 0);
  if (targetCents > totalCapacity) throw new Error("Распределяемая скидка превышает стоимость товаров.");
  var allocated = capacities.map(function () { return 0; });
  var remaining = targetCents;
  while (remaining > 0) {
    var active = [];
    var totalWeight = 0;
    capacities.forEach(function (capacity, index) {
      if (capacity - allocated[index] <= 0) return;
      var weight = Math.max(0, Number(weights[index]) || 0);
      active.push({ index: index, weight: weight, capacity: capacity - allocated[index] });
      totalWeight += weight;
    });
    if (!active.length) throw new Error("Не удалось распределить скидку в пределах стоимости строк.");
    if (totalWeight <= 0) {
      active.forEach(function (item) { item.weight = item.capacity; });
      totalWeight = active.reduce(function (sum, item) { return sum + item.weight; }, 0);
    }
    var candidates = active.map(function (item) {
      var exact = remaining * item.weight / totalWeight;
      var floor = Math.min(item.capacity, Math.floor(exact));
      return { index: item.index, capacity: item.capacity, assigned: floor, remainder: exact - Math.floor(exact) };
    });
    var assignedThisRound = 0;
    candidates.forEach(function (candidate) {
      allocated[candidate.index] += candidate.assigned;
      assignedThisRound += candidate.assigned;
    });
    remaining -= assignedThisRound;
    if (remaining <= 0) break;
    var order = candidates.filter(function (candidate) { return candidate.capacity - candidate.assigned > 0; })
      .sort(function (a, b) {
        if (b.remainder !== a.remainder) return b.remainder - a.remainder;
        return a.index - b.index;
      });
    var centsAdded = 0;
    for (var i = 0; i < order.length && remaining > 0; i++) {
      if (capacities[order[i].index] - allocated[order[i].index] <= 0) continue;
      allocated[order[i].index] += 1;
      remaining -= 1;
      centsAdded += 1;
    }
    if (assignedThisRound === 0 && centsAdded === 0) throw new Error("Не удалось распределить остаток округления скидки.");
  }
  return allocated.map(function (cents) { return cents / 100; });
}

/** Pure financial calculation for one draft. Input lines are already normalized. */
function di3BuildSupplyFinancialPlan_(input) {
  input = input || {};
  var lines = Array.isArray(input.lines) ? input.lines : [];
  if (!lines.length) throw new Error("Нельзя сохранить поставку без товарных позиций.");
  var seen = {};
  var normalized = lines.map(function (line, index) {
    var productId = String(line.product_id || "");
    var packVariantId = String(line.pack_variant_id || "");
    var units = Number(line.units_per_pack);
    var packs = Number(line.packs);
    var price = Number(line.purchase_price_per_pack);
    if (line.purchase_price_per_pack === "" || line.purchase_price_per_pack === null || line.purchase_price_per_pack === undefined) {
      throw new Error("Позиция " + (index + 1) + ": укажи закупочную цену за упаковку (0 допустимо только для бесплатного товара).");
    }
    if (!productId || !packVariantId) throw new Error("Позиция " + (index + 1) + ": не выбран товар или фасовка.");
    if (!Number.isInteger(units) || units <= 0) throw new Error("Позиция " + (index + 1) + ": фасовка должна быть положительным целым числом.");
    if (!Number.isInteger(packs) || packs <= 0) throw new Error("Позиция " + (index + 1) + ": количество упаковок должно быть положительным целым числом.");
    if (!Number.isFinite(price) || price < 0) throw new Error("Позиция " + (index + 1) + ": цена упаковки должна быть неотрицательной.");
    var key = productId + "\u001f" + packVariantId;
    if (seen[key] !== undefined) throw new Error("Позиции " + (seen[key] + 1) + " и " + (index + 1) + " повторяют товар и фасовку.");
    seen[key] = index;
    var base = di3RoundMoney_(packs * di3RoundMoney_(price));
    return {
      product_id: productId, pack_variant_id: packVariantId, units_per_pack: units,
      packs: packs, purchase_price_per_pack: di3RoundMoney_(price),
      base_line_amount: base, received_units: packs * units
    };
  });
  var goodsCents = normalized.reduce(function (sum, line) { return sum + di3ToCents_(line.base_line_amount); }, 0);
  var sellerCents = di3ToCents_(input.seller_discount_amount || 0, "Скидка продавца");
  var partnerCents = di3ToCents_(input.partner_discount_amount || 0, "Скидка партнёров");
  var shippingCents = di3ToCents_(input.shipping_amount || 0, "Доставка");
  if (sellerCents + partnerCents > goodsCents) {
    throw new Error("Сумма скидок не может превышать исходную стоимость товаров.");
  }
  var weights = normalized.map(function (line) { return di3ToCents_(line.base_line_amount); });
  if (weights.reduce(function (sum, n) { return sum + n; }, 0) === 0) {
    weights = normalized.map(function (line) { return line.received_units; });
  }
  var capacities = normalized.map(function (line) { return line.base_line_amount; });
  var sellerAlloc = di3AllocateSupplyAmountWithCaps_(sellerCents / 100, weights, capacities);
  var remainingCapacity = capacities.map(function (value, index) {
    return di3RoundMoney_(value - sellerAlloc[index]);
  });
  var partnerAlloc = di3AllocateSupplyAmountWithCaps_(partnerCents / 100, weights, remainingCapacity);
  var shippingAlloc = di3AllocateSupplyAmount_(shippingCents / 100, weights);
  normalized = normalized.map(function (line, index) {
    var finalLineCents = di3ToCents_(line.base_line_amount) - di3ToCents_(sellerAlloc[index]) -
      di3ToCents_(partnerAlloc[index]) + di3ToCents_(shippingAlloc[index]);
    if (finalLineCents < 0) throw new Error("После распределения расходов стоимость позиции не может быть отрицательной.");
    var finalLineAmount = finalLineCents / 100;
    return Object.assign({}, line, {
      allocated_seller_discount: sellerAlloc[index],
      allocated_partner_discount: partnerAlloc[index],
      allocated_shipping: shippingAlloc[index],
      final_line_amount: finalLineAmount,
      final_pack_cost: line.packs ? finalLineAmount / line.packs : 0,
      unit_cost: line.received_units ? finalLineAmount / line.received_units : 0
    });
  });
  var goodsAmount = goodsCents / 100;
  var discounts = (sellerCents + partnerCents) / 100;
  var shipping = shippingCents / 100;
  return {
    lines: normalized,
    goods_amount: goodsAmount,
    seller_discount_amount: sellerCents / 100,
    partner_discount_amount: partnerCents / 100,
    discount_total: discounts,
    shipping_amount: shipping,
    final_amount: goodsAmount - discounts + shipping,
    currency: typeof di3GetBaseCurrency_ === "function" ? di3GetBaseCurrency_() : "RUB"
  };
}

function di3GetProductFormOptionIndex_() {
  di3EnsureProductPublicCodes_();
  var products = di3ListActiveProductsForWarehouse_();
  var codes = di3GetProductPublicCodeMap_();
  var byLabel = {};
  products.forEach(function (product) {
    byLabel[di3GetProductOptionLabelWithMap_(product, codes)] = product;
  });
  return { products: products, byLabel: byLabel, options: Object.keys(byLabel).sort() };
}

/** Parse a date-only input into a stable local calendar date (stored at noon). */
function di3ParseSupplyCalendarDate_(value, fieldName) {
  if (value === "" || value === null || value === undefined) return null;
  var date = null;
  if (value instanceof Date) {
    if (isNaN(value.getTime())) throw new Error((fieldName || "Дата") + ": некорректная дата.");
    date = new Date(value.getFullYear(), value.getMonth(), value.getDate(), 12, 0, 0, 0);
  } else if (typeof value === "string") {
    var text = value.trim();
    var dmy = text.match(/^(\d{1,2})[.\/](\d{1,2})[.\/](\d{4})$/);
    var iso = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    var year, month, day;
    if (dmy) { day = Number(dmy[1]); month = Number(dmy[2]); year = Number(dmy[3]); }
    else if (iso) { year = Number(iso[1]); month = Number(iso[2]); day = Number(iso[3]); }
    else throw new Error((fieldName || "Дата") + ": используй формат ДД.ММ.ГГГГ.");
    date = new Date(year, month - 1, day, 12, 0, 0, 0);
    if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
      throw new Error((fieldName || "Дата") + ": такой календарной даты не существует.");
    }
  } else {
    throw new Error((fieldName || "Дата") + ": ожидается дата, а не число или произвольный текст.");
  }
  return date;
}

/**
 * Sort supplies by the date the order was created in the store, not by the
 * automatic system-record timestamp. Undated legacy records stay at the end;
 * system created_at is only a tie-breaker for equal/missing order dates.
 */
function di3CompareSupplyOrderChronology_(aOrderDate, aSystemCreatedAt, aNumber, bOrderDate, bSystemCreatedAt, bNumber) {
  var aOrderMs = aOrderDate ? di3ToMillis_(aOrderDate) : 0;
  var bOrderMs = bOrderDate ? di3ToMillis_(bOrderDate) : 0;
  if (aOrderMs !== bOrderMs) {
    if (!aOrderMs) return 1;
    if (!bOrderMs) return -1;
    return bOrderMs - aOrderMs; // newest store order first
  }
  var aSystemMs = aSystemCreatedAt ? di3ToMillis_(aSystemCreatedAt) : 0;
  var bSystemMs = bSystemCreatedAt ? di3ToMillis_(bSystemCreatedAt) : 0;
  if (aSystemMs !== bSystemMs) return bSystemMs - aSystemMs;
  return String(bNumber || "").localeCompare(String(aNumber || ""));
}

function di3ValidateSupplyPlanningDates_(orderCreatedInStoreDate, expectedReceivedDate) {
  var today = di3ParseSupplyCalendarDate_(new Date(), "Сегодня");
  if (orderCreatedInStoreDate && orderCreatedInStoreDate.getTime() > today.getTime()) {
    throw new Error("Дата создания заказа в магазине не может быть в будущем.");
  }
  if (orderCreatedInStoreDate && expectedReceivedDate && expectedReceivedDate.getTime() < orderCreatedInStoreDate.getTime()) {
    throw new Error("Ожидаемая дата прибытия не может быть раньше даты создания заказа в магазине.");
  }
  return true;
}

/**
 * Refreshes the factual date panel. G4 is always system-generated. G5:G7 show
 * persisted timestamps, while only the next stage's cell is enabled for input.
 * When saving a draft, preserve the one pending next-stage value typed by the user.
 */
function di3ReadSupplyStageDateTime_(sheet, dateCell, label, optional) {
  sheet = sheet || di3GetSheetOrThrow_(DI3_SUPPLY_FORM_SHEET);
  var dateValue = sheet.getRange(dateCell).getValue();
  var rowNumber = String(dateCell).replace(/^[A-Z]+/, "");
  var timeValue = sheet.getRange("H" + rowNumber).getDisplayValue();
  if ((dateValue === "" || dateValue == null) && !String(timeValue || "").trim() && optional === true) return null;
  return di3BuildEffectiveDateTime_(dateValue, timeValue, label);
}

/**
 * Refreshes the factual date panel. G4 is system-generated. G5:G7 are
 * date-picker values and H5:H7 are separate mandatory HH:mm inputs.
 */
function di3RefreshSupplyDatePanel_(supply, options) {
  options = options || {};
  var sheet = di3GetSpreadsheet_().getSheetByName(DI3_SUPPLY_FORM_SHEET);
  if (!sheet) return { refreshed: false, reason: "SHEET_MISSING" };
  var historicalMode = String(sheet.getRange(DI3_SUPPLY_FORM.historicalMode).getValue() || "") === "HISTORICAL_CREATE";
  var fullEditMode = String(sheet.getRange(DI3_SUPPLY_FORM.fullEditMode).getValue() || "") === "FULL_EDIT";
  var previousDates = sheet.getRange("G5:G7").getValues().map(function (row) { return row[0]; });
  var previousTimes = sheet.getRange("H5:H7").getDisplayValues().map(function (row) { return String(row[0] || ""); });
  var nextStage = supply && typeof di3GetNextSupplyStageConfig_ === "function"
    ? di3GetNextSupplyStageConfig_(supply.status) : null;
  var values = supply
    ? [supply.created_at || "", supply.sent_at || "", supply.awaiting_at || "", supply.received_at || ""]
    : ["", "", "", ""];
  var dateValues = ["", "", ""];
  var timeValues = ["", "", ""];
  for (var i = 0; i < 3; i++) {
    if (values[i + 1]) {
      var parts = di3SplitEffectiveDateTime_(values[i + 1], "Сохранённый этап поставки");
      dateValues[i] = parts.date;
      timeValues[i] = parts.time;
    } else if (historicalMode || fullEditMode) {
      dateValues[i] = previousDates[i] || "";
      timeValues[i] = previousTimes[i] || "";
    } else if (options.preservePendingInput === true && nextStage && nextStage.input_cell === ("G" + (i + 5))) {
      dateValues[i] = previousDates[i] || "";
      timeValues[i] = previousTimes[i] || "";
    }
  }
  sheet.getRange("G4").setValue(values[0] || "").setNumberFormat("dd.mm.yyyy hh:mm");
  sheet.getRange("G5:G7").setValues(dateValues.map(function (value) { return [value]; })).setNumberFormat("dd.mm.yyyy");
  sheet.getRange("H5:H7").setValues(timeValues.map(function (value) { return [value]; })).setNumberFormat("@");
  di3ApplySupplyStageInputState_(sheet, supply, nextStage);
  return {
    refreshed: true,
    supply_number: supply ? String(supply.supply_number || "") : "",
    next_input_cell: (historicalMode || fullEditMode) ? "G5:H7" : (nextStage ? nextStage.input_cell + ":H" + nextStage.input_cell.substring(1) : ""),
    mode: historicalMode ? "HISTORICAL_CREATE" : (fullEditMode ? "FULL_EDIT" : "STANDARD")
  };
}

function di3ApplySupplyStageInputState_(sheet, supply, nextStage) {
  var inputs = [
    { cell: "G5", field: "sent_at", label: "отправки" },
    { cell: "G6", field: "awaiting_at", label: "этапа «Ожидает получения»" },
    { cell: "G7", field: "received_at", label: "фактического получения" }
  ];
  var validation = SpreadsheetApp.newDataValidation().requireDate().setAllowInvalid(false).build();
  var blockedValidation = SpreadsheetApp.newDataValidation().requireFormulaSatisfied("=FALSE").setAllowInvalid(false).build();
  var historicalMode = String(sheet.getRange(DI3_SUPPLY_FORM.historicalMode).getValue() || "") === "HISTORICAL_CREATE";
  var fullEditMode = String(sheet.getRange(DI3_SUPPLY_FORM.fullEditMode).getValue() || "") === "FULL_EDIT";
  inputs.forEach(function (item) {
    var dateCell = sheet.getRange(item.cell);
    var rowNumber = item.cell.substring(1);
    var timeCell = sheet.getRange("H" + rowNumber);
    var editable = historicalMode || fullEditMode || !!(nextStage && nextStage.input_cell === item.cell);
    dateCell.setDataValidation(editable ? validation : blockedValidation);
    timeCell.setDataValidation(editable ? null : blockedValidation);
    timeCell.setNumberFormat("@");
    sheet.getRange("G" + rowNumber + ":H" + rowNumber)
      .setBackground(editable ? "#FFF7E6" : "#F1F5F9")
      .setFontColor(editable ? "#1F2937" : "#64748B");
    dateCell.setNote(editable
      ? "Введи календарную дату " + item.label + ". Время укажи отдельно в H" + rowNumber + " в формате HH:mm."
      : (supply && supply[item.field] ? "Сохранённая дата этапа. Поле доступно только для просмотра." : "Поле пока недоступно. Сначала заверши предыдущий этап поставки."));
    timeCell.setNote(editable
      ? "Обязательное фактическое время " + item.label + " в формате HH:mm (24 часа)."
      : "Время сохранённого этапа или заблокированное поле.");
  });
}

function di3EnsureSupplyDatePanelLayout_(sheet) {
  var labels = [
    "Дата создания заказа в магазине",
    "Ожидаемая дата прибытия",
    "Запись создана в системе",
    "Отправлена",
    "Ожидает получения",
    "Получена"
  ];
  var previousLabels = [
    "Дата заказа у продавца", "Ожидаемая дата получения", "Создана в системе",
    "Отправлена", "Готова к получению", "Фактически получена"
  ];
  var existingLabels = sheet.getRange("D2:D7").getDisplayValues().map(function (row) { return String(row[0] || "").trim(); });
  var knownNote = "G2 — дата заказа в магазине; G3 — плановая дата прибытия; G4 — системное время записи. Для фактических этапов укажи дату в G5:G7 и отдельное время HH:mm в H5:H7. G7 запускает фактическую приёмку и создание складских движений.";
  var previousNote = "Плановые даты можно менять в черновике; фактические даты фиксируются при смене статуса.";
  var previousOrderDateSemanticsNote = "Дата создания заказа в магазине определяет сортировку. Запись в системе и фактические этапы фиксируются автоматически; ожидаемая дата — плановая.";
  var existingNote = String(sheet.getRange("D8").getDisplayValue() || "").trim();
  var labelsCompatible = existingLabels.every(function (value, index) {
    return !value || value === labels[index] || value === previousLabels[index];
  });
  var panelValues = sheet.getRange("D2:J8").getValues();
  var unexpectedContent = false;
  panelValues.forEach(function (row, rowIndex) {
    row.forEach(function (value, columnIndex) {
      if (value === "" || value == null) return;
      var isLabel = columnIndex === 0 && rowIndex < 6;
      var isNote = columnIndex === 0 && rowIndex === 6;
      var isDateValue = columnIndex === 3 && rowIndex < 6;
      var isTimeValue = columnIndex === 4 && rowIndex >= 3 && rowIndex <= 5;
      if (!isLabel && !isNote && !isDateValue && !isTimeValue) unexpectedContent = true;
    });
  });
  if (!labelsCompatible || (existingNote && existingNote !== knownNote && existingNote !== previousNote &&
      existingNote !== previousOrderDateSemanticsNote && existingNote.indexOf("Вводи фактические даты по очереди") !== 0) || unexpectedContent) {
    throw new Error("Область D2:J8 листа «Поставка v3» содержит неизвестную структуру или данные. Размещение панели дат остановлено без перезаписи.");
  }
  // Preserve legacy combined timestamps as separate visible inputs. A legacy
  // midnight value has no provable time precision, so leave H blank for re-entry.
  var legacyStageDates = sheet.getRange("G5:G7").getValues().map(function (row) { return row[0]; });
  var legacyStageTimes = sheet.getRange("H5:H7").getDisplayValues().map(function (row) { return String(row[0] || "").trim(); });
  var migratedDates = [], migratedTimes = [];
  legacyStageDates.forEach(function (value, index) {
    if (value === "" || value == null) {
      migratedDates.push([""]); migratedTimes.push([legacyStageTimes[index] || ""]); return;
    }
    if (!(value instanceof Date) || isNaN(value.getTime())) {
      throw new Error("Поле G" + (index + 5) + " содержит некорректную старую дату. Исправь её вручную до обновления панели.");
    }
    var parts = di3SplitEffectiveDateTime_(value, "Старый этап поставки");
    migratedDates.push([parts.date]);
    migratedTimes.push([legacyStageTimes[index] || (parts.time === "00:00" ? "" : parts.time)]);
  });
  [["D2:F2", "G2:J2"], ["D3:F3", "G3:J3"], ["D4:F4", "G4:J4"],
    ["D5:F5", "G5:J5"], ["D6:F6", "G6:J6"], ["D7:F7", "G7:J7"]].forEach(function (pair) {
    sheet.getRange(pair[0]).breakApart().merge();
    sheet.getRange(pair[1]).breakApart();
  });
  sheet.getRange("D2:D7").setValues(labels.map(function (label) { return [label]; }));
  sheet.getRange("G5:G7").setValues(migratedDates);
  sheet.getRange("H5:H7").setValues(migratedTimes);
  sheet.getRange("D8:J8").breakApart().merge();
  sheet.getRange("D8").setValue(knownNote);
  sheet.getRange("D2:F7").setBackground("#EEF2F7").setFontWeight("bold");
  sheet.getRange("G2:J3").setBackground("#FFFFFF");
  sheet.getRange("G4:J4").setBackground("#F1F5F9").setFontColor("#475569");
  sheet.getRange("G5:H7").setBackground("#F1F5F9").setFontColor("#64748B");
  sheet.getRange("D8:J8").setBackground("#F8FAFC").setFontColor("#64748B");
  var dateValidation = SpreadsheetApp.newDataValidation().requireDate().setAllowInvalid(false).build();
  sheet.getRange("G2:G3").setDataValidation(dateValidation).setNumberFormat("dd.mm.yyyy");
  sheet.getRange("G4").setNumberFormat("dd.mm.yyyy hh:mm");
  sheet.getRange("G5:G7").setDataValidation(dateValidation).setNumberFormat("dd.mm.yyyy");
  sheet.getRange("H5:H7").setNumberFormat("@");
  sheet.getRange("G5").setNote("Календарная дата фактической отправки. Время обязательно укажи отдельно в H5.");
  sheet.getRange("G6").setNote("Календарная дата фактического этапа «Ожидает получения». Время обязательно укажи отдельно в H6.");
  sheet.getRange("G7").setNote("Календарная дата фактического получения. Время обязательно укажи отдельно в H7.");
  ["H5", "H6", "H7"].forEach(function (cell) {
    sheet.getRange(cell).setNote("Обязательное местное время в формате HH:mm (24 часа).");
  });
  sheet.setColumnWidth(8, 110);
  sheet.setRowHeights(2, 6, 28);
  sheet.setRowHeight(8, 28);
  if (!sheet.getRange("G2").getValue() && !sheet.getRange("B3").getValue()) {
    sheet.getRange("G2").setValue(di3ParseSupplyCalendarDate_(new Date(), "Дата создания заказа в магазине"));
  }
  return { status: "READY", planned_date_cells: ["G2", "G3"], system_date_cell: "G4", stage_input_pairs: [["G5", "H5"], ["G6", "H6"], ["G7", "H7"]] };
}

function di3SetupSupplyForm() {
  di3EnsureCoreFoundationSchemas_();
  var ss = di3GetSpreadsheet_();
  var sheet = ss.getSheetByName(DI3_SUPPLY_FORM_SHEET);
  var created = false;
  if (!sheet) {
    sheet = ss.insertSheet(DI3_SUPPLY_FORM_SHEET);
    di3PrepareNewSheet_(sheet, DI3_SUPPLY_FORM.firstLine + DI3_SUPPLY_FORM.lineCount - 1, 14);
    created = true;
  }
  if (created || sheet.getLastRow() === 0) {
    sheet.getRange("A1:J1").merge();
    sheet.getRange("A1").setValue("СОЗДАНИЕ И РЕДАКТИРОВАНИЕ ПОСТАВКИ");
    sheet.getRange("A2").setValue("Выбрать поставку");
    sheet.getRange("A3:A8").setValues([
      ["Номер поставки"], ["Продавец"], ["Скидка продавца, ₽"],
      ["Скидка партнёров, ₽"], ["Доставка, ₽"], ["Комментарий"]
    ]);
    sheet.getRange("A9:J9").merge();
    sheet.getRange("A9").setValue("Строки 12–31: A — товар, B — штук в упаковке, C — число упаковок, D — закупочная цена за упаковку. Обычное сохранение работает с черновиком; «Полное редактирование» разрешает корректировать ранее пройденные этапы. При несохранённых изменениях переключение B2 и очистка формы потребуют подтверждения. Изменения склада для полученных поставок требуют отдельной корректировки FIFO.");
    sheet.getRange("A10:J10").merge();
    sheet.getRange("A10").setValue("ТОВАРНЫЕ ПОЗИЦИИ — один товар может встречаться несколько раз с разными фасовками");
    sheet.getRange(11, 1, 1, DI3_SUPPLY_LINE_HEADERS.length).setValues([DI3_SUPPLY_LINE_HEADERS]);
    sheet.getRange("L3:M3").merge();
    sheet.getRange("L3").setValue("РАСЧЁТ ПОСТАВКИ");
    sheet.getRange("L4:L8").setValues([["Товары"], ["Скидка продавца"], ["Скидка партнёров"], ["Доставка"], ["Итого"]]);
    sheet.getRange("L9").setValue("Причина корректировки");
    sheet.getRange("A1:J1").setBackground("#17243A").setFontColor("#FFFFFF").setFontWeight("bold").setFontSize(14);
    sheet.getRange("A2:A8").setBackground("#EEF2F7").setFontWeight("bold");
    sheet.getRange("A9:J9").setBackground("#F8FAFC").setFontColor("#475569");
    sheet.getRange("A10:J10").setBackground("#EAF0F7").setFontWeight("bold");
    sheet.getRange("A11:J11").setBackground("#253B59").setFontColor("#FFFFFF").setFontWeight("bold");
    sheet.getRange("L3:M3").setBackground("#17243A").setFontColor("#FFFFFF").setFontWeight("bold");
    sheet.getRange("L4:L8").setBackground("#EEF2F7").setFontWeight("bold");
    sheet.getRange("L9").setBackground("#EEF2F7").setFontWeight("bold");
    sheet.getRange("M9").setBackground("#FFFFFF");
    sheet.getRange("B2:B8").setBackground("#FFFFFF");
    di3SetFrozenRowsSafely_(sheet, 11);
    sheet.setColumnWidths(1, 1, 280);
    sheet.setColumnWidths(2, 3, 125);
    sheet.setColumnWidth(4, 170);
    sheet.setColumnWidths(5, 5, 145);
    sheet.setColumnWidth(10, 130);
    sheet.setColumnWidth(11, 24);
    sheet.setColumnWidth(12, 170);
    sheet.setColumnWidth(13, 145);
    sheet.setRowHeight(1, 36);
    sheet.setRowHeights(2, 7, 28);
    sheet.setRowHeight(9, 32);
    sheet.setRowHeight(10, 28);
    sheet.setRowHeight(11, 38);
    sheet.getRange("B5:B7").setNumberFormat("#,##0.00 ₽");
  } else {
    var actualHeaders = sheet.getRange("A11:J11").getDisplayValues()[0];
    for (var i = 0; i < DI3_SUPPLY_LINE_HEADERS.length; i++) {
      if (actualHeaders[i] !== DI3_SUPPLY_LINE_HEADERS[i]) {
        throw new Error('Лист «Поставка» имеет несовместимые заголовки в A11:J11. Автоматическая перезапись запрещена.');
      }
    }
  }
  if (!created) {
    // Keep concise operating instructions visible on workspaces installed before this help row existed.
    sheet.getRange("A9").setValue("Строки 12–31: A — товар, B — штук в упаковке, C — число упаковок, D — закупочная цена за упаковку. Обычное сохранение работает с черновиком; «Полное редактирование» разрешает корректировать ранее пройденные этапы. При несохранённых изменениях переключение B2 и очистка формы потребуют подтверждения. Изменения склада для полученных поставок требуют отдельной корректировки FIFO.");
    sheet.getRange("A9:J9").setBackground("#F8FAFC").setFontColor("#475569");
    sheet.setRowHeight(9, 32);
  }
  di3EnsureSupplyDatePanelLayout_(sheet);
  sheet.getRange("A2").setValue("Выбрать поставку");
  sheet.getRange("B2").setNote("Выбери номер поставки. Если форма не изменена, документ загрузится автоматически. Если есть несохранённые изменения, выбор будет временно отменён: запусти «Поставки → Выбор и просмотр → Загрузить выбранную поставку» и подтверди замену. Для новой поставки используй «Новая поставка», для уже полученной, но ещё не оприходованной поставки — «Внести старую поставку». Фактические даты и время обычной поставки применяются по очереди: дата G5:G7, время H5:H7.");
  sheet.getRange("B3").setNote("Номер документа. Для новой или старой поставки формируется системой по дате заказа в G2.");
  sheet.getRange("L2").setValue("Режим:").setBackground("#EEF2F7").setFontWeight("bold");
  sheet.getRange("L9").setValue("Причина корректировки").setBackground("#EEF2F7").setFontWeight("bold");
  sheet.getRange("M9").setNote("Поле используется в режиме полного редактирования. Укажи причину изменения перед сохранением.");
  di3CompactSheet_(sheet, DI3_SUPPLY_FORM.firstLine + DI3_SUPPLY_FORM.lineCount - 1, 14);
  sheet.hideColumns(14);
  sheet.getRange(DI3_SUPPLY_FORM.editSupplyId).setNote("Служебное поле supply_id текущей поставки. Не изменять вручную.");
  sheet.getRange("N4:N7").setNote("Служебные параметры полного редактирования. Не изменять вручную.");
  sheet.getRange("N8:N10").setNote("Служебное состояние защиты формы от потери несохранённых данных. Не изменять вручную.");
  sheet.getRange(DI3_SUPPLY_FORM.historicalMode).setNote("Служебное поле режима внесения старой поставки. Не изменять вручную.");
  var editSupplyId = String(sheet.getRange(DI3_SUPPLY_FORM.editSupplyId).getValue() || "").trim();
  var historicalMode = String(sheet.getRange(DI3_SUPPLY_FORM.historicalMode).getValue() || "") === "HISTORICAL_CREATE";
  if (historicalMode) {
    sheet.getRange("D8").setValue("Режим «Внести старую поставку»: заполни G2, при необходимости G3, а также фактические даты G5:G7 и время HH:mm в H5:H7. После проверки и отдельного подтверждения создаётся документ и выполняется одна складская приёмка. G4 остаётся системным временем внесения записи.");
  }
  if (editSupplyId) {
    var editSupply = di3GetSupplyById_(editSupplyId);
    if (editSupply) {
      sheet.getRange("M2").setValue(historicalMode
        ? "Внесение старой поставки: " + editSupply.supply_number + " — " + di3GetSupplyStatusLabel_(editSupply.status)
        : (di3NormalizeSupplyStatus_(editSupply.status) === DI3_SUPPLY_STATUS.CREATED
          ? "Редактирование: " + editSupply.supply_number
          : "Просмотр / этапы: " + editSupply.supply_number + " — " + di3GetSupplyStatusLabel_(editSupply.status)));
    } else {
      sheet.getRange(DI3_SUPPLY_FORM.editSupplyId).clearContent();
      sheet.getRange("M2").setValue(historicalMode ? "Внесение старой поставки" : "Новая поставка");
    }
  } else {
    sheet.getRange("M2").setValue(historicalMode ? "Внесение старой поставки" : "Новая поставка");
  }
  sheet.setHiddenGridlines(true);
  di3RefreshSupplyFormValidations();
  var selectedSupplyNumber = String(sheet.getRange(DI3_SUPPLY_FORM.number).getValue() || "").trim();
  di3RefreshSupplyDatePanel_(selectedSupplyNumber ? di3FindSupplyByNumber_(selectedSupplyNumber) : null);
  di3InstallSupplyFormTrigger_();
  return { status: "READY", sheet: DI3_SUPPLY_FORM_SHEET, products: di3ListActiveProductsForWarehouse_().length };
}

/** Normalize form values before hashing; formulas/rendered totals are deliberately excluded. */
function di3NormalizeSupplyFormStateValue_(value) {
  if (value instanceof Date) return isNaN(value.getTime()) ? "" : value.toISOString();
  if (value === undefined || value === null) return "";
  if (Array.isArray(value)) return value.map(di3NormalizeSupplyFormStateValue_);
  if (typeof value === "number") return Number.isFinite(value) ? value : String(value);
  if (typeof value === "boolean") return value;
  return String(value);
}

/** Pure payload builder for the editable cells in the Supply Workspace. */
function di3BuildSupplyFormStatePayload_(fields) {
  fields = fields || {};
  return {
    document: di3NormalizeSupplyFormStateValue_(fields.document || []), // B3:B8
    dates: di3NormalizeSupplyFormStateValue_(fields.dates || []),       // G2:G7
    times: di3NormalizeSupplyFormStateValue_(fields.times || []),       // H5:H7
    lines: di3NormalizeSupplyFormStateValue_(fields.lines || []),       // A12:D31
    reason: di3NormalizeSupplyFormStateValue_(fields.reason == null ? "" : fields.reason) // M9
  };
}

function di3GetSupplyFormStateHash_(sheet) {
  if (!sheet) throw new Error("Для проверки состояния формы нужен лист поставки.");
  if (typeof di3SupplyFullEditHash_ !== "function") {
    throw new Error("SHA-256 helper для контроля формы не загружен. Проверь модуль полного редактирования.");
  }
  var payload = di3BuildSupplyFormStatePayload_({
    document: sheet.getRange("B3:B8").getValues(),
    dates: sheet.getRange("G2:G7").getValues(),
    times: sheet.getRange("H5:H7").getDisplayValues(),
    lines: sheet.getRange(DI3_SUPPLY_FORM.firstLine, 1, DI3_SUPPLY_FORM.lineCount, 4).getValues(),
    reason: sheet.getRange("M9").getValue()
  });
  return di3SupplyFullEditHash_(payload);
}

function di3SetSupplyFormStateBaseline_(sheet) {
  sheet = sheet || di3GetSheetOrThrow_(DI3_SUPPLY_FORM_SHEET);
  var hash = di3GetSupplyFormStateHash_(sheet);
  sheet.getRange(DI3_SUPPLY_FORM.formStateBaseline).setValue(hash);
  sheet.getRange(DI3_SUPPLY_FORM.pendingSelector + ":" + DI3_SUPPLY_FORM.previousSelector).clearContent();
  return hash;
}

function di3HasSupplyFormUserData_(sheet) {
  function hasValue(value) { return value !== "" && value !== null && value !== undefined; }
  var documentValues = sheet.getRange("B3:B8").getValues();
  var stageDates = sheet.getRange("G3:G7").getValues();
  var stageTimes = sheet.getRange("H5:H7").getDisplayValues();
  var lines = sheet.getRange(DI3_SUPPLY_FORM.firstLine, 1, DI3_SUPPLY_FORM.lineCount, 4).getValues();
  var reason = sheet.getRange("M9").getValue();
  if (documentValues.some(function (row) { return hasValue(row[0]); })) return true;
  if (stageDates.some(function (row) { return hasValue(row[0]); })) return true;
  if (stageTimes.some(function (row) { return hasValue(row[0]); })) return true;
  if (lines.some(function (row) { return row.some(hasValue); })) return true;
  if (hasValue(reason)) return true;
  // G2 is prefilled with today's date for a new blank supply. Treat another date
  // as user data, while avoiding a false warning on a pristine, upgraded form.
  var orderDate = sheet.getRange("G2").getValue();
  if (hasValue(orderDate)) {
    if (!(orderDate instanceof Date) || isNaN(orderDate.getTime())) return true;
    var tz = di3GetConfiguredTimeZone_();
    var orderKey = Utilities.formatDate(orderDate, tz, "yyyy-MM-dd");
    var todayKey = Utilities.formatDate(new Date(), tz, "yyyy-MM-dd");
    if (orderKey !== todayKey) return true;
  }
  return false;
}

/** True means the current editable form differs from the last explicit load/reset baseline. */
function di3HasUnsavedSupplyFormChanges_(sheet) {
  sheet = sheet || di3GetSheetOrThrow_(DI3_SUPPLY_FORM_SHEET);
  var baseline = String(sheet.getRange(DI3_SUPPLY_FORM.formStateBaseline).getValue() || "").trim();
  if (!baseline) return di3HasSupplyFormUserData_(sheet); // Legacy form: fail safe.
  return di3GetSupplyFormStateHash_(sheet) !== baseline;
}

function di3ConfirmSupplyFormDiscard_(title, message) {
  var ui = SpreadsheetApp.getUi();
  return ui.alert(title, message, ui.ButtonSet.YES_NO) === ui.Button.YES;
}

function di3ShouldConfirmSupplyFormDiscard_(hasUnsavedChanges, options) {
  return hasUnsavedChanges === true && !(options && options.skipUnsavedConfirmation === true);
}

function di3GetCurrentSupplyFormSelector_(sheet) {
  var supplyId = String(sheet.getRange(DI3_SUPPLY_FORM.editSupplyId).getValue() || "").trim();
  var supply = supplyId ? di3GetSupplyById_(supplyId) : null;
  return supply ? String(supply.supply_number || "") : "";
}

function di3NewSupplyForm(options) {
  options = options || {};
  var sheet = di3GetSheetOrThrow_(DI3_SUPPLY_FORM_SHEET);
  if (String(sheet.getRange(DI3_SUPPLY_FORM.fullEditMode).getValue() || "") === "FULL_EDIT") {
    throw new Error("Сначала сохрани или отмени полную корректировку поставки. Новая поставка не должна очищать несохранённые изменения.");
  }
  if (di3ShouldConfirmSupplyFormDiscard_(di3HasUnsavedSupplyFormChanges_(sheet), options)) {
    var confirmed = di3ConfirmSupplyFormDiscard_("Очистить текущую форму поставки?",
      "В форме есть несохранённые изменения. Команда «Новая поставка» очистит реквизиты, даты и товарные строки. Уже сохранённые документы и складские движения не удаляются. Продолжить?");
    if (!confirmed) return { status: "CANCELLED_BY_USER", cleared: false };
  }
  sheet.getRange("B2:B8").clearContent();
  sheet.getRange("G2:G7").clearContent();
  sheet.getRange("H5:H7").clearContent();
  sheet.getRange(DI3_SUPPLY_FORM.firstLine, 1, DI3_SUPPLY_FORM.lineCount, 10).clearContent();
  sheet.getRange("M4:M8").clearContent();
  sheet.getRange(DI3_SUPPLY_FORM.editSupplyId).clearContent();
  sheet.getRange(DI3_SUPPLY_FORM.historicalMode).clearContent();
  sheet.getRange("N4:N7").clearContent();
  sheet.getRange("M9").clearContent();
  sheet.getRange("M2").setValue("Новая поставка");
  sheet.getRange("G2").setValue(di3ParseSupplyCalendarDate_(new Date(), "Дата создания заказа в магазине"));
  di3RefreshSupplyFormValidations();
  di3RefreshSupplyDatePanel_(null);
  di3SetSupplyFormStateBaseline_(sheet);
  return { status: "READY", cleared: true };
}

function di3PreviewSupplyDraft() {
  return di3PreviewSupplyForm();
}

function di3LoadSelectedSupplyDraft(options) {
  options = options || {};
  var sheet = di3GetSheetOrThrow_(DI3_SUPPLY_FORM_SHEET);
  if (String(sheet.getRange(DI3_SUPPLY_FORM.fullEditMode).getValue() || "") === "FULL_EDIT") {
    var activeNumber = di3GetCurrentSupplyFormSelector_(sheet);
    sheet.getRange(DI3_SUPPLY_FORM.selector).setValue(activeNumber);
    sheet.getRange(DI3_SUPPLY_FORM.pendingSelector + ":" + DI3_SUPPLY_FORM.previousSelector).clearContent();
    throw new Error("Полное редактирование уже включено. Чтобы не потерять изменения, сначала сохрани или отмени корректировку.");
  }
  var pendingNumber = String(sheet.getRange(DI3_SUPPLY_FORM.pendingSelector).getValue() || "").trim();
  var number = pendingNumber || String(sheet.getRange(DI3_SUPPLY_FORM.selector).getValue() || "").trim();
  if (!number) return { loaded: false };
  var currentSupplyId = String(sheet.getRange(DI3_SUPPLY_FORM.editSupplyId).getValue() || "").trim();
  var currentSupply = currentSupplyId ? di3GetSupplyById_(currentSupplyId) : null;
  if (di3ShouldConfirmSupplyFormDiscard_(di3HasUnsavedSupplyFormChanges_(sheet), options)) {
    var confirmed = di3ConfirmSupplyFormDiscard_("Заменить данные формы поставки?",
      "В форме есть несохранённые изменения. При загрузке поставки " + number + " текущие данные формы будут заменены. Документы, уже сохранённые в реестре, не изменяются. Продолжить?");
    if (!confirmed) {
      var previousNumber = pendingNumber
        ? String(sheet.getRange(DI3_SUPPLY_FORM.previousSelector).getValue() || "")
        : (currentSupply ? String(currentSupply.supply_number || "") : "");
      sheet.getRange(DI3_SUPPLY_FORM.selector).setValue(previousNumber);
      sheet.getRange(DI3_SUPPLY_FORM.pendingSelector + ":" + DI3_SUPPLY_FORM.previousSelector).clearContent();
      return { status: "CANCELLED_BY_USER", loaded: false };
    }
  }
  var supply = di3FindSupplyByNumber_(number);
  if (!supply) throw new Error("Поставка с номером " + number + " не найдена.");
  var items = di3GetSupplyItems_(supply.supply_id);
  if (items.length > DI3_SUPPLY_FORM.lineCount) throw new Error("В поставке " + number + " больше товарных строк, чем поддерживает форма. Автоматическое усечение запрещено.");
  // The B2 onEdit handler may have restored the old selector while waiting
  // for a menu confirmation. Commit the requested selector only after the
  // target document and its complete line set have been validated.
  sheet.getRange(DI3_SUPPLY_FORM.selector).setValue(supply.supply_number);
  sheet.getRange(DI3_SUPPLY_FORM.number).setValue(supply.supply_number);
  sheet.getRange(DI3_SUPPLY_FORM.editSupplyId).setValue(String(supply.supply_id));
  sheet.getRange(DI3_SUPPLY_FORM.historicalMode).clearContent();
  sheet.getRange("N4:N7").clearContent();
  sheet.getRange("M9").clearContent();
  sheet.getRange("M2").setValue(di3NormalizeSupplyStatus_(supply.status) === DI3_SUPPLY_STATUS.CREATED
    ? "Редактирование: " + supply.supply_number
    : "Просмотр / этапы: " + supply.supply_number + " — " + di3GetSupplyStatusLabel_(supply.status));
  sheet.getRange("B4:B8").setValues([
    [supply.supplier || ""], [supply.seller_discount_amount], [supply.partner_discount_amount],
    [supply.shipping_amount], [supply.notes || ""]
  ]);
  sheet.getRange("G2:G3").setValues([[supply.supplier_order_date || ""], [supply.expected_received_date || ""]]);
  di3RefreshSupplyDatePanel_(supply);
  sheet.getRange(DI3_SUPPLY_FORM.firstLine, 1, DI3_SUPPLY_FORM.lineCount, 10).clearContent();
  var products = di3GetProductFormOptionIndex_();
  var codes = di3GetProductPublicCodeMap_();
  var output = items.map(function (item) {
    var product = di3LoadProductById_(String(item.product_id));
    var label = product ? di3GetProductOptionLabelWithMap_(product, codes) : (item.product_label_snapshot || "Неизвестный товар");
    return [label, item.units_per_pack, item.packs, item.purchase_price_per_pack];
  });
  if (output.length) sheet.getRange(DI3_SUPPLY_FORM.firstLine, 1, output.length, 4).setValues(output);
  di3RenderSupplyFinancialPreview_({
    lines: items.map(function (item) {
      return {
        base_line_amount: Number(item.base_line_amount),
        allocated_seller_discount: Number(item.allocated_seller_discount),
        allocated_partner_discount: Number(item.allocated_partner_discount),
        allocated_shipping: Number(item.allocated_shipping),
        final_pack_cost: Number(item.final_pack_cost),
        received_units: Number(item.received_units)
      };
    }),
    goods_amount: Number(supply.goods_amount), seller_discount_amount: Number(supply.seller_discount_amount),
    partner_discount_amount: Number(supply.partner_discount_amount), shipping_amount: Number(supply.shipping_amount),
    final_amount: Number(supply.final_amount)
  });
  di3RefreshSupplyFormValidations();
  di3SetSupplyFormStateBaseline_(sheet);
  return { loaded: true, supply_number: supply.supply_number, items: items.length };
}

function di3InstallSupplyFormTrigger_() {
  return di3InstallUnifiedEditTrigger_();
}

function di3SupplyFormOnEdit(e) {
  if (!e || !e.range || !e.range.getSheet) return;
  if (e.range.getSheet().getName() !== DI3_SUPPLY_FORM_SHEET || e.range.getA1Notation() !== DI3_SUPPLY_FORM.selector) return;
  var sheet = e.range.getSheet();
  var attemptedNumber = String(e.value == null ? sheet.getRange(DI3_SUPPLY_FORM.selector).getValue() || "" : e.value).trim();
  var previousNumber = typeof e.oldValue === "undefined" ? di3GetCurrentSupplyFormSelector_(sheet) : String(e.oldValue || "");
  if (!attemptedNumber) {
    sheet.getRange(DI3_SUPPLY_FORM.selector).setValue(previousNumber);
    sheet.getRange(DI3_SUPPLY_FORM.pendingSelector + ":" + DI3_SUPPLY_FORM.previousSelector).clearContent();
    return { status: "IGNORED_EMPTY_SELECTOR" };
  }
  var fullEdit = String(sheet.getRange(DI3_SUPPLY_FORM.fullEditMode).getValue() || "") === "FULL_EDIT";
  if (fullEdit) {
    sheet.getRange(DI3_SUPPLY_FORM.selector).setValue(di3GetCurrentSupplyFormSelector_(sheet) || previousNumber);
    sheet.getRange(DI3_SUPPLY_FORM.pendingSelector + ":" + DI3_SUPPLY_FORM.previousSelector).clearContent();
    di3GetSpreadsheet_().toast("Сначала сохрани или отмени полное редактирование. Переключение поставки заблокировано.", "Полное редактирование", 8);
    return { status: "BLOCKED_FULL_EDIT" };
  }
  if (di3HasUnsavedSupplyFormChanges_(sheet)) {
    sheet.getRange(DI3_SUPPLY_FORM.pendingSelector).setValue(attemptedNumber);
    sheet.getRange(DI3_SUPPLY_FORM.previousSelector).setValue(previousNumber);
    sheet.getRange(DI3_SUPPLY_FORM.selector).setValue(previousNumber);
    di3GetSpreadsheet_().toast("Есть несохранённые изменения. Они сохранены в форме. Для переключения выбери «Поставки → Выбор и просмотр → Загрузить выбранную поставку…» и подтверди замену.", "Загрузка поставки не выполнена", 10);
    return { status: "CONFIRMATION_REQUIRED", requested_supply_number: attemptedNumber };
  }
  sheet.getRange(DI3_SUPPLY_FORM.pendingSelector + ":" + DI3_SUPPLY_FORM.previousSelector).clearContent();
  return di3LoadSelectedSupplyDraft();
}

function di3SupplyOnOpen() {
  return di3BuildMenus_();
}

function di3SetupCatalogAndSupply() {
  di3EnsureCoreFoundationSchemas_();
  var products = di3SetupProductsSheet();
  var supply = di3SetupSupplyForm();
  return { status: "READY", products_sheet: products, supply_sheet: supply };
}

