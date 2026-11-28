/** Source-only tests for historical supply batch staging; no Sheets writes. */
function di3RunHistoricalSupplyBatchImportTests() {
  var source = di3GetHistoricalSupplyBatchSource_();
  var report = di3ValidateHistoricalSupplyBatchSource_(source);
  var failures = [];
  function assert(ok, message) { if (!ok) failures.push(message); }
  assert(source.supplies.length === 11, "Expected 11 historical supply documents.");
  assert(source.shared_discount_groups[0].total_kopecks === 50000, "Shared partner discount must be 500 RUB.");
  assert(source.shared_discount_groups[0].allocations_kopecks["4"] === 39881, "Mifuny allocation must be 398.81 RUB.");
  assert(source.shared_discount_groups[0].allocations_kopecks["5"] === 10119, "Real Eagles allocation must be 101.19 RUB.");
  assert(source.supplies[3].shipments.length === 2, "Mifuny's two shipment histories must remain distinct.");
  assert(source.supplies[10].goods_kopecks === 132200, "Order 11 must use the confirmed 1,322 RUB line sum.");
  assert(source.supplies[10].source_claimed_goods_kopecks === 370100, "Order 11 conflicting source subtotal must remain preserved.");
  assert(report.read_only === true && report.commit_enabled === false, "Staging must remain read-only.");
  assert(report.errors.some(function (e) { return e.indexOf("№8") !== -1; }), "Unknown 7 lines in supply 8 must block import.");
  assert(report.errors.some(function (e) { return e.indexOf("№11") !== -1; }), "Order 11 subtotal conflict must block import.");
  assert(report.errors.some(function (e) { return e.indexOf("№4") !== -1; }), "Mifuny fractional-kopeck per-pack amount must block current adapter.");
  assert(!report.errors.some(function (e) { return e.indexOf("№6") !== -1 && e.indexOf("скид") !== -1; }), "NxGLOBAL must not be included in shared discount.");
  if (failures.length) throw new Error("Historical batch import tests failed: " + JSON.stringify(failures));
  return { passed: 11, failed: 0, failures: [] };
}
