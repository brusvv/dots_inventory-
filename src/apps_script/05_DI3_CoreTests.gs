/** Lightweight self-tests that can also be executed inside Apps Script. */
function di3RunCoreFoundationUnitTests() {
  var passed = 0;
  var failed = [];
  function test(name, callback) {
    try {
      callback();
      passed++;
    } catch (error) {
      failed.push({ name: name, error: error.message || String(error) });
    }
  }
  function equal(actual, expected, message) {
    if (actual !== expected) {
      throw new Error((message || "Values differ") + ': expected ' + JSON.stringify(expected) +
        ', received ' + JSON.stringify(actual));
    }
  }
  function truthy(value, message) {
    if (!value) throw new Error(message || "Expected truthy value");
  }

  test("identity normalizes decimal comma and point", function () {
    equal(di3BuildIdentityKey_("X-Raypad", "Jade", "6,5"),
      di3BuildIdentityKey_("x-raypad", " Jade ", "6.5 мм"));
  });
  test("empty diameter is a separate identity", function () {
    truthy(di3BuildIdentityKey_("Brand", "Model", "") !==
      di3BuildIdentityKey_("Brand", "Model", "6.5"));
  });
  test("brand-only product identity is valid", function () {
    equal(di3BuildIdentityKey_("Aglow X WestLab", "", ""),
      JSON.stringify(["aglow x westlab", "", ""]));
  });
  test("model without brand is not a valid identity", function () {
    var threw = false;
    try { di3BuildIdentityKey_("", "Model", ""); } catch (error) { threw = true; }
    equal(threw, true);
  });
  test("brand-only product label has no trailing blank model", function () {
    equal(di3CreateProductLabel_("Aglow X WestLab", "", ""), "Aglow X WestLab");
  });
  test("text normalization collapses whitespace and case", function () {
    equal(di3NormalizeIdentityPart_("  Pure   AIM "), "pure aim");
  });
  test("date object is not a diameter", function () {
    var result = di3NormalizeDiameter_(new Date("2026-05-06T00:00:00Z"), "");
    equal(result.value, "");
    equal(result.invalidDate, true);
  });
  test("date-like text is not a diameter", function () {
    var result = di3NormalizeDiameter_("Wed May 06 2026 00:00:00 GMT+0300", "Wed May 06 2026 00:00:00 GMT+0300");
    equal(result.value, "");
    equal(result.invalidDate, true);
  });
  test("pack variants distinguish different pack sizes", function () {
    truthy(di3BuildPackVariantKey_("p-1", 20) !== di3BuildPackVariantKey_("p-1", 40));
  });
  test("same product with different variants is allowed in a supply", function () {
    var result = di3ValidateSupplyPackLines_([
      { product_id: "p-1", pack_variant_id: "v-20" },
      { product_id: "p-1", pack_variant_id: "v-40" }
    ]);
    equal(result.valid, true);
  });
  test("same product and same variant is rejected in a supply", function () {
    var result = di3ValidateSupplyPackLines_([
      { product_id: "p-1", pack_variant_id: "v-20" },
      { product_id: "p-1", pack_variant_id: "v-20" }
    ]);
    equal(result.valid, false);
  });
  test("product labels support a brand-only product", function () {
    equal(di3CreateProductLabel_("Aglow X WestLab", "", ""), "Aglow X WestLab");
  });
  test("application metadata uses a neutral key-value table and core repository helpers", function () {
    equal(DI3_TABLE_SCHEMAS._AppMeta[0], "key");
    equal(DI3_TABLE_SCHEMAS._AppMeta[1], "value");
    equal(DI3_TABLE_SCHEMAS._AppMeta[2], "updated_at");
    truthy(typeof di3GetAppMetaValue_ === "function", "di3GetAppMetaValue_ must be loaded with SchemaRegistry");
    truthy(typeof di3SetAppMetaValue_ === "function", "di3SetAppMetaValue_ must be loaded with SchemaRegistry");
  });

  var report = { passed: passed, failed: failed.length, failures: failed };
  console.log(JSON.stringify(report, null, 2));
  if (failed.length) throw new Error('Core Foundation tests failed: ' + failed.length + '/' + (passed + failed.length));
  return report;
}
