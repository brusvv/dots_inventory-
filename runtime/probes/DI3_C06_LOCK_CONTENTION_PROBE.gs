/**
 * Dots Inventory v3 RC8 — temporary two-execution ScriptLock probe.
 *
 * Uses no business tables and makes no workbook edits. Run only on a test copy.
 * Two separate Apps Script executions (ideally two user sessions) are required.
 */
function di3TmpC06HoldScriptLock(durationMs, confirmation) {
  if (String(confirmation || "") !== "TEST_COPY_ONLY") {
    throw new Error('Для тестовой блокировки явно передай "TEST_COPY_ONLY".');
  }
  var duration = Math.max(5000, Math.min(30000, Number(durationMs) || 25000));
  var lock = LockService.getScriptLock();
  var requestedAt = new Date();
  if (!lock.tryLock(1000)) {
    return {
      status: "LOCK_NOT_ACQUIRED",
      requested_at: requestedAt.toISOString(),
      duration_ms: duration,
      note: "Проба не получила lock и не удерживала его."
    };
  }
  var acquiredAt = new Date();
  try {
    SpreadsheetApp.flush();
    Utilities.sleep(duration);
    SpreadsheetApp.flush();
    return {
      status: "LOCK_HELD_AND_RELEASED",
      requested_at: requestedAt.toISOString(),
      acquired_at: acquiredAt.toISOString(),
      release_at: new Date().toISOString(),
      held_ms: new Date().getTime() - acquiredAt.getTime(),
      requested_hold_ms: duration,
      business_data_touched: false
    };
  } finally {
    lock.releaseLock();
  }
}

function di3TmpC06ProbeContendedLock(confirmation) {
  if (String(confirmation || "") !== "TEST_COPY_ONLY") {
    throw new Error('Для проверки явно передай "TEST_COPY_ONLY".');
  }
  if (typeof di3WithLock_ !== "function") {
    throw new Error("Не найден production helper di3WithLock_. Установи согласованные модули RC8.");
  }
  var startedAt = new Date();
  var callbackEntered = false;
  try {
    var result = di3WithLock_(function () {
      callbackEntered = true;
      return { acquired: true };
    });
    return {
      status: "ACQUIRED",
      started_at: startedAt.toISOString(),
      finished_at: new Date().toISOString(),
      waited_ms: new Date().getTime() - startedAt.getTime(),
      callback_entered: callbackEntered,
      result: result,
      lock_depth_after_call: typeof DI3_SCRIPT_LOCK_DEPTH_ === "number" ? DI3_SCRIPT_LOCK_DEPTH_ : null,
      business_data_touched: false
    };
  } catch (error) {
    var message = String(error && error.message || error);
    var contended = message.indexOf("Core Foundation занят другой операцией") !== -1;
    if (!contended) throw error;
    return {
      status: "CONTENDED",
      started_at: startedAt.toISOString(),
      finished_at: new Date().toISOString(),
      waited_ms: new Date().getTime() - startedAt.getTime(),
      callback_entered: callbackEntered,
      error: message,
      lock_depth_after_call: typeof DI3_SCRIPT_LOCK_DEPTH_ === "number" ? DI3_SCRIPT_LOCK_DEPTH_ : null,
      business_data_touched: false
    };
  }
}
