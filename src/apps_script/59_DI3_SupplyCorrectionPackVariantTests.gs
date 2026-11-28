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
    var headers = DI3_TABLE_SCHEMAS.V3_Supplies;
    var row = new Array(headers.length).fill("");
    row[headers.indexOf("supply_id")] = id;
    row[headers.indexOf("status")] = status || DI3_SUPPLY_STATUS.RECEIVED;
    row[headers.indexOf("created_at")] = new Date(createdAt || receivedAt);
    row[headers.indexOf("received_at")] = new Date(receivedAt);
    return row;
  }
  function item(supplyId, line, productId, variantId) {
    var row = [];
    row[1] = supplyId; row[2] = line; row[3] = productId; row[5] = variantId;
    return row;
  }

  test("selection uses the live v4 V3_Supplies schema columns, not legacy offsets", function () {
    var headers = DI3_TABLE_SCHEMAS.V3_Supplies;
    equal(headers.indexOf("status"), 3);
    equal(headers.indexOf("created_at"), 4);
    equal(headers.indexOf("received_at"), 7);
    var liveRow = supply("LIVE", "2026-11-20T10:00:00Z");
    liveRow[15] = "RUB";
    liveRow[16] = new Date("2026-11-01T10:00:00Z");
    liveRow[18] = new Date("2027-01-01T00:00:00Z");
    var result = di3BuildLatestReceivedPackVariantMap_([liveRow], [
      item("LIVE", 1, "P1", "V-LIVE")
    ], ["P1"]);
    equal(result.P1.pack_variant_id, "V-LIVE");
  });

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

  test("invalid received_at on a received supply for an affected product fails closed", function () {
    var bad = supply("BAD", "2026-11-20T10:00:00Z");
    bad[DI3_TABLE_SCHEMAS.V3_Supplies.indexOf("received_at")] = "not-a-date";
    var error = null;
    try {
      di3BuildLatestReceivedPackVariantMap_([bad], [item("BAD", 1, "P1", "V-20")], ["P1"]);
    } catch (caught) { error = caught; }
    equal(!!error, true);
    equal(/received_at/.test(String(error && error.message)), true);
  });

  test("invalid received_at on an unrelated product does not block affected product selection", function () {
    var bad = supply("UNRELATED", "2026-11-20T10:00:00Z");
    bad[18] = "not-a-date";
    var result = di3BuildLatestReceivedPackVariantMap_([
      bad, supply("VALID", "2026-11-19T10:00:00Z")
    ], [
      item("UNRELATED", 1, "P2", "V-OTHER"),
      item("VALID", 1, "P1", "V-20")
    ], ["P1"]);
    equal(result.P1.pack_variant_id, "V-20");
  });

  test("duplicate line number for one affected product fails closed", function () {
    var error = null;
    try {
      di3BuildLatestReceivedPackVariantMap_([supply("S1", "2026-11-20T10:00:00Z")], [
        item("S1", 1, "P1", "V-20"),
        item("S1", 1, "P1", "V-40")
      ], ["P1"]);
    } catch (caught) { error = caught; }
    equal(!!error, true);
    equal(/повторный line_no/.test(String(error && error.message)), true);
  });

  test("invalid line number for an affected product fails closed", function () {
    var bad = item("S1", 0, "P1", "V-20");
    var error = null;
    try {
      di3BuildLatestReceivedPackVariantMap_([supply("S1", "2026-11-20T10:00:00Z")], [bad], ["P1"]);
    } catch (caught) { error = caught; }
    equal(!!error, true);
    equal(/line_no/.test(String(error && error.message)), true);
  });

  test("equal receipt and creation timestamps across supplies fail closed", function () {
    var error = null;
    try {
      di3BuildLatestReceivedPackVariantMap_([
        supply("S-A", "2026-11-20T10:00:00Z", "2026-11-19T10:00:00Z"),
        supply("S-B", "2026-11-20T10:00:00Z", "2026-11-19T10:00:00Z")
      ], [
        item("S-A", 1, "P1", "V-A"),
        item("S-B", 1, "P1", "V-B")
      ], ["P1"]);
    } catch (caught) { error = caught; }
    equal(!!error, true);
    equal(/одинаковые received_at и created_at/.test(String(error && error.message)), true);
  });

  test("reconciliation reads affected item rows and only their parent supplies", function () {
    var originalMultiRead = di3ReadRowsByColumnValues_;
    var originalFullRead = di3ReadTableValues_;
    var calls = [];
    var itemRows = [
      item("S-A", 1, "P1", "V-1"),
      item("S-B", 1, "P2", "V-2")
    ];
    var parentRows = [
      supply("S-A", "2026-11-20T10:00:00Z"),
      supply("S-B", "2026-11-21T10:00:00Z")
    ];
    try {
      di3ReadRowsByColumnValues_ = function (table, column, keys) {
        calls.push({ table: table, column: column, keys: keys.slice().sort() });
        if (table === "V3_SupplyItems") {
          return itemRows.filter(function (row) { return keys.indexOf(String(row[column] || "")) !== -1; })
            .map(function (values, index) { return { row_number: index + 2, values: values }; });
        }
        if (table === "V3_Supplies") {
          return parentRows.filter(function (row) { return keys.indexOf(String(row[column] || "")) !== -1; })
            .map(function (values, index) { return { row_number: index + 2, values: values }; });
        }
        throw new Error("Unexpected table " + table);
      };
      di3ReadTableValues_ = function () { throw new Error("Unexpected full-table read"); };
      var result = di3ReadPackVariantReconciliationRows_(["P1", "P2"]);
      equal(calls.length, 2);
      equal(calls[0].table, "V3_SupplyItems");
      equal(calls[0].column, DI3_TABLE_SCHEMAS.V3_SupplyItems.indexOf("product_id"));
      equal(calls[1].table, "V3_Supplies");
      equal(calls[1].column, DI3_TABLE_SCHEMAS.V3_Supplies.indexOf("supply_id"));
      equal(result.itemRows.length, 2);
      equal(result.supplyRows.length, 2);
    } finally {
      di3ReadRowsByColumnValues_ = originalMultiRead;
      di3ReadTableValues_ = originalFullRead;
    }
  });

  test("blank affected item supply_id retains full parent scan for fail-closed identity checks", function () {
    var originalMultiRead = di3ReadRowsByColumnValues_;
    var originalFullRead = di3ReadTableValues_;
    var fullReadTables = [];
    var blankItem = item("", 1, "P1", "V-1");
    var parentRows = [supply("S1", "2026-11-20T10:00:00Z")];
    try {
      di3ReadRowsByColumnValues_ = function (table, column) {
        if (table !== "V3_SupplyItems" || column !== DI3_TABLE_SCHEMAS.V3_SupplyItems.indexOf("product_id")) {
          throw new Error("Unexpected selective read");
        }
        return [{ row_number: 2, values: blankItem }];
      };
      di3ReadTableValues_ = function (table) {
        fullReadTables.push(table);
        return parentRows;
      };
      var result = di3ReadPackVariantReconciliationRows_(["P1"]);
      equal(fullReadTables.length, 1);
      equal(fullReadTables[0], "V3_Supplies");
      equal(result.itemRows.length, 1);
      equal(result.supplyRows.length, 1);
    } finally {
      di3ReadRowsByColumnValues_ = originalMultiRead;
      di3ReadTableValues_ = originalFullRead;
    }
  });

  test("no affected supply items avoids reading the parent supply table", function () {
    var originalMultiRead = di3ReadRowsByColumnValues_;
    var originalFullRead = di3ReadTableValues_;
    var fullReads = 0;
    try {
      di3ReadRowsByColumnValues_ = function () { return []; };
      di3ReadTableValues_ = function () { fullReads++; return []; };
      var result = di3ReadPackVariantReconciliationRows_(["P1"]);
      equal(result.itemRows.length, 0);
      equal(result.supplyRows.length, 0);
      equal(fullReads, 0);
    } finally {
      di3ReadRowsByColumnValues_ = originalMultiRead;
      di3ReadTableValues_ = originalFullRead;
    }
  });

  var report = { passed: passed, failed: failed.length, failures: failed };
  if (failed.length) throw new Error("Supply correction pack variant tests failed: " + JSON.stringify(failed));
  return report;
}
