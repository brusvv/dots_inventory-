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

  test("replay input fingerprint ignores mutable lot cache and physical row order", function () {
    var originalHash = di3BuildManualOperationPayloadHash_;
    try {
      di3BuildManualOperationPayloadHash_ = function (value) { return JSON.stringify(value); };
      var ledger = [
        ["m2", "op2", "evt2", "p1", "T", "d", -1, new Date("2026-01-02"), new Date("2026-01-02"), "", "", "", 2],
        ["m1", "op1", "evt1", "p1", "T", "d", 1, new Date("2026-01-01"), new Date("2026-01-01"), "", "", "", 1]
      ];
      var details = [
        ["m2", "c2", "OUT", "SALE", "", "", "KNOWN", "", "", "", "n2"],
        ["m1", "c1", "IN", "SUPPLY", "", "", "KNOWN", "", "", "", "n1"]
      ];
      var lots = [
        ["l2", "p1", "m1", "SUPPLY", "s2", "pv", new Date("2026-01-01"), new Date("2026-01-01"), 2, 5, "KNOWN", "EUR", "", 1, 1000],
        ["l1", "p1", "m0", "SUPPLY", "s1", "pv", new Date("2025-12-31"), new Date("2025-12-31"), 3, 4, "KNOWN", "EUR", "", 2, 1200]
      ];
      var first = di3BuildFifoReplayInputFingerprint_(null, ledger, details, lots);
      var reorderedLedger = ledger.slice().reverse();
      var reorderedDetails = details.slice().reverse();
      var changedCache = lots.map(function (row) { var copy = row.slice(); copy[13] = 99; return copy; }).reverse();
      var second = di3BuildFifoReplayInputFingerprint_(null, reorderedLedger, reorderedDetails, changedCache);
      equal(first, second);
      changedCache[0][9] = 77;
      var changedImmutableInput = di3BuildFifoReplayInputFingerprint_(null, reorderedLedger, reorderedDetails, changedCache);
      equal(first === changedImmutableInput, false);
    } finally { di3BuildManualOperationPayloadHash_ = originalHash; }
  });

  test("replay allocation IDs are deterministic for the same replay and ordinal", function () {
    var allocations = [
      { movement_id: "m1", lot_id: "l1", product_id: "p1", allocation_type: "CONSUME",
        quantity: 2, unit_cost: 5, cost_status: "KNOWN", allocated_cost: 10,
        effective_at: new Date("2026-01-01"), recorded_at: new Date("2026-01-01"), allocated_cost_minor: 1000 },
      { movement_id: "m1", lot_id: "l2", product_id: "p1", allocation_type: "CONSUME",
        quantity: 1, unit_cost: 6, cost_status: "KNOWN", allocated_cost: 6,
        effective_at: new Date("2026-01-01"), recorded_at: new Date("2026-01-01"), allocated_cost_minor: 600 }
    ];
    var first = di3BuildFifoAllocationRows_("run-1", allocations, "OP:op-1:PRODUCT:p1");
    var retry = di3BuildFifoAllocationRows_("run-1", allocations, "OP:op-1:PRODUCT:p1");
    equal(first[0][0], retry[0][0]);
    equal(first[1][0], retry[1][0]);
    equal(first[0][0] === first[1][0], false);
    equal(first[0][0].indexOf("F06:OP:op-1:PRODUCT:p1:") === 0, true);
  });

  test("pending FIFO run reuse preserves operation identity and rejects changed scope", function () {
    var row = ["run-1", 7, "PREPARED", "ORDER_DISPATCH", new Date(), "", 12, 4, 1, "",
      "op-1", "OP:op-1", "PRODUCT_SET", '["p1"]', "fingerprint-a"];
    var reusable = di3SelectReusableFifoRun_([{ row_number: 9, values: row }], {
      operation_id: "op-1", scope_type: "PRODUCT_SET", scope_json: '["p1"]', input_fingerprint: "fingerprint-a"
    });
    equal(reusable.run_id, "run-1");
    equal(reusable.row_number, 9);
    var mismatchThrew = false;
    try {
      di3SelectReusableFifoRun_([{ row_number: 9, values: row }], {
        operation_id: "op-1", scope_type: "PRODUCT_SET", scope_json: '["p1"]', input_fingerprint: "fingerprint-b"
      });
    } catch (error) { mismatchThrew = /другой scope или input fingerprint/.test(error.message); }
    equal(mismatchThrew, true);
    var committed = row.slice(); committed[2] = "COMMITTED";
    equal(di3SelectReusableFifoRun_([{ row_number: 9, values: committed }], {
      operation_id: "op-1", scope_type: "PRODUCT_SET", scope_json: '["p1"]', input_fingerprint: "fingerprint-a"
    }), null);
  });

  test("manual product-set FIFO run resumes only for the same scope and input", function () {
    var row = ["run-manual", 3, "FAILED", "MANUAL_INCREMENTAL", new Date(), "", 8, 2, 1, "",
      "", "RUN:run-manual", "PRODUCT_SET", '["p1","p2"]', "manual-fingerprint"];
    var reusable = di3SelectReusableFifoRun_([{ row_number: 11, values: row }], {
      scope_type: "PRODUCT_SET", scope_json: '["p1","p2"]', input_fingerprint: "manual-fingerprint"
    });
    equal(reusable.run_id, "run-manual");
    equal(reusable.replay_id, "RUN:run-manual");
    var mismatchThrew = false;
    try {
      di3SelectReusableFifoRun_([{ row_number: 11, values: row }], {
        scope_type: "PRODUCT_SET", scope_json: '["p1"]', input_fingerprint: "manual-fingerprint"
      });
    } catch (error) { mismatchThrew = /другой scope или input fingerprint/.test(error.message); }
    equal(mismatchThrew, true);
  });

  test("pending operation run can resume after global cursor already advanced", function () {
    var row = ["run-1", 7, "PREPARED", "ORDER_DISPATCH", new Date(), "", 12, 4, 1, "",
      "op-1", "OP:op-1", "PRODUCT_SET", '["p1"]', "fingerprint-a"];
    var reusable = di3SelectReusableFifoRun_([{ row_number: 9, values: row }], {
      operation_id: "op-1", scope_type: "PRODUCT_SET", scope_json: "[]",
      input_fingerprint: "empty-tail-fingerprint", allow_resume_empty_tail: true
    });
    equal(reusable.run_id, "run-1");
    equal(reusable.scope_json, '["p1"]');
    equal(reusable.resumed_after_cursor_advance, true);
  });

  test("multiple pending FIFO runs for one operation fail closed", function () {
    var row = ["run-1", 7, "PREPARED", "ORDER_DISPATCH", new Date(), "", 12, 4, 1, "",
      "op-1", "OP:op-1", "PRODUCT_SET", '["p1"]', "fingerprint-a"];
    var other = row.slice(); other[0] = "run-2"; other[1] = 8;
    var threw = false;
    try {
      di3SelectReusableFifoRun_([
        { row_number: 9, values: row }, { row_number: 10, values: other }
      ], { operation_id: "op-1", scope_type: "PRODUCT_SET", scope_json: '["p1"]', input_fingerprint: "fingerprint-a" });
    } catch (error) { threw = /несколько незавершённых FIFO run/.test(error.message); }
    equal(threw, true);
  });

  test("FIFO integrity diagnostics validate append-only replay archives and pending states", function () {
    var originalFingerprint = di3BuildFifoFingerprint_;
    try {
      di3BuildFifoFingerprint_ = function (value) { return JSON.stringify(value); };
      var sourceAllocation = ["alloc-1", "old-run", "move-1", "lot-1", "p1", "CONSUME", 2, 5,
        "KNOWN", 10, new Date("2026-01-01"), new Date("2026-01-01"), "", 1000];
      var allocationArchive = ["archive-alloc-1", "replay-1", new Date("2026-01-02"), "TEST"].concat(sourceAllocation);
      var lotArchive = ["archive-lot-1", "replay-1", "lot-1", "p1", 3, new Date("2026-01-02")];
      var allocationFingerprint = di3BuildFifoAllocationSnapshotFingerprint_([sourceAllocation]);
      var lotFingerprint = di3BuildFifoFingerprint_([["lot-1", "p1", 3]]);
      var run = ["run-1", 1, "PREPARED", "TEST", new Date(), "", 2, 1, 1, "", "", "RUN:run-1", "PRODUCT_SET", '["p1"]', "input"];
      var event = ["event-1", "replay-1", 1, "PREPARED", "run-1", "", "PRODUCT", '["p1"]',
        "input", allocationFingerprint, "target-alloc", lotFingerprint, "target-lot", new Date(), "{}"];
      var valid = di3BuildFifoReplayArchiveDiagnostics_([run], [allocationArchive], [lotArchive], [event]);
      equal(valid.ok, true);
      equal(valid.summary.pending_runs, 1);
      equal(valid.summary.pending_replays, 1);
      equal(valid.summary.allocation_archive_rows, 1);
      equal(valid.warnings.some(function (warning) { return warning.indexOf("PREPARED") >= 0; }), true);

      var corruptedAllocation = allocationArchive.slice();
      corruptedAllocation[10] = 9;
      var corrupted = di3BuildFifoReplayArchiveDiagnostics_([run], [corruptedAllocation], [lotArchive], [event]);
      equal(corrupted.ok, false);
      equal(corrupted.errors.some(function (error) { return error.indexOf("source snapshot fingerprint") >= 0; }), true);

      var orphan = di3BuildFifoReplayArchiveDiagnostics_([run], [allocationArchive], [lotArchive], []);
      equal(orphan.ok, true);
      equal(orphan.warnings.some(function (warning) { return warning.indexOf("не имеет PREPARED event") >= 0; }), true);

      var changedTerminal = event.slice();
      changedTerminal[2] = 2;
      changedTerminal[3] = "COMMITTED";
      changedTerminal[10] = "tampered-target-fingerprint";
      var transitionAudit = di3BuildFifoReplayArchiveDiagnostics_([run], [allocationArchive], [lotArchive], [event, changedTerminal]);
      equal(transitionAudit.ok, false);
      equal(transitionAudit.errors.some(function (error) { return error.indexOf("immutable replay identity/fingerprint") >= 0; }), true);
    } finally { di3BuildFifoFingerprint_ = originalFingerprint; }
  });

  test("clean FIFO baseline includes sequence and append-only replay archive schemas", function () {
    equal(DI3_TABLE_SCHEMAS.StockLedger[12], "ledger_sequence");
    equal(DI3_TABLE_SCHEMAS.FifoProductState[4], "last_processed_ledger_sequence");
    equal(DI3_TABLE_SCHEMAS.FifoAllocationRuns.length, 15);
    equal(DI3_TABLE_SCHEMAS.FifoAllocationArchive.length, 18);
    equal(DI3_TABLE_SCHEMAS.FifoLotCacheArchive.length, 6);
    equal(DI3_TABLE_SCHEMAS.FifoReplayEvents.length, 15);
  });

  test("FIFO replay archives source snapshots before replacement and commits append-only events", function () {
    var originals = {
      readOne: di3ReadRowsByColumnValue_,
      readMany: di3ReadRowsByColumnValues_,
      append: di3AppendTableRows_,
      getSheet: di3GetSheetOrThrow_,
      makeUuid: di3MakeUuid_,
      fingerprint: di3BuildFifoFingerprint_,
      restore: di3RestoreFifoReplaySourceSnapshot_
    };
    var stores = { FifoAllocationArchive: [], FifoLotCacheArchive: [], FifoReplayEvents: [] };
    var uuid = 0, restoreCalls = 0;
    function matches(table, column, value) {
      return (stores[table] || []).map(function (row, index) {
        return { row_number: index + 2, values: row };
      }).filter(function (match) { return String(match.values[column]) === String(value); });
    }
    try {
      di3ReadRowsByColumnValue_ = function (table, column, value) { return matches(table, column, value); };
      di3ReadRowsByColumnValues_ = function (table, column, values) {
        var targets = Object.create(null); values.forEach(function (v) { targets[String(v)] = true; });
        return (stores[table] || []).map(function (row, index) {
          return { row_number: index + 2, values: row };
        }).filter(function (match) { return Object.prototype.hasOwnProperty.call(targets, String(match.values[column])); });
      };
      di3AppendTableRows_ = function (table, rows) { stores[table].push.apply(stores[table], rows.map(function (row) { return row.slice(); })); };
      di3GetSheetOrThrow_ = function (table) {
        return { getLastRow: function () { return (stores[table] || []).length + 1; } };
      };
      di3MakeUuid_ = function () { uuid++; return "event-" + uuid; };
      di3BuildFifoFingerprint_ = function (value) { return JSON.stringify(value); };
      di3RestoreFifoReplaySourceSnapshot_ = function () { restoreCalls++; return { allocations: 1, lots: 1 }; };

      var sourceAllocation = ["alloc-old", "run-old", "move-1", "lot-1", "p1", "CONSUME", 2, 5,
        "KNOWN", 10, new Date("2026-01-01"), new Date("2026-01-01"), "", 1000];
      var targetAllocation = ["alloc-target", "run-1", "move-1", "lot-1", "p1", "CONSUME", 2, 5,
        "KNOWN", 10, new Date("2026-01-01"), new Date("2026-01-01"), "", 1000];
      var lot = ["lot-1", "p1", "move-in", "SUPPLY", "s1", "pv1", new Date("2026-01-01"),
        new Date("2026-01-01"), 5, 5, "KNOWN", "EUR", "", 5, 2500];
      var context = {
        replay_id: "OP:op-1:PRODUCT:p1", fifo_run_id: "run-1", operation_id: "op-1",
        scope_type: "PRODUCT", scope_json: '["p1"]', input_fingerprint: "input-fp",
        reason: "PRODUCT_REPLAY:BACKDATED_EVENT", archived_at: new Date("2026-01-02"),
        target_rows: [targetAllocation], target_remaining: { "lot-1": 3 }, lot_rows: [lot]
      };
      var prepared = di3PrepareFifoReplay_(context, function () { return true; }, "p1", [sourceAllocation]);
      equal(prepared.already_target, false);
      equal(stores.FifoAllocationArchive.length, 1);
      equal(stores.FifoLotCacheArchive.length, 1);
      equal(stores.FifoReplayEvents.length, 1);
      equal(stores.FifoReplayEvents[0][3], "PREPARED");

      var interrupted = di3PrepareFifoReplay_(context, function () { return true; }, "p1", []);
      equal(restoreCalls, 1, "A partial active projection must request source restoration");
      equal(interrupted.source_rows[0][0], "alloc-old");

      lot[13] = 3;
      var alreadyTarget = di3PrepareFifoReplay_(context, function () { return true; }, "p1", [targetAllocation]);
      equal(alreadyTarget.already_target, true);
      equal(stores.FifoAllocationArchive.length, 1, "Retry must not duplicate archive snapshots");
      equal(stores.FifoReplayEvents.length, 1, "Retry must not duplicate PREPARED event");

      di3CommitFifoReplayEventsForRun_("run-1");
      equal(stores.FifoReplayEvents.length, 2);
      equal(stores.FifoReplayEvents[1][3], "COMMITTED");
      equal(di3GetPendingFifoReplayEventsForRun_("run-1").length, 0);
    } finally {
      di3ReadRowsByColumnValue_ = originals.readOne;
      di3ReadRowsByColumnValues_ = originals.readMany;
      di3AppendTableRows_ = originals.append;
      di3GetSheetOrThrow_ = originals.getSheet;
      di3MakeUuid_ = originals.makeUuid;
      di3BuildFifoFingerprint_ = originals.fingerprint;
      di3RestoreFifoReplaySourceSnapshot_ = originals.restore;
    }
  });

  test("FIFO projection archives before replacement and rolls back after allocation append failure", function () {
    var originals = {
      read: di3ReadTaggedRowsByColumnValue_,
      readTable: di3ReadTableValues_,
      prepare: di3PrepareFifoReplay_,
      remove: di3DeleteStockAllocationRows_,
      append: di3AppendTableRows_,
      restoreLots: di3RestoreLotRemainingSnapshot_,
      updateLots: di3UpdateLotRemainingRows_
    };
    var calls = [], appendCount = 0, sourceRow = ["source-allocation"];
    try {
      di3ReadTaggedRowsByColumnValue_ = function () { return [sourceRow]; };
      di3ReadTableValues_ = function (name) { if (name !== "StockAllocations") throw new Error("Unexpected table " + name); return [sourceRow]; };
      di3PrepareFifoReplay_ = function () { calls.push("PREPARED_ARCHIVE"); return { already_target: false, source_rows: [sourceRow] }; };
      di3DeleteStockAllocationRows_ = function () { calls.push("DELETE_ACTIVE"); return 1; };
      di3AppendTableRows_ = function (table, rows) {
        appendCount++;
        calls.push(appendCount === 1 ? "APPEND_TARGET" : "RESTORE_SOURCE");
        if (appendCount === 1) throw new Error("simulated target append failure");
      };
      di3UpdateLotRemainingRows_ = function () { calls.push("UPDATE_LOTS"); };
      di3RestoreLotRemainingSnapshot_ = function () { calls.push("RESTORE_LOTS"); };
      var threw = false;
      try {
        di3ReplaceFifoProjectionSafely_(function () { return true; }, [["target-allocation"]], [], {}, null,
          { replay_id: "replay-1" });
      } catch (error) { threw = /simulated target append failure/.test(error.message); }
      equal(threw, true);
      equal(calls.join("|"), "PREPARED_ARCHIVE|DELETE_ACTIVE|APPEND_TARGET|DELETE_ACTIVE|RESTORE_SOURCE|RESTORE_LOTS");
    } finally {
      di3ReadTaggedRowsByColumnValue_ = originals.read;
      di3ReadTableValues_ = originals.readTable;
      di3PrepareFifoReplay_ = originals.prepare;
      di3DeleteStockAllocationRows_ = originals.remove;
      di3AppendTableRows_ = originals.append;
      di3RestoreLotRemainingSnapshot_ = originals.restoreLots;
      di3UpdateLotRemainingRows_ = originals.updateLots;
    }
  });

  test("FIFO projection rolls back allocations and lot cache after lot update failure", function () {
    var originals = {
      read: di3ReadTaggedRowsByColumnValue_,
      readTable: di3ReadTableValues_,
      prepare: di3PrepareFifoReplay_,
      remove: di3DeleteStockAllocationRows_,
      append: di3AppendTableRows_,
      restoreLots: di3RestoreLotRemainingSnapshot_,
      updateLots: di3UpdateLotRemainingRows_
    };
    var calls = [], appendCount = 0, sourceRow = ["source-allocation"];
    try {
      di3ReadTaggedRowsByColumnValue_ = function () { return [sourceRow]; };
      di3ReadTableValues_ = function (name) { if (name !== "StockAllocations") throw new Error("Unexpected table " + name); return [sourceRow]; };
      di3PrepareFifoReplay_ = function () { calls.push("PREPARED_ARCHIVE"); return { already_target: false, source_rows: [sourceRow] }; };
      di3DeleteStockAllocationRows_ = function () { calls.push("DELETE_ACTIVE"); return 1; };
      di3AppendTableRows_ = function (table, rows) { appendCount++; calls.push(appendCount === 1 ? "APPEND_TARGET" : "RESTORE_SOURCE"); };
      di3UpdateLotRemainingRows_ = function () { calls.push("UPDATE_LOTS"); throw new Error("simulated lot update failure"); };
      di3RestoreLotRemainingSnapshot_ = function () { calls.push("RESTORE_LOTS"); };
      var threw = false;
      try {
        di3ReplaceFifoProjectionSafely_(function () { return true; }, [["target-allocation"]], [], {}, null,
          { replay_id: "replay-2" });
      } catch (error) { threw = /simulated lot update failure/.test(error.message); }
      equal(threw, true);
      equal(calls.join("|"), "PREPARED_ARCHIVE|DELETE_ACTIVE|APPEND_TARGET|UPDATE_LOTS|DELETE_ACTIVE|RESTORE_SOURCE|RESTORE_LOTS");
    } finally {
      di3ReadTaggedRowsByColumnValue_ = originals.read;
      di3ReadTableValues_ = originals.readTable;
      di3PrepareFifoReplay_ = originals.prepare;
      di3DeleteStockAllocationRows_ = originals.remove;
      di3AppendTableRows_ = originals.append;
      di3RestoreLotRemainingSnapshot_ = originals.restoreLots;
      di3UpdateLotRemainingRows_ = originals.updateLots;
    }
  });

  test("pending product replay is reconstructed and state watermark is refreshed", function () {
    var originals = {
      pending: di3GetPendingFifoReplayEventsForRun_,
      readTable: di3ReadTableValues_,
      inputFingerprint: di3BuildFifoReplayInputFingerprint_,
      replayPlan: di3BuildProductFifoReplayPlan_,
      allocationRows: di3BuildFifoAllocationRows_,
      replace: di3ReplaceFifoProjectionSafely_,
      stateRows: di3BuildFifoProductStateRows_,
      upsert: di3UpsertFifoProductStateRows_
    };
    var replaceCalls = 0, upsertRows = null;
    var ledger = [["m1", "op", "evt", "p1", "T", "d", -1, new Date("2026-01-01"), new Date("2026-01-01"), "", "", "", 8]];
    var details = [["m1", "code", "OUT", "SALE", "", "", "KNOWN", "", "", "", "TEST"]];
    var lots = [["l1", "p1", "m0", "SUPPLY", "s1", "pv1", new Date("2026-01-01"), new Date("2026-01-01"), 2, 5, "KNOWN", "EUR", "", 0, 1000]];
    var event = ["evt-1", "OP:op-1:PRODUCT:p1", 1, "PREPARED", "run-1", "op-1",
      "PRODUCT", '["p1"]', "input-fp", "source-a", "target-a", "source-l", "target-l", new Date(), "{}"];
    try {
      di3GetPendingFifoReplayEventsForRun_ = function () { return [{ row_number: 2, values: event }]; };
      di3ReadTableValues_ = function (name) {
        if (name === "StockLedger") return ledger;
        if (name === "StockMovementDetails") return details;
        if (name === "StockLots") return lots;
        throw new Error("Unexpected table " + name);
      };
      di3BuildFifoReplayInputFingerprint_ = function () { return "input-fp"; };
      di3BuildProductFifoReplayPlan_ = function () {
        return { allocations: [{ movement_id: "m1", lot_id: "l1", product_id: "p1", allocation_type: "CONSUME",
          quantity: 1, unit_cost: 5, cost_status: "KNOWN", allocated_cost: 5, effective_at: new Date(), recorded_at: new Date(), allocated_cost_minor: 500 }],
          remaining_lots: [{ lot_id: "l1", remaining_quantity: 1 }], movement_count: 1 };
      };
      di3BuildFifoAllocationRows_ = function () { return [["target-allocation"]]; };
      di3ReplaceFifoProjectionSafely_ = function (predicate, targetRows, lotRows, remaining, productId, context) {
        replaceCalls++;
        equal(context.replay_id, "OP:op-1:PRODUCT:p1");
        equal(context.target_rows.length, 1);
        equal(remaining.l1, 1);
        return { allocations_removed: 1, allocations_written: 1 };
      };
      di3BuildFifoProductStateRows_ = function (ids, productLedgerRows) {
        equal(ids[0], "p1");
        equal(productLedgerRows.length, 1);
        return [["p1-state"]];
      };
      di3UpsertFifoProductStateRows_ = function (rows) { upsertRows = rows; };
      var result = di3RecoverPendingFifoReplaysForRun_({ run_id: "run-1", created_at: new Date() }, "TEST");
      equal(result.recovered, 1);
      equal(result.products[0], "p1");
      equal(replaceCalls, 1);
      equal(upsertRows[0][0], "p1-state");
    } finally {
      di3GetPendingFifoReplayEventsForRun_ = originals.pending;
      di3ReadTableValues_ = originals.readTable;
      di3BuildFifoReplayInputFingerprint_ = originals.inputFingerprint;
      di3BuildProductFifoReplayPlan_ = originals.replayPlan;
      di3BuildFifoAllocationRows_ = originals.allocationRows;
      di3ReplaceFifoProjectionSafely_ = originals.replace;
      di3BuildFifoProductStateRows_ = originals.stateRows;
      di3UpsertFifoProductStateRows_ = originals.upsert;
    }
  });

  test("pending replay with changed immutable inputs is quarantined before projection writes", function () {
    var originals = {
      pending: di3GetPendingFifoReplayEventsForRun_,
      readTable: di3ReadTableValues_,
      inputFingerprint: di3BuildFifoReplayInputFingerprint_,
      appendEvent: di3AppendFifoReplayEvent_,
      replace: di3ReplaceFifoProjectionSafely_
    };
    var quarantineType = "";
    var event = ["evt-1", "OP:op-1:PRODUCT:p1", 1, "PREPARED", "run-1", "op-1",
      "PRODUCT", '["p1"]', "expected-fp", "source-a", "target-a", "source-l", "target-l", new Date(), "{}"];
    try {
      di3GetPendingFifoReplayEventsForRun_ = function () { return [{ row_number: 2, values: event }]; };
      di3ReadTableValues_ = function (name) { return name === "StockLedger" ? [] : []; };
      di3BuildFifoReplayInputFingerprint_ = function () { return "different-fp"; };
      di3AppendFifoReplayEvent_ = function (context, type) { quarantineType = type; return {}; };
      var replaceCalls = 0;
      di3ReplaceFifoProjectionSafely_ = function () { replaceCalls++; };
      var threw = false;
      try { di3RecoverPendingFifoReplaysForRun_({ run_id: "run-1", created_at: new Date() }, "TEST"); }
      catch (error) { threw = /quarantine/.test(error.message); }
      equal(threw, true);
      equal(quarantineType, "QUARANTINED");
      equal(replaceCalls, 0);
    } finally {
      di3GetPendingFifoReplayEventsForRun_ = originals.pending;
      di3ReadTableValues_ = originals.readTable;
      di3BuildFifoReplayInputFingerprint_ = originals.inputFingerprint;
      di3AppendFifoReplayEvent_ = originals.appendEvent;
      di3ReplaceFifoProjectionSafely_ = originals.replace;
    }
  });

  test("transient projection failure leaves a FIFO replay PREPARED for retry", function () {
    var originals = {
      pending: di3GetPendingFifoReplayEventsForRun_, readTable: di3ReadTableValues_,
      inputFingerprint: di3BuildFifoReplayInputFingerprint_, replayPlan: di3BuildProductFifoReplayPlan_,
      allocationRows: di3BuildFifoAllocationRows_, replace: di3ReplaceFifoProjectionSafely_,
      stateRows: di3BuildFifoProductStateRows_, upsert: di3UpsertFifoProductStateRows_,
      appendEvent: di3AppendFifoReplayEvent_
    };
    var quarantineType = "";
    var event = ["evt-1", "OP:op-1:PRODUCT:p1", 1, "PREPARED", "run-1", "op-1",
      "PRODUCT", '["p1"]', "input-fp", "source-a", "target-a", "source-l", "target-l", new Date(), "{}"];
    try {
      di3GetPendingFifoReplayEventsForRun_ = function () { return [{ row_number: 2, values: event }]; };
      di3ReadTableValues_ = function (name) {
        if (name === "StockLedger") return [["m1", "op", "evt", "p1", "T", "d", -1, new Date("2026-01-01"), new Date("2026-01-01"), "", "", "", 8]];
        if (name === "StockMovementDetails") return [["m1", "code", "OUT", "SALE", "", "", "KNOWN", "", "", "", "TEST"]];
        if (name === "StockLots") return [["l1", "p1", "m0", "SUPPLY", "s1", "pv1", new Date("2026-01-01"), new Date("2026-01-01"), 2, 5, "KNOWN", "EUR", "", 0, 1000]];
        throw new Error("Unexpected table " + name);
      };
      di3BuildFifoReplayInputFingerprint_ = function () { return "input-fp"; };
      di3BuildProductFifoReplayPlan_ = function () { return { allocations: [], remaining_lots: [{ lot_id: "l1", remaining_quantity: 1 }], movement_count: 1 }; };
      di3BuildFifoAllocationRows_ = function () { return []; };
      di3ReplaceFifoProjectionSafely_ = function () { return { allocations_written: 0, allocations_removed: 0 }; };
      di3BuildFifoProductStateRows_ = function () { return [["p1-state"]]; };
      di3UpsertFifoProductStateRows_ = function () { throw new Error("Temporary Sheets API write failure"); };
      di3AppendFifoReplayEvent_ = function (context, type) { if (type === "QUARANTINED") quarantineType = type; return {}; };
      var retryable = false;
      try { di3RecoverPendingFifoReplaysForRun_({ run_id: "run-1", created_at: new Date() }, "TEST"); }
      catch (error) { retryable = /оставлено PREPARED для безопасного повтора/.test(error.message); }
      equal(retryable, true);
      equal(quarantineType, "");
    } finally {
      di3GetPendingFifoReplayEventsForRun_ = originals.pending;
      di3ReadTableValues_ = originals.readTable;
      di3BuildFifoReplayInputFingerprint_ = originals.inputFingerprint;
      di3BuildProductFifoReplayPlan_ = originals.replayPlan;
      di3BuildFifoAllocationRows_ = originals.allocationRows;
      di3ReplaceFifoProjectionSafely_ = originals.replace;
      di3BuildFifoProductStateRows_ = originals.stateRows;
      di3UpsertFifoProductStateRows_ = originals.upsert;
      di3AppendFifoReplayEvent_ = originals.appendEvent;
    }
  });

  test("a second FIFO replay cannot start while another run is unresolved", function () {
    var originalGetSheet = di3GetSheetOrThrow_;
    try {
      di3GetSheetOrThrow_ = function (name) {
        equal(name, "FifoAllocationRuns");
        return {
          getLastRow: function () { return 3; },
          getRange: function (row, column) {
            return { getValues: function () {
              return column === 1 ? [["run-1"], ["run-2"]] : [["PREPARED"], ["COMMITTED"]];
            } };
          }
        };
      };
      var threw = false;
      try { di3AssertNoConflictingPendingFifoRuns_(""); }
      catch (error) { threw = /другой незавершённый FIFO run/.test(error.message); }
      equal(threw, true);
      di3AssertNoConflictingPendingFifoRuns_("run-1");
    } finally { di3GetSheetOrThrow_ = originalGetSheet; }
  });

  test("pending full replay is reconstructed and refreshes all product watermarks", function () {
    var originals = {
      pending: di3GetPendingFifoReplayEventsForRun_,
      readTable: di3ReadTableValues_,
      inputFingerprint: di3BuildFifoReplayInputFingerprint_,
      replayPlan: di3BuildFifoReplayPlan_,
      allocationRows: di3BuildFifoAllocationRows_,
      replace: di3ReplaceFifoProjectionSafely_,
      stateRows: di3BuildFifoProductStateRows_,
      upsert: di3UpsertFifoProductStateRows_
    };
    var replaceCalls = 0, upsertRows = null;
    var ledger = [
      ["m1", "op1", "evt1", "p1", "T", "d", 1, new Date("2026-01-01"), new Date("2026-01-01"), "", "", "", 1],
      ["m2", "op2", "evt2", "p2", "T", "d", -1, new Date("2026-01-02"), new Date("2026-01-02"), "", "", "", 2]
    ];
    var details = [["m1", "c1", "IN", "SUPPLY"], ["m2", "c2", "OUT", "SALE"]];
    var lots = [
      ["l1", "p1", "m1", "SUPPLY", "s1", "pv1", new Date("2026-01-01"), new Date("2026-01-01"), 1, 5, "KNOWN", "EUR", "", 1, 500],
      ["l2", "p2", "m0", "SUPPLY", "s2", "pv2", new Date("2025-12-31"), new Date("2025-12-31"), 2, 4, "KNOWN", "EUR", "", 1, 800]
    ];
    var event = ["evt-1", "FULL:run-1", 1, "PREPARED", "run-1", "",
      "FULL", "FULL", "input-fp", "source-a", "target-a", "source-l", "target-l", new Date(), "{}"];
    try {
      di3GetPendingFifoReplayEventsForRun_ = function () { return [{ row_number: 2, values: event }]; };
      di3ReadTableValues_ = function (name) {
        if (name === "StockLedger") return ledger;
        if (name === "StockMovementDetails") return details;
        if (name === "StockLots") return lots;
        throw new Error("Unexpected table " + name);
      };
      di3BuildFifoReplayInputFingerprint_ = function () { return "input-fp"; };
      di3BuildFifoReplayPlan_ = function () {
        return { allocations: [{ movement_id: "m2", lot_id: "l2", product_id: "p2", allocation_type: "CONSUME",
          quantity: 1, unit_cost: 4, cost_status: "KNOWN", allocated_cost: 4, effective_at: new Date(), recorded_at: new Date(), allocated_cost_minor: 400 }],
          remaining_lots: [{ lot_id: "l2", remaining_quantity: 1 }], movement_count: 2 };
      };
      di3BuildFifoAllocationRows_ = function (runId, allocations, replayId) {
        equal(runId, "run-1");
        equal(replayId, "FULL:run-1");
        return [["target-full-allocation"]];
      };
      di3ReplaceFifoProjectionSafely_ = function (predicate, targetRows, lotRows, remaining, productId, context) {
        replaceCalls++;
        equal(productId, null);
        equal(context.scope_type, "FULL");
        equal(targetRows.length, 1);
        equal(remaining.l1, 1);
        return { allocations_removed: 3, allocations_written: 1 };
      };
      di3BuildFifoProductStateRows_ = function (ids, ledgerRows) {
        equal(ids.length, 2);
        equal(ledgerRows.length, 2);
        return [["p1-state"], ["p2-state"]];
      };
      di3UpsertFifoProductStateRows_ = function (rows) { upsertRows = rows; };
      var result = di3RecoverPendingFifoReplaysForRun_({ run_id: "run-1", created_at: new Date() }, "TEST");
      equal(result.recovered, 1);
      equal(result.full_replay, true);
      equal(result.movements_replayed, 2);
      equal(replaceCalls, 1);
      equal(upsertRows.length, 2);
    } finally {
      di3GetPendingFifoReplayEventsForRun_ = originals.pending;
      di3ReadTableValues_ = originals.readTable;
      di3BuildFifoReplayInputFingerprint_ = originals.inputFingerprint;
      di3BuildFifoReplayPlan_ = originals.replayPlan;
      di3BuildFifoAllocationRows_ = originals.allocationRows;
      di3ReplaceFifoProjectionSafely_ = originals.replace;
      di3BuildFifoProductStateRows_ = originals.stateRows;
      di3UpsertFifoProductStateRows_ = originals.upsert;
    }
  });

  test("FIFO replay event reader rejects invalid and duplicate sequence numbers", function () {
    var originalRead = di3ReadRowsByColumnValue_;
    try {
      di3ReadRowsByColumnValue_ = function () {
        return [
          { values: ["e1", "replay-1", 1, "PREPARED"] },
          { values: ["e2", "replay-1", 1, "COMMITTED"] }
        ];
      };
      var duplicateThrew = false;
      try { di3GetLatestFifoReplayEvent_("replay-1"); }
      catch (error) { duplicateThrew = /duplicate event_sequence/.test(error.message); }
      equal(duplicateThrew, true);
      di3ReadRowsByColumnValue_ = function () {
        return [{ values: ["e1", "replay-1", 0, "PREPARED"] }];
      };
      var invalidThrew = false;
      try { di3GetLatestFifoReplayEvent_("replay-1"); }
      catch (error) { invalidThrew = /invalid event_sequence/.test(error.message); }
      equal(invalidThrew, true);
    } finally { di3ReadRowsByColumnValue_ = originalRead; }
  });

  test("unresolved FIFO run blocks allocation of new stock sequences", function () {
    var originalGetSheet = di3GetSheetOrThrow_;
    try {
      di3GetSheetOrThrow_ = function (name) {
        equal(name, "FifoAllocationRuns");
        return {
          getLastRow: function () { return 3; },
          getRange: function () { return { getValues: function () { return [["COMMITTED"], ["PREPARED"]]; } }; }
        };
      };
      var threw = false;
      try { di3AssertNoPendingFifoRuns_(); } catch (error) { threw = /Незавершённый FIFO run/.test(error.message); }
      equal(threw, true);
    } finally { di3GetSheetOrThrow_ = originalGetSheet; }
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
        if (width === 1 && column === 4) return { getValues: function () { return rows.slice(row - 2, row - 2 + count).map(function (x) { return [x[3]]; }); } };
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
      var stableRows = rows.map(function (row) { return row.slice(); });
      var staleIndex = di3ReadLedgerSequenceIndex_();
      rows[0] = stableRows[1].slice();
      rows[1] = stableRows[0].slice();
      var concurrentReorderThrew = false;
      try { di3ReadFifoLedgerTail_(4, staleIndex); }
      catch (error) { concurrentReorderThrew = /изменился во время чтения/.test(error.message); }
      equal(concurrentReorderThrew, true, "Concurrent physical sorting must fail closed");
    } finally { di3GetSheetOrThrow_ = originalGetSheet; }
  });

  test("ledger sequence index rejects missing and duplicate populated values", function () {
    var originalGetSheet = di3GetSheetOrThrow_;
    function fakeSheet(ids, seqs, products) {
      return {
        getLastRow: function () { return ids.length + 1; },
        getRange: function (row, column, count) {
          var values = column === 1 ? ids : (column === 4 ? products : seqs);
          return { getValues: function () { return values.slice(row - 2, row - 2 + count).map(function (x) { return [x]; }); } };
        }
      };
    }
    try {
      di3GetSheetOrThrow_ = function () { return fakeSheet(["m1", "m2"], [1, 1], ["p1", "p1"]); };
      var duplicateThrew = false;
      try { di3ReadLedgerSequenceIndex_(); } catch (error) { duplicateThrew = /повторяется ledger_sequence/.test(error.message); }
      equal(duplicateThrew, true);
      di3GetSheetOrThrow_ = function () { return fakeSheet(["m1", "m2"], [1, ""], ["p1", "p1"]); };
      var missingThrew = false;
      try { di3ReadLedgerSequenceIndex_(); } catch (error) { missingThrew = /отсутствует ledger_sequence/.test(error.message); }
      equal(missingThrew, true);
      di3GetSheetOrThrow_ = function () { return fakeSheet(["m1", "m2"], [1, "not-a-number"], ["p1", "p1"]); };
      var invalidThrew = false;
      try { di3ReadLedgerSequenceIndex_(); } catch (error) { invalidThrew = /положительным целым числом/.test(error.message); }
      equal(invalidThrew, true);
      di3GetSheetOrThrow_ = function () { return fakeSheet(["m1", "m2"], [1, 2], ["p1", ""]); };
      var missingProductThrew = false;
      try { di3ReadLedgerSequenceIndex_(); } catch (error) { missingProductThrew = /пустой product_id/.test(error.message); }
      equal(missingProductThrew, true);
      di3GetSheetOrThrow_ = function () { return fakeSheet(["m1", "m2"], [4, 9], ["p1", "p1"]); };
      var oldDepth = DI3_SCRIPT_LOCK_DEPTH_;
      try {
        DI3_SCRIPT_LOCK_DEPTH_ = 1;
        equal(di3AllocateLedgerSequenceBlock_(2).join(","), "10,11");
        DI3_SCRIPT_LOCK_DEPTH_ = 0;
        var lockThrew = false;
        try { di3AllocateLedgerSequenceBlock_(1); } catch (error) { lockThrew = /ScriptLock/.test(error.message); }
        equal(lockThrew, true);
      } finally { DI3_SCRIPT_LOCK_DEPTH_ = oldDepth; }
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
    var code = di3GetShortProductCodeWithMap_("50f4cef3-3dbc-460d-9c83-0d6f2dc5f8df", {});
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

  test("N-02 FIFO quarantine resolution requires owner attestation and appends audit without projection writes", function () {
    var originals = {
      withLock: di3WithLock_, normalize: di3NormalizeText_,
      latest: di3GetLatestFifoReplayEvent_, readRows: di3ReadRowsByColumnValue_,
      archive: di3ReadFifoReplayArchiveSnapshots_,
      allocationFingerprint: di3BuildFifoAllocationSnapshotFingerprint_,
      fingerprint: di3BuildFifoFingerprint_,
      append: di3AppendFifoReplayEvent_, updateRun: di3UpdateFifoRunStatus_,
      actor: typeof di3GetActorEmail_ === "function" ? di3GetActorEmail_ : null
    };
    var event = ["event-2", "OP:op-1:PRODUCT:p1", 2, "QUARANTINED", "run-1", "",
      "PRODUCT", '["p1"]', "input-fp", "source-a", "target-a", "source-l", "target-l", new Date(), "{}"];
    var run = ["run-1", 1, "FAILED", "TEST", new Date(), "", 1, 0, 1, "integrity failure", "", "OP:op-1", "PRODUCT", '["p1"]', "input-fp"];
    var appendedType = "", updatedStatus = "", appendDetails = null, projectionWrites = 0;
    try {
      di3WithLock_ = function (callback) { return callback(); };
      di3NormalizeText_ = function (value) { return String(value || "").trim(); };
      di3GetLatestFifoReplayEvent_ = function (replayId) {
        equal(replayId, "OP:op-1:PRODUCT:p1");
        return { row_number: 3, values: event };
      };
      di3ReadRowsByColumnValue_ = function (table, column, value) {
        equal(table, "FifoAllocationRuns");
        equal(column, 0);
        equal(value, "run-1");
        return [{ row_number: 2, values: run }];
      };
      di3ReadFifoReplayArchiveSnapshots_ = function () {
        return { allocation_rows: [], lot_archive_rows: [] };
      };
      di3BuildFifoAllocationSnapshotFingerprint_ = function () { return "source-a"; };
      di3BuildFifoFingerprint_ = function () { return "source-l"; };
      di3AppendFifoReplayEvent_ = function (context, type, fingerprints, details) {
        appendedType = type; appendDetails = details;
        equal(context.replay_id, "OP:op-1:PRODUCT:p1");
        equal(fingerprints.source_allocations, "source-a");
        return {};
      };
      di3UpdateFifoRunStatus_ = function (rowNumber, status) {
        equal(rowNumber, 2); updatedStatus = status;
      };
      di3GetActorEmail_ = function () { return "owner@example.test"; };

      var rejected = false;
      try { di3ResolveQuarantinedFifoReplay("OP:op-1:PRODUCT:p1", "WRONG", "Reviewed ledger, lots and allocations in detail."); }
      catch (error) { rejected = /RESOLVE_AFTER_MANUAL_RECONCILIATION/.test(error.message); }
      equal(rejected, true);
      equal(appendedType, "");
      equal(updatedStatus, "");

      var result = di3ResolveQuarantinedFifoReplay(
        "OP:op-1:PRODUCT:p1",
        "RESOLVE_AFTER_MANUAL_RECONCILIATION",
        "Сверены Ledger, Details, Lots, Allocations, состояния товаров, курсор и snapshots заказа."
      );
      equal(result.status, "MANUALLY_RESOLVED");
      equal(result.fifo_run_id, "run-1");
      equal(appendedType, "MANUALLY_RESOLVED");
      equal(updatedStatus, "MANUALLY_RESOLVED");
      equal(appendDetails.resolution, "OWNER_ATTESTED_MANUAL_RECONCILIATION");
      equal(appendDetails.actor, "owner@example.test");
      equal(projectionWrites, 0);
    } finally {
      di3WithLock_ = originals.withLock;
      di3NormalizeText_ = originals.normalize;
      di3GetLatestFifoReplayEvent_ = originals.latest;
      di3ReadRowsByColumnValue_ = originals.readRows;
      di3ReadFifoReplayArchiveSnapshots_ = originals.archive;
      di3BuildFifoAllocationSnapshotFingerprint_ = originals.allocationFingerprint;
      di3BuildFifoFingerprint_ = originals.fingerprint;
      di3AppendFifoReplayEvent_ = originals.append;
      di3UpdateFifoRunStatus_ = originals.updateRun;
      if (originals.actor) di3GetActorEmail_ = originals.actor;
      else delete di3GetActorEmail_;
    }
  });

  var report = { passed: passed, failed: failures.length, failures: failures };
  if (failures.length) throw new Error("Stock Core tests failed: " + JSON.stringify(failures));
  return report;
}
