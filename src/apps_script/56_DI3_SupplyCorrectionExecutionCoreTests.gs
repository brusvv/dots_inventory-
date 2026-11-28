/** Pure tests for SC-04 correction relation planning. */
function di3RunSupplyCorrectionExecutionCoreTests() {
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
  var date = "2026-11-27T14:42:00.000Z";
  function source(id, product, variant, item) {
    return { movement_id: id, supply_item_id: item || "SI-" + id, product_id: product,
      pack_variant_id: variant, effective_at: date };
  }
  function replacement(id, product, variant, item) {
    return { movement_id: id, supply_item_id: item || "RI-" + id, product_id: product,
      pack_variant_id: variant, effective_at: date };
  }
  function build(oldLines, newLines) {
    var n = 0;
    return di3BuildSupplyCorrectionRelationPlan_(oldLines, newLines, {
      supply_id: "SUP-1", correction_id: "CORR-1", operation_id: "OP-1"
    }, function () { n++; return "REL-" + n; });
  }

  test("same product and variant maps to REPLACE", function () {
    var result = build([source("OLD", "P1", "V1")], [replacement("NEW", "P1", "V1")]);
    equal(result.length, 1);
    equal(result[0].relation_type, "REPLACE");
    equal(result[0].source_movement_id, "OLD");
    equal(result[0].replacement_movement_id, "NEW");
    equal(result[0].effective_at, date);
  });

  test("changed pack variant of a single product maps to REPLACE", function () {
    var result = build([source("OLD", "P1", "V1")], [replacement("NEW", "P1", "V2")]);
    equal(result.length, 1);
    equal(result[0].relation_type, "REPLACE");
    equal(result[0].source_product_id, result[0].replacement_product_id);
  });

  test("product identity change maps to REMOVE plus ADD, never cross-product REPLACE", function () {
    var result = build([source("OLD", "P1", "V1")], [replacement("NEW", "P2", "V2")]);
    equal(result.length, 2);
    equal(result.map(function (x) { return x.relation_type; }).sort().join(","), "ADD,REMOVE");
  });

  test("many source lines replaced by one new product line map to REMOVE plus ADD", function () {
    var result = build([
      source("OLD-A", "P1", "V1"), source("OLD-B", "P2", "V2")
    ], [replacement("NEW-C", "P3", "V3")]);
    equal(result.length, 3);
    equal(result.filter(function (x) { return x.relation_type === "REMOVE"; }).length, 2);
    equal(result.filter(function (x) { return x.relation_type === "ADD"; }).length, 1);
    equal(result.filter(function (x) { return x.relation_type === "REPLACE"; }).length, 0);
  });

  test("exact variant matches are preferred when a product has multiple variants", function () {
    var result = build([
      source("OLD-A", "P1", "V1"), source("OLD-B", "P1", "V2")
    ], [replacement("NEW-B", "P1", "V2"), replacement("NEW-C", "P1", "V3")]);
    equal(result.filter(function (x) { return x.relation_type === "REPLACE"; }).length, 2);
    equal(result.filter(function (x) { return x.source_movement_id === "OLD-B"; })[0].replacement_movement_id, "NEW-B");
    equal(result.filter(function (x) { return x.source_movement_id === "OLD-A"; })[0].replacement_movement_id, "NEW-C");
    equal(result.filter(function (x) { return x.relation_type === "REMOVE"; }).length, 0);
    equal(result.filter(function (x) { return x.relation_type === "ADD"; }).length, 0);
  });

  test("ambiguous many-to-one same-product mapping fails safe as REMOVE plus ADD", function () {
    var result = build([
      source("OLD-A", "P1", "V1"), source("OLD-B", "P1", "V2")
    ], [replacement("NEW-A", "P1", "V3")]);
    equal(result.filter(function (x) { return x.relation_type === "REPLACE"; }).length, 0);
    equal(result.filter(function (x) { return x.relation_type === "REMOVE"; }).length, 2);
    equal(result.filter(function (x) { return x.relation_type === "ADD"; }).length, 1);
  });

  test("duplicate movement IDs and empty correction metadata are rejected", function () {
    throws(function () {
      build([source("OLD", "P1", "V1")], [replacement("OLD", "P1", "V1")]);
    }, /must be new and distinct/);
    throws(function () {
      di3BuildSupplyCorrectionRelationPlan_([source("OLD", "P1", "V1")], [],
        { supply_id: "SUP-1", correction_id: "", operation_id: "OP-1" }, function () { return "REL"; });
    }, /отсутствует supply_id\/correction_id\/operation_id/);
  });

  test("replacement relation identity and metadata are unique and complete", function () {
    var result = build([source("OLD", "P1", "V1")], [replacement("NEW", "P1", "V1")]);
    equal(result[0].relation_id, "REL-1");
    equal(result[0].correction_id, "CORR-1");
    equal(result[0].operation_id, "OP-1");
    equal(result[0].supply_id, "SUP-1");
    equal(result[0].source_supply_item_id, "SI-OLD");
    equal(result[0].replacement_supply_item_id, "RI-NEW");
  });

  test("document projection preflight accepts untouched and fully applied snapshots", function () {
    var beforeSupply = ["SUP-1", "RECEIVED", 100];
    var afterSupply = ["SUP-1", "RECEIVED", 120];
    var beforeItem = ["ITEM-1", "SUP-1", "P1", 2];
    var afterItem = ["ITEM-1", "SUP-1", "P1", 3];
    var payload = {
      supply_id: "SUP-1",
      before_supply_row: beforeSupply,
      after_supply_row: afterSupply,
      before_item_rows: [beforeItem],
      after_item_rows: [afterItem]
    };
    equal(di3BuildSupplyCorrectionDocumentProjectionAudit_(beforeSupply, [beforeItem], payload).status, "READY");
    equal(di3BuildSupplyCorrectionDocumentProjectionAudit_(afterSupply, [afterItem], payload).status, "READY");
  });

  test("document projection preflight accepts a partially applied target with new rows not appended yet", function () {
    var beforeSupply = ["SUP-1", "RECEIVED", 100];
    var afterSupply = ["SUP-1", "RECEIVED", 120];
    var beforeItem = ["ITEM-1", "SUP-1", "P1", 2];
    var afterItem = ["ITEM-1", "SUP-1", "P1", 3];
    var addedItem = ["ITEM-2", "SUP-1", "P2", 1];
    var payload = {
      supply_id: "SUP-1",
      before_supply_row: beforeSupply,
      after_supply_row: afterSupply,
      before_item_rows: [beforeItem],
      after_item_rows: [afterItem, addedItem]
    };
    equal(di3BuildSupplyCorrectionDocumentProjectionAudit_(afterSupply, [beforeItem], payload).status, "READY");
  });

  test("document projection preflight rejects conflicting or foreign live rows before writes", function () {
    var beforeSupply = ["SUP-1", "RECEIVED", 100];
    var afterSupply = ["SUP-1", "RECEIVED", 120];
    var beforeItem = ["ITEM-1", "SUP-1", "P1", 2];
    var afterItem = ["ITEM-1", "SUP-1", "P1", 3];
    var payload = {
      supply_id: "SUP-1",
      before_supply_row: beforeSupply,
      after_supply_row: afterSupply,
      before_item_rows: [beforeItem],
      after_item_rows: [afterItem]
    };
    throws(function () {
      di3BuildSupplyCorrectionDocumentProjectionAudit_(["SUP-1", "RECEIVED", 999], [beforeItem], payload);
    }, /V3_Supplies.*source.*target/);
    throws(function () {
      di3BuildSupplyCorrectionDocumentProjectionAudit_(beforeSupply, [["FOREIGN", "SUP-1", "P2", 1]], payload);
    }, /посторонняя строка/);
    throws(function () {
      di3BuildSupplyCorrectionDocumentProjectionAudit_(beforeSupply, [["ITEM-1", "SUP-1", "P1", 9]], payload);
    }, /source и target snapshots/);
  });

  test("document projection preflight rejects duplicate or cross-supply immutable snapshots", function () {
    var beforeSupply = ["SUP-1", "RECEIVED", 100];
    var payload = {
      supply_id: "SUP-1",
      before_supply_row: beforeSupply,
      after_supply_row: beforeSupply,
      before_item_rows: [["ITEM-1", "SUP-1", "P1", 2], ["ITEM-1", "SUP-1", "P1", 3]],
      after_item_rows: []
    };
    throws(function () {
      di3BuildSupplyCorrectionDocumentProjectionAudit_(beforeSupply, [], payload);
    }, /повторный supply_item_id/);
    payload.before_item_rows = [["ITEM-1", "OTHER-SUPPLY", "P1", 2]];
    throws(function () {
      di3BuildSupplyCorrectionDocumentProjectionAudit_(beforeSupply, [], payload);
    }, /принадлежит другой поставке/);
  });

  test("committed correction FIFO run is selected only with its final matching FULL event", function () {
    var run = ["RUN-1", 1, "COMMITTED", "SUPPLY_CORRECTION", date, date, 10, 5, 2, "", "OP-1", "OP:OP-1", "FULL", "FULL", "INPUT-1"];
    var events = [
      ["EV-1", "OP:OP-1", 1, "PREPARED", "RUN-1", "OP-1", "FULL", "FULL", "INPUT-1", "SOURCE-A", "TARGET-A", "SOURCE-L", "TARGET-L", date, "{}"],
      ["EV-2", "OP:OP-1", 2, "COMMITTED", "RUN-1", "OP-1", "FULL", "FULL", "INPUT-1", "SOURCE-A", "TARGET-A", "SOURCE-L", "TARGET-L", date, "{}"]
    ];
    var selected = di3BuildCommittedSupplyCorrectionFifoRunSelection_([run], events, "OP-1");
    equal(selected.run[0], "RUN-1");
    equal(selected.replay_event[3], "COMMITTED");
  });

  test("committed correction FIFO selection rejects mismatched run/event and nonterminal replay", function () {
    var run = ["RUN-1", 1, "COMMITTED", "SUPPLY_CORRECTION", date, date, 10, 5, 2, "", "OP-1", "OP:OP-1", "FULL", "FULL", "INPUT-1"];
    var prepared = [["EV-1", "OP:OP-1", 1, "PREPARED", "RUN-1", "OP-1", "FULL", "FULL", "INPUT-1", "SOURCE-A", "TARGET-A", "SOURCE-L", "TARGET-L", date, "{}"]];
    throws(function () { di3BuildCommittedSupplyCorrectionFifoRunSelection_([run], prepared, "OP-1"); }, /не образуют согласованную FULL projection/);
    var mismatched = [["EV-1", "OP:OP-1", 1, "COMMITTED", "OTHER-RUN", "OP-1", "FULL", "FULL", "INPUT-1", "SOURCE-A", "TARGET-A", "SOURCE-L", "TARGET-L", date, "{}"]];
    throws(function () { di3BuildCommittedSupplyCorrectionFifoRunSelection_([run], mismatched, "OP-1"); }, /не образуют согласованную FULL projection/);
  });

  test("committed correction FIFO selection fails closed on duplicate runs or broken event sequence", function () {
    var run = ["RUN-1", 1, "COMMITTED", "SUPPLY_CORRECTION", date, date, 10, 5, 2, "", "OP-1", "OP:OP-1", "FULL", "FULL", "INPUT-1"];
    var second = run.slice(); second[0] = "RUN-2"; second[1] = 2; second[11] = "OP:OP-1:SECOND";
    throws(function () { di3BuildCommittedSupplyCorrectionFifoRunSelection_([run, second], [], "OP-1"); }, /несколько COMMITTED FIFO runs/);
    var broken = [
      ["EV-1", "OP:OP-1", 1, "PREPARED", "RUN-1", "OP-1", "FULL", "FULL", "INPUT-1", "SOURCE-A", "TARGET-A", "SOURCE-L", "TARGET-L", date, "{}"],
      ["EV-3", "OP:OP-1", 3, "COMMITTED", "RUN-1", "OP-1", "FULL", "FULL", "INPUT-1", "SOURCE-A", "TARGET-A", "SOURCE-L", "TARGET-L", date, "{}"]
    ];
    throws(function () { di3BuildCommittedSupplyCorrectionFifoRunSelection_([run], broken, "OP-1"); }, /нарушена последовательность/);
  });

  test("SUPPLY_CORRECTION is registered for operation recovery", function () {
    var registry = di3GetOperationHandlerRegistry_();
    if (typeof registry.SUPPLY_CORRECTION !== "function") {
      throw new Error("SUPPLY_CORRECTION handler is missing from operation registry.");
    }
  });

  test("replacement receipt rows preserve original effective and recorded timestamps", function () {
    var originalActor = di3GetOperationInitiatorActor_;
    var originalSequence = di3RequireLedgerSequence_;
    var originalCurrency = di3GetBaseCurrency_;
    try {
      di3GetOperationInitiatorActor_ = function () { return "actor@example.test"; };
      di3RequireLedgerSequence_ = function (value) { return Number(value); };
      di3GetBaseCurrency_ = function () { return "RUB"; };
      var payload = {
        supply_id: "SUP-1", supply_number: "S-17", correction_id: "CORR-1",
        currency: "RUB", created_by: "actor@example.test",
        replacement_lines: [{
          supply_item_id: "ITEM-NEW", product_id: "P1", pack_variant_id: "V1",
          movement_id: "MOVE-NEW", lot_id: "LOT-NEW", event_key: "SUPPLY_CORRECTION:CORR-1:ITEM-NEW",
          quantity: 60, unit_cost: 9.295, total_cost_minor: 55770, cost_status: "KNOWN",
          effective_at: "2026-11-27T14:42:00.000Z", recorded_at: "2026-11-27T14:42:00.000Z",
          ledger_sequence: 777, display_code: "MOV-000777"
        }]
      };
      var rows = di3BuildSupplyCorrectionReceiptRows_("OP-CORR", payload);
      equal(rows.ledger.length, 1);
      equal(rows.ledger[0][1], "OP-CORR");
      equal(rows.ledger[0][2], payload.replacement_lines[0].event_key);
      equal(rows.ledger[0][12], 777);
      equal(rows.details[0][2], "IN");
      equal(rows.details[0][3], "SUPPLY_CORRECTION");
      equal(rows.details[0][8], "actor@example.test");
      equal(rows.lots[0][9], 9.295);
      equal(rows.lots[0][14], 55770);
      equal(rows.ledger[0][7].toISOString(), "2026-11-27T14:42:00.000Z");
      equal(rows.ledger[0][8].toISOString(), "2026-11-27T14:42:00.000Z");
    } finally {
      di3GetOperationInitiatorActor_ = originalActor;
      di3RequireLedgerSequence_ = originalSequence;
      di3GetBaseCurrency_ = originalCurrency;
    }
  });

  test("correction request fingerprint is stable and changes with financial inputs", function () {
    var base = {
      correction_id: "CORR-1", reason: "Correct receipt",
      seller_discount_amount: 0, partner_discount_amount: 10, shipping_amount: 5,
      lines: [{ product_id: "P1", pack_variant_id: "V1", units_per_pack: 20, packs: 3, purchase_price_per_pack: 100 }]
    };
    var first = di3BuildSupplyCorrectionRequestFingerprint_("SUP-1", base);
    equal(di3BuildSupplyCorrectionRequestFingerprint_("SUP-1", base), first);
    var changed = JSON.parse(JSON.stringify(base));
    changed.shipping_amount = 6;
    if (di3BuildSupplyCorrectionRequestFingerprint_("SUP-1", changed) === first) {
      throw new Error("Changing shipping must change the correction request fingerprint.");
    }
  });

  var report = { passed: passed, failed: failed.length, failures: failed };
  if (failed.length) throw new Error("Supply correction execution core tests failed: " + JSON.stringify(failed));
  return report;
}
