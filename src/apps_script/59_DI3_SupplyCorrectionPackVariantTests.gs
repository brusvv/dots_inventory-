/** Pure selection tests for pack-variant current flags after supply correction. */
function di3RunSupplyCorrectionPackVariantTests() {
  var passed = 0, failed = [];
  function test(name, callback) {
    try { callback(); passed++; }
    catch (error) { failed.push({ name: name, error: error.message || String(error) }); }
  }
  function equal(actual, expected, message) {
    if (actual !== expected) throw new Error((message || "Values differ") + ": expected " + JSON.stringify(expected) + ", got " + JSON.stringify(actual));
  }
  function supply(id, receivedAt, createdAt, status) {
    var row = [];
    row[0] = id; row[15] = status || DI3_SUPPLY_STATUS.RECEIVED;
    row[16] = new Date(createdAt || receivedAt); row[18] = new Date(receivedAt);
    return row;
  }
  function item(supplyId, line, productId, variantId) {
    var row = [];
    row[1] = supplyId; row[2] = line; row[3] = productId; row[5] = variantId;
    return row;
  }

  test("latest received supply wins over corrected older receipt", function () {
    var result = di3BuildLatestReceivedPackVariantMap_([
      supply("OLD", "2026-11-10T10:00:00Z"),
      supply("NEW", "2026-11-20T10:00:00Z")
    ], [
      item("OLD", 1, "P1", "V-OLD"),
      item("NEW", 1, "P1", "V-NEW")
    ], ["P1"]);
    equal(result.P1.pack_variant_id, "V-NEW");
    equal(result.P1.supply_id, "NEW");
  });

  test("corrected supply becomes current when it is the latest received supply", function () {
    var result = di3BuildLatestReceivedPackVariantMap_([
      supply("CORRECTED", "2026-11-27T10:00:00Z"),
      supply("OLDER", "2026-11-20T10:00:00Z")
    ], [
      item("CORRECTED", 1, "P1", "V-40"),
      item("OLDER", 1, "P1", "V-20")
    ], ["P1"]);
    equal(result.P1.pack_variant_id, "V-40");
  });

  test("cancelled supplies are ignored", function () {
    var result = di3BuildLatestReceivedPackVariantMap_([
      supply("CANCELLED", "2026-11-28T10:00:00Z", "2026-11-01T10:00:00Z", DI3_SUPPLY_STATUS.CANCELLED),
      supply("RECEIVED", "2026-11-20T10:00:00Z")
    ], [
      item("CANCELLED", 1, "P1", "V-CANCELLED"),
      item("RECEIVED", 1, "P1", "V-VALID")
    ], ["P1"]);
    equal(result.P1.pack_variant_id, "V-VALID");
  });

  test("highest line number wins when a supply contains multiple variants of one product", function () {
    var result = di3BuildLatestReceivedPackVariantMap_([
      supply("S1", "2026-11-20T10:00:00Z")
    ], [
      item("S1", 1, "P1", "V-20"),
      item("S1", 2, "P1", "V-40")
    ], ["P1"]);
    equal(result.P1.pack_variant_id, "V-40");
  });

  test("products outside affected scope are not selected", function () {
    var result = di3BuildLatestReceivedPackVariantMap_([
      supply("S1", "2026-11-20T10:00:00Z")
    ], [item("S1", 1, "P1", "V-20")], ["P2"]);
    equal(Object.keys(result).length, 0);
  });

  function variantRecord(id, productId, isCurrent, updatedAt) {
    return {
      pack_variant_id: id, product_id: productId, units_per_pack: 20,
      variant_label: "20 шт.", is_current: isCurrent, active: true,
      source: "SUPPLY", created_at: new Date("2026-01-01T00:00:00Z"),
      updated_at: updatedAt, row_number: 7
    };
  }

  test("unchanged current flag does not rewrite updated_at to received_at", function () {
    var oldUpdatedAt = new Date("2026-11-01T10:00:00Z");
    var result = di3BuildPackVariantCurrentFlagUpdate_(
      variantRecord("V-20", "P1", true, oldUpdatedAt), "V-20",
      new Date("2026-11-20T10:00:00Z"));
    equal(result, null);
  });

  test("inactive non-target variant is not rewritten when another variant is current", function () {
    var oldUpdatedAt = new Date("2026-10-01T10:00:00Z");
    var result = di3BuildPackVariantCurrentFlagUpdate_(
      variantRecord("V-20", "P1", false, oldUpdatedAt), "V-40",
      new Date("2026-11-20T10:00:00Z"));
    equal(result, null);
  });

  test("changed current flag receives actual reconciliation timestamp", function () {
    var updatedAt = new Date("2026-11-28T12:00:00Z");
    var result = di3BuildPackVariantCurrentFlagUpdate_(
      variantRecord("V-40", "P1", false, new Date("2026-10-01T10:00:00Z")),
      "V-40", updatedAt);
    equal(result.row_number, 7);
    equal(result.values[4], true);
    equal(result.values[8].toISOString(), updatedAt.toISOString());
  });

  test("removed latest variant clears only the previously current flag", function () {
    var updatedAt = new Date("2026-11-28T12:00:00Z");
    var result = di3BuildPackVariantCurrentFlagUpdate_(
      variantRecord("V-20", "P1", true, new Date("2026-10-01T10:00:00Z")),
      "", updatedAt);
    equal(result.values[4], false);
    equal(result.values[8].toISOString(), updatedAt.toISOString());
  });

  var report = { passed: passed, failed: failed.length, failures: failed };
  if (failed.length) throw new Error("Supply correction pack variant tests failed: " + JSON.stringify(failed));
  return report;
}
