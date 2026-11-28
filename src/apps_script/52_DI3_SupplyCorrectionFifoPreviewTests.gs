/** Unit tests for read-only candidate FIFO replay with supply correction relations. */
function di3RunSupplyCorrectionFifoPreviewTests() {
  var passed = 0, failed = [];
  function test(name, callback) {
    try { callback(); passed++; }
    catch (error) { failed.push({ name: name, error: error.message || String(error) }); }
  }
  function equal(actual, expected, message) {
    if (actual !== expected) throw new Error((message || "Values differ") + ": expected " + JSON.stringify(expected) + ", got " + JSON.stringify(actual));
  }
  function throws(callback, pattern) {
    var error = null;
    try { callback(); } catch (caught) { error = caught; }
    if (!error) throw new Error("Expected error matching " + pattern + ", but no error was thrown");
    if (pattern && !pattern.test(String(error.message || error))) {
      throw new Error("Expected error matching " + pattern + ", got: " + String(error.message || error));
    }
  }
  var sequence = 0;
  function ledger(id, productId, delta, effectiveAt, recordedAt) {
    sequence++;
    return [id, "OP-" + id, "EV-" + id, productId, "SUPPLY", "S1", delta,
      new Date(effectiveAt), new Date(recordedAt || effectiveAt), "", "", "", sequence];
  }
  function detail(id, type) {
    return [id, "MOV-" + id, type, "SUPPLY_RECEIVE", "", "", "KNOWN", "", "test", "", "SUPPLY"];
  }
  function lot(id, productId, movementId, quantity, unitCost, effectiveAt, recordedAt) {
    var row = [id, productId, movementId, "SUPPLY", "S1", "PV-" + productId,
      new Date(effectiveAt), new Date(recordedAt || effectiveAt), quantity,
      unitCost, "KNOWN", "RUB", "", "", Math.round(quantity * unitCost * 100)];
    return row;
  }
  function operation(id, status) {
    return [id, "SUPPLY_CORRECTION:" + id, "SUPPLY_CORRECTION", "SUPPLY", "S1",
      status, "HASH-" + id, new Date("2026-11-28T00:00:00Z"), "", "", "test"];
  }
  function relationEvent(seq, relationId, eventType, relationType, source, replacement, sourceProduct, replacementProduct, operationId) {
    return [
      "EVT-" + seq, relationId, "CORR-" + operationId, operationId, "S1", seq,
      eventType, relationType, source || "", replacement || "", sourceProduct || "",
      replacementProduct || "", source ? "ITEM-" + source : "",
      replacement ? "ITEM-" + replacement : "",
      new Date("2026-01-02T09:00:00Z"), new Date("2026-11-28T00:00:00Z"), "{}"
    ];
  }
  function preview(ledgerRows, details, lots, relations, operations, operationId) {
    return di3BuildSupplyCorrectionCandidateFifoReplayPlan_(
      ledgerRows, details, lots, relations, operations, { include_operation_id: operationId || "" }
    );
  }

  test("REPLACE hides the original receipt and replays sales against replacement cost", function () {
    var date = "2026-01-02T09:00:00Z";
    var rows = [
      ledger("SRC", "P1", 10, date, date),
      ledger("SALE", "P1", -5, "2026-01-03T09:00:00Z"),
      ledger("REPL", "P1", 10, date, "2026-01-04T09:00:00Z")
    ];
    var details = [detail("SRC", "IN"), detail("SALE", "OUT"), detail("REPL", "IN")];
    var lots = [
      lot("LOT-SRC", "P1", "SRC", 10, 10, date, date),
      lot("LOT-REPL", "P1", "REPL", 10, 5, date, "2026-01-04T09:00:00Z")
    ];
    var relations = [relationEvent(1, "REL-1", "PREPARED", "REPLACE", "SRC", "REPL", "P1", "P1", "OP-1")];
    var result = preview(rows, details, lots, relations, [operation("OP-1", "PREPARED")], "OP-1");
    equal(result.superseded_movement_ids.join(","), "SRC");
    equal(result.active_replacement_movement_ids.join(","), "REPL");
    equal(result.replay.allocations.length, 1);
    equal(result.replay.allocations[0].lot_id, "LOT-REPL");
    equal(result.replay.movement_costs.SALE.total_cost, 25);
  });

  test("REMOVE can reveal a historical stock deficit and fails candidate replay", function () {
    var date = "2026-01-02T09:00:00Z";
    var rows = [ledger("SRC", "P1", 10, date), ledger("SALE", "P1", -5, "2026-01-03T09:00:00Z")];
    var details = [detail("SRC", "IN"), detail("SALE", "OUT")];
    var lots = [lot("LOT-SRC", "P1", "SRC", 10, 10, date)];
    var relations = [relationEvent(1, "REL-REMOVE", "PREPARED", "REMOVE", "SRC", "", "P1", "", "OP-1")];
    throws(function () {
      preview(rows, details, lots, relations, [operation("OP-1", "PREPARED")], "OP-1");
    }, /Недостаточно остатка/);
  });

  test("REMOVE plus ADD includes both removed and replacement products in scope", function () {
    var date = "2026-01-02T09:00:00Z";
    var rows = [ledger("OLD", "P1", 10, date), ledger("NEW", "P2", 20, date, "2026-01-04T09:00:00Z")];
    var details = [detail("OLD", "IN"), detail("NEW", "IN")];
    var lots = [lot("LOT-OLD", "P1", "OLD", 10, 10, date), lot("LOT-NEW", "P2", "NEW", 20, 5, date, "2026-01-04T09:00:00Z")];
    var relations = [
      relationEvent(1, "REL-REMOVE", "PREPARED", "REMOVE", "OLD", "", "P1", "", "OP-1"),
      relationEvent(2, "REL-ADD", "PREPARED", "ADD", "", "NEW", "", "P2", "OP-1")
    ];
    var result = preview(rows, details, lots, relations, [operation("OP-1", "PREPARED")], "OP-1");
    equal(result.affected_product_ids.join(","), "P1,P2");
    equal(result.replay.remaining_lots.length, 1);
    equal(result.replay.remaining_lots[0].lot_id, "LOT-NEW");
  });

  test("committed correction chain leaves only the final replacement lot", function () {
    var date = "2026-01-02T09:00:00Z";
    var rows = [
      ledger("A", "P1", 10, date),
      ledger("B", "P1", 10, date, "2026-01-04T09:00:00Z"),
      ledger("C", "P1", 10, date, "2026-01-05T09:00:00Z")
    ];
    var details = [detail("A", "IN"), detail("B", "IN"), detail("C", "IN")];
    var lots = [lot("LA", "P1", "A", 10, 10, date), lot("LB", "P1", "B", 10, 8, date, "2026-01-04T09:00:00Z"),
      lot("LC", "P1", "C", 10, 5, date, "2026-01-05T09:00:00Z")];
    var relations = [
      relationEvent(1, "REL-1", "COMMITTED", "REPLACE", "A", "B", "P1", "P1", "OP-1"),
      relationEvent(2, "REL-2", "COMMITTED", "REPLACE", "B", "C", "P1", "P1", "OP-2")
    ];
    var result = preview(rows, details, lots, relations,
      [operation("OP-1", "COMMITTED"), operation("OP-2", "COMMITTED")]);
    equal(result.superseded_movement_ids.join(","), "A,B");
    equal(result.active_replacement_movement_ids.join(","), "C");
    equal(result.replay.remaining_lots.length, 1);
    equal(result.replay.remaining_lots[0].lot_id, "LC");
  });

  test("candidate replay requires the exact pending operation ID", function () {
    var date = "2026-01-02T09:00:00Z";
    var rows = [ledger("SRC", "P1", 10, date), ledger("REPL", "P1", 10, date, "2026-01-04T09:00:00Z")];
    var details = [detail("SRC", "IN"), detail("REPL", "IN")];
    var lots = [lot("LS", "P1", "SRC", 10, 10, date), lot("LR", "P1", "REPL", 10, 5, date, "2026-01-04T09:00:00Z")];
    var relations = [relationEvent(1, "REL-1", "PREPARED", "REPLACE", "SRC", "REPL", "P1", "P1", "OP-1")];
    throws(function () {
      preview(rows, details, lots, relations, [operation("OP-1", "PREPARED")], "OP-OTHER");
    }, /не найдены активные связи/);
  });

  test("replacement movement must be an inbound movement at original effective time", function () {
    var date = "2026-01-02T09:00:00Z";
    var rows = [ledger("SRC", "P1", 10, date), ledger("REPL", "P1", -10, date, "2026-01-04T09:00:00Z")];
    var details = [detail("SRC", "IN"), detail("REPL", "OUT")];
    var lots = [lot("LS", "P1", "SRC", 10, 10, date)];
    var relations = [relationEvent(1, "REL-1", "PREPARED", "REPLACE", "SRC", "REPL", "P1", "P1", "OP-1")];
    throws(function () {
      preview(rows, details, lots, relations, [operation("OP-1", "PREPARED")], "OP-1");
    }, /должно быть положительным приходом/);
  });

  test("candidate replay is read-only and does not mutate supplied snapshots", function () {
    var date = "2026-01-02T09:00:00Z";
    var rows = [ledger("SRC", "P1", 10, date), ledger("REPL", "P1", 10, date, "2026-01-04T09:00:00Z")];
    var details = [detail("SRC", "IN"), detail("REPL", "IN")];
    var lots = [lot("LS", "P1", "SRC", 10, 10, date), lot("LR", "P1", "REPL", 10, 5, date, "2026-01-04T09:00:00Z")];
    var relations = [relationEvent(1, "REL-1", "PREPARED", "REPLACE", "SRC", "REPL", "P1", "P1", "OP-1")];
    var before = JSON.stringify({ rows: rows, details: details, lots: lots, relations: relations });
    preview(rows, details, lots, relations, [operation("OP-1", "PREPARED")], "OP-1");
    equal(JSON.stringify({ rows: rows, details: details, lots: lots, relations: relations }), before);
  });

  var report = { passed: passed, failed: failed.length, failures: failed };
  if (failed.length) throw new Error("Supply correction FIFO preview tests failed: " + JSON.stringify(failed));
  return report;
}
