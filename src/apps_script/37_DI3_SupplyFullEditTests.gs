/** Pure and structural tests for controlled full supply editing. */
function di3RunSupplyFullEditUnitTests() {
  var passed = 0;
  var failed = [];
  function test(name, callback) {
    try { callback(); passed++; }
    catch (error) { failed.push({ name: name, error: error.message || String(error) }); }
  }
  function equal(actual, expected, message) {
    if (actual !== expected) throw new Error((message || "Values differ") + ": expected " + JSON.stringify(expected) + ", got " + JSON.stringify(actual));
  }
  function includes(source, fragment, message) {
    equal(String(source).indexOf(fragment) !== -1, true, message || ("Expected source to contain: " + fragment));
  }
  function throws(callback, pattern) {
    var error = null;
    try { callback(); } catch (caught) { error = caught; }
    if (!error) throw new Error("Expected error matching " + pattern + ", but no error was thrown");
    if (pattern && !pattern.test(String(error.message || error))) {
      throw new Error("Expected error matching " + pattern + ", got: " + String(error.message || error));
    }
  }
  var fixedNow = new Date(2026, 10, 23, 12, 0, 0).getTime();
  function dates() {
    return {
      order_date: new Date(2026, 6, 2, 0, 0, 0),
      expected_date: new Date(2026, 6, 15, 0, 0, 0),
      sent_at: new Date(2026, 6, 4, 10, 0, 0),
      awaiting_at: new Date(2026, 6, 12, 12, 0, 0),
      received_at: new Date(2026, 6, 14, 15, 0, 0)
    };
  }

  test("full edit accepts the requested historical date correction 02.07 -> 04.07", function () {
    var input = dates();
    input.sent_at = new Date(2026, 6, 4, 0, 0, 0);
    var result = di3ValidateSupplyFullEditDates_(input, fixedNow);
    equal(result.sent_at.getFullYear(), 2026);
    equal(result.sent_at.getMonth(), 6);
    equal(result.sent_at.getDate(), 4);
  });
  test("full edit accepts an incomplete SENT document with only G5", function () {
    var input = dates(); input.awaiting_at = ""; input.received_at = "";
    equal(di3ValidateSupplyFullEditDates_(input, fixedNow).awaiting_at, null);
  });
  test("full edit accepts an AWAITING document with G5 and G6", function () {
    var input = dates(); input.received_at = "";
    equal(di3ValidateSupplyFullEditDates_(input, fixedNow).received_at, null);
  });
  test("full edit accepts an empty optional expected arrival date", function () {
    var input = dates(); input.expected_date = "";
    equal(di3ValidateSupplyFullEditDates_(input, fixedNow).expected_date, null);
  });
  test("full edit rejects G5 earlier than the store order date", function () {
    var input = dates(); input.sent_at = new Date(2026, 6, 1, 23, 59, 0);
    throws(function () { di3ValidateSupplyFullEditDates_(input, fixedNow); }, /G5 не может быть раньше даты заказа G2/);
  });
  test("full edit rejects G6 without G5", function () {
    var input = dates(); input.sent_at = "";
    throws(function () { di3ValidateSupplyFullEditDates_(input, fixedNow); }, /без фактической даты отправки G5/);
  });
  test("full edit rejects G7 without G6", function () {
    var input = dates(); input.awaiting_at = "";
    throws(function () { di3ValidateSupplyFullEditDates_(input, fixedNow); }, /без фактической даты.*G6/);
  });
  test("full edit rejects G6 earlier than G5", function () {
    var input = dates(); input.awaiting_at = new Date(2026, 6, 4, 9, 59, 59);
    throws(function () { di3ValidateSupplyFullEditDates_(input, fixedNow); }, /G6 не может быть раньше даты отправки G5/);
  });
  test("full edit rejects G7 earlier than G6", function () {
    var input = dates(); input.received_at = new Date(2026, 6, 12, 11, 59, 59);
    throws(function () { di3ValidateSupplyFullEditDates_(input, fixedNow); }, /G7 не может быть раньше даты ожидания получения G6/);
  });
  test("full edit rejects future factual dates", function () {
    var input = dates(); input.sent_at = new Date(2026, 10, 24, 9, 0, 0);
    throws(function () { di3ValidateSupplyFullEditDates_(input, fixedNow); }, /не может быть в будущем/);
  });
  test("full edit rejects an expected arrival before the store order date", function () {
    var input = dates(); input.expected_date = new Date(2026, 6, 1, 0, 0, 0);
    throws(function () { di3ValidateSupplyFullEditDates_(input, fixedNow); }, /Ожидаемая дата прибытия не может быть раньше даты создания заказа/);
  });
  test("full edit fingerprint is stable for equivalent normalized snapshots", function () {
    var left = { supply: ["SUP-1", new Date(2026, 6, 4)], items: [["ITEM-1", 5]] };
    var right = { supply: ["SUP-1", new Date(2026, 6, 4)], items: [["ITEM-1", 5]] };
    equal(di3SupplyFullEditHash_(left), di3SupplyFullEditHash_(right));
  });
  test("full edit fingerprint changes when a business field changes", function () {
    var before = { supplier: "A", shipping: 0 };
    var after = { supplier: "A", shipping: 10 };
    equal(di3SupplyFullEditHash_(before) === di3SupplyFullEditHash_(after), false);
  });
  test("document edit handler is registered as a dedicated OperationExecutor type", function () {
    var registry = di3GetOperationHandlerRegistry_();
    equal(typeof registry.SUPPLY_DOCUMENT_EDIT, "function");
    equal(registry.SUPPLY_DOCUMENT_EDIT, di3ApplySupplyDocumentEditOperation_);
  });
  test("document edit handler never writes receipt, ledger, lots or FIFO projections", function () {
    var source = di3ApplySupplyDocumentEditOperation_.toString();
    equal(/di3AppendTableRows_\(\s*["']StockLedger/.test(source), false);
    equal(/di3AppendTableRows_\(\s*["']StockLots/.test(source), false);
    equal(/di3RebuildFifoAllocations_\s*\(/.test(source), false);
    equal(/di3CreateSupplyReceiptOperation_\s*\(/.test(source), false);
  });
  test("full edit status history records adjacent forward transitions instead of skipping stages", function () {
    var transitions = di3BuildSupplyFullEditStatusHistoryTransitions_(DI3_SUPPLY_STATUS.CREATED, DI3_SUPPLY_STATUS.AWAITING);
    equal(JSON.stringify(transitions), JSON.stringify([[DI3_SUPPLY_STATUS.CREATED, DI3_SUPPLY_STATUS.SENT], [DI3_SUPPLY_STATUS.SENT, DI3_SUPPLY_STATUS.AWAITING]]));
  });
  test("full edit status history records adjacent reverse corrections", function () {
    var transitions = di3BuildSupplyFullEditStatusHistoryTransitions_(DI3_SUPPLY_STATUS.AWAITING, DI3_SUPPLY_STATUS.CREATED);
    equal(JSON.stringify(transitions), JSON.stringify([[DI3_SUPPLY_STATUS.AWAITING, DI3_SUPPLY_STATUS.SENT], [DI3_SUPPLY_STATUS.SENT, DI3_SUPPLY_STATUS.CREATED]]));
  });
  test("full edit uses a revision-scoped idempotency key and validates baseline fingerprint", function () {
    var source = di3SaveFullSupplyEdit.toString();
    equal(source.indexOf("SUPPLY_DOCUMENT_EDIT:") !== -1, true);
    equal(source.indexOf("context.revision_id") !== -1, true);
    equal(source.indexOf("snapshot.fingerprint !== context.baseline_hash") !== -1, true);
  });
  test("full edit preserves immutable supply identity and created_at", function () {
    var source = di3ApplySupplyDocumentEditOperation_.toString();
    equal(source.indexOf("targetParent[0] = String(payload.supply_id)") !== -1, true);
    equal(source.indexOf("targetParent[4] = supply.created_at") !== -1, true);
  });
  test("received supply stock-impacting edits fail closed until SUPPLY_CORRECTION exists", function () {
    var source = di3BuildSupplyFullEditPlan_.toString();
    equal(source.indexOf("SUPPLY_CORRECTION") !== -1, true);
    equal(source.indexOf("stockSensitiveChanges") !== -1, true);
    equal(source.indexOf("currentStatus === DI3_SUPPLY_STATUS.RECEIVED && stockSensitiveChanges") !== -1, true);
  });
  test("full edit audit snapshot does not call the mutating quarantine-on-error payload verifier", function () {
    var source = di3BuildSupplyFullEditSnapshot_.toString();
    equal(/di3ReadVerifiedOperationPayload_\s*\(/.test(source), false);
    equal(source.indexOf("payload_integrity") !== -1, true);
  });
  test("received supply full-edit mode requires a verified immutable receipt payload", function () {
    var enableSource = di3EnableFullSupplyEditMode.toString();
    var handlerSource = di3ApplySupplyDocumentEditOperation_.toString();
    equal(enableSource.indexOf("snapshot.receipt_operation.payload_integrity !== \"VALID\"") !== -1, true);
    equal(handlerSource.indexOf("receiptAudit.payload_integrity !== \"VALID\"") !== -1, true);
  });

  test("interactive full-edit snapshots skip unrelated stock audit tables but retain receipt verification", function () {
    var snapshotSource = di3BuildSupplyFullEditSnapshot_.toString();
    var enableSource = di3EnableFullSupplyEditMode.toString();
    var saveSource = di3SaveFullSupplyEdit.toString();
    includes(snapshotSource, "options.includeStockAudit !== false");
    includes(snapshotSource, "if (includeStockAudit)");
    includes(snapshotSource, "options.includeReceiptPayload !== false");
    includes(snapshotSource, "options.supply || di3GetSupplyById_(id)");
    includes(snapshotSource, "options.receiptOperation");
    includes(enableSource, "includeStockAudit: false");
    includes(enableSource, "includeReceiptPayload: status === DI3_SUPPLY_STATUS.RECEIVED");
    includes(enableSource, "receiptOperation: receipt");
    includes(saveSource, "includeStockAudit: false");
    includes(saveSource, "includeReceiptPayload: false");
    // The public audit entry point deliberately keeps the default, complete snapshot.
    includes(di3AuditSupplyForFullEdit.toString(), "di3BuildSupplyFullEditSnapshot_(id)");
  });

  test("full-edit cancel and successful reload can reuse existing form validations", function () {
    var endSource = di3EndFullSupplyEditMode.toString();
    var loadSource = di3LoadSelectedSupplyDraft.toString();
    includes(endSource, "skipValidationRefresh: true");
    includes(endSource, "di3SetSupplySelectorValidation_(sheet, current.supply_number)");
    includes(loadSource, "options.skipValidationRefresh !== true");
  });

  test("full edit auto-preview reacts to quantity, pack size, price and financial inputs", function () {
    equal(di3IsSupplyFullEditFinancialInputRange_(12, 2, 1, 1), true, "units per pack");
    equal(di3IsSupplyFullEditFinancialInputRange_(12, 3, 1, 1), true, "pack count");
    equal(di3IsSupplyFullEditFinancialInputRange_(12, 4, 1, 1), true, "purchase price");
    equal(di3IsSupplyFullEditFinancialInputRange_(12, 1, 1, 1), true, "product");
    equal(di3IsSupplyFullEditFinancialInputRange_(5, 2, 1, 1), true, "seller discount");
    equal(di3IsSupplyFullEditFinancialInputRange_(6, 2, 2, 1), true, "partner discount and shipping paste");
    equal(di3IsSupplyFullEditFinancialInputRange_(12, 5, 1, 1), false, "calculated columns do not trigger recalculation");
    equal(di3IsSupplyFullEditFinancialInputRange_(8, 2, 1, 1), false, "notes do not trigger recalculation");
    equal(di3IsSupplyFullEditFinancialInputRange_(31, 1, 1, 4), true, "last supported item row");
    equal(di3IsSupplyFullEditFinancialInputRange_(32, 1, 1, 4), false, "rows below supply form do not trigger recalculation");
  });
  test("changing units per pack recalculates received units and unit cost", function () {
    var original = di3BuildSupplyFinancialPlan_({
      lines: [{ product_id: "P1", pack_variant_id: "V20", units_per_pack: 20, packs: 3, purchase_price_per_pack: 100 }],
      seller_discount_amount: 10, partner_discount_amount: 20, shipping_amount: 15
    });
    var changed = di3BuildSupplyFinancialPlan_({
      lines: [{ product_id: "P1", pack_variant_id: "V40", units_per_pack: 40, packs: 3, purchase_price_per_pack: 100 }],
      seller_discount_amount: 10, partner_discount_amount: 20, shipping_amount: 15
    });
    equal(original.lines[0].received_units, 60);
    equal(changed.lines[0].received_units, 120);
    equal(changed.goods_amount, original.goods_amount);
    equal(changed.final_amount, original.final_amount);
    equal(changed.lines[0].final_line_amount, original.lines[0].final_line_amount);
    equal(changed.lines[0].unit_cost, original.lines[0].unit_cost / 2);
  });
  test("changing pack count recalculates goods, discounts, shipping and final unit cost", function () {
    var original = di3BuildSupplyFinancialPlan_({
      lines: [{ product_id: "P1", pack_variant_id: "V20", units_per_pack: 20, packs: 3, purchase_price_per_pack: 100 }],
      seller_discount_amount: 10, partner_discount_amount: 20, shipping_amount: 15
    });
    var changed = di3BuildSupplyFinancialPlan_({
      lines: [{ product_id: "P1", pack_variant_id: "V20", units_per_pack: 20, packs: 4, purchase_price_per_pack: 100 }],
      seller_discount_amount: 10, partner_discount_amount: 20, shipping_amount: 15
    });
    equal(changed.lines[0].received_units, 80);
    equal(changed.goods_amount, 400);
    equal(changed.discount_total, 30);
    equal(changed.shipping_amount, 15);
    equal(changed.final_amount, 385);
    equal(changed.lines[0].final_pack_cost, 96.25);
    equal(changed.lines[0].unit_cost, 4.8125);
  });
  test("full edit automatic preview is read-only and never posts stock or creates pack variants", function () {
    var source = di3RefreshSupplyFullEditFinancialPreview_.toString();
    equal(source.indexOf("di3ResolveSupplyFormLines_(false, true)") !== -1, true);
    equal(source.indexOf("di3GetOrCreatePackVariant_") === -1, true);
    var resolverSource = di3ResolveSupplyFormLines_.toString();
    equal(resolverSource.indexOf("di3LoadSupplyFormLineSnapshot_(readOnlyCatalog)") !== -1, true);
    var snapshotSource = di3LoadSupplyFormLineSnapshot_.toString();
    equal(snapshotSource.indexOf("di3GetProductFormOptionIndex_(readOnlyCatalog === true)") !== -1, true);
    var indexSource = di3GetProductFormOptionIndex_.toString();
    equal(indexSource.indexOf("if (skipPublicCodeEnsure !== true)") !== -1, true);
    equal(source.indexOf("di3AppendTableRows_") === -1, true);
    equal(source.indexOf("di3RebuildFifoAllocations_") === -1, true);
    var handler = di3SupplyFormOnEdit.toString();
    equal(handler.indexOf("di3IsSupplyFullEditFinancialInputRange_") !== -1, true);
    equal(handler.indexOf("di3RefreshSupplyFullEditFinancialPreview_") !== -1, true);
  });

  test("full edit item projection batches identity resolution and plans updates, appends and removals", function () {
    var plan = di3BuildSupplyFullEditItemProjectionPlan_([
      ["I1", "S1", "P1", "V1"],
      ["I3", "S1", "P3", "V3"]
    ], ["I2"], [
      { row_number: 10, values: ["I1", "S1", "P1", "V1"] },
      { row_number: 11, values: ["I2", "S1", "P2", "V2"] }
    ], "S1");
    equal(plan.item_updates.length, 1);
    equal(plan.item_updates[0].row_number, 10);
    equal(plan.item_appends.length, 1);
    equal(plan.item_appends[0][0], "I3");
    equal(plan.remove_row_numbers.length, 1);
    equal(plan.remove_row_numbers[0], 11);
  });
  test("full edit item projection rejects target IDs owned by another supply", function () {
    throws(function () {
      di3BuildSupplyFullEditItemProjectionPlan_([["I1", "S1"]], [], [
        { row_number: 10, values: ["I1", "S2"] }
      ], "S1");
    }, /принадлежит другой поставке/);
  });
  test("full edit item projection rejects removal IDs owned by another supply", function () {
    throws(function () {
      di3BuildSupplyFullEditItemProjectionPlan_([], ["I1"], [
        { row_number: 10, values: ["I1", "S2"] }
      ], "S1");
    }, /удалить товарную строку другой поставки/);
  });
  test("full edit item projection rejects target/removal overlap and duplicate database identities", function () {
    throws(function () {
      di3BuildSupplyFullEditItemProjectionPlan_([["I1", "S1"]], ["I1"], [], "S1");
    }, /одновременно добавлена и помечена к удалению/);
    throws(function () {
      di3BuildSupplyFullEditItemProjectionPlan_([["I1", "S1"]], [], [
        { row_number: 10, values: ["I1", "S1"] },
        { row_number: 11, values: ["I1", "S1"] }
      ], "S1");
    }, /повторяющийся supply_item_id/);
  });
  test("full edit item projection rejects duplicate and empty payload identities", function () {
    throws(function () {
      di3BuildSupplyFullEditItemProjectionPlan_([["I1", "S1"], ["I1", "S1"]], [], [], "S1");
    }, /повторяется или не согласован supply_item_id/);
    throws(function () {
      di3BuildSupplyFullEditItemProjectionPlan_([["", "S1"]], [], [], "S1");
    }, /повторяется или не согласован supply_item_id/);
    throws(function () {
      di3BuildSupplyFullEditItemProjectionPlan_([], [""], [], "S1");
    }, /удаляемый supply_item_id/);
  });
  test("full edit handler resolves all item IDs in one batch before parent projection write", function () {
    var source = di3ApplySupplyDocumentEditOperation_.toString();
    equal(source.indexOf("di3ReadRowsByColumnValues_(\"V3_SupplyItems\", 0, lookupIds)") !== -1, true);
    equal(/di3FindRowByFirstColumn_\s*\(\s*[\"']V3_SupplyItems/.test(source), false);
    equal(source.indexOf("di3BuildSupplyFullEditItemProjectionPlan_") < source.indexOf("di3ApplyContiguousRowUpdates_(\"V3_Supplies\""), true);
  });

  test("full edit validation and materialization share one form/catalogue snapshot", function () {
    var planSource = di3BuildSupplyFullEditPlan_.toString();
    var saveSource = di3SaveFullSupplyEdit.toString();
    equal(planSource.indexOf("di3ResolveSupplyFormLines_(false, false, lineSnapshot)") !== -1, true);
    equal(planSource.indexOf("di3ResolveSupplyFormLines_(true, false, lineSnapshot)") !== -1, true);
    equal(saveSource.indexOf("var lineSnapshot = di3LoadSupplyFormLineSnapshot_(false)") !== -1, true);
    equal(saveSource.indexOf("di3BuildSupplyFullEditPlan_(context, false, lineSnapshot)") !== -1, true);
    equal(saveSource.indexOf("di3BuildSupplyFullEditPlan_(context, true, lineSnapshot)") !== -1, true);
  });

  var report = { passed: passed, failed: failed.length, failures: failed };
  if (failed.length) throw new Error("Supply full editing tests failed: " + JSON.stringify(failed));
  return report;
}
