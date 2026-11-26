# Runtime probes — safety classification

| File | Safety | Purpose / warning |
|---|---|---|
| `DI3_C04_ALL_TYPES_FAULT_INJECTION_PROBE.gs` | **MUTATING** | Performs real test operations and injects post-write faults to test recovery. Requires isolated disposable copy, recent backup and explicit test-only parameters. It is not a production module. |
| `DI3_C06_LOCK_CONTENTION_PROBE.gs` | Controlled lock test | Requires a shared probe ID and `TEST_COPY_ONLY`. Session A holds ScriptLock and writes a temporary ScriptProperties marker; Session B calls production `di3WithLock_()`. Expected results are `CONTENDED` or `ACQUIRED_AFTER_RELEASE`; `OVERLAP_DETECTED` is a failure. It does not touch business tables, but temporarily blocks mutations. Test copy only. |
| `DI3_C08_READ_RUNTIME_PROBE.gs` | Read-only | Measures TextFinder/read-path behavior. Recommended `sample_keys: 5` and `sample_keys: 30`; save full report. |
| `DI3_C10_MONEY_RANGE_RUNTIME_PROBE.gs` | Read-only / in-memory | Checks numeric rounding vectors; no sheet data changes. |
| `DI3_SUPPLY_CANCEL_FAULT_INJECTION_PROBE.gs` | **MUTATING** | Permanently cancels two specified unreceived test supplies in the test copy to test recovery/history repair. Never use real supplies. |
| `DI3_SUPPLY_CATALOG_RUNTIME_PROBE.gs` | Read-only | Checks supply/catalog runtime integrity and selector behavior. |
| `DI3_SUPPLY_EDIT_CANCEL_RUNTIME_PROBE.gs` | Read-only | Checks form mode, register, edit/cancel invariants. |

Only add a probe to a test Apps Script project when running that exact test. Remove temporary probe files after saving the evidence. Save the complete JSON, not a truncated screenshot.


## F-14 two-session procedure

Run only on a restored disposable workbook and bound Apps Script project.

1. Start Session A:
   di3TmpC06HoldScriptLock(25000, "C06-TEST-001", "TEST_COPY_ONLY")
2. While Session A is sleeping, start Session B in another independent Apps Script execution:
   di3TmpC06ProbeContendedLock("C06-TEST-001", "TEST_COPY_ONLY")
3. Expected with 25 seconds: Session B returns CONTENDED, callback_entered=false, business_data_touched=false.
4. Repeat with a 5–15 second hold. Session B should wait, then return ACQUIRED_AFTER_RELEASE; active_marker_present=false.
5. Any OVERLAP_DETECTED is a hard failure. Starting Session B only after A has completed does not test contention.
6. The probe marker is stored in ScriptProperties and token-checked on cleanup. A stale marker older than 120 seconds can be removed by the next hold attempt. It does not read or write business tables.

Do not run this probe against the production workbook. Save both complete execution results with timestamps and the same probe ID.
