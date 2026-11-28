/** Pure tests for supply transition and receipt planning invariants. */
function di3RunSupplyReceivingUnitTests() {
  var passed = 0;
  var failed = [];
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

  test("status history idempotency is scoped to the exact transition event", function () {
    var firstAt = new Date("2026-11-01T10:00:00.000Z");
    var retryAt = new Date("2026-11-01T10:00:00.000Z");
    var laterAt = new Date("2026-11-03T12:30:00.000Z");
    var row = ["H1", "SUPPLY", "S1", DI3_SUPPLY_STATUS.CREATED, DI3_SUPPLY_STATUS.SENT,
      firstAt, "actor@example.test", "", "sent"];
    equal(di3SupplyStatusHistoryEventMatches_(row, "S1", DI3_SUPPLY_STATUS.CREATED,
      DI3_SUPPLY_STATUS.SENT, retryAt, ""), true);
    equal(di3SupplyStatusHistoryEventMatches_(row, "S1", DI3_SUPPLY_STATUS.CREATED,
      DI3_SUPPLY_STATUS.SENT, laterAt, ""), false,
      "a later transition to the same status must be recorded after a rollback");
    equal(di3SupplyStatusHistoryEventMatches_(row, "S1", DI3_SUPPLY_STATUS.AWAITING,
      DI3_SUPPLY_STATUS.SENT, retryAt, ""), false);
    equal(di3SupplyStatusHistoryEventMatches_(row, "S1", DI3_SUPPLY_STATUS.CREATED,
      DI3_SUPPLY_STATUS.SENT, retryAt, "different-operation"), false);
  });

  test("supply state machine only permits the next transition", function () {
    equal(DI3_SUPPLY_STATUS_TRANSITIONS[DI3_SUPPLY_STATUS.CREATED], DI3_SUPPLY_STATUS.SENT);
    equal(DI3_SUPPLY_STATUS_TRANSITIONS[DI3_SUPPLY_STATUS.SENT], DI3_SUPPLY_STATUS.AWAITING);
    equal(DI3_SUPPLY_STATUS_TRANSITIONS[DI3_SUPPLY_STATUS.AWAITING], DI3_SUPPLY_STATUS.RECEIVED);
    equal(DI3_SUPPLY_STATUS_TRANSITIONS[DI3_SUPPLY_STATUS.RECEIVED], undefined);
  });
  test("skipping a supply stage is rejected", function () {
    throws(function () { di3ValidateSupplyStatusTransition_(DI3_SUPPLY_STATUS.CREATED, DI3_SUPPLY_STATUS.AWAITING); }, /Недопустимый переход/);
  });
  test("cancelled supply is terminal and has a normalized user-facing label", function () {
    equal(DI3_SUPPLY_STATUS_TRANSITIONS[DI3_SUPPLY_STATUS.CANCELLED], undefined);
    equal(di3GetSupplyStatusLabel_(DI3_SUPPLY_STATUS.CANCELLED), "Отменена");
  });
  test("draft, sent and awaiting supplies may be cancelled before receipt", function () {
    [DI3_SUPPLY_STATUS.CREATED, DI3_SUPPLY_STATUS.SENT, DI3_SUPPLY_STATUS.AWAITING].forEach(function (status) {
      equal(di3ValidateSupplyCancellation_({ supply_id: "S1", status: status }, null, 0).already_cancelled, false);
    });
  });
  test("received supply cannot be cancelled", function () {
    throws(function () { di3ValidateSupplyCancellation_({ supply_id: "S1", status: DI3_SUPPLY_STATUS.RECEIVED }, null, 0); }, /Полученную поставку отменить нельзя/);
  });
  test("cancellation is blocked when receipt operation or stock movement exists", function () {
    throws(function () { di3ValidateSupplyCancellation_({ supply_id: "S1", status: DI3_SUPPLY_STATUS.AWAITING }, { values: ["OP", "KEY", "SUPPLY_RECEIVE", "SUPPLY", "S1", "PREPARED"] }, 0); }, /операция приёмки/);
    throws(function () { di3ValidateSupplyCancellation_({ supply_id: "S1", status: DI3_SUPPLY_STATUS.AWAITING }, null, 1); }, /складские движения/);
  });
  test("repeated cancellation is identified as already cancelled", function () {
    equal(di3ValidateSupplyCancellation_({ supply_id: "S1", status: DI3_SUPPLY_STATUS.CANCELLED }, null, 0).already_cancelled, true);
  });
  test("receipt date parser accepts Russian date and time", function () {
    var date = di3ParseSupplyEffectiveDate_("20.11.2026 14:35", null);
    equal(date.getFullYear(), 2026);
    equal(date.getMonth(), 10);
    equal(date.getDate(), 20);
    equal(date.getHours(), 14);
    equal(date.getMinutes(), 35);
  });
  test("invalid receipt date is rejected", function () {
    throws(function () { di3ParseSupplyEffectiveDate_("not-a-date", null); }, /Не удалось распознать дату/);
  });
  test("missing supply stage date is rejected instead of silently using today", function () {
    throws(function () { di3ParseSupplyEffectiveDate_("", null); }, /Текущая дата автоматически не подставляется/);
    throws(function () { di3ParseSupplyEffectiveDate_(null, null); }, /Текущая дата автоматически не подставляется/);
  });
  test("invalid Russian calendar dates and times are rejected", function () {
    throws(function () { di3ParseSupplyEffectiveDate_("31.02.2026 12:00", null); }, /календарной даты не существует/);
    throws(function () { di3ParseSupplyEffectiveDate_("20.11.2026 25:00", null); }, /Некорректное время/);
  });
  test("display status labels normalize to the same next-stage inputs as stored statuses", function () {
    equal(di3NormalizeSupplyStatus_("Оформлена"), DI3_SUPPLY_STATUS.CREATED);
    equal(di3NormalizeSupplyStatus_("Создана"), DI3_SUPPLY_STATUS.CREATED);
    equal(di3NormalizeSupplyStatus_("Отправлена"), DI3_SUPPLY_STATUS.SENT);
    equal(di3NormalizeSupplyStatus_("Получена"), DI3_SUPPLY_STATUS.RECEIVED);
    equal(di3GetNextSupplyStageConfig_("Оформлена").input_cell, "G5");
    equal(di3GetNextSupplyStageConfig_("Отправлена").input_cell, "G6");
    equal(di3GetNextSupplyStageConfig_("Ожидает получения").input_cell, "G7");
  });
  test("form stage input follows the supply state machine in order", function () {
    var sent = di3GetNextSupplyStageConfig_(DI3_SUPPLY_STATUS.CREATED);
    equal(sent.input_cell, "G5");
    equal(sent.date_field, "sent_at");
    equal(sent.next_status, DI3_SUPPLY_STATUS.SENT);
    var awaiting = di3GetNextSupplyStageConfig_(DI3_SUPPLY_STATUS.SENT);
    equal(awaiting.input_cell, "G6");
    equal(awaiting.date_field, "awaiting_at");
    equal(awaiting.next_status, DI3_SUPPLY_STATUS.AWAITING);
    var received = di3GetNextSupplyStageConfig_(DI3_SUPPLY_STATUS.AWAITING);
    equal(received.input_cell, "G7");
    equal(received.date_field, "received_at");
    equal(received.next_status, DI3_SUPPLY_STATUS.RECEIVED);
    equal(received.requires_receipt_confirmation, true);
    equal(di3GetNextSupplyStageConfig_(DI3_SUPPLY_STATUS.RECEIVED), null);
    equal(di3GetNextSupplyStageConfig_(DI3_SUPPLY_STATUS.CANCELLED), null);
  });
  test("first supply stage is bounded by the store order date, not the later system-created timestamp", function () {
    var supply = {
      supplier_order_date: new Date(2026, 10, 20, 12, 0, 0),
      created_at: new Date(2026, 10, 23, 15, 0, 0)
    };
    var boundary = di3GetSupplyPreviousDate_(supply, DI3_SUPPLY_STATUS.SENT);
    equal(boundary.getFullYear(), 2026);
    equal(boundary.getMonth(), 10);
    equal(boundary.getDate(), 20);
    equal(boundary.getHours(), 0, "same-day morning dispatch must be allowed");
  });
  test("legacy supply without a store order date falls back to the system-created timestamp", function () {
    var createdAt = new Date(2026, 10, 23, 15, 0, 0);
    equal(di3GetSupplyPreviousDate_({ created_at: createdAt }, DI3_SUPPLY_STATUS.SENT).getTime(), createdAt.getTime());
  });
  test("unknown or empty line cost is not silently treated as free", function () {
    var supply = { supply_id: "S1", supply_number: "26NR201" };
    var items = [{ supply_item_id: "I1", product_id: "P1", pack_variant_id: "V1", received_units: 10,
      packs: 1, units_per_pack: 10, unit_cost: "", final_pack_cost: 0 }];
    throws(function () { di3BuildSupplyReceiptPayload_(supply, items, new Date("2026-11-20T10:00:00Z"), new Date()); }, /себестоимость не рассчитана/);
  });
  test("free supply line creates a FREE cost layer", function () {
    var supply = { supply_id: "S1", supply_number: "26NR201" };
    var items = [{ supply_item_id: "I1", product_id: "P1", pack_variant_id: "V1", received_units: 10,
      packs: 1, units_per_pack: 10, unit_cost: 0, final_pack_cost: 0 }];
    // Isolate code-generation dependency for a pure unit test.
    var oldCode = di3NextMovementDisplayCode_;
    di3NextMovementDisplayCode_ = function () { return "MOV-000001"; };
    try {
      var payload = di3BuildSupplyReceiptPayload_(supply, items, new Date("2026-11-20T10:00:00Z"), new Date("2026-11-20T11:00:00Z"));
      equal(payload.lines[0].cost_status, "FREE");
      equal(payload.lines[0].quantity, 10);
      equal(payload.lines[0].display_code, "MOV-000001");
    } finally { di3NextMovementDisplayCode_ = oldCode; }
  });

  var report = { passed: passed, failed: failed.length, failures: failed };
  if (failed.length) throw new Error("Supply receiving tests failed: " + JSON.stringify(failed));
  return report;
}
