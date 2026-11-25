/** Generates internal opaque IDs. UUIDs are never shown in the user-facing sheets. */
function di3MakeUuid_() {
  return Utilities.getUuid();
}

/** Products repository for the clean-start v3 application. */
function di3LoadProductsIndex_() {
  var rows = di3ReadTableValues_("Products");
  var schema = DI3_TABLE_SCHEMAS.Products;
  var byIdentity = {};
  var byId = {};
  rows.forEach(function (row, offset) {
    var record = {};
    schema.forEach(function (header, i) { record[header] = row[i]; });
    var identity = String(record.identity_key || "");
    var productId = String(record.product_id || "");
    if (!identity || !productId) {
      throw new Error('Products: строка ' + (offset + 2) + ' не содержит product_id или identity_key.');
    }
    if (Object.prototype.hasOwnProperty.call(byIdentity, identity)) {
      throw new Error('Products: повторяется identity_key в строках ' + byIdentity[identity].row_number + ' и ' + (offset + 2) + '.');
    }
    if (Object.prototype.hasOwnProperty.call(byId, productId)) {
      throw new Error('Products: повторяется product_id "' + productId + '".');
    }
    record.row_number = offset + 2;
    byIdentity[identity] = record;
    byId[productId] = record;
  });
  return { byIdentity: byIdentity, byId: byId };
}

function di3LoadProductByIdentity_(identityKey) {
  var index = di3LoadProductsIndex_();
  return index.byIdentity[String(identityKey)] || null;
}

function di3LoadProductById_(productId) {
  var index = di3LoadProductsIndex_();
  return index.byId[String(productId)] || null;
}

function di3ProductToRow_(product, productId, timestamp, stored) {
  var createdAt = stored && stored.created_at ? stored.created_at : timestamp;
  var active = stored ? stored.active : true;
  return [
    productId,
    product.identity_key,
    product.brand,
    product.model || "",
    product.diameter || "",
    product.category || "",
    product.shape || "",
    product.material || "",
    product.thickness || "",
    product.foam || "",
    product.current_sale_price === "" || product.current_sale_price == null ? "" : product.current_sale_price,
    active,
    createdAt,
    timestamp,
    timestamp
  ];
}


/**
 * One-time repair for diameter strings that Sheets previously auto-parsed as dates.
 * A repair is made only when the saved identity_key independently confirms the
 * same day.month value (e.g. Date 06.05.2026 and identity diameter "6.5").
 * Ambiguous/mismatched dates are reported and left untouched.
 */
function di3RepairDateCoercedProductDiameters() {
  return di3WithLock_(function () {
    var ss = di3GetSpreadsheet_();
    var sheet = di3GetSheetOrThrow_("Products");
    var lastRow = sheet.getLastRow();
    if (lastRow < 2) return { status: "NO_PRODUCTS", scanned: 0, repaired: 0, unresolved: [] };

    var rows = di3ReadTableValues_("Products");
    var repairs = [];
    var unresolved = [];
    rows.forEach(function (row, index) {
      var diameter = row[4];
      if (!(diameter instanceof Date) || isNaN(diameter.getTime())) return;
      var rowNumber = index + 2;
      var identityParts = null;
      try { identityParts = JSON.parse(String(row[1] || "")); } catch (ignore) { identityParts = null; }
      var brandMatches = identityParts && identityParts.length === 3 &&
        String(identityParts[0]) === di3NormalizeIdentityPart_(row[2]);
      var modelMatches = identityParts && identityParts.length === 3 &&
        String(identityParts[1]) === di3NormalizeIdentityPart_(row[3]);
      var identityDiameter = identityParts && identityParts.length === 3
        ? di3NormalizeDiameter_(identityParts[2], identityParts[2]) : { value: "", invalidDate: true };
      var dateDayMonth = Utilities.formatDate(diameter, ss.getSpreadsheetTimeZone(), "d.M");
      if (brandMatches && modelMatches && !identityDiameter.invalidDate && identityDiameter.value &&
          identityDiameter.value === dateDayMonth) {
        repairs.push({ row_number: rowNumber, diameter: identityDiameter.value });
      } else {
        unresolved.push({ row: rowNumber, stored_date: Utilities.formatDate(diameter, ss.getSpreadsheetTimeZone(), "dd.MM.yyyy"),
          identity_diameter: identityParts && identityParts.length === 3 ? String(identityParts[2] || "") : "" });
      }
    });

    // Format the storage column before restoring text values, preventing repeat coercion.
    sheet.getRange(2, 5, Math.max(1, lastRow - 1), 1).setNumberFormat("@");
    repairs.forEach(function (item) {
      sheet.getRange(item.row_number, 5).setValue(item.diameter);
    });
    return {
      status: unresolved.length ? (repairs.length ? "PARTIAL_REPAIR" : "REVIEW_REQUIRED") : (repairs.length ? "REPAIRED" : "NO_ISSUES"),
      scanned: rows.length,
      repaired: repairs.length,
      repaired_rows: repairs,
      unresolved: unresolved,
      note: "Исправлены только даты, у которых день и месяц точно совпали с диаметром в identity_key. Остальные значения оставлены без изменений."
    };
  });
}
