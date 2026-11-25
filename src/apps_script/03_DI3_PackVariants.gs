/** Pack variant helpers. A product may have multiple distinct pack sizes. */
function di3BuildPackVariantKey_(productId, unitsPerPack) {
  var units = Number(unitsPerPack);
  if (!productId) throw new Error('Для варианта упаковки не указан product_id.');
  if (!Number.isInteger(units) || units <= 0) {
    throw new Error('Количество единиц в упаковке должно быть положительным целым числом.');
  }
  return String(productId) + "\u001f" + String(units);
}

function di3LoadPackVariantIndex_() {
  var rows = di3ReadTableValues_("PackVariants");
  var schema = DI3_TABLE_SCHEMAS.PackVariants;
  var index = {};
  var idIndex = {};
  rows.forEach(function (row, offset) {
    var record = {};
    schema.forEach(function (header, i) { record[header] = row[i]; });
    var key = di3BuildPackVariantKey_(record.product_id, record.units_per_pack);
    var id = String(record.pack_variant_id || "");
    if (!id) throw new Error('PackVariants: отсутствует pack_variant_id в строке ' + (offset + 2));
    if (index[key]) throw new Error('PackVariants: повторяется пара product_id + units_per_pack в строках ' +
      index[key].row_number + ' и ' + (offset + 2) + '.');
    if (idIndex[id]) throw new Error('PackVariants: повторяется pack_variant_id "' + id + '".');
    record.row_number = offset + 2;
    index[key] = record;
    idIndex[id] = record;
  });
  return { byProductAndUnits: index, byId: idIndex };
}

function di3BuildPackVariantRow_(productId, unitsPerPack, timestamp, source) {
  var units = Number(unitsPerPack);
  di3BuildPackVariantKey_(productId, units);
  return [
    di3MakeUuid_(),
    productId,
    units,
    units + " шт.",
    true,
    true,
    source || "MANUAL_CATALOG",
    timestamp,
    timestamp
  ];
}

/** Return an active variant or register a new pack configuration. */
function di3GetOrCreatePackVariant(productId, unitsPerPack, source) {
  return di3WithLock_(function () {
    return di3GetOrCreatePackVariant_(productId, unitsPerPack, source);
  });
}

/** Internal version for an application service that already owns the script lock. */
function di3GetOrCreatePackVariant_(productId, unitsPerPack, source) {
  var product = di3LoadProductById_(productId);
  if (!product) throw new Error('Не найден товар с product_id ' + productId + '.');
  if (product.active === false || String(product.active).toLowerCase() === "false") {
    throw new Error('Товар отключён и не может использоваться в новой поставке.');
  }
  var key = di3BuildPackVariantKey_(productId, unitsPerPack);
  var index = di3LoadPackVariantIndex_();
  var existing = index.byProductAndUnits[key];
  if (existing) {
    if (existing.active === false || String(existing.active).toLowerCase() === "false") {
      throw new Error('Вариант упаковки ' + unitsPerPack + ' шт. отключён.');
    }
    return {
      created: false,
      pack_variant_id: String(existing.pack_variant_id),
      product_id: String(productId),
      units_per_pack: Number(unitsPerPack)
    };
  }
  var row = di3BuildPackVariantRow_(productId, unitsPerPack, new Date(), source || "SUPPLY");
  row[4] = false;
  di3AppendTableRows_("PackVariants", [row]);
  return {
    created: true,
    pack_variant_id: String(row[0]),
    product_id: String(productId),
    units_per_pack: Number(unitsPerPack)
  };
}

/**
 * Validate supply lines: same product may appear more than once only when the
 * pack variant differs. Duplicate product_id + pack_variant_id is rejected.
 */
function di3ValidateSupplyPackLines_(lines, variantsById) {
  var seen = {};
  var errors = [];
  (lines || []).forEach(function (line, index) {
    var productId = String(line.product_id || "");
    var variantId = String(line.pack_variant_id || "");
    if (!productId || !variantId) {
      errors.push('Позиция ' + (index + 1) + ': обязательны product_id и pack_variant_id.');
      return;
    }
    if (variantsById) {
      var variant = variantsById[variantId];
      if (!variant) {
        errors.push('Позиция ' + (index + 1) + ': вариант упаковки не найден.');
        return;
      }
      if (String(variant.product_id) !== productId) {
        errors.push('Позиция ' + (index + 1) + ': вариант упаковки принадлежит другому товару.');
        return;
      }
      if (variant.active === false || String(variant.active).toLowerCase() === "false") {
        errors.push('Позиция ' + (index + 1) + ': вариант упаковки отключён.');
        return;
      }
    }
    var key = productId + "\u001f" + variantId;
    if (seen[key] !== undefined) {
      errors.push('Позиции ' + (seen[key] + 1) + ' и ' + (index + 1) +
        ' повторяют один товар и один вариант упаковки.');
    } else {
      seen[key] = index;
    }
  });
  return { valid: errors.length === 0, errors: errors };
}

function di3ValidateSupplyPackLinesAgainstRepository_(lines) {
  var products = di3LoadProductsIndex_();
  var variants = di3LoadPackVariantIndex_();
  var errors = [];
  (lines || []).forEach(function (line, index) {
    var product = products.byId[String(line.product_id || "")];
    if (!product) errors.push('Позиция ' + (index + 1) + ': товар не найден.');
    else if (product.active === false || String(product.active).toLowerCase() === "false") {
      errors.push('Позиция ' + (index + 1) + ': товар отключён.');
    }
  });
  if (errors.length) return { valid: false, errors: errors };
  return di3ValidateSupplyPackLines_(lines, variants.byId);
}
