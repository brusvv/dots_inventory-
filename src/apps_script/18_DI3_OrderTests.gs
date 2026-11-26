/** Pure order-domain tests. Safe to run in Apps Script; does not create or modify sheets. */
function di3RunOrderDomainUnitTests() {
  var passed = 0;
  var failures = [];
  function test(name, callback) {
    try { callback(); passed++; }
    catch (error) { failures.push({ name: name, error: error.message || String(error) }); }
  }
  function equal(actual, expected, message) {
    if (actual !== expected) throw new Error((message || "Values differ") + ": expected " + JSON.stringify(expected) + ", got " + JSON.stringify(actual));
  }
  function close(actual, expected, epsilon, message) {
    if (Math.abs(Number(actual) - Number(expected)) > (epsilon || 0.000001)) {
      throw new Error((message || "Values are not close") + ": expected " + expected + ", got " + actual);
    }
  }
  function throws(callback, pattern) {
    var error = null;
    try { callback(); } catch (caught) { error = caught; }
    if (!error) throw new Error("Expected an error matching " + pattern + ".");
    if (pattern && !pattern.test(String(error.message || error))) {
      throw new Error("Expected error matching " + pattern + ", got: " + String(error.message || error));
    }
  }

  test("money minor-unit conversion rounds half-up for binary decimal edge cases", function () {
    equal(di3MoneyToMinorUnits_(10.075, "test", true), 1008);
    equal(di3MoneyToMinorUnits_(1.005, "test", true), 101);
    equal(di3MoneyToMinorUnits_(1234.565, "test", true), 123457);
    equal(di3MoneyToMinorUnits_(100.125, "test", true), 10013);
    equal(di3MoneyToMinorUnits_(-10.075, "test", true), -1008);
    equal(di3MoneyToMinorUnits_(-1.005, "test", true), -101);
  });

  test("goods, commission, discount and payable total calculate in kopeks", function () {
    var plan = di3BuildOrderFinancialPlan_({
      commission_enabled: true, commission_rate: 0.05,
      discount_enabled: true, discount_rate: 0.10,
      lines: [
        { product_id: "P1", product_label: "Product 1", quantity: 2, sale_unit_price: 100, estimated_unit_cost: 20 },
        { product_id: "P2", product_label: "Product 2", quantity: 1, sale_unit_price: 100, estimated_unit_cost: 10 }
      ]
    });
    equal(plan.goods_amount, 300);
    equal(plan.commission_amount, 15);
    equal(plan.discount_amount, 30);
    equal(plan.payable_total, 285);
    equal(plan.estimated_fifo_cost_total, 50);
    equal(plan.seller_revenue_estimate, 270);
    equal(plan.platform_commission_quote, 15);
    equal(plan.estimated_profit, 220);
  });
  test("10% commission is 30 rubles on 300 rubles when buyer pays", function () {
    var plan = di3BuildOrderFinancialPlan_({
      commission_paid_by_buyer: true, commission_rate: 0.10,
      lines: [{ product_id: "BUYER-FEE", quantity: 10, sale_unit_price: 30, estimated_unit_cost: 10.5 }]
    });
    equal(plan.commission_amount, 30);
    equal(plan.commission_payer, "BUYER");
    equal(plan.payable_total, 330);
    equal(plan.seller_revenue_estimate, 300);
    equal(plan.estimated_profit, 195);
  });
  test("10% commission is deducted from seller proceeds when seller pays", function () {
    var plan = di3BuildOrderFinancialPlan_({
      commission_paid_by_buyer: false, commission_rate: 0.10,
      lines: [{ product_id: "SELLER-FEE", quantity: 10, sale_unit_price: 30, estimated_unit_cost: 10.5 }]
    });
    equal(plan.commission_amount, 30);
    equal(plan.commission_payer, "SELLER");
    equal(plan.payable_total, 300);
    equal(plan.seller_revenue_estimate, 270);
    equal(plan.estimated_profit, 165);
  });
  test("commission percent parser supports native and literal percent cell formats", function () {
    equal(di3NormalizeOrderPercentInput_(0.1, "0.00%", "Комиссия"), 0.1);
    equal(di3NormalizeOrderPercentInput_(10, '0.00"%"', "Комиссия"), 0.1);
    equal(di3NormalizeOrderPercentInput_(9, '0.00"%"', "Комиссия"), 0.09);
  });
  test("seller-paid commission is deducted after seller discount while fee base stays gross", function () {
    var plan = di3BuildOrderFinancialPlan_({
      commission_paid_by_buyer: false, commission_rate: 0.10,
      discount_enabled: true, discount_rate: 0.10,
      lines: [{ product_id: "SELLER-DISCOUNT", quantity: 10, sale_unit_price: 30, estimated_unit_cost: 10.5 }]
    });
    equal(plan.goods_amount, 300);
    equal(plan.commission_amount, 30);
    equal(plan.discount_amount, 30);
    equal(plan.payable_total, 270);
    equal(plan.seller_revenue_estimate, 240);
    equal(plan.estimated_profit, 135);
  });

  test("duplicate product lines are rejected", function () {
    throws(function () {
      di3BuildOrderFinancialPlan_({ lines: [
        { product_id: "P1", quantity: 1, sale_unit_price: 10 },
        { product_id: "P1", quantity: 2, sale_unit_price: 10 }
      ] });
    }, /повторяется в заказе/);
  });
  test("quantity must be a positive integer", function () {
    throws(function () {
      di3BuildOrderFinancialPlan_({ lines: [{ product_id: "P1", quantity: 1.5, sale_unit_price: 10 }] });
    }, /положительным целым числом/);
  });
  test("explicit zero price is allowed", function () {
    var plan = di3BuildOrderFinancialPlan_({ lines: [{ product_id: "P1", quantity: 1, sale_unit_price: 0 }] });
    equal(plan.goods_amount, 0);
    equal(plan.payable_total, 0);
  });
  test("commission and discount rates outside zero to one are rejected", function () {
    throws(function () {
      di3BuildOrderFinancialPlan_({ commission_enabled: true, commission_rate: 1.01,
        lines: [{ product_id: "P1", quantity: 1, sale_unit_price: 10 }] });
    }, /от 0% до 100%/);
  });
  test("unknown FIFO estimate remains unvalued, not zero", function () {
    var plan = di3BuildOrderFinancialPlan_({ lines: [{
      product_id: "P1", quantity: 3, sale_unit_price: 50,
      estimated_unit_cost: null, estimated_cost_status: "UNKNOWN"
    }] });
    equal(plan.estimated_fifo_cost_total, "");
    equal(plan.estimated_fifo_cost_status, "UNKNOWN");
    equal(plan.estimated_profit, "");
  });
  test("allowed order transitions follow the agreed workflow", function () {
    equal(DI3_ORDER_ALLOWED_TRANSITIONS[DI3_ORDER_STATUS.NEW].join("|"), "В пути|Отменен");
    equal(DI3_ORDER_ALLOWED_TRANSITIONS[DI3_ORDER_STATUS.IN_TRANSIT].join("|"), "Завершен|Возвращается");
    equal(DI3_ORDER_ALLOWED_TRANSITIONS[DI3_ORDER_STATUS.RETURNING].join("|"), "Возврат");
    equal(DI3_ORDER_ALLOWED_TRANSITIONS[DI3_ORDER_STATUS.COMPLETED].length, 0);
    equal(DI3_ORDER_ALLOWED_TRANSITIONS[DI3_ORDER_STATUS.RETURNED].length, 0);
    equal(DI3_ORDER_ALLOWED_TRANSITIONS[DI3_ORDER_STATUS.CANCELLED].length, 0);
  });

  test("order return selects dispatch allocations even when a later unrelated FIFO run exists", function () {
    // StockAllocations is a compact active projection. Incremental runs can
    // leave the original dispatch allocation tagged with an older run_id.
    var allocationRows = [
      ["ALLOC-A", "RUN-OLD-A", "DISPATCH-A", "LOT-A1", "PRODUCT-A", "CONSUME", 2, 10, "KNOWN", 20],
      ["ALLOC-A-EXTRA", "RUN-OLD-A", "DISPATCH-A", "LOT-A2", "PRODUCT-A", "CONSUME", 1, 12, "KNOWN", 12],
      ["ALLOC-B", "RUN-LATEST", "UNRELATED-DISPATCH-B", "LOT-B", "PRODUCT-B", "CONSUME", 5, 7, "KNOWN", 35],
      ["ALLOC-A-RESTORE", "RUN-LATEST", "DISPATCH-A", "LOT-A1", "PRODUCT-A", "RESTORE", 1, 10, "KNOWN", 10]
    ];
    var selected = di3SelectOrderDispatchConsumeAllocations_(allocationRows, ["DISPATCH-A"]);
    equal(selected.length, 2);
    equal(selected[0][1], "RUN-OLD-A");
    equal(selected[1][1], "RUN-OLD-A");
    equal(selected.every(function (row) { return String(row[2]) === "DISPATCH-A" && String(row[5]) === "CONSUME"; }), true);
    var itemAllocations = di3GetOrderItemReturnAllocations_(selected, {
      dispatch_movement_id: "DISPATCH-A", quantity: 3, product_label_snapshot: "Product A"
    });
    equal(itemAllocations.length, 2);
  });

  test("order return still rejects partial or inconsistent dispatch allocation quantity", function () {
    var allocationRows = [
      ["ALLOC-A", "RUN-OLD", "DISPATCH-A", "LOT-A", "PRODUCT-A", "CONSUME", 2, 10, "KNOWN", 20]
    ];
    var selected = di3SelectOrderDispatchConsumeAllocations_(allocationRows, ["DISPATCH-A"]);
    throws(function () {
      di3GetOrderItemReturnAllocations_(selected, {
        dispatch_movement_id: "DISPATCH-A", quantity: 3, product_label_snapshot: "Product A"
      });
    }, /FIFO-распределение позиции.*не совпадает/);
  });

  test("order return payload is built from original dispatch allocations after an unrelated later FIFO run", function () {
    var originalReadRows = di3ReadRowsByColumnValues_;
    var originalGetLatestRun = di3GetLatestFifoAllocationRun_;
    var originalGetSequence = di3GetNextMovementDisplayCodeSequence_;
    var originalMakeUuid = di3MakeUuid_;
    var latestRunLookups = 0;
    var uuidSequence = 0;
    var allocations = [
      ["ALLOC-A1", "RUN-OLD-A", "DISPATCH-A", "LOT-A1", "PRODUCT-A", "CONSUME", 2, 10, "KNOWN", 20, new Date("2026-01-01T00:00:00Z"), new Date("2026-01-01T00:00:00Z"), "", 2000],
      ["ALLOC-A2", "RUN-OLD-A", "DISPATCH-A", "LOT-A2", "PRODUCT-A", "CONSUME", 1, 12, "KNOWN", 12, new Date("2026-01-01T00:00:00Z"), new Date("2026-01-01T00:00:00Z"), "", 1200],
      ["ALLOC-B", "RUN-LATEST", "UNRELATED-DISPATCH-B", "LOT-B", "PRODUCT-B", "CONSUME", 5, 7, "KNOWN", 35, new Date("2026-01-02T00:00:00Z"), new Date("2026-01-02T00:00:00Z"), "", 3500],
      ["ALLOC-A-RESTORE", "RUN-LATEST", "DISPATCH-A", "LOT-A1", "PRODUCT-A", "RESTORE", 1, 10, "KNOWN", 10, new Date("2026-01-02T00:00:00Z"), new Date("2026-01-02T00:00:00Z"), "ALLOC-A1", 1000]
    ];
    var lotsById = {
      "LOT-A1": ["LOT-A1", "PRODUCT-A", "RECEIPT-A1", "SUPPLY_RECEIVE", "SUPPLY-A", "PACK-A", new Date("2025-12-01T00:00:00Z"), new Date("2025-12-01T00:00:00Z"), 10, 10, "KNOWN", "RUB", "", 8, 10000],
      "LOT-A2": ["LOT-A2", "PRODUCT-A", "RECEIPT-A2", "SUPPLY_RECEIVE", "SUPPLY-A", "PACK-A", new Date("2025-12-02T00:00:00Z"), new Date("2025-12-02T00:00:00Z"), 10, 12, "KNOWN", "RUB", "", 9, 12000]
    };
    try {
      di3ReadRowsByColumnValues_ = function (sheetName, columnIndex, values) {
        if (sheetName === "StockAllocations" && columnIndex === 2) {
          return allocations.filter(function (row) { return values.indexOf(String(row[2])) >= 0; })
            .map(function (row, index) { return { values: row, row_number: index + 2 }; });
        }
        if (sheetName === "StockLots" && columnIndex === 0) {
          return values.filter(function (lotId) { return !!lotsById[String(lotId)]; })
            .map(function (lotId, index) { return { values: lotsById[String(lotId)], row_number: index + 2 }; });
        }
        throw new Error("Unexpected test read: " + sheetName + "/" + columnIndex);
      };
      di3GetLatestFifoAllocationRun_ = function () {
        latestRunLookups++;
        return { run_id: "RUN-LATEST", run_sequence: 99 };
      };
      di3GetNextMovementDisplayCodeSequence_ = function () { return 100; };
      di3MakeUuid_ = function () { uuidSequence++; return "TEST-UUID-" + uuidSequence; };

      var payload = di3BuildOrderReturnPayload_({ order_id: "ORDER-A", order_number: "A-001" }, [{
        order_item_id: "ITEM-A", product_id: "PRODUCT-A", product_label_snapshot: "Product A",
        quantity: 3, dispatch_movement_id: "DISPATCH-A"
      }], new Date("2026-01-03T00:00:00Z"));

      equal(latestRunLookups, 0, "Return payload must not depend on the globally latest FIFO run");
      equal(payload.lines.length, 2);
      equal(payload.lines.reduce(function (sum, line) { return sum + line.quantity; }, 0), 3);
      equal(payload.source_fifo_run_id, "RUN-OLD-A");
      equal(payload.source_fifo_run_ids.join("|"), "RUN-OLD-A");
      equal(payload.lines[0].source_lot_id, "LOT-A1");
      equal(payload.lines[1].source_lot_id, "LOT-A2");
      equal(payload.lines.every(function (line) { return line.original_dispatch_movement_id === "DISPATCH-A"; }), true);
    } finally {
      di3ReadRowsByColumnValues_ = originalReadRows;
      di3GetLatestFifoAllocationRun_ = originalGetLatestRun;
      di3GetNextMovementDisplayCodeSequence_ = originalGetSequence;
      di3MakeUuid_ = originalMakeUuid;
    }
  });

  test("common platform surcharge rates 5, 9 and 10 percent are calculated on gross goods", function () {
    [5, 9, 10].forEach(function (rate) {
      var plan = di3BuildOrderFinancialPlan_({
        commission_enabled: true, commission_rate: rate / 100,
        lines: [{ product_id: "P" + rate, quantity: 1, sale_unit_price: 100 }]
      });
      equal(plan.commission_amount, rate);
      equal(plan.payable_total, 100 + rate);
      equal(plan.seller_revenue_estimate, 100);
      equal(plan.estimated_profit, "");
    });
  });

  test("platform surcharge increases buyer quote but is excluded from seller profit", function () {
    var plan = di3BuildOrderFinancialPlan_({
      commission_enabled: true, commission_rate: 0.09,
      discount_enabled: true, discount_rate: 0.05,
      lines: [{ product_id: "P1", quantity: 10, sale_unit_price: 100, estimated_unit_cost: 60 }]
    });
    equal(plan.goods_amount, 1000);
    equal(plan.commission_amount, 90);
    equal(plan.discount_amount, 50);
    equal(plan.payable_total, 1040);
    equal(plan.seller_revenue_estimate, 950);
    equal(plan.estimated_profit, 350);
  });
  test("historical sale request hash binds business date and both historical event timestamps", function () {
    var originalHash = di3BuildManualOperationPayloadHash_;
    var originalBusinessDate = di3FormatBusinessDate_;
    var originalToDate = di3ToDate_;
    try {
      di3BuildManualOperationPayloadHash_ = function (value) { return JSON.stringify(value); };
      di3FormatBusinessDate_ = function (value) { return String(value); };
      di3ToDate_ = function (value) { return value instanceof Date ? value : new Date(value); };
      var base = {
        request_token: "HIST-1", business_date: "2026-01-02", historical_mode: true,
        historical_dispatched_at: "2026-01-02T12:00:00.000Z",
        historical_completed_at: "2026-01-03T09:00:00.000Z",
        lines: [{ product_id: "P1", quantity: 1, sale_unit_price: 100 }]
      };
      var original = di3BuildOrderRequestHash_(base);
      var changedBusinessDate = Object.assign({}, base, { business_date: "2026-01-01" });
      var changedDispatch = Object.assign({}, base, { historical_dispatched_at: "2026-01-02T12:01:00.000Z" });
      var changedCompletion = Object.assign({}, base, { historical_completed_at: "2026-01-03T09:01:00.000Z" });
      equal(di3BuildOrderRequestHash_(changedBusinessDate) === original, false);
      equal(di3BuildOrderRequestHash_(changedDispatch) === original, false);
      equal(di3BuildOrderRequestHash_(changedCompletion) === original, false);
      equal(di3BuildOrderRequestHash_(base), original);
    } finally {
      di3BuildManualOperationPayloadHash_ = originalHash;
      di3FormatBusinessDate_ = originalBusinessDate;
      di3ToDate_ = originalToDate;
    }
  });

  test("historical mode bypasses only the created_at lower bound for dispatch", function () {
    var originalMillis = di3ToMillis_;
    var originalItems = di3GetOrderItems_;
    var eventAt = new Date("2026-01-02T10:00:00.000Z");
    var order = { order_id: "HIST-ORDER", order_number: "H-1", status: DI3_ORDER_STATUS.NEW,
      created_at: new Date("2026-01-03T10:00:00.000Z") };
    try {
      di3ToMillis_ = function (value) { return new Date(value).getTime(); };
      di3GetOrderItems_ = function () { return []; };
      throws(function () { di3DispatchOrder_(order, eventAt); }, /раньше создания заказа/);
      throws(function () { di3DispatchOrder_(order, eventAt, { allowHistoricalBackdate: true }); }, /нет товарных позиций/);
    } finally {
      di3ToMillis_ = originalMillis;
      di3GetOrderItems_ = originalItems;
    }
  });

  test("prepared dispatch retry rejects a changed immutable timestamp", function () {
    var originals = {
      millis: di3ToMillis_, items: di3GetOrderItems_,
      pending: typeof di3AssertNoOtherPendingStockOperations_ === "function" ? di3AssertNoOtherPendingStockOperations_ : null,
      getOperation: di3GetOrderOperationByKey_,
      readPayload: di3ReadVerifiedOperationPayload_, complete: di3CompleteOrderDispatch_
    };
    var savedAt = "2026-01-02T10:00:00.000Z";
    var order = { order_id: "RETRY-ORDER", order_number: "R-1", status: DI3_ORDER_STATUS.NEW,
      created_at: new Date("2026-01-01T10:00:00.000Z") };
    try {
      di3ToMillis_ = function (value) { return new Date(value).getTime(); };
      di3GetOrderItems_ = function () { return [{ order_item_id: "I1", product_id: "P1", quantity: 1 }]; };
      di3AssertNoOtherPendingStockOperations_ = function () { return true; };
      di3GetOrderOperationByKey_ = function () { return { values: ["OP-1", "KEY", "ORDER_DISPATCH", "ORDER", "RETRY-ORDER", "PREPARED"] }; };
      di3ReadVerifiedOperationPayload_ = function () { return { dispatched_at: savedAt, historical_mode: false }; };
      di3CompleteOrderDispatch_ = function () { return { status: "COMMITTED" }; };
      throws(function () { di3DispatchOrder_(order, new Date("2026-01-02T10:01:00.000Z")); }, /другим временем/);
    } finally {
      di3ToMillis_ = originals.millis;
      di3GetOrderItems_ = originals.items;
      di3AssertNoOtherPendingStockOperations_ = originals.pending;
      di3GetOrderOperationByKey_ = originals.getOperation;
      di3ReadVerifiedOperationPayload_ = originals.readPayload;
      di3CompleteOrderDispatch_ = originals.complete;
    }
  });

  var report = { passed: passed, failed: failures.length, failures: failures };
  if (failures.length) throw new Error("Order-domain tests failed: " + JSON.stringify(failures));
  return report;
}
