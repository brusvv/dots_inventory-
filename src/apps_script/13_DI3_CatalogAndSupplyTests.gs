/** Unit tests for product/supply domain calculations. No SpreadsheetApp required. */
function di3RunCatalogAndSupplyUnitTests() {
  var passed = 0;
  var failures = [];
  function test(name, fn) {
    try { fn(); passed++; }
    catch (error) { failures.push({ name: name, error: error.message || String(error) }); }
  }
  function equal(actual, expected, message) {
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      throw new Error((message || "Values differ") + ": " + JSON.stringify(actual) + " !== " + JSON.stringify(expected));
    }
  }
  function close(actual, expected, epsilon) {
    if (Math.abs(Number(actual) - Number(expected)) > (epsilon || 0.000001)) {
      throw new Error(String(actual) + " is not close to " + String(expected));
    }
  }

  test("largest remainder allocates all kopeks", function () {
    equal(di3AllocateSupplyAmount_(10, [1, 1, 1]), [3.34, 3.33, 3.33]);
  });
  test("allocation is proportional", function () {
    equal(di3AllocateSupplyAmount_(90, [500, 400]), [50, 40]);
  });
  test("empty weights cannot distribute positive amount", function () {
    var thrown = false;
    try { di3AllocateSupplyAmount_(1, []); } catch (e) { thrown = true; }
    equal(thrown, true);
  });
  test("batch pack variant resolver appends missing variants in one write and reuses IDs", function () {
    var originalAppend = di3AppendTableRows_;
    var writes = [];
    try {
      di3AppendTableRows_ = function (sheetName, rows) { writes.push({ sheet: sheetName, rows: rows }); };
      var products = {
        P1: { product_id: "P1", active: true },
        P2: { product_id: "P2", active: true }
      };
      var variants = { byProductAndUnits: Object.create(null), byId: Object.create(null) };
      var result = di3GetOrCreatePackVariants_([
        { product_id: "P1", units_per_pack: 20 },
        { product_id: "P2", units_per_pack: 40 },
        { product_id: "P1", units_per_pack: 20 }
      ], "SUPPLY_DRAFT", products, variants);
      equal(writes.length, 1);
      equal(writes[0].sheet, "PackVariants");
      equal(writes[0].rows.length, 2);
      equal(result.length, 3);
      equal(result[0].created, true);
      equal(result[1].created, true);
      equal(result[2].created, false);
      equal(result[0].pack_variant_id, result[2].pack_variant_id);
    } finally {
      di3AppendTableRows_ = originalAppend;
    }
  });
  test("batch pack variant resolver rejects inactive products and variants", function () {
    var products = {
      P1: { product_id: "P1", active: false },
      P2: { product_id: "P2", active: true }
    };
    var variants = { byProductAndUnits: Object.create(null), byId: Object.create(null) };
    variants.byProductAndUnits[di3BuildPackVariantKey_("P2", 40)] = {
      pack_variant_id: "V2", product_id: "P2", units_per_pack: 40, active: false
    };
    var inactiveProductRejected = false, inactiveVariantRejected = false;
    try { di3GetOrCreatePackVariants_([{ product_id: "P1", units_per_pack: 20 }], "SUPPLY_DRAFT", products, variants); }
    catch (error) { inactiveProductRejected = /товар отключён/.test(error.message); }
    try { di3GetOrCreatePackVariants_([{ product_id: "P2", units_per_pack: 40 }], "SUPPLY_DRAFT", products, variants); }
    catch (error) { inactiveVariantRejected = /вариант упаковки 40 шт. отключён/.test(error.message); }
    equal(inactiveProductRejected, true);
    equal(inactiveVariantRejected, true);
  });

  test("two pack variants for one product are allowed", function () {
    var plan = di3BuildSupplyFinancialPlan_({ lines: [
      { product_id: "P1", pack_variant_id: "V20", units_per_pack: 20, packs: 2, purchase_price_per_pack: 100 },
      { product_id: "P1", pack_variant_id: "V40", units_per_pack: 40, packs: 1, purchase_price_per_pack: 180 }
    ] });
    equal(plan.lines.length, 2);
    equal(plan.lines[0].received_units, 40);
    equal(plan.lines[1].received_units, 40);
  });
  test("duplicate product and pack variant is rejected", function () {
    var thrown = false;
    try {
      di3BuildSupplyFinancialPlan_({ lines: [
        { product_id: "P1", pack_variant_id: "V20", units_per_pack: 20, packs: 1, purchase_price_per_pack: 10 },
        { product_id: "P1", pack_variant_id: "V20", units_per_pack: 20, packs: 2, purchase_price_per_pack: 10 }
      ] });
    } catch (e) { thrown = true; }
    equal(thrown, true);
  });
  test("goods, discounts, shipping and final amount calculate", function () {
    var plan = di3BuildSupplyFinancialPlan_({
      seller_discount_amount: 90, partner_discount_amount: 45, shipping_amount: 90,
      lines: [
        { product_id: "P1", pack_variant_id: "V20", units_per_pack: 20, packs: 5, purchase_price_per_pack: 100 },
        { product_id: "P2", pack_variant_id: "V10", units_per_pack: 10, packs: 2, purchase_price_per_pack: 200 }
      ]
    });
    equal(plan.goods_amount, 900);
    equal(plan.discount_total, 135);
    equal(plan.shipping_amount, 90);
    equal(plan.final_amount, 855);
    equal(plan.lines[0].allocated_seller_discount, 50);
    equal(plan.lines[1].allocated_partner_discount, 20);
    close(plan.lines[0].final_pack_cost, 95);
    close(plan.lines[1].unit_cost, 19);
  });
  test("rounding residual is not lost", function () {
    var plan = di3BuildSupplyFinancialPlan_({
      shipping_amount: 0.05,
      lines: [
        { product_id: "P1", pack_variant_id: "V1", units_per_pack: 1, packs: 1, purchase_price_per_pack: 0.01 },
        { product_id: "P2", pack_variant_id: "V2", units_per_pack: 1, packs: 1, purchase_price_per_pack: 0.01 },
        { product_id: "P3", pack_variant_id: "V3", units_per_pack: 1, packs: 1, purchase_price_per_pack: 0.01 }
      ]
    });
    var allocated = plan.lines.reduce(function (sum, line) { return sum + line.allocated_shipping; }, 0);
    close(allocated, 0.05, 0.000001);
    close(plan.final_amount, 0.08, 0.000001);
  });
  test("discounts cannot exceed goods total", function () {
    var thrown = false;
    try {
      di3BuildSupplyFinancialPlan_({ seller_discount_amount: 11, lines: [
        { product_id: "P1", pack_variant_id: "V1", units_per_pack: 1, packs: 1, purchase_price_per_pack: 10 }
      ] });
    } catch (e) { thrown = true; }
    equal(thrown, true);
  });
  test("shipping distributes by received quantity for zero-cost goods", function () {
    var plan = di3BuildSupplyFinancialPlan_({ shipping_amount: 3, lines: [
      { product_id: "P1", pack_variant_id: "V1", units_per_pack: 2, packs: 1, purchase_price_per_pack: 0 },
      { product_id: "P2", pack_variant_id: "V2", units_per_pack: 1, packs: 1, purchase_price_per_pack: 0 }
    ] });
    equal(plan.lines[0].allocated_shipping, 2);
    equal(plan.lines[1].allocated_shipping, 1);
  });
  test("negative purchase price is rejected", function () {
    var thrown = false;
    try {
      di3BuildSupplyFinancialPlan_({ lines: [
        { product_id: "P1", pack_variant_id: "V1", units_per_pack: 1, packs: 1, purchase_price_per_pack: -1 }
      ] });
    } catch (e) { thrown = true; }
    equal(thrown, true);
  });
  test("fractional pack count is rejected", function () {
    var thrown = false;
    try {
      di3BuildSupplyFinancialPlan_({ lines: [
        { product_id: "P1", pack_variant_id: "V1", units_per_pack: 1, packs: 1.5, purchase_price_per_pack: 1 }
      ] });
    } catch (e) { thrown = true; }
    equal(thrown, true);
  });
  test("empty supply is rejected", function () {
    var thrown = false;
    try { di3BuildSupplyFinancialPlan_({ lines: [] }); } catch (e) { thrown = true; }
    equal(thrown, true);
  });

  test("read-only product option index does not allocate public product codes", function () {
    var originals = {
      ensure: di3EnsureProductPublicCodes_,
      list: di3ListAllProductsForWarehouse_,
      codes: di3GetProductPublicCodeMap_,
      label: di3GetProductOptionLabelWithMap_
    };
    var ensureCalls = 0;
    try {
      di3EnsureProductPublicCodes_ = function () { ensureCalls++; };
      di3ListAllProductsForWarehouse_ = function () {
        return [{ product_id: "P1", brand: "Brand", model: "Model", diameter: "6,5", active: true }];
      };
      di3GetProductPublicCodeMap_ = function () { return {}; };
      di3GetProductOptionLabelWithMap_ = function (product) { return product.product_id; };

      var readOnlyIndex = di3GetProductFormOptionIndex_(true);
      equal(readOnlyIndex.byId.P1.product_id, "P1");
      equal(ensureCalls, 0, "read-only lookup must not allocate persistent public codes");

      di3GetProductFormOptionIndex_();
      equal(ensureCalls, 1, "ordinary catalogue lookup must preserve its existing ensure behavior");
    } finally {
      di3EnsureProductPublicCodes_ = originals.ensure;
      di3ListAllProductsForWarehouse_ = originals.list;
      di3GetProductPublicCodeMap_ = originals.codes;
      di3GetProductOptionLabelWithMap_ = originals.label;
    }
  });

  test("ordinary supply financial preview resolves catalogue in read-only mode", function () {
    var originals = {
      getSheet: di3GetSheetOrThrow_,
      resolve: di3ResolveSupplyFormLines_,
      build: di3BuildSupplyFinancialPlan_,
      render: di3RenderSupplyFinancialPreview_
    };
    var resolveArgs = null;
    var plan = {
      lines: [{ product_id: "P1" }],
      goods_amount: 100, discount_total: 0, shipping_amount: 0, final_amount: 100
    };
    try {
      di3GetSheetOrThrow_ = function () {
        return { getRange: function () { return { getValues: function () { return [[0], [0], [0]]; } }; } };
      };
      di3ResolveSupplyFormLines_ = function (createVariants, readOnlyCatalog) {
        resolveArgs = [createVariants, readOnlyCatalog];
        return [{ product_id: "P1", pack_variant_id: "V1", units_per_pack: 1, packs: 1, purchase_price_per_pack: 100 }];
      };
      di3BuildSupplyFinancialPlan_ = function () { return plan; };
      di3RenderSupplyFinancialPreview_ = function () {};
      var result = di3PreviewSupplyForm();
      equal(resolveArgs, [false, true]);
      equal(result.final_amount, 100);
    } finally {
      di3GetSheetOrThrow_ = originals.getSheet;
      di3ResolveSupplyFormLines_ = originals.resolve;
      di3BuildSupplyFinancialPlan_ = originals.build;
      di3RenderSupplyFinancialPreview_ = originals.render;
    }
  });

  test("supply selector summary uses one multi-key status lookup and de-duplicates IDs", function () {
    var original = di3ReadRowsByColumnValues_;
    var calls = [];
    function supplyRow(id, number, status, createdAt, orderDate) {
      var row = [];
      row[0] = id; row[1] = number; row[2] = "Supplier"; row[3] = status;
      row[4] = createdAt; row[17] = orderDate;
      return row;
    }
    try {
      di3ReadRowsByColumnValues_ = function (sheetName, column, values) {
        calls.push({ sheet: sheetName, column: column, values: values.slice() });
        return [
          { row_number: 2, values: supplyRow("S1", "26NR001", DI3_SUPPLY_STATUS.CREATED, new Date(2026, 10, 1), new Date(2026, 9, 30)) },
          { row_number: 3, values: supplyRow("S1", "26NR001", "Оформлена", new Date(2026, 10, 1), new Date(2026, 9, 30)) },
          { row_number: 4, values: supplyRow("S2", "26NR002", DI3_SUPPLY_STATUS.RECEIVED, new Date(2026, 10, 2), new Date(2026, 10, 1)) }
        ];
      };
      var result = di3GetSupplyFormLoadSummary_();
      equal(calls.length, 1);
      equal(calls[0].sheet, "V3_Supplies");
      equal(calls[0].column, 3);
      equal(calls[0].values.length, 11);
      equal(result.length, 2);
      equal(result[0].supply_id, "S2");
      equal(result[1].supply_id, "S1");
    } finally {
      di3ReadRowsByColumnValues_ = original;
    }
  });

  test("draft supply summary uses one multi-key status lookup and keeps canonical labels", function () {
    var original = di3ReadRowsByColumnValues_;
    var calls = [];
    function row(id, status) {
      var values = [];
      values[0] = id; values[1] = "26NR001"; values[2] = "Supplier"; values[3] = status;
      values[4] = new Date(2026, 10, 1); values[13] = 100; values[17] = new Date(2026, 9, 30);
      return values;
    }
    try {
      di3ReadRowsByColumnValues_ = function (sheetName, column, values) {
        calls.push({ sheet: sheetName, column: column, values: values.slice() });
        return [
          { row_number: 2, values: row("S1", DI3_SUPPLY_STATUS.CREATED) },
          { row_number: 3, values: row("S1", "Оформлена") }
        ];
      };
      var result = di3GetSupplyDraftSummary();
      equal(calls.length, 1);
      equal(calls[0].values, [DI3_SUPPLY_STATUS.CREATED, "Создана", "Оформлена"]);
      equal(result.length, 1);
      equal(result[0].status, "Оформлена");
    } finally {
      di3ReadRowsByColumnValues_ = original;
    }
  });

  test("supply form line snapshot is reused across validation and pack materialization", function () {
    var originals = {
      getSheet: di3GetSheetOrThrow_,
      getOptions: di3GetProductFormOptionIndex_,
      loadVariants: di3LoadPackVariantIndex_,
      label: di3GetProductLabel_,
      createVariants: di3GetOrCreatePackVariants_
    };
    var sheetReads = 0, productReads = 0, variantReads = 0, createCalls = 0;
    var values = Array.from({ length: DI3_SUPPLY_FORM.lineCount }, function () { return ["", "", "", ""]; });
    values[0] = ["Product 1", 10, 2, 100];
    var product = { product_id: "P1", active: true };
    var snapshot = null;
    try {
      di3GetSheetOrThrow_ = function () {
        return { getRange: function () { return { getValues: function () { sheetReads++; return values; } }; } };
      };
      di3GetProductFormOptionIndex_ = function () {
        productReads++;
        return { byLabel: { "Product 1": product }, byId: { P1: product } };
      };
      di3LoadPackVariantIndex_ = function () {
        variantReads++;
        return { byProductAndUnits: Object.create(null), byId: Object.create(null) };
      };
      di3GetProductLabel_ = function () { return "Product 1"; };
      di3GetOrCreatePackVariants_ = function (lines) {
        createCalls++;
        return lines.map(function () { return { pack_variant_id: "V10" }; });
      };

      snapshot = di3LoadSupplyFormLineSnapshot_(true);
      var validated = di3ResolveSupplyFormLines_(false, true, snapshot);
      equal(validated.length, 1);
      equal(validated[0].pack_variant_id.indexOf("PREVIEW:"), 0);
      var materialized = di3ResolveSupplyFormLines_(true, true, snapshot);
      equal(materialized[0].pack_variant_id, "V10");
      equal(sheetReads, 1);
      equal(productReads, 1);
      equal(variantReads, 1);
      equal(createCalls, 1);
    } finally {
      di3GetSheetOrThrow_ = originals.getSheet;
      di3GetProductFormOptionIndex_ = originals.getOptions;
      di3LoadPackVariantIndex_ = originals.loadVariants;
      di3GetProductLabel_ = originals.label;
      di3GetOrCreatePackVariants_ = originals.createVariants;
    }
  });

  var report = { passed: passed, failed: failures.length, failures: failures };
  if (failures.length) throw new Error("Catalog and supply tests failed: " + JSON.stringify(failures));
  return report;
}
