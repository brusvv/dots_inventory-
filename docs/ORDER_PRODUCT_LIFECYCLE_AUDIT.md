# Order and Product Lifecycle Audit

Status: source audit and regression hardening implemented; runtime acceptance NOT RUN.

Branch: `feature/order-product-lifecycle-audit`
Base: `feature/github-preview-releases`

## Scope and safety

This audit follows the product/catalog and order workflows from their user-facing entry points through validation, persistence, idempotency/recovery, FIFO/stock effects, financial settlement, and derived views.

Only repository source, tests, and documentation were changed. No Apps Script project was deployed, no setup or schema migration was run, and no live spreadsheet, order, product, supply, or stock data was modified.

Runtime acceptance remains reserved for a disposable restored workbook and a separate Apps Script Script ID. Do not run mutating entry points, FIFO replay, failure injection, restore, or schema migration against the live workbook.

## Product and catalog lifecycle

### New product

`di3NewProductForm` → `di3SaveNewProductForm` → `di3CreateProduct` → Products row → public product code → optional PackVariants row → catalog/dashboard projections.

The repository service serializes creation with the script lock and rejects duplicate identity keys. The product ID is stable and the public code is assigned separately from the product row.

### Edit existing product

`di3LoadSelectedProductToForm` → dirty-card confirmation → `di3SaveProductForm` → identity uniqueness check → optional pack variant → Products row update → product register, dashboard, and dependent catalog views.

Pack variants remain distinct by `product_id + units_per_pack`; disabled variants are not silently reactivated.

### Findings and changes

- Product option-label fallback previously re-read the complete public-code table for each product when a code was missing. It now uses the already-loaded map.
- Editing a product previously wrote the product row before validating/creating an optional pack variant. The order is reversed: a rejected or disabled variant now fails before product fields are changed.
- Product selection previously depended only on the visible label. If an identity-changing edit succeeded but a later projection failed, the old label could no longer identify the product on retry. The form now tracks the immutable `product_id` alongside the selected option and uses it for a retry while the visible option remains the tracked one.
- The duplicate-identity path previously ignored `CANCELLED_BY_USER` from the dirty-card confirmation and still displayed a success toast. It now returns immediately when the user cancels.
- The catalog form's existing tests cover dirty-state confirmation and replacement; additional checks cover stable-ID recovery, variant-before-product-write ordering, and cancellation propagation.

## Order lifecycle

### Ordinary order creation

`di3SetupOrderWorkspace` / `di3SetupOrderForm` → `di3ReadOrderFormCommand_` → preview via `di3BuildOrderPreviewPlan_` → `di3SaveOrderForm` → `di3CreateOrder` → request hash and immutable `ORDER_CREATE` payload → `di3ApplyOrderCreateOperation_` → V3_Orders, V3_OrderItems, status history, order register.

Creating an order does not reserve stock. Stock is deducted only at dispatch. Availability is revalidated when the order is created and FIFO preflight is repeated at dispatch.

### Dispatch and completion

`di3AdvanceOrderStatus` → `di3DispatchOrder_` → immutable `ORDER_DISPATCH` operation → StockLedger / StockMovementDetails / StockLots → scoped FIFO replay → order status/history and cost snapshots → order register.

Completion changes the order settlement and realized seller profit; it does not repeat the stock deduction.

### Return and cancellation

- Cancellation is allowed only before dispatch and creates no stock movement.
- `Возвращается` is a status-only transition.
- `Возврат` creates an immutable `ORDER_RETURN` operation from the original dispatch FIFO allocations, restores the original cost layers, runs FIFO replay, and then commits the returned status.
- Partial returns are not supported; inconsistent or partial dispatch allocations are rejected.

### Historical sale

`di3PreviewHistoricalSaleForm` → explicit confirmation → `di3CreateHistoricalSale` → idempotent order creation → historical dispatch at the supplied effective timestamp → immutable-payload verification → completion at the supplied timestamp.

The historical path uses the same stock/FIFO dispatch handler and does not bypass period, chronology, or payload-integrity checks except for its explicitly authorized created-at lower-bound behavior.

### Findings and changes

- A deferred order-create retry could return `RETRY_DEFERRED`, but the form unconditionally cleared itself and displayed a success toast. The form is now cleared only for `CREATED` or `ALREADY_CREATED`; deferred retries preserve the user's input.
- Historical-sale reset cleared obsolete time cells D5:D6 although current time inputs are C5:C6. It now clears C5:C6 and restores the default buyer-paid commission checkbox.
- Order register refresh previously refreshed every order's FIFO snapshots even when the immediately preceding FIFO replay had already refreshed affected products. The refresh now accepts an explicit `refreshFifoSnapshots: false` option. Order creation, dispatch, and return use the view-only refresh; completion refreshes only the products belonging to the completed order. Manual register refresh retains the full snapshot-refresh default.
- The order transition UI previously cleared the next-stage date/time by the row number captured before the domain transition. It now re-finds the row by the hidden immutable `order_id` after the register rebuild, preventing a concurrent insert/sort from clearing another order's input.
- Order preview and historical-sale preview now use a read-only product-option index and do not allocate missing public product codes as a preview side effect.
- Order preview and order payload construction now reuse one FIFO valuation per distinct product instead of querying the same product once for each line and again for aggregate availability.
- Financial calculation now rounds the unit sale price first and calculates line revenue from that stored price. The displayed/stored unit price and line total can no longer disagree on sub-kopeck inputs.
- Order-create recovery now compares immutable order and item fields against the persisted payload, rejects duplicate/extra item identities, and tolerates only the mutable lifecycle columns that may legitimately change after creation.
- FIFO snapshot status now remains `PENDING` when an order has fewer dispatch-linked items than its total item count. A partially linked dispatch can no longer be reported as a fully valued order.

## Regression coverage

Added or extended tests cover:

- immutable order-create row comparison and retry-safe mutable fields;
- consistent unit-price and line-total rounding;
- incomplete dispatch-link FIFO status;
- order draft FIFO valuation cache;
- deferred order-create retry preserving the form;
- stable order-row lookup after register rebuild;
- read-only ordinary and historical previews;
- correct historical-sale time-field reset;
- catalog edit recovery by product ID;
- pack-variant validation before product-row update;
- duplicate-product confirmation cancellation.

The CI workflow runs syntax, FIFO replay, order-domain, supply UX, historical supply, catalog/order UX, system safety, dashboard, and finance schema suites independently.

## Remaining review items

These are intentionally not changed without additional evidence or runtime measurements:

1. Product catalog and warehouse views still rebuild derived sheets after edits. Benchmark on the disposable workbook before introducing incremental projections.
2. PackVariants loading retains global duplicate-ID and `product_id + units_per_pack` validation. A selective read must preserve those global ownership guarantees.
3. Manual order-register refresh retains the full FIFO snapshot refresh as a repair path. Only callers that already refreshed snapshots skip it.
4. Dispatch/return handlers still need a dedicated corruption/fault-injection audit for pre-existing ledger/detail/lot rows whose event keys match but whose immutable contents differ. Do not weaken FIFO preflight or global uniqueness checks.
5. Core schema initialization invokes additive legacy schema-upgrade helpers. Confirm the intended setup/backup gate before changing this behavior; no schema migration was run during this audit.
6. Product creation and product edits are catalog writes rather than stock operations; they do not use the stock operation journal. Their current recovery relies on stable product identity/ID and retry-safe variant creation.
7. Order creation does not reserve stock. Multiple un-dispatched orders can individually pass availability checks against the same inventory; dispatch remains the authoritative FIFO preflight and may reject a later order if stock has already been consumed.

## Runtime acceptance gate

Do not mark this audit runtime-accepted until the following are completed on the disposable restored workbook:

- create, edit, and reload a product; change identity; add an existing/new/disabled pack variant; interrupt and retry projection refresh;
- create an ordinary order; retry a deferred create; verify buyer-paid and seller-paid commission and discount calculations;
- dispatch, complete, cancel, mark returning, and accept a full return;
- create a historical sale with exact business, dispatch, and completion timestamps;
- interrupt and recover order creation, dispatch, and return at their write boundaries;
- verify FIFO layers, allocations, remaining quantities, order cost snapshots, seller revenue, commission, and profit;
- verify register sorting and next-stage date/time inputs after refresh and concurrent order creation.

No live workbook or production data should be used for these tests.
