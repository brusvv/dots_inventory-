# F-02 — historical sales: source audit and implementation design

Date: 25 November 2026
Status: DESIGN / SOURCE AUDIT ONLY — no application code or workbook data changed.

## 1. Current source findings

The current order lifecycle is split across three existing mechanisms:

1. `ORDER_CREATE` persists the order and its lines through OperationExecutor with an immutable payload and request token.
2. `ORDER_DISPATCH` creates the stock OUT movement, then runs FIFO allocation/replay. The movement's `effective_at` is the dispatch timestamp and `recorded_at` is the actual execution timestamp.
3. Completion is a non-stock order-status transition. It settles buyer payment, seller revenue and realized commission; the FIFO snapshots provide actual COGS/profit.

The existing order schema is v3. `V3_Orders` currently has 29 columns; `commission_payer` is column AC. `created_at` is currently both the recorded order creation timestamp and the lower bound for dispatch date validation. The order number is generated from `created_at`. After F-02, preserve `created_at` for record identity/audit, but validate customer-order date against the actual dispatch date; do not reject a legitimate business_date merely because it predates the workbook entry timestamp.

The current order-draft builder validates requested quantity against today's available stock and estimates FIFO cost from today's valuation. That is correct for a new order, but not sufficient for a historical sale: stock may have been consumed by later transactions, and the historical balance must be evaluated at the historical dispatch timestamp.

The FIFO engine already has a relevant capability: events are ordered by `effective_at`, then `recorded_at`, then `movement_id`. A backdated movement triggers product replay when it precedes the persisted product state. The replay fails closed if stock was insufficient at the historical point in the event sequence. The existing scoped FIFO preflight can validate the candidate dispatch before the operation is registered.

PeriodGuard already blocks backdated dispatch/completion events in locked periods. Dispatch also checks for pending stock operations and applies the existing returned-order backdating guard.

## 2. Proposed data model — schema v3 → v4

Append one field to the end of `V3_Orders` (after current column AC):

- `business_date` — the date on which the customer placed the order, distinct from when the user saw and entered it into the workbook.

Keep three time concepts separate:
- `business_date` is the customer-order date and is entered manually when needed (for example, an order placed at 23:00 and entered the following morning);
- `created_at` is the actual timestamp when the order was recorded in the workbook;
- `dispatched_at` / StockLedger `effective_at` is the actual dispatch/stock-out event time, entered through the ordinary order lifecycle when dispatch occurs.

Do not infer dispatch time from the customer-order date. Do not create approximate dispatch timestamps or time-window provenance fields.

Do not repurpose `created_at`:
- `created_at` remains the real timestamp when the order record was created in this workbook.
- `business_date` is the historical business date entered by the user.
- `dispatched_at` remains the physical stock-out effective timestamp.
- `completed_at` remains the buyer-completion/settlement effective timestamp.
- `Operations.started_at`, `OperationPayloads.created_at`, and stock movement `recorded_at` preserve actual system-recording time.

Migration `RC8_ORDER_BUSINESS_DATE_V4` (3 → 4):
- append `business_date` as column AD; never insert or move existing columns;
- backfill `business_date` from the date portion of `created_at` as the safest available legacy approximation;
- preserve every existing row/ID and all 29 existing columns;
- validate the complete v3 prefix, blank/occupied tail, and every existing date before writing;
- be resumable and fail closed on unknown headers or non-date legacy values;
- register migration through SchemaMigrations and the normal backup + Dry Run + explicit apply flow;
- no reverse migration; rollback through verified backup/restore.

The schema registry, legacy-schema compatibility checks, schema-version report, migration executor, order-row builder, order read/write mapping, and order register must all be updated together. The order register should display business date separately from actual record-created time rather than silently relabeling `created_at`.

## 3. Historical sale workflow

Recommended UX: a separate menu command **«Внести старую продажу…»** using the existing order calculator's product lines, prices, discount and commission inputs. It must not silently turn ordinary order creation into historical mode.

The command collects and confirms:
- customer-order business date (date only; user-entered, and may precede `created_at`);
- the normal product lines, prices, discount and commission inputs;
- the current calculator request token and exact form fingerprint.

The historical-sale entry creates the order in the same initial lifecycle state as an ordinary order. Dispatch and completion remain separate ordinary lifecycle transitions and use their actual event date/time when performed. Do not force the user to reconstruct a dispatch time merely to represent when the customer placed the order.

### Date/time input UX — simplified decision 26.11.2026

- The historical-sale form asks for the customer-order business date as a date-only value.
- The business date may be earlier than the actual workbook entry timestamp. Example: customer order placed 25 November at 23:00, user sees it and records it 26 November at 08:00. Store `business_date = 25 November`; preserve actual `created_at = 26 November 08:00`.
- Do not derive `created_at` from the business date and do not overwrite the actual recording timestamp.
- Do not ask for a dispatch-time window in the historical-sale form. Physical dispatch is a separate lifecycle event and retains the ordinary date + exact time input contract.
- The date-only business date is not a FIFO event timestamp and must not be used as StockLedger `effective_at`.


Recommended orchestration reuses the existing idempotent lifecycle rather than introducing a second stock engine:

1. Validate the order form and customer-order business date.
2. Assert PeriodGuard is open for the business date; apply existing checks to actual dispatch/completion events when those transitions occur.
3. Build the normal immutable `ORDER_CREATE` request with actual `created_at` and explicit `business_date`; include business_date in the request hash.
4. Create/recover the order using `ORDER_CREATE`.
5. Dispatch later through the existing `ORDER_DISPATCH` handler, using the actual dispatch date/time supplied at that transition. FIFO preflight remains authoritative for stock sufficiency and lot allocation.
6. Complete the order using the existing status/settlement logic at the actual completion timestamp.
7. Refresh order snapshots/register and verify the actual FIFO COGS, commission settlement and profit.

The orchestration must be retry-safe at every boundary. If interrupted after order creation, it must resume the same order. If interrupted after dispatch, it must not dispatch twice and must continue completion. Reusing the same request token with changed lines, prices, business date, dispatch date or completion date must fail closed.

No new operation type is required if the orchestration can safely resume the existing ORDER_CREATE and ORDER_DISPATCH operations and deterministically finish the completion transition. This must be proven by tests before implementation is accepted.

## 4. Historical FIFO and cost rules

- StockLedger `effective_at` is the historical dispatch timestamp; `recorded_at` remains the actual timestamp at which the user entered the sale.
- FIFO replay is authoritative for historical availability and cost. Never use today's average stock valuation as the historical COGS.
- If stock is insufficient at the historical dispatch point, reject before registering the dispatch operation. Do not allow negative stock or silently borrow future receipts.
- `UNKNOWN` and `FREE` lots retain their current FIFO semantics; historical sales must not invent a known unit cost.
- After dispatch/replay, refresh `OrderCostSnapshots` and the order's actual FIFO cost/profit from the exact dispatch movement allocations.
- Existing return linkage remains through `V3_OrderItems.dispatch_movement_id`; F-01's movement-based lookup must continue to work when a historical sale is later returned.
- A sale whose dispatch or completion date falls in a locked period must be blocked by PeriodGuard. Reopening a period remains an explicit, audited action.

## 5. Date semantics and FIFO boundary

The customer-order business date is descriptive/accounting metadata; it is not a stock movement timestamp. It must not change FIFO event ordering or be substituted for dispatch `effective_at`.

The order's actual dispatch remains a separate lifecycle event. When the user dispatches the order, the ordinary date + exact-time controls produce the canonical `effective_at` in the configured spreadsheet timezone. The FIFO engine then allocates stock lots according to the actual dispatch event chronology. No approximate midnight fallback, uncertainty interval, time-window overlap guard or `dispatch_time_precision` field is required for F-02. The business date must not be later than the actual dispatch date, but it may be earlier than `created_at` when the order was entered after the customer placed it.

For an order that was already physically dispatched before it was entered, the existing historical/backdated dispatch mechanism may still be used with a user-supplied actual dispatch date/time. Its FIFO preflight and replay rules remain unchanged; do not guess a time from the customer-order date.


## 6. Required regression and acceptance coverage

Pure/domain tests:
1. Normal order with no business_date preserves existing v3 behavior before migration and defaults business_date to the date portion of created_at after v4.
2. Historical order stores actual created_at separately from manually entered business_date.
3. An order placed late at night and entered the next morning retains the previous calendar date as business_date and the next-morning timestamp as created_at.
4. Business date is date-only and does not affect StockLedger event ordering or FIFO lot allocation.
5. Ordinary dispatch date/time is combined using the configured spreadsheet timezone; backdated dispatch continues to use existing FIFO preflight/replay rules.
6. Historical stock is sufficient at dispatch even if later sales consumed the current stock: preflight passes and replay allocates correct historical lots.
7. Historical stock is insufficient at dispatch even if a later receipt makes current stock sufficient: preflight rejects.
8. UNKNOWN/FREE lots preserve cost status and no invented COGS.
9. Existing F-01 return-after-unrelated-FIFO-run scenario still returns the original dispatch lots.
10. Request-token retry with identical business date and form payload is idempotent; changed business date or form payload is rejected.
11. Fault/retry after ORDER_CREATE, after ORDER_DISPATCH, and before completion never duplicates order, ledger, details, lots or allocations.
12. PeriodGuard rejects any business date in a locked period and applies existing checks to actual dispatch/completion events.
13. v3→v4 migration preserves the 29-column prefix, IDs, row count and timestamps; appends business_date and backfills it from the date portion of created_at; Dry Run is read-only and rerun is safe.

Runtime acceptance on a restored disposable workbook:
- backup + schema Dry Run before migration;
- migrate v3→v4 and verify manifest/SchemaMigrations;
- enter a historical sale whose customer-order business date is the previous day while the actual recording time is the next morning;
- verify that business_date is stored separately and does not alter dispatch effective_at, FIFO allocations or OrderCostSnapshots;
- verify ordinary dispatch continues to store actual effective_at separately from recorded_at;
- verify buyer-paid and seller-paid commission settlement;
- verify Finance Dashboard period/filter totals;
- test insufficient historical stock, locked period, same-day event ordering and recovery;
- verify no duplicate rows after repeated confirmation/retry.

## 7. Safety boundaries

This document is a design only. No schema, order, stock, FIFO, migration, menu or workbook code was changed as part of this audit. Do not install a partial v4 schema. Do not run the migration on the production workbook. The implementation should be delivered as one coordinated source patch with tests and a dedicated release note, then applied only to a restored test copy after backup and Dry Run.


## 8. Cross-workspace date/time contract

The common date/time UX remains shared with order lifecycle events, supply lifecycle events and manual warehouse movements. F-02 adds only a manually entered date-only customer-order `business_date`; it does not weaken the ordinary exact date/time input contract for physical dispatch. See `docs/OPERATION_DATE_TIME_UX_DESIGN.md`. This does not add timestamp-split schema columns to supplies or StockLedger.
