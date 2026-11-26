# Unified date/time input contract — orders, supplies and warehouse

Date confirmed: 26 November 2026  
Status: SOURCE IMPLEMENTED + CI PASSED — separate date/time inputs are implemented across ordinary orders, supply lifecycle, historical supply, historical sales and manual warehouse movements; Google Sheets runtime acceptance remains pending.

## 1. Decision

Every user-entered operational event that affects the document lifecycle or stock chronology must have two independent inputs:

- **Date** — calendar/date-picker control, displayed as `ДД.ММ.ГГГГ`.
- **Time** — separate required 24-hour input, displayed as `ЧЧ:ММ`, minute precision; seconds normalize to `00`.

The controls sit next to each other on the same row. Selecting or changing the date must never clear, replace, or silently reset the time. Do not use a combined date-time picker/cell as the input mechanism. A display format such as `dd.mm.yyyy hh:mm` is not a substitute for a separate time input.

The application combines the pair into one timestamp using the configured spreadsheet timezone before validation, hashing an immutable operation payload, or passing `effective_at` to a workflow. Empty or malformed time fails closed. No submit handler may silently substitute midnight or the current time.

## 2. Keep event time separate from recording time

This is a UI/input contract, not a reason to split canonical timestamps into separate date and time columns.

- `effective_at` (or the document's corresponding event field) is when the real-world event happened.
- `recorded_at`, `created_at`, `updated_at`, `Operations.started_at`, and `OperationPayloads.created_at` retain their existing meanings as system-recording/audit timestamps.
- The combined event timestamp remains a single Date/timestamp in canonical tables and immutable payloads.
- Do not rewrite an event's effective time when retrying/recovering an operation.

## 3. Orders

### Ordinary order transitions

The order register currently uses a single next-transition effective-date input (column P). Replace the input with adjacent date and time controls (P/Q or an equivalent non-overlapping layout). The pair is used for dispatch, completion, return-start, actual return and cancellation transitions where the user supplies an effective event time.

The order register may continue displaying stored event timestamps as one readable `ДД.ММ.ГГГГ ЧЧ:ММ` value. The separate controls are specifically for input.

### Historical sales — F-02

- The customer-order `business_date` is a manually entered date-only value; it may precede the actual `created_at` recording timestamp.
- The historical-sale form separately requires actual dispatch date/time and completion date/time. The physical dispatch timestamp—not business_date—drives StockLedger `effective_at` and FIFO.
- Historical mode may permit dispatch before `created_at` only through its explicit workflow; ordinary order dispatch retains the existing lower-bound validation.
- Finance Dashboard continues to recognize sales on `completed_at`; business_date does not shift recognized revenue/COGS periods.
- The F-02 v3→v4 additive schema appends only `business_date`; no dispatch precision/window fields or date/time split columns are added to `V3_Orders`.

## 4. Supplies

### Normal supply lifecycle

The supply register now uses adjacent date/time inputs M/N for the next lifecycle transition: sent, awaiting receipt or received. Both are required; N is strict `HH:mm`. The generated register is now 14 columns; the prior 13-column layout is upgraded while preserving values by `supply_id`. Stored `sent_at`, `awaiting_at` and `received_at` remain single timestamps.

### Historical supply entry

The historical supply form currently captures:
- G2 — store order date;
- G3 — expected arrival date;
- G5 — actual sent time;
- G6 — actual awaiting-receipt time;
- G7 — actual received time.

G2 and G3 are **date-only planning/business dates** and remain date-only. Each actual event G5:G7 must become a date/time pair with adjacent mandatory time inputs (for example H5:H7, subject to the final form layout). All three actual lifecycle event times are required in historical mode; the date picker must not overwrite their time values.

The existing immutable `SUPPLY_RECEIVE` payload, StockLedger movement and FIFO lot continue to store one timestamp for the receipt's `effective_at`; actual operation/recording timestamps remain separate.

## 5. Manual warehouse movements

The `Управление складом` form now uses adjacent date and time controls B4/C4. The pair is mandatory for both manual IN and OUT and is combined into `effective_at` before calling `di3PostManualStockMovement()`. Existing combined B4 values are split on setup; an old midnight value leaves C4 blank for explicit time entry.

The StockLedger row, StockLots row for IN, FIFO allocations for OUT, immutable operation payload and request hash retain the single combined timestamp. `recorded_at` remains the actual registration time captured by the operation workflow.

## 6. Date-only fields are not changed

Do not add a time field to values whose business meaning is a calendar date rather than an event instant:

- supply `supplier_order_date` / G2;
- supply `expected_received_date` / G3;
- order `business_date` (F-02);
- accounting business-period keys and other date-only filters.

Do not invent midnight as an event time from these date-only fields. F-02 `business_date` is a calendar date describing when the customer placed the order; it is not a timestamp and is never converted to a FIFO event. Physical dispatch continues to require its own actual date/time input.

## 7. Shared validation and tests

One shared date+time parser/validator, `di3BuildEffectiveDateTime_`, is now used by orders, supplies, historical supply entry and warehouse movement entry. It:

1. require a valid calendar date and strict 24-hour `HH:mm` time;
2. reject impossible dates, malformed values, and nonexistent local times in the configured timezone;
3. combine the pair in the configured spreadsheet timezone (not an assumed server timezone);
4. normalize seconds/milliseconds to zero;
5. return a canonical timestamp used consistently in confirmation text, request fingerprint/hash and operation payload;
6. preserve the entered time when the date changes;
7. reject a changed date/time payload when reusing an existing idempotency token;
8. keep event chronology validation and PeriodGuard checks on the combined timestamp;
9. distinguish historical mode (no silent prefill) from ordinary current actions; any displayed default must be an actual visible value in the time input, never a submit-time fallback.

Regression coverage must include:
- date change preserves time in every form;
- blank, malformed and impossible times fail closed;
- timezone conversion and daylight-saving transitions;
- same-day FIFO receipt/dispatch ordering at minute precision;
- F-02 previous-day business date entered the following morning, kept separate from actual created_at, actual dispatch timestamp and actual completion timestamp;
- supply sent ≤ awaiting ≤ received;
- order created/business/dispatch/completion chronology;
- manual IN/OUT event timestamp versus recorded_at;
- immutable retry hash and recovery;
- PeriodGuard on combined timestamps;
- no schema changes to supply or StockLedger solely for this UX contract.

## 8. Schema and release boundaries

This contract does not by itself add columns to `V3_Supplies`, `StockLedger`, `StockLots`, or `V3_OrderItems`. Existing timestamp fields are retained.

F-02 requires its separately designed v3→v4 migration appending only `V3_Orders.business_date`. The clean-final schema target is v4, with F-02 `business_date` and F-06 archive tables represented. This date/time UI contract adds no schema columns to supplies, StockLedger, StockLots or OrderItems.

Implement the date/time controls and shared parser as one coordinated source patch across the order, supply, historical-supply and warehouse workspaces. Add source/Node regression tests and CI. Keep PR #1 Draft and unmerged; runtime acceptance must occur on a restored disposable workbook after backup and Dry Run. Never modify the production RC8 workbook during implementation or acceptance.


## 9. Source implementation record — 26 November 2026

Implemented on `feature/clean-final-baseline`:

- Shared `di3BuildEffectiveDateTime_()` combines a date-picker value and strict `HH:mm` text using `DI3_APP_CONFIG.TIME_ZONE`, rejects missing/malformed values and nonexistent local times (DST gaps), and normalizes seconds/milliseconds to zero.
- `di3SplitEffectiveDateTime_()` presents stored timestamps as a date-only picker value plus a separate visible time value.
- Orders: register P/Q date/time pair; hidden order ID moved to R; `business_date` is S. Legacy register layouts migrate by order ID. A date-only legacy input does not silently become midnight; the time must be re-entered.
- Supplies: register M/N date/time pair; historical/ordinary/full-edit form uses G5:G7 date cells and H5:H7 time cells. Dirty-form fingerprints include the time inputs. The previous 13-column supply register migrates to 14 columns by `supply_id`.
- Manual warehouse IN/OUT: B4/C4 date/time pair; legacy combined B4 timestamp is split during setup.
- Historical sales: B4 is the date-only customer business date; dispatch B5/C5 and completion B6/C6 are adjacent date/time pairs.
- Canonical schema fields remain single timestamps. No event-time split columns were added to `V3_Supplies`, `StockLedger`, `StockLots` or `V3_OrderItems`.
- Source regressions cover strict time format, seconds normalization, nonexistent DST local time, supply date/time pairs and dirty-state fingerprints, order register migration, historical sale input cells and manual warehouse date/time.
- **Source CI:** GitHub Actions run [#225](https://github.com/brusvv/dots_inventory-/actions/runs/45853092868) passed syntax for 50 Apps Script files and **145/145** Node regression tests (FIFO 41, Order Domain 22, Supply Workspace UX 17, Catalog/Order UX 14, System Safety UX 37, Warehouse Dashboard 9, Finance Schema 4).

**Runtime acceptance is still pending:** test the old-to-new form migrations, date-picker behavior, text input validation, DST handling in the configured spreadsheet timezone, order/supply lifecycle transitions, FIFO effective_at versus recorded_at, and retry behavior on a restored disposable workbook. No production RC8 workbook or deployed Apps Script was changed.
