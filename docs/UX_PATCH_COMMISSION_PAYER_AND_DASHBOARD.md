# Commission payer and Warehouse Dashboard diagnostics — 25.11.2026

## Confirmed user feedback

- The user visually accepted UX-01–UX-06 except the duplicate-product-identity test, which remains untested.
- The order calculator screenshot showed goods 300 ₽, displayed commission 10%, but platform fee 0.30 ₽. This is consistent with a percentage-scale mismatch: a native Sheets percentage cell stores 10% as 0.1, while the reader divided the value by 100 again.
- The Warehouse Dashboard remains visually blank in Google Sheets despite local chart-data tests passing.

## Commission calculation change

The existing B3 checkbox now means **“Комиссию оплачивает покупатель”**. When checked, the fee is added to the buyer's payable amount. When unchecked, the same fee is deducted from seller proceeds and therefore seller profit. A fee is calculated whenever the commission rate is greater than zero; the checkbox changes the payer, not whether the fee exists.

The previous commission base is retained: gross goods amount before seller discount.

Example: goods 300 ₽, commission 10% (30 ₽), FIFO cost 105 ₽, no discount:
- Buyer pays: buyer total 330 ₽, seller revenue 300 ₽, profit 195 ₽.
- Seller pays: buyer total 300 ₽, seller revenue 270 ₽, profit 165 ₽.

Percent input parsing now supports both native percentage number formats (stored as fractions, e.g. 0.1) and the existing literal-percent format `0.00"%"` (stored as 10). This fixes the 100× under-calculation visible in the user's screenshot.

`V3_Orders` adds `commission_payer` at the end of the schema. Existing orders are backfilled as `BUYER`, preserving the old behavior. Schema Versioning advances to v3 with migration `RC8_ORDER_COMMISSION_PAYER_V3` (v2 → v3). The migration is additive; normal setup Dry Run/backup requirements remain in force.

Settlement and Finance Dashboard logic now use the stored payer:
- `BUYER`: buyer payment = goods − discount + commission; seller revenue = goods − discount.
- `SELLER`: buyer payment = goods − discount; seller revenue = goods − discount − commission.
- Platform commission remains separately recorded in both cases.
- FIFO profit is calculated from net seller revenue minus actual FIFO cost.

## Warehouse Dashboard changes

- Added `average_known_unit_cost` to warehouse totals. It is calculated as known inventory value / known units. This addresses the observed `—` in the average FIFO KPI when known stock exists.
- Chart height and retained grid rows are now calculated together. The previous fixed `chartRow + 18` compaction could remove rows beneath a 480 px chart.
- Added read-only diagnostic functions `di3DiagnoseWarehouseDashboardChart()` and `di3LogWarehouseDashboardChartDiagnostics()`. They report N1:O21 values, hidden-column state, chart count, source ranges, chart type and anchor position. They do not modify workbook data.

**Still unresolved:** the blank chart's runtime cause has not yet been identified. The diagnostic output must be inspected on the restored test workbook before changing chart construction again. The 7/7 local dashboard tests validate pure calculations only, not Google Sheets chart rendering.

## Local validation

- Apps Script syntax: 49/49 `.gs`.
- Order domain: 13/13.
- Supply Workspace UX: 9/9.
- Catalog/Order UX: 12/12.
- System Safety UX: 11/11.
- Warehouse Dashboard pure tests: 7/7.
- No live workbook, schema migration, order creation, stock mutation, FIFO rebuild or chart rendering test was executed.

The Order Domain suite was subsequently extended to 16/16 by the separate F-01 return FIFO patch. See `docs/UX_PATCH_F01_RETURN_FIFO.md` for its scope and runtime acceptance.

## Runtime acceptance required

On a restored test copy, after a fresh backup and setup Dry Run:
1. Apply the additive schema v3 migration; confirm old orders receive `commission_payer=BUYER` and no existing order amounts change.
2. Preview a 300 ₽ order with 10% commission and FIFO cost 105 ₽, first with B3 checked and then unchecked. Expected results are listed above. Do not create/dispatch a real order solely for this preview test.
3. Verify completed test settlements and Finance Dashboard for both payer modes.
4. Run `di3LogWarehouseDashboardChartDiagnostics()` from the Apps Script editor and provide the execution log. Do not run any stock mutation for this diagnostic.
5. Verify the average FIFO KPI displays 24.50 ₽ when known value is 2,940 ₽ and known units are 120.
