/**
 * Reconcile current pack-variant flags after a received supply is corrected.
 * Selection is based on the newest still-received supply document, not on the
 * corrected document alone (which may have older received_at than later buys).
 */
function di3BuildLatestReceivedPackVariantMap_(supplyRows, itemRows, affectedProductIds) {
  var affected = Object.create(null);
  (affectedProductIds || []).forEach(function (id) { affected[String(id)] = true; });
  var supplyHeaders = DI3_TABLE_SCHEMAS.V3_Supplies;
  var itemHeaders = DI3_TABLE_SCHEMAS.V3_SupplyItems;
  var supplyIndex = {
    supply_id: supplyHeaders.indexOf("supply_id"),
    status: supplyHeaders.indexOf("status"),
    created_at: supplyHeaders.indexOf("created_at"),
    received_at: supplyHeaders.indexOf("received_at")
  };
  var itemIndex = {
    supply_id: itemHeaders.indexOf("supply_id"),
    line_no: itemHeaders.indexOf("line_no"),
    product_id: itemHeaders.indexOf("product_id"),
    pack_variant_id: itemHeaders.indexOf("pack_variant_id")
  };
  if (Object.keys(supplyIndex).some(function (key) { return supplyIndex[key] < 0; }) ||
      Object.keys(itemIndex).some(function (key) { return itemIndex[key] < 0; })) {
    throw new Error("PackVariants reconciliation: V3_Supplies/V3_SupplyItems schema is missing required columns.");
  }
  var itemsBySupply = Object.create(null);
  (itemRows || []).forEach(function (row) {
    var supplyId = String(row[itemIndex.supply_id] || "");
    if (!itemsBySupply[supplyId]) itemsBySupply[supplyId] = [];
    itemsBySupply[supplyId].push(row);
  });

  var receivedSupplies = [];
  (supplyRows || []).forEach(function (row) {
    if (di3NormalizeSupplyStatus_(row[supplyIndex.status]) !== DI3_SUPPLY_STATUS.RECEIVED) return;
    var supplyId = String(row[supplyIndex.supply_id] || "");
    var rows = itemsBySupply[supplyId] || [];
    var relevantRows = rows.filter(function (itemRow) {
      return !!affected[String(itemRow[itemIndex.product_id] || "")];
    });
    if (!relevantRows.length) return;
    if (!supplyId) throw new Error("Полученная поставка с затронутым товаром не имеет supply_id.");
    var receivedValue = row[supplyIndex.received_at];
    if (receivedValue === "" || receivedValue == null || !Number.isFinite(new Date(receivedValue).getTime())) {
      throw new Error("Полученная поставка " + supplyId + " имеет некорректный received_at; нельзя безопасно выбрать текущую фасовку.");
    }
    var receivedAt = new Date(receivedValue);
    var createdValue = row[supplyIndex.created_at];
    var createdAt = createdValue === "" || createdValue == null ? new Date(receivedAt) : new Date(createdValue);
    if (!Number.isFinite(createdAt.getTime())) createdAt = new Date(receivedAt);
    receivedSupplies.push({
      supply_id: supplyId,
      received_at: receivedAt,
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
      var productId = String(row[itemIndex.product_id] || "");
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
      var lineNo = Number(row[itemIndex.line_no]);
      if (!Number.isSafeInteger(lineNo) || lineNo <= 0) {
        throw new Error("Поставка " + supply.supply_id + " содержит некорректный line_no для затронутого товара.");
      }
    });
    rows.sort(function (a, b) { return Number(b[2]) - Number(a[2]); });
    var seenLineByProduct = Object.create(null);
    rows.forEach(function (row) {
      var productId = String(row[itemIndex.product_id] || "");
      var lineNo = Number(row[itemIndex.line_no]);
      var duplicateKey = productId + "\\u001f" + lineNo;
      if (seenLineByProduct[duplicateKey]) {
        throw new Error("Поставка " + supply.supply_id + " содержит повторный line_no " + lineNo + " для товара " + productId + ".");
      }
      seenLineByProduct[duplicateKey] = true;
      if (latest[productId]) return;
      var variantId = String(row[itemIndex.pack_variant_id] || "");
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
