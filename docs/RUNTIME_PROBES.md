# Runtime probes — safety classification

| File | Safety | Purpose / warning |
|---|---|---|
| `DI3_C04_ALL_TYPES_FAULT_INJECTION_PROBE.gs` | **MUTATING** | Performs real test operations and injects post-write faults to test recovery. Requires isolated disposable copy, recent backup and explicit test-only parameters. It is not a production module. |
| `DI3_C06_LOCK_CONTENTION_PROBE.gs` | Controlled lock test | Uses two independent Apps Script executions; holds ScriptLock for several seconds. It does not write business tables, but it can temporarily block other mutations. Test copy only. |
| `DI3_C08_READ_RUNTIME_PROBE.gs` | Read-only | Measures TextFinder/read-path behavior. Recommended `sample_keys: 5` and `sample_keys: 30`; save full report. |
| `DI3_C10_MONEY_RANGE_RUNTIME_PROBE.gs` | Read-only / in-memory | Checks numeric rounding vectors; no sheet data changes. |
| `DI3_SUPPLY_CANCEL_FAULT_INJECTION_PROBE.gs` | **MUTATING** | Permanently cancels two specified unreceived test supplies in the test copy to test recovery/history repair. Never use real supplies. |
| `DI3_SUPPLY_CATALOG_RUNTIME_PROBE.gs` | Read-only | Checks supply/catalog runtime integrity and selector behavior. |
| `DI3_SUPPLY_EDIT_CANCEL_RUNTIME_PROBE.gs` | Read-only | Checks form mode, register, edit/cancel invariants. |

Only add a probe to a test Apps Script project when running that exact test. Remove temporary probe files after saving the evidence. Save the complete JSON, not a truncated screenshot.
