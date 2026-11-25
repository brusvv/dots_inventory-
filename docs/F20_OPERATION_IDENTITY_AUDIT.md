# F-20 — Operation identity and actor attribution audit

Date: 2026-11-25  
Scope: source audit only. No Apps Script behavior, spreadsheet schema, workbook data, stock ledger, or operation records changed.

## Executive summary

The operation journal already has two separate actor fields with different intended meanings:

- `Operations.actor`: actor captured when an immutable operation is registered.
- `OperationAttempts.actor`: actor captured when a concrete initial or recovery attempt starts.

That separation is sound, but attribution is not yet consistent end-to-end. Several domain audit rows obtain the actor again while a handler is executing, so a recovery run may be written as if the recovery executor initiated the business event. Other paths call `Session.getActiveUser().getEmail()` directly, and manual quarantine release uses a separate wrapper. The current diagnostics also omit actor from the attempt objects they return.

The current implementation should therefore be treated as **partially attributed**, not as a complete actor audit trail. This audit proposes a consistent identity contract before any schema or code change.

## Source observations

### 1. Operation registration

`27_DI3_OperationExecutor.gs` — `di3RegisterPreparedOperation_`:

- Captures a timestamp in `startedAt` and stores it in `Operations.started_at`.
- Captures actor through `di3GetActorEmail_()` when available, otherwise directly through `Session.getActiveUser().getEmail()`; exceptions are swallowed and the value becomes an empty string.
- Writes the immutable payload to `OperationPayloads`, then writes the `PREPARED` operation row.
- A repeated idempotency key returns the existing verified operation; it does not create a new registration row or record a separate repeat-request actor.

The schema names the timestamp `started_at`, but semantically it is the operation-registration/creation time, not the start time of an execution attempt. The actual execution timestamps are in `OperationAttempts`.

### 2. Attempt execution and recovery

`di3StartOperationAttempt_` captures an actor using the same helper/fallback pattern and writes it to `OperationAttempts.actor` before invoking the domain handler.

The attempt journal distinguishes `INITIAL` and `RECOVERY`, records attempt number, status-before, start/finish time, result and error. Stale attempts are closed as `INTERRUPTED`; recovery then starts a new attempt.

This is a useful distinction: the actor on an attempt can legitimately differ from the actor who registered the operation. However, `di3GetOperationAttemptStats_` currently constructs attempt diagnostic objects without copying column 12 (`actor`). The raw sheet retains the value, but callers of the stats helper cannot inspect it.

### 3. Manual quarantine release

`di3RequeueQuarantinedOperation` obtains actor through `di3SettingsActor_`, writes it into the `MANUAL_REOPEN` row in `OperationAttempts`, and includes the actor and reason in the operation error/audit message.

`di3SettingsActor_` itself calls `Session.getActiveUser().getEmail()` and returns an empty string on failure. This is a separate path from the helper/fallback logic used for registration and attempt start.

### 4. Domain-level actor fields

The source uses several different actor acquisition patterns:

- Order dispatch detail rows call `di3GetActorEmail_()` while the handler builds its domain writes (`16_DI3_OrderWorkflow.gs`).
- Supply status history calls `Session.getActiveUser().getEmail()` directly (`12_DI3_SupplyReceiving.gs`).
- Full supply edit payload stores `edited_by` using a direct active-user lookup (`36_DI3_SupplyFullEdit.gs`).
- Settings audit rows use `di3SettingsActor_()` (`29_DI3_SettingsRepository.gs`).

These fields do not currently have one documented contract. In particular, actor acquisition performed inside a recovery handler can identify the recovery execution context rather than the original requester. A payload field captured at preparation time, such as `edited_by`, behaves differently and remains stable across retries.

### 5. Trigger context and identity limits

The unified edit trigger routes events by sheet and does not pass a durable actor context into domain operations. The inspected trigger dispatcher does not record trigger UID, event type, execution ID, actor source, or whether the active-user identity was available.

An active-user email can be unavailable in some Apps Script execution contexts. An empty value must therefore mean **identity unavailable**, not be silently replaced with the script owner. The effective user is not a safe substitute for the initiating person: for an installable trigger it can identify the account under which the trigger runs rather than the person whose action caused the event.

The source audit does not establish which identity scopes will be available in the deployed spreadsheet's exact account, sharing and trigger configuration. That requires runtime acceptance in the actual Apps Script environment.

## Progress update — diagnostic actor visibility

A first low-risk source patch is now present:

- `di3GetOperationAttemptStats_` includes the stored actor in attempt objects, the latest-attempt summary and manual-review objects.
- The retry-epoch adapter preserves the actor field when it passes rows to `di3GetOperationAttemptExecutionRows_`.
- A regression test covers a first executor, a separate manual reviewer and a different recovery executor.

This does not resolve initiator/executor conflation in domain-event writes. The centralized identity helper, identity source/context metadata and initiator propagation remain unimplemented. The regression test and syntax checks have not been executed in this environment.

## Main risks

1. **Initiator/executor conflation.** Domain rows written during recovery may record the recovery executor as the actor for a business action originally requested by another user.
2. **Inconsistent identity acquisition.** Direct Session lookups, helper/fallback logic and settings-specific lookup can produce different behavior for the same logical action.
3. **Ambiguous blank actor.** Empty string does not distinguish anonymous/unavailable identity from a deliberately system-originated operation.
4. **Incomplete diagnostics.** Attempt statistics omit the actor already stored in the journal.
5. **No explicit source/context.** The audit cannot tell whether an actor was obtained during a menu/dialog action, an installable trigger, recovery, or another execution path.
6. **No separate repeat-request event.** Reusing an idempotency key returns the original operation; the journal intentionally does not retain who later retried the same request through the UI.

## Recommended identity contract

Do not treat a single email field as a complete audit identity. Define three separate concepts:

| Concept | Meaning | Source of truth |
|---|---|---|
| Initiator | Person/context that first requested the business operation | Captured once at operation registration and retained with the immutable operation |
| Executor | Person/context that ran a specific attempt | Captured separately at each `OperationAttempts` start |
| Domain-event actor | Actor attributed to the business event itself | Explicitly derived from the initiator, not re-read from Session during recovery |

For each capture, use a small normalized actor context rather than a bare email:

- `email`: active-user email, or empty if unavailable;
- `identity_status`: `IDENTIFIED` or `UNAVAILABLE`;
- `identity_source`: for example `ACTIVE_USER` or `NONE`;
- `execution_context`: a controlled value such as `INTERACTIVE`, `TRIGGER`, `RECOVERY`, `MANUAL_REVIEW`, or `UNKNOWN`.

Do not use `Session.getEffectiveUser()` as a fallback for the initiating user. If a future workflow has a trusted explicit actor supplied by a verified UI/authentication boundary, it may be added as a separately identified source; do not trust arbitrary payload text as proof of identity.

### Proposed implementation sequence

1. Add one centralized, read-only actor-context helper. It must never throw when identity is unavailable and must not substitute the effective user.
2. Keep the current `Operations.actor` field as the initiating email for backward compatibility; add explicit identity status/source/context fields only through a reviewed additive schema migration if the project needs them.
3. Keep `OperationAttempts.actor` as the executor email and expose it in attempt diagnostics. Add attempt identity status/source/context in the same reviewed migration if required.
4. Pass the persisted initiating actor/context into domain handlers. Domain event rows should use the initiator for the business event; attempt rows should continue to show the actual executor. If a domain field is intentionally meant to record the physical executor, rename/document its semantics rather than overloading `actor`.
5. Route manual quarantine release and document-status history through the same actor-context helper. Preserve the review reason and the fact that this was a manual review action.
6. Optionally add a separate append-only request/retry event for repeated UI submissions that resolve to an existing idempotency key. This is not required for business-operation idempotency and should be implemented only if support/audit requirements need it.
7. Update diagnostic views so they expose initiator, latest executor, execution mode, identity availability and recovery reason without exposing unnecessary personal data.

## Required regression and runtime acceptance

### Pure/source tests

- Actor helper returns `IDENTIFIED` when a test Session exposes an active-user email.
- Actor helper returns `UNAVAILABLE` and does not throw when Session is unavailable or returns an empty email.
- No path substitutes effective-user email for a missing active-user email.
- Registration captures initiator once; repeated idempotent execution does not overwrite it.
- An attempt captures its own executor; a recovery attempt may differ from the initiator.
- Domain event attribution remains the original initiator after recovery by another user.
- Attempt statistics expose the stored actor and identity status.
- Manual quarantine release records a manual-review context and does not overwrite the initiator.
- Trigger-driven execution with unavailable active-user identity is explicitly marked unavailable, not attributed to the script owner.

### Restored-workbook runtime tests

1. User A creates an operation; verify `Operations` identifies A.
2. Force a recoverable failure, then have user B run recovery; verify the original initiator remains A and the recovery attempt identifies B when Apps Script exposes that identity.
3. Repeat the recovery with an execution context where active-user identity is unavailable; verify the journal explicitly shows unavailable identity.
4. Execute an installable edit trigger and verify no false attribution to the script owner.
5. Requeue a quarantined operation manually; verify a separate `MANUAL_REOPEN` audit row with reason and reviewer context.
6. Confirm domain event actor semantics are consistent for normal and recovery execution.

## Original audit scope and safety

At the time of the initial audit, this work was design-only and no application source or workbook data had been changed. The subsequent implementation slices are recorded below. The safety boundary remains: no deployment, schema migration, trigger change, or live workbook/business-data mutation without restored-workbook acceptance.


## Implementation progress — centralized identity capture

The first source-level implementation slice is now in place:

- Added `di3CaptureActorContext_()` as the single identity acquisition point. It returns `email`, `identity_status` (`IDENTIFIED` / `UNAVAILABLE`) and `identity_source` (`ACTIVE_USER` / `NONE`).
- Kept `di3GetActorEmail_()` as a backwards-compatible string accessor for existing schema columns.
- Routed operation registration, operation-attempt execution, supply draft/status history, order status/movement history, PeriodLocks, schema migration records, supply full-edit metadata and settings actor lookup through the shared accessor.
- Removed the duplicate direct active-user lookups and the executor's direct Session fallback. No code path substitutes `Session.getEffectiveUser()`.
- Added a structural regression check to `di3RunSystemSafetyUxUnitTests()` for the shared helper, identity status/source markers and absence of effective-user fallback.

### Boundaries not yet solved

This slice centralizes *acquisition*, but it does not yet persist the normalized context object or distinguish the operation initiator from the executor in domain-event rows. Existing actor columns remain email strings. In particular, handlers that write domain audit rows during recovery may still use the recovery executor's email. The next implementation slice must pass the immutable initiator identity from the registered `Operations.actor` record into the relevant domain audit writes, while `OperationAttempts.actor` continues to represent the actual executor.

### Verification

- Source edits were committed through the GitHub repository connection.
- The structural test was added but **has not been executed**.
- No Apps Script deployment, workbook mutation, schema migration, trigger change or live business-data change was performed.
- Runtime acceptance still requires a restored workbook and separate user/trigger execution contexts.
