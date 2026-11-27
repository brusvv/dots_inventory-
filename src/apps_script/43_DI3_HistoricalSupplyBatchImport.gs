/**
 * Dots Inventory v4 — historical supply batch import staging.
 *
 * SAFETY: this module intentionally implements READ-ONLY source reconciliation
 * first. It does not write Supply, Operations, StockLedger, StockLots or FIFO.
 * Batch commit is blocked until source ambiguities and schema constraints are
 * explicitly resolved and a tested adapter to the standard receipt pipeline
 * exists.
 */
var DI3_HISTORICAL_BATCH_IMPORT_VERSION = "1.0.0";

function di3GetHistoricalSupplyBatchSource_() {
  return {
    source_id: "HISTORICAL-SUPPLIES-2026-11",
    currency: "RUB",
    shared_discount_groups: [{
      id: "PARTNER-DISCOUNT-2026-06-10",
      total_kopecks: 50000,
      supply_seq: [4, 5],
      allocations_kopecks: { "4": 39881, "5": 10119 }
    }],
    supplies: [
      { seq: 1, supplier: "mamnamh", order_date: "2025-12-11", sent_at: "2025-12-16T08:43", awaiting_at: "2025-12-16T11:20", received_at: "2025-12-31T13:24", goods_kopecks: 28200, shipping_kopecks: null, partner_discount_kopecks: 0, items: [
        { product: "ESPTiger YanZi Rouge Orange", variant: "5.5 mm", packs: 1, pcs: 10, line_kopecks: 7050 },
        { product: "ESPTiger YanZi Rouge Orange", variant: "6 mm", packs: 1, pcs: 10, line_kopecks: 7050 },
        { product: "ESPTiger YanZi Rouge Orange", variant: "6.5 mm", packs: 1, pcs: 10, line_kopecks: 7050 },
        { product: "ESPTiger YanZi Rouge Orange", variant: "7 mm", packs: 1, pcs: 10, line_kopecks: 7050 }
      ]},
      { seq: 2, supplier: "Sweet Baby Store", order_date: "2026-01-18", sent_at: "2026-03-01T10:29", awaiting_at: "2026-03-22T10:22", received_at: "2026-03-24T19:22", goods_kopecks: 100700, shipping_kopecks: null, partner_discount_kopecks: 0, items: [
        { product: "X-Raypad Obsidian Air", variant: "6.5 mm", packs: 1, pcs: 40, line_kopecks: 50350 },
        { product: "X-Raypad Jade Air", variant: "6.5 mm", packs: 1, pcs: 20, line_kopecks: 25175 },
        { product: "X-Raypad Jade Air", variant: "8 mm", packs: 1, pcs: 20, line_kopecks: 25175 }
      ]},
      { seq: 3, supplier: "ProGlide", order_date: "2026-06-05", sent_at: "2026-06-06T10:13", awaiting_at: "2026-06-09T15:27", received_at: "2026-06-09T19:05", goods_kopecks: 32600, shipping_kopecks: null, partner_discount_kopecks: 0, items: [
        { product: "WestLab Yellow", variant: "", packs: 1, pcs: 20, line_kopecks: 32600 }
      ]},
      { seq: 4, supplier: "Mifuny Keyboard Store", order_date: "2026-06-10", sent_at: null, awaiting_at: null, received_at: null, goods_kopecks: 312667, shipping_kopecks: null, partner_discount_kopecks: 39881, items: [
        { product: "X-Raypad Obsidian Air", variant: "6.5 mm", packs: 2, pcs: 40, line_kopecks: 157915, shipment: "MIFUNY-OBSIDIAN" },
        { product: "Wallhack PTFE Black", variant: "", packs: 1, pcs: 40, line_kopecks: 154752, shipment: "MIFUNY-WALLHACK" }
      ], shipments: [
        { id: "MIFUNY-OBSIDIAN", sent_at: "2026-06-12T13:04", awaiting_at: "2026-07-02T10:15", received_at: "2026-07-11T19:55" },
        { id: "MIFUNY-WALLHACK", sent_at: "2026-06-21T15:25", awaiting_at: "2026-06-27T11:00", received_at: "2026-07-11T19:56" }
      ]},
      { seq: 5, supplier: "Real Eagles Trading Store", order_date: "2026-06-10", sent_at: "2026-06-12T07:01", awaiting_at: "2026-06-20T13:46", received_at: "2026-06-28T17:07", goods_kopecks: 79333, shipping_kopecks: 24000, partner_discount_kopecks: 10119, items: [
        { product: "WestLab Yellow", variant: "", packs: 2, pcs: 20, line_kopecks: 31732 },
        { product: "WestLab Orange", variant: "6.5 mm", packs: 3, pcs: 20, line_kopecks: 47601 }
      ]},
      { seq: 6, supplier: "NxGLOBAL", order_date: "2026-06-14", sent_at: "2026-06-20T06:34", awaiting_at: "2026-07-16T18:40", received_at: "2026-07-17T20:33", goods_kopecks: 85100, shipping_kopecks: null, partner_discount_kopecks: 0, items: [
        { product: "X-Raypad Obsidian Pro Air", variant: "", packs: 1, pcs: 40, line_kopecks: 85100 }
      ]},
      { seq: 7, supplier: "CuXiu Official Store", order_date: "2026-07-26", sent_at: "2026-07-31T05:20", awaiting_at: "2026-08-08T13:05", received_at: "2026-08-08T20:16", goods_kopecks: 335200, shipping_kopecks: 77500, partner_discount_kopecks: 50000, items: [
        { product: "Dysphoria Booby", variant: "6 mm", packs: 8, pcs: 40, line_kopecks: 335200 }
      ]},
      { seq: 8, supplier: "switheskeys Store", order_date: "2026-08-14", sent_at: "2026-08-18T09:50", awaiting_at: "2026-08-28T13:24", received_at: "2026-08-29T13:10", goods_kopecks: 412600, prior_line_sum_kopecks: 412599, shipping_kopecks: 57500, partner_discount_kopecks: 27600, items: null, expected_item_count: 7 },
      { seq: 9, supplier: "For Gamer", order_date: "2026-08-24", sent_at: "2026-08-28T11:17", awaiting_at: "2026-09-13T17:49", received_at: "2026-09-13T20:05", goods_kopecks: 554000, shipping_kopecks: null, partner_discount_kopecks: 0, items: [
        { product: "X-Raypad Jade", variant: "6.5 mm", packs: 10, pcs: 40, line_kopecks: 554000 }
      ]},
      { seq: 10, supplier: "Real Eagles Trading Store", order_date: "2026-08-26T18:27", sent_at: "2026-09-01T07:21", awaiting_at: "2026-09-10T12:29", received_at: "2026-09-10T13:13", order_number: "5548 4031 8104 4525", goods_kopecks: 357900, shipping_kopecks: 46200, partner_discount_kopecks: 50000, items: [
        { product: "Dream Gamer Mercury", variant: "", packs: 1, pcs: 80, line_kopecks: 61900 },
        { product: "Tsukilume Polar Smooth", variant: "", packs: 1, pcs: 40, line_kopecks: 43900 },
        { product: "PSYCHE Gear LYNN", variant: "", packs: 1, pcs: 50, line_kopecks: 48500 },
        { product: "Dream Gamer Neptune", variant: "", packs: 1, pcs: 80, line_kopecks: 70900 },
        { product: "Have Fun Gaming Nix", variant: "", packs: 1, pcs: 40, line_kopecks: 30900 },
        { product: "Hitomi Dots", variant: "3 models x 20", packs: 1, pcs: 60, line_kopecks: 30900 },
        { product: "Dor Saint", variant: "4 models x 20", packs: 1, pcs: 80, line_kopecks: 70900, components: [\n          { name: "Meng Yi", style: "Fast", shape: "Balanced Flat", material: "PTFE", diameter_mm: "6.5", thickness_mm: "0.85", foam: true, pcs: 20 },\n          { name: "Lyu Yu", style: "Fast", shape: "Balanced Flat", material: "PTFE", diameter_mm: "6.5", thickness_mm: "0.85", foam: true, pcs: 20 },\n          { name: "Zi Dian", style: "Balanced Control", shape: "Balanced Flat", material: "PTFE", diameter_mm: "6.5", thickness_mm: "0.85", foam: true, pcs: 20 },\n          { name: "Yue Yan", style: "Control", shape: "Balanced Flat", material: "UHMW-PE", diameter_mm: "6.5", thickness_mm: "0.85", foam: true, pcs: 20 }\n        ] }
      ]},
      { seq: 11, supplier: "Real Eagles Trading Store", order_date: "2026-08-26", sent_at: "2026-09-01T07:21", awaiting_at: "2026-09-10T12:29", received_at: "2026-09-10T13:13", order_number: "5548 4064 6978 4525", goods_kopecks: 132200, source_claimed_goods_kopecks: 370100, shipping_kopecks: 48100, partner_discount_kopecks: 50000, items: [
        { product: "AGLOW × Westlab", variant: "", packs: 1, pcs: 60, line_kopecks: 52900 },
        { product: "X-Raypad Jade Air", variant: "6.5 mm", packs: 2, pcs: 20, line_kopecks: 39650 },
        { product: "X-Raypad Jade Air", variant: "8 mm", packs: 2, pcs: 20, line_kopecks: 39650 }
      ], tracking_events: [
        ["2026-08-31T13:28", "Sent to sorting center"],
        ["2026-08-31T21:54", "Accepted by distribution center, Xinqiao Town"],
        ["2026-08-31T22:17", "Left distribution center, Xinqiao Town"],
        ["2026-09-01T07:21", "Accepted for long-distance delivery"],
        ["2026-09-02T07:43", "Preparing for customs processing"],
        ["2026-09-02T08:03", "Cleared customs in departure country"],
        ["2026-09-03T18:00", "Handed over to airline"],
        ["2026-09-04T06:41", "Customs processing ongoing"],
        ["2026-09-05T08:11", "Left country of departure"],
        ["2026-09-05T17:16", "Arrived at linehaul office"],
        ["2026-09-07T19:40", "Cleared customs"],
        ["2026-09-08T04:22", "Arrived distribution center, Domodedovo"],
        ["2026-09-08T13:25", "Left distribution center, Domodedovo"],
        ["2026-09-08T21:52", "In transit, Domodedovo"],
        ["2026-09-09T22:15", "Accepted by distribution center, Krasnodar_HUB (Ruconnect)"],
        ["2026-09-10T05:59", "In transit, Krasnodar_HUB (Ruconnect)"],
        ["2026-09-10T12:29", "Accepted at destination for pick-up"],
        ["2026-09-10T13:13", "Delivered"]
      ]}
    ]
  };
}

/** Pure validation of the source register. Does not access Sheets or mutate state. */
function di3ValidateHistoricalSupplyBatchSource_(source) {
  source = source || di3GetHistoricalSupplyBatchSource_();
  var errors = [], warnings = [], totals = { supplies: 0, item_lines: 0, packs: 0, units: 0, goods_kopecks: 0 };
  var bySeq = {};
  (source.supplies || []).forEach(function (supply) {
    totals.supplies++;
    bySeq[String(supply.seq)] = supply;
    if (!supply.supplier || !supply.order_date) errors.push("№" + supply.seq + ": отсутствует поставщик или дата заказа.");
    if (!Array.isArray(supply.items)) {
      errors.push("№" + supply.seq + ": состав товаров не восстановлен; импорт запрещён.");
      return;
    }
    var lineSum = 0;
    supply.items.forEach(function (line, index) {
      if (!line.product || !Number.isInteger(line.packs) || line.packs <= 0 ||
          !Number.isInteger(line.pcs) || line.pcs <= 0 || !Number.isInteger(line.line_kopecks) || line.line_kopecks < 0) {
        errors.push("№" + supply.seq + ", строка " + (index + 1) + ": некорректные количество или сумма.");
        return;
      }
      if (line.line_kopecks % line.packs !== 0) {
        errors.push("№" + supply.seq + ", строка " + (index + 1) + ": сумма строки не делится на целое число упаковок в копейках; требуется отдельное решение, округлять нельзя.");
      }
      lineSum += line.line_kopecks;
      totals.item_lines++;
      totals.packs += line.packs;
      totals.units += line.packs * line.pcs;
    });
    if (lineSum !== supply.goods_kopecks) {
      errors.push("№" + supply.seq + ": сумма строк " + (lineSum / 100).toFixed(2) + " ₽ не совпадает с подтверждённой стоимостью товаров " + (supply.goods_kopecks / 100).toFixed(2) + " ₽.");
    }
    totals.goods_kopecks += supply.goods_kopecks;
    ["sent_at", "awaiting_at", "received_at"].forEach(function (field) {
      if (!supply[field] && !supply.shipments) errors.push("№" + supply.seq + ": отсутствует " + field + ".");
    });
    if (supply.shipments) errors.push("№" + supply.seq + ": документ содержит несколько отдельных историй отправки, а стандартная модель хранит один набор дат на поставку. Нельзя импортировать без потери хронологии.");
    if (supply.source_claimed_goods_kopecks != null && supply.source_claimed_goods_kopecks !== supply.goods_kopecks) {
      errors.push("№" + supply.seq + ": конфликт источника — заявлено " + (supply.source_claimed_goods_kopecks / 100).toFixed(2) +
        " ₽, подтверждённые строки дают " + (supply.goods_kopecks / 100).toFixed(2) + " ₽.");
    }
    if (supply.prior_line_sum_kopecks != null && supply.prior_line_sum_kopecks !== supply.goods_kopecks) {
      errors.push("№" + supply.seq + ": расхождение в 1 копейку между предыдущей суммой строк и чеком.");
    }
  });
  (source.shared_discount_groups || []).forEach(function (group) {
    var allocated = group.supply_seq.reduce(function (sum, seq) { return sum + Number(group.allocations_kopecks[String(seq)] || 0); }, 0);
    if (allocated !== group.total_kopecks) errors.push(group.id + ": распределение скидки не равно исходной сумме.");
    group.supply_seq.forEach(function (seq) {
      if (!bySeq[String(seq)]) errors.push(group.id + ": отсутствует поставка №" + seq + ".");
      else if (Number(bySeq[String(seq)].partner_discount_kopecks) !== Number(group.allocations_kopecks[String(seq)])) {
        errors.push(group.id + ": сумма по поставке №" + seq + " не совпадает с распределением.");
      }
    });
  });
  return {
    status: errors.length ? "BLOCKED" : "SOURCE_VALID",
    read_only: true,
    source_id: source.source_id,
    totals: {
      supplies: totals.supplies, item_lines: totals.item_lines, packs: totals.packs,
      units: totals.units, goods_rub: (totals.goods_kopecks / 100).toFixed(2)
    },
    errors: errors,
    warnings: warnings,
    commit_enabled: false
  };
}

/** Read-only menu entry point. Writes the report to execution log and shows summary. */
function di3PreviewHistoricalSupplyBatchImport() {
  var report = di3ValidateHistoricalSupplyBatchSource_();
  Logger.log(JSON.stringify(report, null, 2));
  var message = [
    "Поставок: " + report.totals.supplies,
    "Товарных строк: " + report.totals.item_lines,
    "Упаковок: " + report.totals.packs,
    "Точек: " + report.totals.units,
    "Ошибок: " + report.errors.length,
    "Предупреждений: " + report.warnings.length,
    "",
    report.errors.slice(0, 8).join("\n"),
    "",
    "Это только Preview. Запись в таблицу не выполняется."
  ].join("\n");
  SpreadsheetApp.getUi().alert("Preview исторических поставок — " + report.status, message, SpreadsheetApp.getUi().ButtonSet.OK);
  return report;
}

/** Fail-closed placeholder: never write until the preview is clean and the adapter is tested. */
function di3ImportHistoricalSuppliesBatch() {
  var report = di3ValidateHistoricalSupplyBatchSource_();
  if (report.errors.length) {
    throw new Error("Пакетный импорт остановлен: Preview содержит " + report.errors.length +
      " блокирующих несоответствий. Ничего не записано. Запусти «Preview исторических поставок» и устрани ошибки.");
  }
  throw new Error("Пакетный Commit пока закрыт: требуется проверить соответствие каталога и фасовок, отдельные истории Mifuny и адаптер штатной SUPPLY_RECEIVE. Ничего не записано.");
}
