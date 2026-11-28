/** Unit tests for correction-aware FIFO source snapshot construction. */
function di3RunSupplyCorrectionFifoIntegrationTests() {
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
    if (pattern && !pattern.test(String(error.message || error))) throw new Error("Expected error matching " + pattern + ", got: " + String(error.message || error));
  }
  function ledger(id, productId, delta, effectiveAt, recordedAt) {
    return [id, "OP-" + id, "EV-" + id, productId, "SUPPLY", "S1", delta,
      new Date(effectiveAt), new Date(recordedAt || effectiveAt), "", "", "", 1];
  }
  function detail(id, type) { return [id, "MOV-" + id, type, "SUPPLY_RECEIVE", "", "", "KNOWN", "", "test", "", "SUPPLY"]; }
  function lot(id, productId, movementId, quantity, unitCost, effectiveAt, recordedAt) {
    var effective = effectiveAt || "2026-01-02T09:00:00Z";
    return [id, productId, movementId, "SUPPLY", "S1", "PV-" + productId,
      new Date(effective), new Date(recordedAt || effective),
      quantity, unitCost == null ? 10 : unitCost, "KNOWN", "RUB", "", quantity,
      Math.round(quantity * (unitCost == null ? 10 : unitCost) * 100)];
  }
  function operation(id) {
    return [id, "SUPPLY_CORRECTION:" + id, "SUPPLY_CORRECTION", "SUPPLY", "S1",
      "COMMITTED", "HASH-" + id, new Date(), "", "", "test"];
  }
  function relation(seq, relationId, type, source, replacement, sourceProduct, replacementProduct, operationId) {
    return ["EVT-" + seq, relationId, "CORR-" + operationId, operationId, "S1", seq,
      "COMMITTED", type, source || "", replacement || "", sourceProduct || "",
      replacementProduct || "", source ? "ITEM-" + source : "",
      replacement ? "ITEM-" + replacement : "",
      new Date("2026-01-02T09:00:00Z"), new Date(), "{}"];
  }
  function snapshot(ledgerRows, details, lots, relations, operations) {
    var map = di3BuildSupplyCorrectionEffectiveMovementMap_(relations, operations, {});
    return di3BuildSupplyCorrectionEffectiveFifoSnapshot_(ledgerRows, details, lots, map);
  }

  test("correction operation lookup reads only operations referenced by relation events", function () {
    var source = di3ReadSupplyCorrectionOperationRows_.toString();
    equal(source.indexOf('di3ReadRowsByColumnValues_("Operations", operationIdIndex, keys)') >= 0, true);
    equal(source.indexOf('di3ReadTableValues_("Operations")'), -1);
    var relationMap = di3ReadSupplyCorrectionEffectiveMovementMap_.toString();
    equal(relationMap.indexOf('di3ReadSupplyCorrectionOperationRows_(relationRows)') >= 0, true);
    equal(relationMap.indexOf('di3ReadTableValues_("Operations")'), -1);
  });
  test("REPLACE excludes source ledger, detail and lot while retaining replacement", function () {
    var date = "2026-01-02T09:00:00Z";
    var rows = [ledger("SRC", "P1", 10, date), ledger("REPL", "P1", 10, date, date)];
    var details = [detail("SRC", "IN"), detail("REPL", "IN")];
    var lots = [lot("LOT-SRC", "P1", "SRC", 10), lot("LOT-REPL", "P1", "REPL", 10, 10, date, date)];
    var result = snapshot(rows, details, lots,
      [relation(1, "REL-1", "REPLACE", "SRC", "REPL", "P1", "P1", "OP-1")], [operation("OP-1")]);
    equal(result.ledger_rows.length, 1);
    equal(result.ledger_rows[0][0], "REPL");
    equal(result.detail_rows.length, 1);
    equal(result.detail_rows[0][0], "REPL");
    equal(result.lot_rows.length, 1);
    equal(result.lot_rows[0][0], "LOT-REPL");
    equal(result.lot_rows[0]._di3RowNumber, 3, "physical StockLots row must survive filtering");
    equal(result.all_lot_rows.length, 2, "F-06 must retain both source and replacement lot cache rows");
    equal(result.all_lot_rows[0][0], "LOT-SRC");
    equal(result.all_lot_rows[0]._di3RowNumber, 2, "superseded lot physical row must survive for archival");
    equal(result.affected_product_ids.join(","), "P1");
  });

  test("F-06 target lot cache zeros superseded lots after preserving them in source snapshot", function () {
    var result = di3BuildSupplyCorrectionTargetLotRemainingMap_(
      [{ lot_id: "LOT-REPL", remaining_quantity: 7 }],
      [lot("LOT-SRC", "P1", "SRC", 10), lot("LOT-REPL", "P1", "REPL", 12)],
      ["SRC"]
    );
    equal(result["LOT-SRC"], 0);
    equal(result["LOT-REPL"], 7);
  });

  test("F-06 target lot cache fails if an effective lot is absent from replay", function () {
    throws(function () {
      di3BuildSupplyCorrectionTargetLotRemainingMap_([], [
        lot("LOT-ACTIVE", "P1", "ACTIVE", 10)
      ], ["OLD"]);
    }, /missing from candidate FIFO replay/);
  });

  test("REMOVE keeps no superseded receipt and still exposes affected product scope", function () {
    var date = "2026-01-02T09:00:00Z";
    var result = snapshot([ledger("SRC", "P1", 10, date)], [detail("SRC", "IN")],
      [lot("LOT-SRC", "P1", "SRC", 10)],
      [relation(1, "REL-R", "REMOVE", "SRC", "", "P1", "", "OP-1")], [operation("OP-1")]);
    equal(result.ledger_rows.length, 0);
    equal(result.lot_rows.length, 0);
    equal(result.affected_product_ids.join(","), "P1");
  });

  test("ADD retains the replacement movement and scopes its product", function () {
    var date = "2026-01-02T09:00:00Z";
    var result = snapshot([ledger("NEW", "P2", 12, date)], [detail("NEW", "IN")],
      [lot("LOT-NEW", "P2", "NEW", 12)],
      [relation(1, "REL-A", "ADD", "", "NEW", "", "P2", "OP-1")], [operation("OP-1")]);
    equal(result.ledger_rows.length, 1);
    equal(result.ledger_rows[0][0], "NEW");
    equal(result.affected_product_ids.join(","), "P2");
  });

  test("correction chain removes every superseded movement and keeps final replacement", function () {
    var date = "2026-01-02T09:00:00Z";
    var rows = ["A", "B", "C"].map(function (id, index) {
      return ledger(id, "P1", 10, date, date);
    });
    var details = ["A", "B", "C"].map(function (id) { return detail(id, "IN"); });
    var lots = ["A", "B", "C"].map(function (id) { return lot("LOT-" + id, "P1", id, 10); });
    var result = snapshot(rows, details, lots, [
      relation(1, "REL-1", "REPLACE", "A", "B", "P1", "P1", "OP-1"),
      relation(2, "REL-2", "REPLACE", "B", "C", "P1", "P1", "OP-2")
    ], [operation("OP-1"), operation("OP-2")]);
    equal(result.ledger_rows.length, 1);
    equal(result.ledger_rows[0][0], "C");
    equal(result.lot_rows[0][0], "LOT-C");
  });

  test("REPLACE preserves the original receipt recorded_at tie-break timestamp", function () {
    var date = "2026-01-02T09:00:00Z";
    var changedRecordedAt = "2026-01-04T09:00:00Z";
    throws(function () {
      snapshot(
        [ledger("SRC", "P1", 10, date, date), ledger("REPL", "P1", 10, date, changedRecordedAt)],
        [detail("SRC", "IN"), detail("REPL", "IN")],
        [lot("LOT-SRC", "P1", "SRC", 10), lot("LOT-REPL", "P1", "REPL", 10, 5, date, changedRecordedAt)],
        [relation(1, "REL-1", "REPLACE", "SRC", "REPL", "P1", "P1", "OP-1")],
        [operation("OP-1")]
      );
    }, /recorded_at должен совпадать с исходным receipt/);
  });

  test("source snapshots are not mutated", function () {
    var date = "2026-01-02T09:00:00Z";
    var rows = [ledger("SRC", "P1", 10, date), ledger("REPL", "P1", 10, date)];
    var details = [detail("SRC", "IN"), detail("REPL", "IN")];
    var lots = [lot("LOT-SRC", "P1", "SRC", 10), lot("LOT-REPL", "P1", "REPL", 10, 10, date, date)];
    var relations = [relation(1, "REL-1", "REPLACE", "SRC", "REPL", "P1", "P1", "OP-1")];
    var before = JSON.stringify({ rows: rows, details: details, lots: lots, relations: relations });
    snapshot(rows, details, lots, relations, [operation("OP-1")]);
    equal(JSON.stringify({ rows: rows, details: details, lots: lots, relations: relations }), before);
  });

  test("rejects a relation whose replacement is not an inbound movement", function () {
    var date = "2026-01-02T09:00:00Z";
    throws(function () {
      snapshot([ledger("SRC", "P1", 10, date), ledger("REPL", "P1", -10, date)],
        [detail("SRC", "IN"), detail("REPL", "OUT")],
        [lot("LOT-SRC", "P1", "SRC", 10)],
        [relation(1, "REL-1", "REPLACE", "SRC", "REPL", "P1", "P1", "OP-1")], [operation("OP-1")]);
    }, /должен быть положительным приходом SUPPLY IN/);
  });

  test("stale committed correction projection is rejected by stock read guards", function () {
    var original = di3GetAppMetaValue_;
    try {
      di3GetAppMetaValue_ = function (key) { return key === "fifo_supply_correction_fingerprint" ? "OLD-FINGERPRINT" : ""; };
      throws(function () {
        di3AssertSupplyCorrectionFifoProjectionCurrent_({ relations: [{ relation_id: "R1" }], fingerprint: "NEW-FINGERPRINT" });
      }, /FIFO-проекция ещё не пересчитана/);
      di3GetAppMetaValue_ = function (key) { return key === "fifo_supply_correction_fingerprint" ? "NEW-FINGERPRINT" : ""; };
      equal(di3AssertSupplyCorrectionFifoProjectionCurrent_({ relations: [{ relation_id: "R1" }], fingerprint: "NEW-FINGERPRINT" }), true);
      equal(di3AssertSupplyCorrectionFifoProjectionCurrent_({ relations: [], fingerprint: "EMPTY" }), true);
    } finally {
      di3GetAppMetaValue_ = original;
    }
  });

  test("rejects a replacement with a different effective receipt date", function () {
    var date = "2026-01-02T09:00:00Z";
    throws(function () {
      snapshot([ledger("SRC", "P1", 10, date), ledger("REPL", "P1", 10, "2026-01-03T09:00:00Z", date)],
        [detail("SRC", "IN"), detail("REPL", "IN")],
        [lot("LOT-SRC", "P1", "SRC", 10), lot("LOT-REPL", "P1", "REPL", 10, 10, "2026-01-03T09:00:00Z", date)],
        [relation(1, "REL-1", "REPLACE", "SRC", "REPL", "P1", "P1", "OP-1")], [operation("OP-1")]);
    }, /не совпадает с исходной датой приёмки/);
  });

  var report = { passed: passed, failed: failed.length, failures: failed };
  if (failed.length) throw new Error("Supply correction FIFO integration tests failed: " + JSON.stringify(failed));
  return report;
}
