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
  function rowLedger(id, productId, delta, date, recorded) {
    return [id, "op-" + id, "event-" + id, productId, "TEST", id, delta, new Date(date), new Date(recorded || date), "", "", ""];
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
