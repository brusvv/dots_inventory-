/** Pure and structural regression tests for SC-01 received-supply source audit. */
function di3RunSupplyCorrectionUnitTests() {
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
  function fixture() {
    var effective = new Date("2026-11-20T10:00:00.000Z");
    var recorded = new Date("2026-11-20T11:00:00.000Z");
    return {
      operation: { values: ["OP-1", "SUPPLY_RECEIVE:S1", "SUPPLY_RECEIVE", "SUPPLY", "S1",
        "COMMITTED", "PAYLOAD-HASH", new Date("2026-11-20T11:01:00.000Z"),
        new Date("2026-11-20T11:02:00.000Z"), "", "actor@example.test"] },
      payload: { supply_id: "S1", supply_number: "26NR201", received_at: effective.toISOString(),
        recorded_at: recorded.toISOString(), lines: [{
          supply_item_id: "ITEM-1", movement_id: "MOVE-1", lot_id: "LOT-1",
          event_key: "SUPPLY_RECEIVE:S1:ITEM-1", product_id: "P1", pack_variant_id: "VAR-20",
          units_per_pack: 20, packs: 2, quantity: 40, unit_cost: 4.5,
          total_cost_minor: 18000, cost_status: "KNOWN",
          effective_at: effective.toISOString(), recorded_at: recorded.toISOString()
        }] },
      ledger: [{ row_number: 2, values: ["MOVE-1", "OP-1", "SUPPLY_RECEIVE:S1:ITEM-1", "P1", "SUPPLY", "S1",
        40, effective, recorded, "", "", "Приёмка поставки 26NR201", 101] }],
      details: [{ row_number: 2, values: ["MOVE-1", "MOV-000101", "IN", "SUPPLY_RECEIVE", "", "", "KNOWN", "",
        "actor@example.test", "Приёмка поставки 26NR201", "SUPPLY"] }],
      lots: [{ row_number: 2, values: ["LOT-1", "P1", "MOVE-1", "SUPPLY", "S1", "VAR-20",
        effective, recorded, 40, 4.5, "KNOWN", "RUB", "Поставка 26NR201", 40, 18000] }]
    };
  }
  function audit(data) {
    return di3BuildSupplyCorrectionSourceMap_(data.operation, data.payload, data.ledger, data.details, data.lots);
  }

  test("valid committed receipt maps each payload line to exactly one ledger, detail and lot", function () {
    var result = audit(fixture());
    equal(result.status, "VALID");
    equal(result.source_lines.length, 1);
    equal(result.source_lines[0].movement_id, "MOVE-1");
    equal(result.source_lines[0].lot_id, "LOT-1");
    equal(result.source_lines[0].quantity, 40);
    equal(result.affected_product_ids.join(","), "P1");
    equal(result.fingerprint.length > 0, true);
  });
  test("source audit rejects non-committed and non-receipt operations", function () {
    var data = fixture(); data.operation.values[5] = "PREPARED";
    throws(function () { audit(data); }, /не имеет статус COMMITTED/);
    data = fixture(); data.operation.values[2] = "SUPPLY_DOCUMENT_EDIT";
    throws(function () { audit(data); }, /не соответствует SUPPLY_RECEIVE/);
  });
  test("source audit rejects duplicate source item, movement, lot and event identities", function () {
    ["supply_item_id", "movement_id", "lot_id", "event_key"].forEach(function (field) {
      var data = fixture(), duplicate = Object.assign({}, data.payload.lines[0]);
      duplicate.supply_item_id = "ITEM-2";
      duplicate[field] = data.payload.lines[0][field];
      data.payload.lines.push(duplicate);
      throws(function () { audit(data); }, /повторяется идентификатор/);
    });
  });
  test("source audit rejects missing and duplicate ledger, detail and lot records", function () {
    var data = fixture(); data.ledger = [];
    throws(function () { audit(data); }, /ровно одна запись|Количество движений/);
    data = fixture(); data.details.push(data.details[0]);
    throws(function () { audit(data); }, /Количество деталей движений/);
    data = fixture(); data.lots = [];
    throws(function () { audit(data); }, /Количество FIFO-партий/);
    data = fixture(); data.lots.push(data.lots[0]);
    throws(function () { audit(data); }, /Количество FIFO-партий/);
  });
  test("source audit rejects ledger operation, event, product, document and quantity mismatches", function () {
    var mutations = [
      function (d) { d.ledger[0].values[1] = "OTHER-OP"; },
      function (d) { d.ledger[0].values[2] = "OTHER-EVENT"; },
      function (d) { d.ledger[0].values[3] = "OTHER-PRODUCT"; },
      function (d) { d.ledger[0].values[5] = "OTHER-SUPPLY"; },
      function (d) { d.ledger[0].values[6] = -40; }
    ];
    mutations.forEach(function (mutate) {
      var data = fixture(); mutate(data);
      throws(function () { audit(data); }, /StockLedger|операции/);
    });
  });
  test("source audit rejects detail and lot identity/cost mismatches", function () {
    var data = fixture(); data.details[0].values[2] = "OUT";
    throws(function () { audit(data); }, /StockMovementDetails/);
    data = fixture(); data.lots[0].values[5] = "VAR-40";
    throws(function () { audit(data); }, /StockLots/);
    data = fixture(); data.lots[0].values[14] = 17999;
    throws(function () { audit(data); }, /total_cost_minor/);
  });
  test("source audit rejects quantity formula and date/sequence mismatches", function () {
    var data = fixture(); data.payload.lines[0].packs = 3;
    throws(function () { audit(data); }, /packs × units_per_pack/);
    data = fixture(); data.ledger[0].values[8] = new Date("2026-11-20T11:03:00.000Z");
    throws(function () { audit(data); }, /recorded_at/);
    data = fixture(); data.ledger[0].values[12] = 0;
    throws(function () { audit(data); }, /ledger_sequence/);
  });
  test("source audit rejects extra movements belonging to the original receipt operation", function () {
    var data = fixture();
    data.ledger.push({ row_number: 3, values: ["MOVE-EXTRA", "OP-1", "EXTRA", "P1", "SUPPLY", "S1", 1,
      new Date("2026-11-20T10:00:00.000Z"), new Date("2026-11-20T11:00:00.000Z"), "", "", "", 102] });
    throws(function () { audit(data); }, /лишние складские движения|Количество движений/);
  });
  test("SC-01 entry point is structurally read-only", function () {
    var source = di3AuditSupplyCorrectionSource.toString();
    ["di3FindRowByFirstColumn_", "di3ReadRowsByColumnValue_", "di3ReadRowsByColumnValues_", "di3BuildSupplyCorrectionSourceMap_"].forEach(function (name) {
      equal(source.indexOf(name) !== -1, true);
    });
    ["di3WithLock_(", "di3EnsureCoreFoundationSchemas_(", "di3AppendTableRows_(", "di3ExecutePreparedOperation_(", "di3RebuildFifoAllocations_("].forEach(function (name) {
      equal(source.indexOf(name), -1, "SC-01 must not call " + name);
    });
    equal(/\.setValue\s*\(/.test(source), false);
    equal(/\.deleteRow\s*\(/.test(source), false);
    equal(/\.appendRow\s*\(/.test(source), false);
  });

  var report = { passed: passed, failed: failed.length, failures: failed };
  if (failed.length) throw new Error("Supply correction source audit tests failed: " + JSON.stringify(failed));
  return report;
}
