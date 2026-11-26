# F-02 — historical sales: source audit and implementation design

Date: 25 November 2026
Status: DESIGN / SOURCE AUDIT ONLY — no application code or workbook data changed.

## 1. Current source findings

The current order lifecycle is split across three existing mechanisms:

1. `ORDER_CREATE` persists the order and its lines through OperationExecutor with an immutable payload and request token.
2. `ORDER_DISPATCH` creates the stock OUT movement, then runs FIFO allocation/replay. The movement's `effective_at` is the dispatch timestamp and `recorded_at` is the actual execution timestamp.
3. Completion is a non-stock order-status transition. It settles buyer payment, seller revenue and realized commission; the FIFO snapshots provide actual COGS/profit.

The existing order schema is v3. `V3_Orders` currently has 29 columns; `commission_payer` is column AC. `created_at` is currently both the recorded order creation timestamp and the lower bound for dispatch date validation. The order number is generated from `created_at`.

The current order-draft builder validates requested quantity against today's available stock and estimates FIFO cost from today's valuation. That is correct for a new order, but not sufficient for a historical sale: stock may have been consumed by later transactions, and the historical balance must be evaluated at the historical dispatch timestamp.

The FIFO engine already has a relevant capability: events are ordered by `effective_at`, then `recorded_at`, then `movement_id`. A backdated movement triggers product replay when it precedes the persisted product state. The replay fails closed if stock was insufficient at the historical point in the event sequence. The existing scoped FIFO preflight can validate the candidate dispatch before the operation is registered.

PeriodGuard already blocks backdated dispatch/completion events in locked periods. Dispatch also checks for pending stock operations and applies the existing returned-order backdating guard.

## 2. Proposed data model — schema v3 → v4

Append two fields to the end of `V3_Orders` (after current column AC):

- `business_date` — the effective business date of the sale/order, distinct from when the record was entered into the system.
- `dispatch_time_precision` — explicit precision/provenance for the dispatch timestamp:
  - `EXACT_MINUTE` — an exact minute was supplied;
  - `WINDOW_START_APPROXIMATE` — a non-zero time window was supplied and its start is used conservatively;
  - `DATE_START_APPROXIMATE` — only the dispatch date was supplied and local midnight is used;
  - `LEGACY_UNKNOWN` — a pre-v4 row whose original time precision cannot be proven.

The entered time-window bounds remain in the immutable order/dispatch payload and request hash.

Do not repurpose `created_at`:
- `created_at` remains the real timestamp when the order record was created in this workbook.
- `business_date` is the historical business date entered by the user.
- `dispatched_at` remains the physical stock-out effective timestamp.
- `completed_at` remains the buyer-completion/settlement effective timestamp.
- `Operations.started_at`, `OperationPayloads.created_at`, and stock movement `recorded_at` preserve actual system-recording time.

Migration `RC8_ORDER_BUSINESS_DATE_V4` (3 → 4):
- append `business_date` as column AD and `dispatch_time_precision` as column AE; never insert or move existing columns;
- backfill `business_date` from `created_at` (the only current source value representing the order's effective date);
- backfill `dispatch_time_precision` as `LEGACY_UNKNOWN`; never infer precision from whether an old timestamp happens to be midnight;
- preserve every existing row/ID and all 29 existing columns;
- validate the complete v3 prefix, blank/occupied tail, and every existing date before writing;
- be resumable and fail closed on unknown headers or non-date legacy values;
- register migration through SchemaMigrations and the normal backup + Dry Run + explicit apply flow;
- no reverse migration; rollback through verified backup/restore.

The schema registry, legacy-schema compatibility checks, schema-version report, migration executor, order-row builder, order read/write mapping, and order register must all be updated together. The order register should display business date separately from actual record-created time rather than silently relabeling `created_at`.

## 3. Historical sale workflow

Recommended UX: a separate menu command **«Внести старую продажу…»** using the existing order calculator's product lines, prices, discount and commission inputs. It must not silently turn ordinary order creation into historical mode.

The command collects and confirms:
- business date (date only);
- required physical dispatch date plus an optional separately entered time window (`from` / `to`);
- required completion date and exact completion time;
- current calculator request token and exact form fingerprint.

### Date/time input UX — updated decision 26.11.2026

The physical dispatch date is required; the time window is optional. The user may save a historical sale with the date alone.

- dispatch date: required calendar picker, displayed as `ДД.ММ.ГГГГ`;
- optional time window: two separate 24-hour inputs, `с` / `по`, minute precision (`ЧЧ:ММ`); both values must be supplied together, and the start must not exceed the end;
- if only a date is supplied, the canonical dispatch `effective_at` is the beginning of that local calendar day (`00:00:00`) in `DI3_APP_CONFIG.TIME_ZONE`; precision is `DATE_START_APPROXIMATE`;
- if a non-zero time window is supplied, the canonical dispatch `effective_at` is the beginning of the window; precision is `WINDOW_START_APPROXIMATE`;
- if the window start equals its end, treat it as one exact minute; precision is `EXACT_MINUTE`;
- the selected timestamp is the earliest possible instant in the supplied uncertainty interval. It is a conservative FIFO boundary, not a claim that dispatch physically happened at that exact minute;
- before registering `ORDER_DISPATCH`, inspect existing StockLedger events for each product in the sale. If another stock event for that product falls inside or on the boundary of the uncertainty interval, fail closed and ask the user to narrow the window or supply a more precise time. With date-only input, the uncertainty interval is the entire local calendar day, so any same-product event on that date makes the date-only entry ambiguous;
- when no same-product event intersects the uncertainty interval, using its start preserves the event's order relative to all known events for that product. Normal full FIFO replay remains authoritative and must still reject insufficient historical stock;
- completion date and exact completion time remain separately required and validated;
- business date remains date-only.

Do not combine date and time in one date-picker-controlled cell: a Sheets date picker can replace the time portion with midnight. Keep date and optional time-window values in separate controls/columns, and combine them only in the workflow layer using the configured spreadsheet timezone.

The conservative dispatch timestamp rule is defined in Section 5 below. The remaining completion-chronology question is also recorded there; it does not change the requirement to supply a completion date and exact completion time.

Recommended orchestration reuses the existing idempotent lifecycle rather than introducing a second stock engine:

1. Validate the order form and historical date sequence.
2. Assert PeriodGuard is open for business date, dispatch and completion.
3. Build the normal immutable `ORDER_CREATE` request with actual `created_at`, explicit `business_date`, and the historical dates included in the request hash.
4. Create/recover the order using `ORDER_CREATE`.
5. Dispatch using the existing `ORDER_DISPATCH` handler and the historical dispatch timestamp. FIFO preflight must be the authority for historical stock sufficiency; today's stock check must not reject a valid past balance.
6. Complete the order using the existing status/settlement logic at the historical completion timestamp.
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

## 5. Precision rule and remaining timestamp decision

The FIFO comparator orders same-day events by `recorded_at` after `effective_at`. A date-only historical sale cannot reveal its true within-day position relative to same-product receipts and other sales.

Decision confirmed 26.11.2026: **use the beginning of the uncertainty interval as the FIFO timestamp** — local midnight for date-only input, or the window start for a supplied interval. This is intentionally conservative with respect to receipts that may have happened later. Same-product ledger events inside or on the interval boundary make the order ambiguous and must block dispatch until the user narrows the interval or supplies a more precise time. Do not silently substitute noon, end-of-day or the current time.

The selected precision (`DATE_START_APPROXIMATE`, `WINDOW_START_APPROXIMATE`, or `EXACT_MINUTE`) must be stored in the order row and included, together with the entered window bounds, in the immutable operation payload and request hash. Existing v3 orders migrate as `LEGACY_UNKNOWN`.

**Still to confirm before implementation:** completion chronology must be checked against the *latest possible dispatch instant* (window end, or end of the local dispatch date for date-only input), not only against the conservative FIFO timestamp. This can require completion to be on the following date when dispatch was entered date-only. Confirm this user-visible consequence before implementing F-02.

## 6. Required regression and acceptance coverage

Pure/domain tests:
1. Normal order with no business_date preserves existing v3 behavior before migration and defaults business_date to created_at after v4.
2. Historical order stores actual created_at separately from business_date.
3. Business date ≤ dispatch uncertainty interval; completion timestamp must be after the latest possible dispatch instant (window end, or end of local dispatch day for date-only input) and no later than now; date/time is combined using the configured spreadsheet timezone.
4. Dispatch before business date, completion before dispatch, future dates and invalid dates fail closed.
5. Historical stock is sufficient at dispatch even if later sales consumed the current stock: preflight passes and replay allocates correct historical lots.
6. Historical stock is insufficient at dispatch even if a later receipt makes current stock sufficient: preflight rejects.
7. Date-only dispatch uses local midnight and `DATE_START_APPROXIMATE`; a non-zero window uses its start and `WINDOW_START_APPROXIMATE`; equal boundaries use `EXACT_MINUTE`; malformed, partial or inverted windows fail closed.
8. Any same-product StockLedger event inside or on the boundary of the dispatch uncertainty interval blocks dispatch; narrowing the interval to exclude the event permits deterministic ordering.
9. A later same-day receipt never becomes available to a date-only dispatch at the beginning of that day.
10. UNKNOWN/FREE lots preserve cost status and no invented COGS.
11. Existing F-01 return-after-unrelated-FIFO-run scenario still returns the original dispatch lots.
12. Request-token retry with identical dates/windows is idempotent; changed dates, window bounds or form payload are rejected.
13. Fault/retry after ORDER_CREATE, after ORDER_DISPATCH, and before completion never duplicates order, ledger, details, lots or allocations.
14. PeriodGuard rejects any historical business/dispatch/completion date in a locked period.
15. v3→v4 migration preserves the 29-column prefix, IDs, row count and timestamps; backfills business_date from created_at and dispatch_time_precision as LEGACY_UNKNOWN; Dry Run is read-only and rerun is safe.

Runtime acceptance on a restored disposable workbook:
- backup + schema Dry Run before migration;
- migrate v3→v4 and verify manifest/SchemaMigrations;
- enter historical sales with date-only dispatch, a non-zero time window, and a single-minute window;
- verify that date-only dispatch cannot consume a same-day receipt and that overlapping same-product events block dispatch until the interval is narrowed;
- verify StockLedger effective_at vs recorded_at, the precision marker, FIFO allocations and OrderCostSnapshots;
- verify buyer-paid and seller-paid commission settlement;
- verify Finance Dashboard period/filter totals;
- test insufficient historical stock, locked period, same-day event ordering and recovery;
- verify no duplicate rows after repeated confirmation/retry.

## 7. Safety boundaries

This document is a design only. No schema, order, stock, FIFO, migration, menu or workbook code was changed as part of this audit. Do not install a partial v4 schema. Do not run the migration on the production workbook. The implementation should be delivered as one coordinated source patch with tests and a dedicated release note, then applied only to a restored test copy after backup and Dry Run.


## 8. Cross-workspace date/time contract

The common date/time UX remains shared with supply lifecycle events and manual warehouse movements, with one explicit F-02 exception: historical dispatch accepts a date without a time window and uses the conservative interval-start rule above. See `docs/OPERATION_DATE_TIME_UX_DESIGN.md` for mandatory-time controls elsewhere and the F-02 exception. This does not add timestamp-split schema columns to supplies or StockLedger.
