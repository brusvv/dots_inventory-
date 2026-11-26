# Unified date/time input contract — orders, supplies and warehouse

Date confirmed: 26 November 2026  
Status: UX / domain contract frozen for implementation; source changes not yet applied.

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

- Business date remains date-only.
- Dispatch date and dispatch time are separate mandatory inputs.
- Completion date and completion time are separate mandatory inputs.
- Actual order `created_at` remains the system-recorded creation time.
- Dispatch `effective_at` is the physical stock-out time; stock movement `recorded_at` is when it was entered.
- Preserve the F-02 v3→v4 additive migration for `business_date`; no date/time split columns are added to `V3_Orders`.

## 4. Supplies

### Normal supply lifecycle

The supply register currently has one optional next-stage effective-date input (column M). Add a separate adjacent time input (column N or equivalent). Use the pair for the effective time of the next lifecycle transition: sent, awaiting receipt, or received. The stored `sent_at`, `awaiting_at`, and `received_at` fields remain single timestamps.

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

The `Управление складом` form currently captures the operation date/time in one cell (B4). Replace that input with adjacent date and time controls on the same row. The pair is mandatory for both manual IN and OUT and is combined into `effective_at` before calling `di3PostManualStockMovement()`.

The StockLedger row, StockLots row for IN, FIFO allocations for OUT, immutable operation payload and request hash retain the single combined timestamp. `recorded_at` remains the actual registration time captured by the operation workflow.

## 6. Date-only fields are not changed

Do not add a time field to values whose business meaning is a calendar date rather than an event instant:

- supply `supplier_order_date` / G2;
- supply `expected_received_date` / G3;
- order `business_date` (F-02);
- accounting business-period keys and other date-only filters.

Do not invent midnight as an event time from these date-only fields. Where a date-only value is used as a lower-bound validation rule, preserve that rule explicitly rather than pretending it is a timestamped event.

## 7. Shared validation and tests

Implement one shared date+time parser/validator used by orders, supplies, historical supply entry and warehouse movement entry. It must:

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
- supply sent ≤ awaiting ≤ received;
- order created/business/dispatch/completion chronology;
- manual IN/OUT event timestamp versus recorded_at;
- immutable retry hash and recovery;
- PeriodGuard on combined timestamps;
- no schema changes to supply or StockLedger solely for this UX contract.

## 8. Schema and release boundaries

This contract does not by itself add columns to `V3_Supplies`, `StockLedger`, `StockLots`, or `V3_OrderItems`. Existing timestamp fields are retained.

F-02 still requires its separately designed `V3_Orders.business_date` v3→v4 migration. Do not increment the target schema version until the F-02 field contract and F-06 archive table contract are frozen together.

Implement the date/time controls and shared parser as one coordinated source patch across the order, supply, historical-supply and warehouse workspaces. Add source/Node regression tests and CI. Keep PR #1 Draft and unmerged; runtime acceptance must occur on a restored disposable workbook after backup and Dry Run. Never modify the production RC8 workbook during implementation or acceptance.
