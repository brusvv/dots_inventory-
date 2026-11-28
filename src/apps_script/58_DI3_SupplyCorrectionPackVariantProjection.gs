/**
 * Reconcile current pack-variant flags after a received supply is corrected.
 * Selection is based on the newest still-received supply document, not on the
 * corrected document alone (which may have older received_at than later buys).
 */
function di3BuildLatestReceivedPackVariantMap_(supplyRows, itemRows, affectedProductIds) {
  var affected = Object.create(null);
  (affectedProductIds || []).forEach(function (id) { affected[String(id)] = true; });
  var itemsBySupply = Object.create(null);
  (itemRows || []).forEach(function (row) {
    var supplyId = String(row[1] || "");
    if (!itemsBySupply[supplyId]) itemsBySupply[supplyId] = [];
    itemsBySupply[supplyId].push(row);
  });

  var receivedSupplies = [];
  (supplyRows || []).forEach(function (row) {
    if (di3NormalizeSupplyStatus_(row[15]) !== DI3_SUPPLY_STATUS.RECEIVED) return;
    var supplyId = String(row[0] || "");
    var rows = itemsBySupply[supplyId] || [];
    var relevantRows = rows.filter(function (itemRow) {
      return !!affected[String(itemRow[3] || "")];
    });
    if (!relevantRows.length) return;
    if (!supplyId) throw new Error("Полученная поставка с затронутым товаром не имеет supply_id.");
    if (row[18] === "" || row[18] == null || !Number.isFinite(new Date(row[18]).getTime())) {
      throw new Error("Полученная поставка " + supplyId + " имеет некорректный received_at; нельзя безопасно выбрать текущую фасовку.");
    }
    var createdAt = row[16] === "" || row[16] == null ? new Date(row[18]) : new Date(row[16]);
    if (!Number.isFinite(createdAt.getTime())) createdAt = new Date(row[18]);
    receivedSupplies.push({
      supply_id: supplyId,
      received_at: new Date(row[18]),
      created_at: createdAt,
      relevant_rows: relevantRows
    });
  });
  receivedSupplies.sort(function (a, b) {
    var receivedDiff = b.received_at.getTime() - a.received_at.getTime();
    if (receivedDiff) return receivedDiff;
    var createdDiff = b.created_at.getTime() - a.created_at.getTime();
    if (createdDiff) return createdDiff;
    return a.supply_id.localeCompare(b.supply_id);
  });

  var latest = Object.create(null);
  var latestRank = Object.create(null);
  receivedSupplies.forEach(function (supply) {
    var productsInSupply = Object.create(null);
    supply.relevant_rows.forEach(function (row) {
      var productId = String(row[3] || "");
      if (productId) productsInSupply[productId] = true;
    });
    Object.keys(productsInSupply).forEach(function (productId) {
      var prior = latestRank[productId];
      if (!prior) {
        latestRank[productId] = {
          received_at: supply.received_at.getTime(),
          created_at: supply.created_at.getTime(),
          supply_id: supply.supply_id
        };
      } else if (prior.received_at === supply.received_at.getTime() &&
          prior.created_at === supply.created_at.getTime() &&
          prior.supply_id !== supply.supply_id) {
        throw new Error("Невозможно однозначно выбрать текущую фасовку товара " + productId +
          ": полученные поставки " + prior.supply_id + " и " + supply.supply_id +
          " имеют одинаковые received_at и created_at.");
      }
    });
    var rows = supply.relevant_rows.filter(function (row) {
      return !latest[String(row[3] || "")];
    });
    rows.forEach(function (row) {
      var lineNo = Number(row[2]);
      if (!Number.isSafeInteger(lineNo) || lineNo <= 0) {
        throw new Error("Поставка " + supply.supply_id + " содержит некорректный line_no для затронутого товара.");
      }
    });
    rows.sort(function (a, b) { return Number(b[2]) - Number(a[2]); });
    var seenLineByProduct = Object.create(null);
    rows.forEach(function (row) {
      var productId = String(row[3] || "");
      var lineNo = Number(row[2]);
      var duplicateKey = productId + "\\u001f" + lineNo;
      if (seenLineByProduct[duplicateKey]) {
        throw new Error("Поставка " + supply.supply_id + " содержит повторный line_no " + lineNo + " для товара " + productId + ".");
      }
      seenLineByProduct[duplicateKey] = true;
      if (latest[productId]) return;
      var variantId = String(row[5] || "");
      if (!variantId) throw new Error("Полученная поставка " + supply.supply_id + " содержит строку без pack_variant_id для товара " + productId + ".");
      latest[productId] = {
        pack_variant_id: variantId,
        supply_id: supply.supply_id,
        received_at: supply.received_at.toISOString()
      };
    });
  });
  return latest;
}

function di3BuildPackVariantCurrentFlagUpdate_(record, targetVariantId, updatedAt) {
  var shouldBeCurrent = !!targetVariantId && String(record.pack_variant_id) === String(targetVariantId);
  var isCurrent = record.is_current === true || String(record.is_current).toLowerCase() === "true";
  if (shouldBeCurrent === isCurrent) return null;
  var row = DI3_TABLE_SCHEMAS.PackVariants.map(function (header) { return record[header]; });
  row[4] = shouldBeCurrent;
  row[8] = updatedAt instanceof Date ? new Date(updatedAt.getTime()) : new Date(updatedAt || Date.now());
  return { row_number: record.row_number, values: row };
}

function di3ReconcileCurrentPackVariantsForProducts_(productIds) {
  var affected = (productIds || []).map(String).filter(Boolean);
  if (!affected.length) return 0;
  var supplyRows = di3ReadTableValues_("V3_Supplies");
  var itemRows = di3ReadTableValues_("V3_SupplyItems");
  var latest = di3BuildLatestReceivedPackVariantMap_(supplyRows, itemRows, affected);
  var variants = di3LoadPackVariantIndex_();
  var updates = [];
  var updatedAt = new Date();
  Object.keys(variants.byId).forEach(function (variantId) {
    var record = variants.byId[variantId];
    var productId = String(record.product_id);
    if (affected.indexOf(productId) === -1) return;
    var target = latest[productId] || null;
    if (target && (!variants.byId[target.pack_variant_id] ||
        String(variants.byId[target.pack_variant_id].product_id) !== productId)) {
      throw new Error("Последняя полученная поставка указывает на отсутствующую/чужую фасовку " + target.pack_variant_id + ".");
    }
    var update = di3BuildPackVariantCurrentFlagUpdate_(record,
      target ? target.pack_variant_id : "", updatedAt);
    if (update) updates.push(update);
  });
  if (updates.length) di3ApplyContiguousRowUpdates_("PackVariants", updates);
  return updates.length;
}
