/** Pure regression tests for the append-only supply correction relation journal. */
function di3RunSupplyCorrectionRelationUnitTests() {
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
  function operation(id, status) {
    return [id, "SUPPLY_CORRECTION:" + id, "SUPPLY_CORRECTION", "SUPPLY", "S1",
      status, "HASH", new Date("2026-11-28T00:00:00Z"), "", "", "actor@example.test"];
  }
  function event(seq, relationId, eventType, relationType, source, replacement, sourceProduct, replacementProduct, opId) {
    return [
      "EVENT-" + seq, relationId, "CORR-" + opId, opId || "OP-1", "S1", seq,
      eventType, relationType, source || "", replacement || "", sourceProduct || "",
      replacementProduct || "", source ? "ITEM-" + source : "",
      replacement ? "ITEM-" + replacement : "", new Date("2026-11-20T10:00:00Z"),
      new Date("2026-11-28T00:00:00Z"), "{}"
    ];
  }
  function resolve(events, operations, options) {
    return di3BuildSupplyCorrectionEffectiveMovementMap_(events, operations, options);
  }

  test("committed REPLACE supersedes source and exposes replacement", function () {
    var result = resolve([
      event(1, "REL-1", "PREPARED", "REPLACE", "MOVE-A", "MOVE-B", "P1", "P1"),
      event(2, "REL-1", "COMMITTED", "REPLACE", "MOVE-A", "MOVE-B", "P1", "P1")
    ], [operation("OP-1", "COMMITTED")]);
    equal(result.superseded_movement_ids.join(","), "MOVE-A");
    equal(result.active_replacement_movement_ids.join(","), "MOVE-B");
    equal(result.relations.length, 1);
  });
  test("normal replay excludes PREPARED relation until its operation commits", function () {
    var rows = [event(1, "REL-1", "PREPARED", "REPLACE", "MOVE-A", "MOVE-B", "P1", "P1")];
    var ops = [operation("OP-1", "PREPARED")];
    equal(resolve(rows, ops).relations.length, 0);
    var candidate = resolve(rows, ops, { include_operation_id: "OP-1" });
    equal(candidate.superseded_movement_ids.join(","), "MOVE-A");
    equal(candidate.active_replacement_movement_ids.join(","), "MOVE-B");
  });
  test("pending relation cannot be included for a different operation", function () {
    var rows = [event(1, "REL-1", "PREPARED", "REPLACE", "MOVE-A", "MOVE-B", "P1", "P1")];
    equal(resolve(rows, [operation("OP-1", "PREPARED")], { include_operation_id: "OP-OTHER" }).relations.length, 0);
  });
  test("correction chain resolves to final replacement without resurrecting original source", function () {
    var result = resolve([
      event(1, "REL-1", "COMMITTED", "REPLACE", "MOVE-A", "MOVE-B", "P1", "P1", "OP-1"),
      event(2, "REL-2", "COMMITTED", "REPLACE", "MOVE-B", "MOVE-C", "P1", "P1", "OP-2")
    ], [operation("OP-1", "COMMITTED"), operation("OP-2", "COMMITTED")]);
    equal(result.superseded_movement_ids.join(","), "MOVE-A,MOVE-B");
    equal(result.active_replacement_movement_ids.join(","), "MOVE-C");
  });
  test("REMOVE and ADD are represented independently", function () {
    var result = resolve([
      event(1, "REL-REMOVE", "COMMITTED", "REMOVE", "MOVE-OLD", "", "P1", "", "OP-1"),
      event(2, "REL-ADD", "COMMITTED", "ADD", "", "MOVE-NEW", "", "P2", "OP-2")
    ], [operation("OP-1", "COMMITTED"), operation("OP-2", "COMMITTED")]);
    equal(result.superseded_movement_ids.join(","), "MOVE-OLD");
    equal(result.removed_movement_ids.join(","), "MOVE-OLD");
    equal(result.active_replacement_movement_ids.join(","), "MOVE-NEW");
  });
  test("ABORTED relation is inactive", function () {
    var result = resolve([
      event(1, "REL-1", "PREPARED", "REPLACE", "MOVE-A", "MOVE-B", "P1", "P1"),
      event(2, "REL-1", "ABORTED", "REPLACE", "MOVE-A", "MOVE-B", "P1", "P1")
    ], [operation("OP-1", "REJECTED")]);
    equal(result.relations.length, 0);
    equal(result.superseded_movement_ids.length, 0);
  });
  test("QUARANTINED relation fails closed", function () {
    throws(function () {
      resolve([event(1, "REL-1", "QUARANTINED", "REPLACE", "MOVE-A", "MOVE-B", "P1", "P1")],
        [operation("OP-1", "QUARANTINED")]);
    }, /карантине/);
  });
  test("cycle in correction chain is rejected", function () {
    throws(function () {
      resolve([
        event(1, "REL-1", "COMMITTED", "REPLACE", "MOVE-A", "MOVE-B", "P1", "P1", "OP-1"),
        event(2, "REL-2", "COMMITTED", "REPLACE", "MOVE-B", "MOVE-A", "P1", "P1", "OP-2")
      ], [operation("OP-1", "COMMITTED"), operation("OP-2", "COMMITTED")]);
    }, /цикл/);
  });
  test("multiple active supersessions of one source are rejected", function () {
    throws(function () {
      resolve([
        event(1, "REL-1", "COMMITTED", "REPLACE", "MOVE-A", "MOVE-B", "P1", "P1", "OP-1"),
        event(2, "REL-2", "COMMITTED", "REMOVE", "MOVE-A", "", "P1", "", "OP-2")
      ], [operation("OP-1", "COMMITTED"), operation("OP-2", "COMMITTED")]);
    }, /несколько активных supersession/);
  });
  test("replacement movement cannot be claimed by two relations", function () {
    throws(function () {
      resolve([
        event(1, "REL-1", "COMMITTED", "ADD", "", "MOVE-X", "", "P1", "OP-1"),
        event(2, "REL-2", "COMMITTED", "ADD", "", "MOVE-X", "", "P1", "OP-2")
      ], [operation("OP-1", "COMMITTED"), operation("OP-2", "COMMITTED")]);
    }, /используется несколькими/);
  });
  test("REPLACE cannot cross product identity", function () {
    throws(function () {
      resolve([event(1, "REL-1", "COMMITTED", "REPLACE", "MOVE-A", "MOVE-B", "P1", "P2")],
        [operation("OP-1", "COMMITTED")]);
    }, /одного product_id/);
  });
  test("duplicate event sequence and unknown operation are rejected", function () {
    var first = event(1, "REL-1", "COMMITTED", "REPLACE", "MOVE-A", "MOVE-B", "P1", "P1");
    var second = event(1, "REL-2", "COMMITTED", "ADD", "", "MOVE-C", "", "P1", "OP-1");
    throws(function () { resolve([first, second], [operation("OP-1", "COMMITTED")]); }, /повторяется event_sequence/);
    throws(function () { resolve([event(2, "REL-1", "COMMITTED", "REPLACE", "MOVE-A", "MOVE-B", "P1", "P1", "OP-MISSING")], []); }, /не найдена операция/);
  });

  var report = { passed: passed, failed: failed.length, failures: failed };
  if (failed.length) throw new Error("Supply correction relation tests failed: " + JSON.stringify(failed));
  return report;
}
