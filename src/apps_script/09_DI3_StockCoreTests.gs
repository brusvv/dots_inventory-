/** Pure unit tests for FIFO, valuation, pricing and movement conventions. */
function di3RunStockCoreUnitTests() {
  var passed = 0;
  var failures = [];
  function test(name, callback) {
    try { callback(); passed++; }
    catch (error) { failures.push({ name: name, error: error.message || String(error) }); }
  }
  function equal(actual, expected, message) {
    if (actual !== expected) throw new Error((message || "Values differ") + ": expected " + expected + ", got " + actual);
  }
  function near(actual, expected, epsilon, message) {
    if (Math.abs(actual - expected) > (epsilon || 1e-8)) throw new Error((message || "Values differ") + ": expected " + expected + ", got " + actual);
  }
  var rowLedgerSequence = 0;
  function rowLedger(id, productId, delta, date, recorded) {
    rowLedgerSequence++;
    return [id, "op-" + id, "event-" + id, productId, "TEST", id, delta, new Date(date), new Date(recorded || date), "", "", "", rowLedgerSequence];
  }
  function rowDetail(id, type, reason) {
    return [id, "MOV-000001", type, reason || "TEST", "", "", "", "", "", "", "TESTS"];
  }
  function rowLot(id, productId, movementId, quantity, unitCost, costStatus, date, recorded) {
    return [id, productId, movementId, "TEST", "TEST", "", new Date(date), new Date(recorded || date), quantity,
      unitCost == null ? "" : unitCost, costStatus, "RUB", "", ""];
  }

  test("FIFO consumes the oldest lot first and splits across lots", function () {
    var ledger = [
      rowLedger("in1", "p1", 100, "2026-11-10T09:00:00Z"),
      rowLedger("in2", "p1", 50, "2026-11-15T09:00:00Z"),
      rowLedger("in3", "p1", 80, "2026-11-20T09:00:00Z"),
      rowLedger("out1", "p1", -120, "2026-11-21T09:00:00Z")
    ];
    var details = [rowDetail("in1", "IN"), rowDetail("in2", "IN"), rowDetail("in3", "IN"), rowDetail("out1", "OUT")];
    var lots = [rowLot("l1", "p1", "in1", 100, 40, "KNOWN", "2026-11-10T09:00:00Z"),
      rowLot("l2", "p1", "in2", 50, 50, "KNOWN", "2026-11-15T09:00:00Z"),
      rowLot("l3", "p1", "in3", 80, 45, "KNOWN", "2026-11-20T09:00:00Z")];
    var plan = di3BuildFifoReplayPlan_(ledger, details, lots, null);
    equal(plan.allocations.length, 2);
    equal(plan.allocations[0].lot_id, "l1");
    equal(plan.allocations[0].quantity, 100);
    equal(plan.allocations[1].lot_id, "l2");
    equal(plan.allocations[1].quantity, 20);
    near(plan.movement_costs.out1.total_cost, 5000);
  });

  test("FIFO keeps the unconsumed part of each layer", function () {
    var ledger = [rowLedger("in1", "p1", 10, "2026-01-01"), rowLedger("out1", "p1", -4, "2026-01-02")];
    var details = [rowDetail("in1", "IN"), rowDetail("out1", "OUT")];
    var lots = [rowLot("l1", "p1", "in1", 10, 12, "KNOWN", "2026-01-01")];
    var plan = di3BuildFifoReplayPlan_(ledger, details, lots, null);
    equal(plan.remaining_lots[0].remaining_quantity, 6);
  });

  test("free inventory is valued at zero and included in known weighted average", function () {
    var lots = [
      rowLot("l1", "p1", "in1", 10, 10, "KNOWN", "2026-01-01"),
      rowLot("l2", "p1", "in2", 10, 0, "FREE", "2026-01-02")
    ];
    var value = di3BuildProductValuation_("p1", lots, []);
    equal(value.total_quantity, 20);
    near(value.average_unit_cost, 5);
    near(value.inventory_value, 100);
  });

  test("unknown-cost stock is not silently valued at zero", function () {
    var lots = [rowLot("l1", "p1", "in1", 7, null, "UNKNOWN", "2026-01-01")];
    var value = di3BuildProductValuation_("p1", lots, []);
    equal(value.unknown_quantity, 7);
    equal(value.inventory_value, null);
    equal(value.average_unit_cost, null);
    equal(value.valuation_status, "UNVALUED");
  });

  test("partial valuation exposes known portion but withholds total average", function () {
    var lots = [
      rowLot("l1", "p1", "in1", 5, 20, "KNOWN", "2026-01-01"),
      rowLot("l2", "p1", "in2", 5, null, "UNKNOWN", "2026-01-02")
    ];
    var value = di3BuildProductValuation_("p1", lots, []);
    equal(value.valuation_status, "PARTIAL");
    near(value.average_known_unit_cost, 20);
    equal(value.average_unit_cost, null);
    equal(value.cost_coverage_pct, 50);
  });

  test("remaining-stock weighted average is based on remaining FIFO layers", function () {
    var lots = [
      rowLot("l1", "p1", "in1", 30, 40, "KNOWN", "2026-01-01"),
      rowLot("l2", "p1", "in2", 50, 50, "KNOWN", "2026-01-02"),
      rowLot("l3", "p1", "in3", 20, 60, "KNOWN", "2026-01-03")
    ];
    var allocations = [["a1", "run", "out", "l1", "p1", "CONSUME", 30, 40, "KNOWN", 1200, new Date(), new Date(), ""]];
    var value = di3BuildProductValuation_("p1", lots, allocations);
    equal(value.total_quantity, 70);
    near(value.average_unit_cost, (2500 + 1200) / 70);
    near(value.inventory_value, 3700);
  });

  test("valuation exposes next FIFO layer cost separately from the remaining-stock average", function () {
    var lots = [
      rowLot("l1", "p1", "in1", 30, 40, "KNOWN", "2026-01-01"),
      rowLot("l2", "p1", "in2", 50, 50, "KNOWN", "2026-01-02")
    ];
    var allocations = [["a1", "run", "out", "l1", "p1", "CONSUME", 20, 40, "KNOWN", 800, new Date(), new Date(), ""]];
    var value = di3BuildProductValuation_("p1", lots, allocations);
    equal(value.total_quantity, 60);
    near(value.average_unit_cost, (10 * 40 + 50 * 50) / 60);
    near(value.next_fifo_unit_cost, 40);
    equal(value.next_fifo_cost_status, "KNOWN");
    equal(value.next_fifo_lot_id, "l1");
  });

  test("remaining_quantity cache mismatch is detected rather than silently trusted", function () {
    var lots = [rowLot("l1", "p1", "in1", 10, 10, "KNOWN", "2026-01-01")];
    lots[0][13] = 9;
    var threw = false;
    try { di3BuildProductValuation_("p1", lots, []); } catch (error) { threw = /remaining_quantity/.test(error.message); }
    equal(threw, true);
  });

  test("a backdated receipt causes a full replay and can become the oldest consumed layer", function () {
    var ledger = [
      rowLedger("in-later", "p1", 10, "2026-01-12T09:00:00Z", "2026-01-12T10:00:00Z"),
      rowLedger("out", "p1", -5, "2026-01-13T09:00:00Z", "2026-01-13T10:00:00Z"),
      rowLedger("in-backdated", "p1", 10, "2026-01-11T09:00:00Z", "2026-01-14T10:00:00Z")
    ];
    var details = [rowDetail("in-later", "IN"), rowDetail("out", "OUT"), rowDetail("in-backdated", "IN")];
    var lots = [
      rowLot("later-lot", "p1", "in-later", 10, 100, "KNOWN", "2026-01-12T09:00:00Z", "2026-01-12T10:00:00Z"),
      rowLot("backdated-lot", "p1", "in-backdated", 10, 50, "KNOWN", "2026-01-11T09:00:00Z", "2026-01-14T10:00:00Z")
    ];
    var plan = di3BuildFifoReplayPlan_(ledger, details, lots, null);
    equal(plan.allocations[0].movement_id, "out");
    equal(plan.allocations[0].lot_id, "backdated-lot");
    near(plan.movement_costs.out.total_cost, 250);
  });

  test("expense before stock was received is rejected", function () {
    var ledger = [rowLedger("out", "p1", -1, "2026-01-01"), rowLedger("in", "p1", 5, "2026-01-02")];
    var details = [rowDetail("out", "OUT"), rowDetail("in", "IN")];
    var lots = [rowLot("l1", "p1", "in", 5, 10, "KNOWN", "2026-01-02")];
    var threw = false;
    try { di3BuildFifoReplayPlan_(ledger, details, lots, null); } catch (error) { threw = /Недостаточно остатка/.test(error.message); }
    equal(threw, true);
  });

  test("incremental FIFO tail matches full replay for allocations, cost and remaining layers", function () {
    var ledger = [
      rowLedger("in1", "p1", 10, "2026-01-01T09:00:00Z"),
      rowLedger("out1", "p1", -4, "2026-01-02T09:00:00Z"),
      rowLedger("in2", "p1", 5, "2026-01-03T09:00:00Z"),
      rowLedger("out2", "p1", -7, "2026-01-04T09:00:00Z")
    ];
    var details = [
      rowDetail("in1", "IN"), rowDetail("out1", "OUT"),
      rowDetail("in2", "IN"), rowDetail("out2", "OUT")
    ];
    var lot1 = rowLot("l1", "p1", "in1", 10, 1, "KNOWN", "2026-01-01T09:00:00Z");
    lot1[13] = 6;
    lot1[14] = 1000;
    var lot2 = rowLot("l2", "p1", "in2", 5, 5, "KNOWN", "2026-01-03T09:00:00Z");
    lot2[13] = "";
    lot2[14] = 2500;
    var state = [["p1", new Date("2026-01-02T09:00:00Z"), new Date("2026-01-02T09:00:00Z"),
      "out1", ledger[1][12], 2, 6, new Date("2026-01-02T09:01:00Z")]];
    var tailIn = ledger[2].slice();
    var tailOut = ledger[3].slice();
    tailIn._di3RowNumber = 4;
    tailOut._di3RowNumber = 5;
    var tailDetails = [details[2], details[3]];
    var tailPlan = di3BuildFifoTailPlanForProduct_("p1", [tailIn, tailOut], tailDetails,
      [lot1, lot2], [], state);
    equal(tailPlan.mode, "INCREMENTAL_TAIL");

    var full = di3BuildFifoReplayPlan_(ledger, details, [lot1, lot2], null);
    var fullOut = full.allocations.filter(function (item) { return item.movement_id === "out2"; });
    var tailOutAllocations = tailPlan.allocations.filter(function (item) { return item.movement_id === "out2"; });
    equal(tailOutAllocations.length, fullOut.length);
    tailOutAllocations.forEach(function (item, index) {
      equal(item.lot_id, fullOut[index].lot_id);
      equal(item.quantity, fullOut[index].quantity);
      equal(item.allocated_cost_minor, fullOut[index].allocated_cost_minor);
    });
    equal(tailPlan.movement_costs.out2.total_cost_minor, full.movement_costs.out2.total_cost_minor);
    full.remaining_lots.forEach(function (lot) {
      equal(tailPlan.remaining_by_lot[lot.lot_id], lot.remaining_quantity);
    });
  });

  test("backdated tail requests product replay and full replay recalculates the original allocation", function () {
    var ledger = [
      rowLedger("in1", "p1", 10, "2026-01-02T09:00:00Z", "2026-01-02T10:00:00Z"),
      rowLedger("out1", "p1", -5, "2026-01-03T09:00:00Z", "2026-01-03T10:00:00Z")
    ];
    var details = [rowDetail("in1", "IN"), rowDetail("out1", "OUT")];
    var lot1 = rowLot("l1", "p1", "in1", 10, 10, "KNOWN",
      "2026-01-02T09:00:00Z", "2026-01-02T10:00:00Z");
    lot1[13] = 5;
    lot1[14] = 10000;
    var backdatedLedger = rowLedger("in-backdated", "p1", 10,
      "2026-01-01T09:00:00Z", "2026-01-04T10:00:00Z");
    backdatedLedger._di3RowNumber = 4;
    var backdatedDetail = rowDetail("in-backdated", "IN");
    var backdatedLot = rowLot("l-backdated", "p1", "in-backdated", 10, 5, "KNOWN",
      "2026-01-01T09:00:00Z", "2026-01-04T10:00:00Z");
    backdatedLot[13] = "";
    backdatedLot[14] = 5000;
    var state = [["p1", new Date("2026-01-03T09:00:00Z"), new Date("2026-01-03T10:00:00Z"),
      "out1", ledger[1][12], 2, 5, new Date("2026-01-03T10:01:00Z")]];
    var tailPlan = di3BuildFifoTailPlanForProduct_("p1", [backdatedLedger],
      [backdatedDetail], [lot1, backdatedLot], [], state);
    equal(tailPlan.mode, "PRODUCT_REPLAY_REQUIRED");
    equal(tailPlan.reason, "BACKDATED_EVENT");

    var full = di3BuildFifoReplayPlan_(ledger.concat([backdatedLedger]),
      details.concat([backdatedDetail]), [lot1, backdatedLot], null);
    equal(full.allocations.length, 1);
    equal(full.allocations[0].movement_id, "out1");
    equal(full.allocations[0].lot_id, "l-backdated");
    equal(full.allocations[0].quantity, 5);
  });

  test("partially applied OUT movement is routed to product replay, not incrementally duplicated", function () {
    var ledger = [rowLedger("out2", "p1", -2, "2026-01-04T09:00:00Z")];
    var detail = [rowDetail("out2", "OUT")];
    var lot = rowLot("l1", "p1", "in1", 10, 10, "KNOWN", "2026-01-01T09:00:00Z");
    lot[13] = 8;
    lot[14] = 10000;
    var state = [["p1", new Date("2026-01-03T09:00:00Z"), new Date("2026-01-03T10:00:00Z"),
      "out1", ledger[0][12] - 1, 2, 8, new Date("2026-01-03T10:01:00Z")]];
    var existingPartialAllocation = [["allocation-1", "run-old", "out2", "l1", "p1",
      "CONSUME", 1, 10, "KNOWN", 10, new Date("2026-01-04T09:00:00Z"),
      new Date("2026-01-04T09:00:00Z"), "", 1000]];
    var plan = di3BuildFifoTailPlanForProduct_("p1", ledger, detail, [lot],
      existingPartialAllocation, state);
    equal(plan.mode, "PRODUCT_REPLAY_REQUIRED");
    equal(plan.reason, "PARTIALLY_APPLIED_MOVEMENT");
  });

  test("UNKNOWN and FREE lots retain distinct cost semantics through replay", function () {
    var ledger = [
      rowLedger("in-unknown", "p1", 2, "2026-01-01T09:00:00Z"),
      rowLedger("in-free", "p1", 3, "2026-01-02T09:00:00Z"),
      rowLedger("out", "p1", -4, "2026-01-03T09:00:00Z")
    ];
    var details = [rowDetail("in-unknown", "IN"), rowDetail("in-free", "IN"), rowDetail("out", "OUT")];
    var unknownLot = rowLot("l-unknown", "p1", "in-unknown", 2, null, "UNKNOWN", "2026-01-01T09:00:00Z");
    var freeLot = rowLot("l-free", "p1", "in-free", 3, 0, "FREE", "2026-01-02T09:00:00Z");
    freeLot[14] = 0;
    var plan = di3BuildFifoReplayPlan_(ledger, details, [unknownLot, freeLot], null);
    equal(plan.allocations.length, 2);
    equal(plan.allocations[0].lot_id, "l-unknown");
    equal(plan.allocations[0].cost_status, "UNKNOWN");
    equal(plan.allocations[0].allocated_cost_minor, null);
    equal(plan.allocations[1].lot_id, "l-free");
    equal(plan.allocations[1].cost_status, "FREE");
    equal(plan.allocations[1].unit_cost, 0);
    equal(plan.allocations[1].allocated_cost_minor, 0);
    equal(plan.movement_costs.out.cost_status, "PARTIAL");
    equal(plan.movement_costs.out.unknown_quantity, 2);
    equal(plan.movement_costs.out.known_cost_minor, 0);
  });

  test("same-time FIFO tie-break is deterministic by movement ID", function () {
    var sameEffective = "2026-01-01T09:00:00Z";
    var sameRecorded = "2026-01-01T10:00:00Z";
    var inboundFirst = [
      rowLedger("a-in", "p1", 2, sameEffective, sameRecorded),
      rowLedger("z-out", "p1", -1, sameEffective, sameRecorded)
    ];
    var valid = di3BuildFifoReplayPlan_(inboundFirst,
      [rowDetail("a-in", "IN"), rowDetail("z-out", "OUT")],
      [rowLot("l1", "p1", "a-in", 2, 10, "KNOWN", sameEffective, sameRecorded)], null);
    equal(valid.allocations.length, 1);
    equal(valid.allocations[0].lot_id, "l1");

    var outboundFirst = [
      rowLedger("a-out", "p1", -1, sameEffective, sameRecorded),
      rowLedger("z-in", "p1", 2, sameEffective, sameRecorded)
    ];
    var threw = false;
    try {
      di3BuildFifoReplayPlan_(outboundFirst,
        [rowDetail("a-out", "OUT"), rowDetail("z-in", "IN")],
        [rowLot("l2", "p1", "z-in", 2, 10, "KNOWN", sameEffective, sameRecorded)], null);
    } catch (error) { threw = /Недостаточно остатка/.test(error.message); }
    equal(threw, true);
  });

  test("FifoProductState stores the maximum ledger sequence independently of business event order", function () {
    var ledger = [
      ["backdated", "op", "event", "p1", "TEST", "doc", 1, new Date("2026-01-01"), new Date("2026-01-10"), "", "", "", 18],
      ["later", "op", "event", "p1", "TEST", "doc", 1, new Date("2026-01-05"), new Date("2026-01-06"), "", "", "", 11]
    ];
    var state = di3BuildFifoProductStateRows_(["p1"], ledger, []);
    equal(state[0][3], "later", "Business watermark remains based on effective/recorded event order");
    equal(state[0][4], 18, "Sequence watermark is the maximum ingested sequence");
  });

  test("incremental product state advances sequence watermark without changing business event watermark", function () {
    var previous = ["p1", new Date("2026-01-05"), new Date("2026-01-06"), "latest-business-event", 18, 4, 7, new Date()];
    var backdated = ["backdated-new", "op", "event", "p1", "TEST", "doc", 1,
      new Date("2026-01-01"), new Date("2026-01-11"), "", "", "", 23];
    var state = di3BuildIncrementalFifoProductStateRow_("p1", [backdated], [], previous);
    equal(state[3], "latest-business-event");
    equal(state[4], 23);
    equal(state[5], 5);
  });

  test("ledger sequence tail reader finds appended events after physical row reordering", function () {
    var originalGetSheet = di3GetSheetOrThrow_;
    var fullReads = [];
    var rows = [
      ["m5", "op", "e5", "p1", "T", "d", 1, new Date("2026-01-01"), new Date("2026-01-01"), "", "", "", 5],
      ["m2", "op", "e2", "p1", "T", "d", 1, new Date("2026-01-02"), new Date("2026-01-02"), "", "", "", 2],
      ["m7", "op", "e7", "p1", "T", "d", 1, new Date("2026-01-03"), new Date("2026-01-03"), "", "", "", 7]
    ];
    var sheet = {
      getLastRow: function () { return 4; },
      getRange: function (row, column, count, width) {
        if (width === 1 && column === 1) return { getValues: function () { return rows.slice(row - 2, row - 2 + count).map(function (x) { return [x[0]]; }); } };
        if (width === 1 && column === 13) return { getValues: function () { return rows.slice(row - 2, row - 2 + count).map(function (x) { return [x[12]]; }); } };
        fullReads.push({ row: row, count: count });
        return { getValues: function () { return rows.slice(row - 2, row - 2 + count).map(function (x) { return x.slice(); }); } };
      }
    };
    try {
      di3GetSheetOrThrow_ = function (name) { equal(name, "StockLedger"); return sheet; };
      var index = di3ReadLedgerSequenceIndex_();
      equal(index.max_sequence, 7);
      var tail = di3ReadFifoLedgerTail_(4, index);
      equal(tail.length, 2);
      equal(tail[0][0], "m5");
      equal(tail[1][0], "m7");
      equal(tail[0]._di3RowNumber, 2);
      equal(tail[1]._di3RowNumber, 4);
      equal(fullReads.length, 2, "Non-contiguous tail rows should be fetched as two narrow ranges");
    } finally { di3GetSheetOrThrow_ = originalGetSheet; }
  });

  test("ledger sequence index rejects missing and duplicate populated values", function () {
    var originalGetSheet = di3GetSheetOrThrow_;
    function fakeSheet(ids, seqs) {
      return {
        getLastRow: function () { return ids.length + 1; },
        getRange: function (row, column, count) {
          var values = column === 1 ? ids : seqs;
          return { getValues: function () { return values.slice(row - 2, row - 2 + count).map(function (x) { return [x]; }); } };
        }
      };
    }
    try {
      di3GetSheetOrThrow_ = function () { return fakeSheet(["m1", "m2"], [1, 1]); };
      var duplicateThrew = false;
      try { di3ReadLedgerSequenceIndex_(); } catch (error) { duplicateThrew = /повторяется ledger_sequence/.test(error.message); }
      equal(duplicateThrew, true);
      di3GetSheetOrThrow_ = function () { return fakeSheet(["m1", "m2"], [1, ""]); };
      var missingThrew = false;
      try { di3ReadLedgerSequenceIndex_(); } catch (error) { missingThrew = /отсутствует ledger_sequence/.test(error.message); }
      equal(missingThrew, true);
    } finally { di3GetSheetOrThrow_ = originalGetSheet; }
  });

  test("offline sale revenue is separate from FIFO cost", function () {
    var suggestion = di3CalculatePriceSuggestion_(49, 100, 0.30, false, 10);
    equal(suggestion.status, "READY");
    near(suggestion.minimum_sale_price, 70);
    near(suggestion.maximum_discount_per_unit, 30);
    near(suggestion.current_gross_margin, 0.51);
  });

  test("price discount suggestion is blocked when cost coverage is incomplete", function () {
    var suggestion = di3CalculatePriceSuggestion_(25, 100, 0.30, true, 10);
    equal(suggestion.status, "INCOMPLETE_COST_COVERAGE");
  });

  test("display product code does not reveal the full UUID", function () {
    var code = di3GetShortProductCode_("50f4cef3-3dbc-460d-9c83-0d6f2dc5f8df");
    equal(code, "PRD-50F4CEF3");
    equal(code.indexOf("50f4cef3-3dbc-460d-9c83-0d6f2dc5f8df") === -1, true);
  });

  test("manual movement reason lists are separate for income and expense", function () {
    equal(Object.prototype.hasOwnProperty.call(DI3_STOCK_REASON_LABELS.IN, "OLD_STOCK_NO_DOC"), true);
    equal(Object.prototype.hasOwnProperty.call(DI3_STOCK_REASON_LABELS.OUT, "TESTING"), true);
    equal(Object.prototype.hasOwnProperty.call(DI3_STOCK_REASON_LABELS.IN, "TESTING"), false);
  });

  test("free goods must use the FREE cost state", function () {
    var threw = false;
    try {
      var cost = di3ValidateInboundCost_("Известна", 0);
      di3ValidateStockReason_("IN", "FREE_GOODS", "");
      if (cost.cost_status !== "FREE") throw new Error("Wrong free state");
    } catch (error) { threw = true; }
    equal(threw, true);
  });

  var report = { passed: passed, failed: failures.length, failures: failures };
  if (failures.length) throw new Error("Stock Core tests failed: " + JSON.stringify(failures));
  return report;
}
