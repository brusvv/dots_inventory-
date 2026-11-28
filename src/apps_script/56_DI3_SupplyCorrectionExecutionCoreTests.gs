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
    }, /повторяется movement_id/);
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

  var report = { passed: passed, failed: failed.length, failures: failed };
  if (failed.length) throw new Error("Supply correction execution core tests failed: " + JSON.stringify(failed));
  return report;
}
