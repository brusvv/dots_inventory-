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

  var report = { passed: passed, failed: failures.length, failures: failures };
  if (failures.length) throw new Error("Catalog and supply tests failed: " + JSON.stringify(failures));
  return report;
}
