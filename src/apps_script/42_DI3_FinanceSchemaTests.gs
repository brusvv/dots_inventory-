/** Pure/static regression tests for schema-driven Finance Dashboard column access. */
function di3RunFinanceSchemaUnitTests() {
  var passed = 0;
  var failed = [];
  function test(name, callback) {
    try { callback(); passed++; }
    catch (error) { failed.push({ name: name, error: error.message || String(error) }); }
  }
  function equal(actual, expected, message) {
    if (actual !== expected) throw new Error((message || "Values differ") + ": expected " + JSON.stringify(expected) + ", got " + JSON.stringify(actual));
  }
  function includes(source, value) {
    equal(String(source).indexOf(value) !== -1, true, "Expected source to contain " + value);
  }

  test("finance column map resolves order, item, snapshot and supply fields from table schemas", function () {
    var order = di3FinanceColumnMap_("V3_Orders", ["status", "completed_at", "seller_revenue", "platform_commission_realized", "buyer_paid_total", "commission_payer"]);
    equal(order.status, DI3_TABLE_SCHEMAS.V3_Orders.indexOf("status"));
    equal(order.completed_at, DI3_TABLE_SCHEMAS.V3_Orders.indexOf("completed_at"));
    equal(order.seller_revenue, DI3_TABLE_SCHEMAS.V3_Orders.indexOf("seller_revenue"));
    equal(order.platform_commission_realized, DI3_TABLE_SCHEMAS.V3_Orders.indexOf("platform_commission_realized"));
    equal(order.buyer_paid_total, DI3_TABLE_SCHEMAS.V3_Orders.indexOf("buyer_paid_total"));
    equal(order.commission_payer, DI3_TABLE_SCHEMAS.V3_Orders.indexOf("commission_payer"));
    var item = di3FinanceColumnMap_("V3_OrderItems", ["order_item_id", "order_id", "line_no", "product_id", "quantity", "sale_unit_price", "line_revenue", "actual_fifo_cost", "actual_fifo_cost_status"]);
    equal(item.line_revenue, DI3_TABLE_SCHEMAS.V3_OrderItems.indexOf("line_revenue"));
    equal(item.actual_fifo_cost_status, DI3_TABLE_SCHEMAS.V3_OrderItems.indexOf("actual_fifo_cost_status"));
    var snapshot = di3FinanceColumnMap_("OrderCostSnapshots", ["order_item_id", "calculation_version", "cost_amount_minor", "cost_status"]);
    equal(snapshot.calculation_version, DI3_TABLE_SCHEMAS.OrderCostSnapshots.indexOf("calculation_version"));
    equal(snapshot.cost_amount_minor, DI3_TABLE_SCHEMAS.OrderCostSnapshots.indexOf("cost_amount_minor"));
    var supply = di3FinanceColumnMap_("V3_Supplies", ["supply_id", "status", "sent_at", "received_at"]);
    equal(supply.received_at, DI3_TABLE_SCHEMAS.V3_Supplies.indexOf("received_at"));
    var supplyItem = di3FinanceColumnMap_("V3_SupplyItems", ["product_id", "product_label_snapshot", "received_units", "final_line_amount", "unit_cost"]);
    equal(supplyItem.received_units, DI3_TABLE_SCHEMAS.V3_SupplyItems.indexOf("received_units"));
    equal(supplyItem.final_line_amount, DI3_TABLE_SCHEMAS.V3_SupplyItems.indexOf("final_line_amount"));
  });

  test("unknown schema table or header fails loudly instead of silently reading another column", function () {
    var tableFailed = false;
    var columnFailed = false;
    try { di3FinanceColumnIndex_("MissingTable", "status"); } catch (error) { tableFailed = /отсутствует схема/.test(error.message); }
    try { di3FinanceColumnIndex_("V3_Orders", "missing_column"); } catch (error) { columnFailed = /отсутствует колонка/.test(error.message); }
    equal(tableFailed, true);
    equal(columnFailed, true);
  });

  test("finance data pipeline uses schema maps rather than numeric offsets", function () {
    var source = di3GetFinanceDashboardData.toString();
    ["row[18]", "row[27]", "order[23]", "order[24]", "order[25]", "order[28]", "item[12]", "item[13]", "line[14]", "line[15]", "supply[7]"].forEach(function (offset) {
      equal(source.indexOf(offset) === -1, true, "Magic offset remains: " + offset);
    });
    includes(source, "di3FinanceColumnMap_(\"V3_Orders\"");
    includes(source, "di3FinanceColumnMap_(\"V3_OrderItems\"");
    includes(source, "di3FinanceColumnMap_(\"V3_Supplies\"");
    includes(source, "di3FinanceColumnMap_(\"V3_SupplyItems\"");
  });

  test("snapshot and legacy item-cost resolvers use schema column names", function () {
    var snapshots = di3FinanceResolveLatestOrderCosts_.toString();
    includes(snapshots, "calculation_version");
    includes(snapshots, "cost_amount_minor");
    var itemCost = di3FinanceResolveItemCost_.toString();
    includes(itemCost, "actual_fifo_cost");
    includes(itemCost, "actual_fifo_cost_status");
  });

  var report = { passed: passed, failed: failed.length, failures: failed };
  if (failed.length) throw new Error("Finance schema tests failed: " + JSON.stringify(failed));
  return report;
}
