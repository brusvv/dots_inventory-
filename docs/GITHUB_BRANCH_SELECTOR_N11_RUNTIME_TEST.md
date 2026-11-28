# D-09-N11 — Apps Script runtime concurrency test

Status: **RUNBOOK PREPARED; RUNTIME NOT RUN**.

This procedure tests the real Apps Script `LockService.getScriptLock()` used by the confirmed installer and code rollback. It is intentionally performed only in the isolated disposable project `Dots beta 4`.

## Safety boundary

- Target project: disposable Apps Script project `Dots beta 4` only.
- Expected Script ID recorded in the preceding project handoff: `1ZyZcv7Z_DRjf30_062HRRPWmcXpqrSxIMSNtJlwGqOolMRJTCXSMsrxk`. **Verify it in Project Settings immediately before starting. If it differs, stop.**
- Source branch: `feature/github-branch-selector`.
- Source commit: `05e01800276c73a452522514634a6d78364569f6` (the branch may have advanced; record the actual installed commit and do not assume this SHA is currently installed).
- Never use production RC8, a production deployment, or a production spreadsheet.
- No setup, migration, schema changes, FIFO rebuild, inventory edits, or deployment actions are part of this test.
- The test intentionally creates verified Drive source backups as part of the install/rollback confirmation flow. It must not call `projects.updateContent` while the lock is held.
- Do not paste OAuth tokens, GitHub tokens, or Script Properties values into the test log.

## What this verifies

Both `di3InstallLatestGitHubReleaseWithConfirmation()` and `di3RollbackAppsScriptCodeWithConfirmation()` acquire the same project-wide ScriptLock **after** the user confirms YES, with a 1000 ms wait. If another execution owns the lock, the operation must return:

```text
status: LOCK_NOT_ACQUIRED
write_performed: false
```

For this outcome, `projects.updateContent` must not be called. The installer keeps its verified source backup; rollback keeps both the selected backup and the verified backup of the current project.

This test does not claim to protect other Script IDs or writers that do not use this ScriptLock.

## Preparation

1. Open the disposable `Dots beta 4` spreadsheet and its bound Apps Script project.
2. In **Project Settings**, verify the Script ID exactly matches the ID above. If not, stop; do not run any test.
3. Verify the installed updater files `43_DI3_GitHubDeploymentManager.gs` through `46_DI3_GitHubCodeRollback.gs` are from the same reviewed branch-selector commit. Record the actual installed branch/commit shown by the updater and the project file inventory.
4. Record the current Apps Script file inventory and fingerprint using the project's existing read-only diagnostic. Record the actual `appsscript.json` name/type and timezone. Do not alter the manifest or scopes.
5. Ensure the disposable project has a usable verified source backup. For rollback contention, note the ID of a verified backup belonging to this **same Script ID**. Never use a backup from another project.
6. Keep the spreadsheet open in one browser tab and the Apps Script editor open in another. Do not run any install/rollback YES confirmation yet.

If the project identity, source set, or backup cannot be verified, stop.

## Temporary lock-holder helper

Create a temporary file named `98_DI3_N11_RuntimeLockTest.gs` in the disposable Apps Script project only. Paste exactly this code:

```javascript
/**
 * TEMPORARY D-09-N11 TEST ONLY.
 * Holds this project's ScriptLock for up to 90 seconds.
 * Does not read or write project content, Drive files, Properties, or Sheets.
 */
function di3N11HoldScriptLockForRuntimeTest() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) {
    Logger.log(JSON.stringify({
      test: "N11_LOCK_HOLDER",
      status: "LOCK_NOT_ACQUIRED",
      write_performed: false
    }));
    return;
  }
  var startedAt = new Date().toISOString();
  try {
    Logger.log(JSON.stringify({
      test: "N11_LOCK_HOLDER",
      status: "LOCK_ACQUIRED",
      hold_seconds: 90,
      started_at: startedAt
    }));
    Utilities.sleep(90000);
  } finally {
    lock.releaseLock();
    Logger.log(JSON.stringify({
      test: "N11_LOCK_HOLDER",
      status: "LOCK_RELEASED",
      released_at: new Date().toISOString()
    }));
  }
}

/**
 * Read-only lock availability probe. Acquires and immediately releases
 * the same project-wide ScriptLock; it does not modify project content.
 */
function di3N11ProbeScriptLockAvailability() {
  var lock = LockService.getScriptLock();
  var acquired = lock.tryLock(1000);
  if (!acquired) {
    Logger.log(JSON.stringify({
      test: "N11_LOCK_PROBE",
      status: "LOCK_NOT_ACQUIRED"
    }));
    return { status: "LOCK_NOT_ACQUIRED" };
  }
  try {
    Logger.log(JSON.stringify({
      test: "N11_LOCK_PROBE",
      status: "LOCK_ACQUIRED"
    }));
    return { status: "LOCK_ACQUIRED" };
  } finally {
    lock.releaseLock();
  }
}
```

Save the file. This temporary file changes the test project's file inventory; record its presence so it can be removed at the end. Do not copy this helper into the repository's production source modules.

## N11-A — installer is rejected while the lock is held

1. In Apps Script editor, select `di3N11HoldScriptLockForRuntimeTest` and click **Run**.
2. Open **Executions** and confirm the holder execution started and logged `LOCK_ACQUIRED`.
3. While its 90-second hold is active, switch to the disposable spreadsheet.
4. Run the normal menu command for GitHub confirmed installation. Complete the read-only preview. The installer may create and verify its normal Drive source backup before showing the confirmation dialog; this is expected.
5. Inspect the confirmation details: project ID must be the disposable Script ID, branch/commit and file counts must be expected, removed files must be zero, and the backup must be VERIFIED.
6. Click **YES** while the helper still holds the lock.
7. Expected installer result: `LOCK_NOT_ACQUIRED`, `write_performed: false`. It must not report `INSTALLED_AND_VERIFIED`.
8. Check Apps Script Executions/logs for the result. Verify the installer execution completed inside the lock-holder's 90-second window.
9. Re-read the project file inventory/fingerprint. It must match the pre-operation inventory/fingerprint, except for the already-recorded temporary helper file. A new verified Drive backup is expected. No project source write is expected.

If the lock holder did not log `LOCK_ACQUIRED`, if the operation outlasted the 90-second hold, or if the result is ambiguous, mark the test **INCONCLUSIVE** and repeat only after diagnosing the cause. Do not infer a pass from a generic UI message.

## N11-B — rollback is rejected while the lock is held

1. Confirm a verified source backup exists for the same disposable Script ID. Keep its file ID ready.
2. Start `di3N11HoldScriptLockForRuntimeTest` again from Apps Script editor.
3. Confirm `LOCK_ACQUIRED` in the holder execution log.
4. While the lock is held, use the normal menu command for Apps Script code rollback.
5. Supply the ID of the verified same-project backup. Check that the selected backup and target project are correct.
6. The rollback flow creates and verifies a backup of the current project before its YES/NO dialog; this is expected.
7. Click **YES** while the helper still holds the lock.
8. Expected result: `LOCK_NOT_ACQUIRED`, `write_performed: false`. It must not report `ROLLED_BACK_AND_VERIFIED`.
9. Verify the project inventory/fingerprint is unchanged (apart from the temporary helper file), and confirm no Apps Script source write occurred. The selected backup and current-state backup should remain available.

Do not select a backup from another Script ID. Do not test rollback by choosing a backup that would intentionally downgrade the project.

## N11-C — lock is available after the holder exits

1. Wait until the lock-holder execution has completed and logged `LOCK_RELEASED`.
2. Run `di3N11ProbeScriptLockAvailability` from the Apps Script editor.
3. Expected result: `LOCK_ACQUIRED`, followed by release in the helper's `finally`.
4. This confirms that the test holder released the project lock. It does **not** independently prove that installer/rollback release their lock in runtime; those `finally` paths remain covered by the passing CI regression tests.

## Cleanup

1. Wait until all N11 executions have completed.
2. Delete only the temporary file `98_DI3_N11_RuntimeLockTest.gs` from the disposable Apps Script project.
3. Save, then re-read the project file inventory/fingerprint. Confirm the temporary file is gone and all other files match the recorded baseline.
4. Do not delete the verified Drive backups created during the test; they are harmless and preserve recovery evidence.
5. Confirm spreadsheet data, schema, FIFO, stock, triggers, deployments, and deployment pointers were not changed.
6. Save the execution IDs, timestamps/timezone, holder logs, installer/rollback return statuses, before/after fingerprints, and backup file IDs in the test report. Redact tokens and Script Properties values.

## Acceptance table

| Check | Required evidence | Pass condition |
|---|---|---|
| Target isolation | Script ID from Project Settings | Exact disposable project ID |
| N11-A holder | Execution log | `LOCK_ACQUIRED` |
| N11-A installer | Execution result | `LOCK_NOT_ACQUIRED`; `write_performed:false` |
| N11-A no-write | Before/after fingerprint | No source changes except temporary helper file |
| N11-B holder | Execution log | `LOCK_ACQUIRED` |
| N11-B rollback | Execution result | `LOCK_NOT_ACQUIRED`; `write_performed:false` |
| N11-B no-write | Before/after fingerprint | No source changes except temporary helper file |
| N11-C release | Probe execution | `LOCK_ACQUIRED` |
| Cleanup | Final inventory | Temporary helper removed; remaining source set restored |

Overall N11 runtime status is **PASS** only when all rows pass with retained evidence. Any missing log, timeout, wrong Script ID, unexpected write, or ambiguous status makes the affected case **INCONCLUSIVE/FAIL**, not PASS.
