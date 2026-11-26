# F-02 — historical sales: source audit and implementation design

Date: 25 November 2026
Status: SOURCE IMPLEMENTATION + CI PASSED — F-02 source patch, form preview/confirmation and regression suite are on the PR branch; Google Sheets runtime acceptance is still pending.

## 1. Current source findings

The current order lifecycle is split across three existing mechanisms:

1. `ORDER_CREATE` persists the order and its lines through OperationExecutor with an immutable payload and request token.
2. `ORDER_DISPATCH` creates the stock OUT movement, then runs FIFO allocation/replay. The movement's `effective_at` is the dispatch timestamp and `recorded_at` is the actual execution timestamp.
3. Completion is a non-stock order-status transition. It settles buyer payment, seller revenue and realized commission; the FIFO snapshots provide actual COGS/profit.

The existing order schema is v3. `V3_Orders` currently has 29 columns; `commission_payer` is column AC. `created_at` is currently both the recorded order creation timestamp and the lower bound for dispatch date validation. The order number is generated from `created_at`. After F-02, preserve `created_at` for record identity/audit, but validate customer-order date against the actual dispatch date; do not reject a legitimate business_date merely because it predates the workbook entry timestamp.

The current order-draft builder validates requested quantity against today's available stock and estimates FIFO cost from today's valuation. That is correct for a new order, but not sufficient for a historical sale: stock may have been consumed by later transactions, and the historical balance must be evaluated at the historical dispatch timestamp. Historical mode must therefore bypass the current-availability rejection (without bypassing product/quantity/price validation) and rely on scoped FIFO preflight at the supplied dispatch timestamp. Any current-valuation estimate shown in historical mode must be labelled non-authoritative; actual COGS comes only from replay allocations.

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

The schema registry, legacy-schema compatibility checks, schema-version report, migration executor, order-row builder, order read/write mapping, and order register must all be updated together. The order register should display business date separately from actuThe command collects and confirms:
- customer-order business date (date only; may precede the actual workbook `created_at`);
- actual historical dispatch date and exact time (minute precision);
- actual historical completion date and exact time (minute precision);
- normal product lines, prices, discount, commission payer/rate, delivery method and notes;
- one stable request token and a fingerprint covering all commercial inputs and all three business dates/timestamps.

This is a completed historical-sale workflow, not merely a backdated order draft. It creates the order with the actual current `created_at`, dispatches it through the existing `ORDER_DISPATCH` operation at the supplied historical dispatch timestamp (thereby invoking FIFO preflight/replay), and completes/settles it at the supplied historical completion timestamp. The historical form must be separate from ordinary «Новый заказ» so the user cannot accidentally bypass current-stock checks or create a historical sale without the chronology inputs.

### Date/time input UX — confirmed model 26.11.2026

The historical-sale form contains three distinct business-time inputs:

- `business_date`: customer-order calendar date only.
- Dispatch: required date + exact `HH:mm` time.
- Completion: required date + exact `HH:mm` time.

Example: customer order placed 25 November at 23:00, user sees and records it 26 November at 08:00, dispatch occurs 26 November at 10:30, completion at 27 November at 09:00. Store `business_date = 25 November`, actual `created_at = 26 November 08:00`, `dispatched_at = 26 November 10:30`, and `completed_at = 27 November 09:00`.

The business date is not a FIFO event timestamp and must never be used as StockLedger `effective_at`. The actual dispatch timestamp is the sole stock-out event time. The historical form does not use an approximate time window or infer dispatch time from business_date.

Recommended orchestration reuses the existing idempotent lifecycle rather than introducing a second stock engine:

1. Validate all required fields and chronology: `business_date` must not be after the dispatch calendar date; completion timestamp must be at or after dispatch timestamp; dispatch and completion must not be in the future.
2. PeriodGuard applies to actual dispatch and completion event timestamps. `business_date` is descriptive order metadata and is not itself a stock/settlement event.
3. Build the immutable `ORDER_CREATE` request with actual `created_at`, explicit `business_date`, historical-mode marker and a request hash covering the business date and all commercial inputs.
4. Create/recover the order using `ORDER_CREATE`.
5. Dispatch through the existing `ORDER_DISPATCH` handler at the supplied actual historical dispatch timestamp. Historical mode may bypass only the ordinary `dispatched_at >= created_at` guard; all other period, returned-order, pending-operation and scoped FIFO preflight checks remain mandatory.
6. Complete through the existing order status/settlement logic at the supplied actual completion timestamp; the status chronology check must enforce `completed_at >= dispatched_at`.
7. Refresh order snapshots/register and verify actual FIFO COGS, commission settlement and profit.

The orchestration must be retry-safe at every boundary. If interrupted after order creation, it must resume the same order; after dispatch, it must reuse the persisted `ORDER_DISPATCH` payload and must not create a second movement; after completion, it must recognize the settled order. Reusing the same request token with changed lines, prices, business date, dispatch timestamp, completion timestamp, commission settings or delivery data must fail closed. A retry that finds an existing dispatch operation must compare the persisted dispatch timestamp with the requested one rather than silently accepting a changed timestamp.

he orchestration must be retry-safe at every boundary. If interrupted after order creation, it must resume the same order. If interrupted after dispatch, it must not dispatch twice and must continue completion. Reusing the same request token with changed lines, prices, business date, dispatch date or completion date must fail closed.

No new operation type is required if the orchestration can safely resume the existing ORDER_CREATE and ORDER_DISPATCH operations and deterministically finish the completion transition. This must be proven by tests before implementation is accepted.

## 4. Historical FIFO and cost rules

- StockLedger `effective_at` is the actual historical dispatch timestamp; `recorded_at` remains the actual timestamp at which the historical-sale workflow wrote the movement.
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
5. Historical dispatch and completion timestamps are combined using the configured spreadsheet timezone; dispatch may precede workbook `created_at` only through the explicit historical-sale workflow. Ordinary dispatch retains the `created_at` lower-bound guard.
6. Completion must not precede actual dispatch; dispatch must not precede the business-date calendar day.
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
- enter a historical sale whose customer-order business date is the previous day while the actual recording time is the next morning, with independently supplied dispatch and completion timestamps;
- verify business_date, created_at, dispatched_at and completed_at are stored independently;
- verify historical dispatch may precede created_at only through the historical workflow, and ordinary dispatch still rejects that chronology;
- verify dispatch effective_at drives FIFO allocation while recorded_at remains actual workflow execution time;
- verify buyer-paid and seller-paid commission settlement;
- verify Finance Dashboard period/filter totals;
- test insufficient historical stock, locked period, same-day event ordering and recovery;
- verify no duplicate rows after repeated confirmation/retry.

## 7. Safety boundaries

The original audit/design-only status is superseded by the source implementation record in section 9. The current branch contains a coordinated F-02 source patch and regression tests, but it has not been runtime-accepted. Do not run the migration on the production workbook. Apply it only to a restored disposable copy after a verified backup and read-only Dry Run. Do not deploy, merge or recreate the production workbook as part of this source task.


## 8. Cross-workspace date/time contract

The common date/time UX remains shared with order lifecycle events, supply lifecycle events and manual warehouse movements. F-02 adds only a manually entered date-only customer-order `business_date`; it does not weaken the ordinary exact date/time input contract for physical dispatch. See `docs/OPERATION_DATE_TIME_UX_DESIGN.md`. This does not add timestamp-split schema columns to supplies or StockLedger.


## 9. F-02 source implementation pass — 26.11.2026

Implemented on `feature/clean-final-baseline` / PR #1:

- Raised the clean-final schema target to v4. `V3_Orders` appends `business_date` as AD; the previous 29-column prefix remains in place. The commission-payer upgrade remains a separate 23/28 → 29-column compatibility step.
- Added `RC8_ORDER_BUSINESS_DATE_V4` (3 → 4). The migration validates the A:AC prefix, rejects unknown AD headers, occupied AD data without a header, formulas in AD, and missing/invalid `created_at` values before backfill. It appends the header and backfills only AD using the configured timezone; it does not rewrite existing order rows or formulas.
- Updated schema compatibility, setup's explicit migration path and installation preflight so v3 workbooks can reach the journaled v3→v4 migration after backup/Dry Run. Clean baseline adoption targets v4 directly.
- Normal orders receive a date-only `business_date` derived from the local calendar date of actual `created_at`; historical sales require an explicit business date.
- Added the dedicated `Историческая продажа` sheet and menu commands. It requires business date, actual dispatch date + HH:mm, actual completion date + HH:mm, product lines and normal commercial inputs. It is separate from the ordinary new-order form; a financial preview is available without current-stock gating, and a YES/NO confirmation is required before the historical stock mutation.
- Added `di3CreateHistoricalSale()`: create/recover via `ORDER_CREATE`, dispatch via the existing `ORDER_DISPATCH` at the supplied historical timestamp, then complete/settle at the supplied completion timestamp. Only the explicit historical path bypasses the ordinary dispatch-not-before-`created_at` guard.
- Historical draft creation bypasses only current-stock quantity rejection. Product, quantity, price and chronology validation remain; scoped FIFO preflight/replay at actual dispatch time decides historical availability and actual COGS.
- The immutable create-request hash includes business date, historical dispatch/completion timestamps and commercial inputs. Dispatch retry compares the persisted operation timestamp and historical-mode marker; a changed timestamp fails closed. Completed retries verify exact timestamps and refresh derived snapshots/register.
- Added business date to the order register as a separate visible field. Finance Dashboard recognition remains based on `completed_at`; business_date does not move revenue or COGS between periods.
- Added source regression tests for request-hash binding, the historical-only created_at bypass, and immutable dispatch retry timestamp checks.

**Source CI passed:** GitHub Actions run `45848104778` (run #163) passed on the current PR head: syntax for 50 `.gs` files and all 134/134 regression tests, including the F-02 cases. The Order Domain suite is 21/21. The same source revision was already tested after the final F-02 source changes in run #160; later commits are documentation-only. **Not yet runtime-accepted:** the migration, historical form, FIFO chronology, PeriodGuard, commissions, Finance Dashboard and retry/fault-recovery flows must be exercised on a restored disposable workbook. No production workbook, live RC8 data, or deployed Apps Script was changed by this source patch. PR #1 remains Draft and unmerged.
## 10. Recovery hardening — 26.11.2026

- Hardened the IN_TRANSIT retry boundary: the order status alone is no longer treated as proof that ORDER_DISPATCH reached COMMITTED. When a dispatch operation exists, retry verifies the persisted timestamp and historical-mode marker; a PREPARED operation is resumed from its immutable payload.
- The historical-sale orchestrator now re-enters the dispatch workflow when it finds an order already in IN_TRANSIT, allowing recovery after the order row was updated but before the dispatch operation journal was committed.
- Before confirming a historical sale, the orchestrator verifies that the dispatch operation exists, is COMMITTED, carries the exact requested dispatched_at, and is marked as historical.
- The completion retry path idempotently repairs a missing DocumentStatusHistory completion entry after verifying the immutable completion timestamp. Derived FIFO snapshots and the order register are refreshed on an already-completed retry.
- Added an Order Domain regression for IN_TRANSIT + PREPARED recovery, including rejection when the persisted operation's historical-mode marker does not match.
- Added a financial preview and explicit YES/NO confirmation before historical stock mutation. The preview accepts the already-read command snapshot, so the confirmed amounts and the eventual immutable create payload cannot be built from two different reads of the form.
- Added a Catalog/Order UX regression proving the historical-sale confirmation and create path share one form snapshot.
- **Latest source CI:** GitHub Actions PR run #163 (45848104778) passed syntax for 50 .gs files and **135/135** tests: FIFO 41, Order Domain 21, Supply Workspace UX 15, Catalog/Order UX 13, System Safety UX 32, Warehouse Dashboard 9, Finance Schema 4. Later commits changed documentation only.
- This remains source/Node validation. Apps Script runtime, actual OperationExecutor fault injection, migration Dry Run/apply, and backup/restore acceptance remain pending on a restored disposable workbook.
