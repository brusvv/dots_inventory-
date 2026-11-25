/** Pure order-domain tests. Safe to run in Apps Script; does not create or modify sheets. */
function di3RunOrderDomainUnitTests() {
  var passed = 0;
  var failures = [];
  function test(name, callback) {
    try { callback(); passed++; }
    catch (error) { failures.push({ name: name, error: error.message || String(error) }); }
  }
  function equal(actual, expected, message) {
    if (actual !== expected) throw new Error((message || "Values differ") + ": expected " + JSON.stringify(expected) + ", got " + JSON.stringify(actual));
  }
  function close(actual, expected, epsilon, message) {
    if (Math.abs(Number(actual) - Number(expected)) > (epsilon || 0.000001)) {
      throw new Error((message || "Values are not close") + ": expected " + expected + ", got " + actual);
    }
  }
  function throws(callback, pattern) {
    var error = null;
    try { callback(); } catch (caught) { error = caught; }
    if (!error) throw new Error("Expected an error matching " + pattern + ".");
    if (pattern && !pattern.test(String(error.message || error))) {
      throw new Error("Expected error matching " + pattern + ", got: " + String(error.message || error));
    }
  }

  test("goods, commission, discount and payable total calculate in kopeks", function () {
    var plan = di3BuildOrderFinancialPlan_({
      commission_enabled: true, commission_rate: 0.05,
      discount_enabled: true, discount_rate: 0.10,
      lines: [
        { product_id: "P1", product_label: "Product 1", quantity: 2, sale_unit_price: 100, estimated_unit_cost: 20 },
        { product_id: "P2", product_label: "Product 2", quantity: 1, sale_unit_price: 100, estimated_unit_cost: 10 }
      ]
    });
    equal(plan.goods_amount, 300);
    equal(plan.commission_amount, 15);
    equal(plan.discount_amount, 30);
    equal(plan.payable_total, 285);
    equal(plan.estimated_fifo_cost_total, 50);
    equal(plan.seller_revenue_estimate, 270);
    equal(plan.platform_commission_quote, 15);
    equal(plan.estimated_profit, 220);
  });
  test("10% commission is 30 rubles on 300 rubles when buyer pays", function () {
    var plan = di3BuildOrderFinancialPlan_({
      commission_paid_by_buyer: true, commission_rate: 0.10,
      lines: [{ product_id: "BUYER-FEE", quantity: 10, sale_unit_price: 30, estimated_unit_cost: 10.5 }]
    });
    equal(plan.commission_amount, 30);
    equal(plan.commission_payer, "BUYER");
    equal(plan.payable_total, 330);
    equal(plan.seller_revenue_estimate, 300);
    equal(plan.estimated_profit, 195);
  });
  test("10% commission is deducted from seller proceeds when seller pays", function () {
    var plan = di3BuildOrderFinancialPlan_({
      commission_paid_by_buyer: false, commission_rate: 0.10,
      lines: [{ product_id: "SELLER-FEE", quantity: 10, sale_unit_price: 30, estimated_unit_cost: 10.5 }]
    });
    equal(plan.commission_amount, 30);
    equal(plan.commission_payer, "SELLER");
    equal(plan.payable_total, 300);
    equal(plan.seller_revenue_estimate, 270);
    equal(plan.estimated_profit, 165);
  });
  test("commission percent parser supports native and literal percent cell formats", function () {
    equal(di3NormalizeOrderPercentInput_(0.1, "0.00%", "Комиссия"), 0.1);
    equal(di3NormalizeOrderPercentInput_(10, '0.00"%"', "Комиссия"), 0.1);
    equal(di3NormalizeOrderPercentInput_(9, '0.00"%"', "Комиссия"), 0.09);
  });
  test("seller-paid commission is deducted after seller discount while fee base stays gross", function () {
    var plan = di3BuildOrderFinancialPlan_({
      commission_paid_by_buyer: false, commission_rate: 0.10,
      discount_enabled: true, discount_rate: 0.10,
      lines: [{ product_id: "SELLER-DISCOUNT", quantity: 10, sale_unit_price: 30, estimated_unit_cost: 10.5 }]
    });
    equal(plan.goods_amount, 300);
    equal(plan.commission_amount, 30);
    equal(plan.discount_amount, 30);
    equal(plan.payable_total, 270);
    equal(plan.seller_revenue_estimate, 240);
    equal(plan.estimated_profit, 135);
  });

  test("duplicate product lines are rejected", function () {
    throws(function () {
      di3BuildOrderFinancialPlan_({ lines: [
        { product_id: "P1", quantity: 1, sale_unit_price: 10 },
        { product_id: "P1", quantity: 2, sale_unit_price: 10 }
      ] });
    }, /повторяется в заказе/);
  });
  test("quantity must be a positive integer", function () {
    throws(function () {
      di3BuildOrderFinancialPlan_({ lines: [{ product_id: "P1", quantity: 1.5, sale_unit_price: 10 }] });
    }, /положительным целым числом/);
  });
  test("explicit zero price is allowed", function () {
    var plan = di3BuildOrderFinancialPlan_({ lines: [{ product_id: "P1", quantity: 1, sale_unit_price: 0 }] });
    equal(plan.goods_amount, 0);
    equal(plan.payable_total, 0);
  });
  test("commission and discount rates outside zero to one are rejected", function () {
    throws(function () {
      di3BuildOrderFinancialPlan_({ commission_enabled: true, commission_rate: 1.01,
        lines: [{ product_id: "P1", quantity: 1, sale_unit_price: 10 }] });
    }, /от 0% до 100%/);
  });
  test("unknown FIFO estimate remains unvalued, not zero", function () {
    var plan = di3BuildOrderFinancialPlan_({ lines: [{
      product_id: "P1", quantity: 3, sale_unit_price: 50,
      estimated_unit_cost: null, estimated_cost_status: "UNKNOWN"
    }] });
    equal(plan.estimated_fifo_cost_total, "");
    equal(plan.estimated_fifo_cost_status, "UNKNOWN");
    equal(plan.estimated_profit, "");
  });
  test("allowed order transitions follow the agreed workflow", function () {
    equal(DI3_ORDER_ALLOWED_TRANSITIONS[DI3_ORDER_STATUS.NEW].join("|"), "В пути|Отменен");
    equal(DI3_ORDER_ALLOWED_TRANSITIONS[DI3_ORDER_STATUS.IN_TRANSIT].join("|"), "Завершен|Возвращается");
    equal(DI3_ORDER_ALLOWED_TRANSITIONS[DI3_ORDER_STATUS.RETURNING].join("|"), "Возврат");
    equal(DI3_ORDER_ALLOWED_TRANSITIONS[DI3_ORDER_STATUS.COMPLETED].length, 0);
    equal(DI3_ORDER_ALLOWED_TRANSITIONS[DI3_ORDER_STATUS.RETURNED].length, 0);
    equal(DI3_ORDER_ALLOWED_TRANSITIONS[DI3_ORDER_STATUS.CANCELLED].length, 0);
  });

  test("common platform surcharge rates 5, 9 and 10 percent are calculated on gross goods", function () {
    [5, 9, 10].forEach(function (rate) {
      var plan = di3BuildOrderFinancialPlan_({
        commission_enabled: true, commission_rate: rate / 100,
        lines: [{ product_id: "P" + rate, quantity: 1, sale_unit_price: 100 }]
      });
      equal(plan.commission_amount, rate);
      equal(plan.payable_total, 100 + rate);
      equal(plan.seller_revenue_estimate, 100);
      equal(plan.estimated_profit, "");
    });
  });

  test("platform surcharge increases buyer quote but is excluded from seller profit", function () {
    var plan = di3BuildOrderFinancialPlan_({
      commission_enabled: true, commission_rate: 0.09,
      discount_enabled: true, discount_rate: 0.05,
      lines: [{ product_id: "P1", quantity: 10, sale_unit_price: 100, estimated_unit_cost: 60 }]
    });
    equal(plan.goods_amount, 1000);
    equal(plan.commission_amount, 90);
    equal(plan.discount_amount, 50);
    equal(plan.payable_total, 1040);
    equal(plan.seller_revenue_estimate, 950);
    equal(plan.estimated_profit, 350);
  });
  var report = { passed: passed, failed: failures.length, failures: failures };
  if (failures.length) throw new Error("Order-domain tests failed: " + JSON.stringify(failures));
  return report;
}
