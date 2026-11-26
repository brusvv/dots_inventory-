/**
 * Dots Inventory v3 — temporary two-execution ScriptLock probe.
 *
 * Run only on a restored disposable test copy. No business tables are read or
 * written. The only shared state is one temporary ScriptProperties marker.
 *
 * Session A:
 *   di3TmpC06HoldScriptLock(25000, "C06-2026-11-26", "TEST_COPY_ONLY")
 *
 * Start Session B in a separate Apps Script execution while A is sleeping:
 *   di3TmpC06ProbeContendedLock("C06-2026-11-26", "TEST_COPY_ONLY")
 *
 * With a 25s hold, di3WithLock_ (20s timeout) should return CONTENDED and must
 * not enter its callback. With a 5–15s hold, it should enter only after A
 * releases and return ACQUIRED_AFTER_RELEASE. Starting B after A has finished
 * also returns ACQUIRED_AFTER_RELEASE, but does not test contention.
 * OVERLAP_DETECTED is a hard failure: the callback entered before A marked
 * release while still holding ScriptLock.
 */
function di3TmpC06LockProbeKey_(probeId) {
  var id = String(probeId || "").trim();
  if (!/^[A-Za-z0-9_-]{4,48}$/.test(id)) {
    throw new Error("Укажи probeId длиной 4–48 символов: латиница, цифры, _ или -.");
  }
  return "DI3_TMP_C06_LOCK_PROBE_" + id;
}

function di3TmpC06HoldScriptLock(durationMs, probeId, confirmation) {
  if (String(confirmation || "") !== "TEST_COPY_ONLY") {
    throw new Error('Для тестовой блокировки явно передай "TEST_COPY_ONLY".');
  }
  var key = di3TmpC06LockProbeKey_(probeId);
  var duration = Math.max(5000, Math.min(30000, Number(durationMs) || 25000));
  var properties = PropertiesService.getScriptProperties();
  var existing = properties.getProperty(key);
  if (existing) {
    var existingRecord = null;
    try { existingRecord = JSON.parse(existing); } catch (ignoreExisting) {}
    var existingAge = existingRecord && Number(existingRecord.started_at_ms)
      ? Date.now() - Number(existingRecord.started_at_ms) : 0;
    if (existingAge > 120000) properties.deleteProperty(key);
    else throw new Error("Для этого probeId уже есть активная метка C06. Выбери другой ID или дождись очистки.");
  }

  var lock = LockService.getScriptLock();
  var requestedAt = new Date();
  if (!lock.tryLock(1000)) {
    return {
      status: "LOCK_NOT_ACQUIRED",
      probe_id: String(probeId),
      requested_at: requestedAt.toISOString(),
      duration_ms: duration,
      business_data_touched: false
    };
  }

  var token = Utilities.getUuid();
  var acquiredAt = new Date();
  var marker = {
    probe_id: String(probeId),
    token: token,
    started_at_ms: acquiredAt.getTime(),
    started_at_utc: acquiredAt.toISOString(),
    execution_id: Utilities.getUuid()
  };
  try {
    properties.setProperty(key, JSON.stringify(marker));
    SpreadsheetApp.flush();
    Utilities.sleep(duration);
    SpreadsheetApp.flush();
    return {
      status: "LOCK_HELD_AND_RELEASED",
      probe_id: String(probeId),
      requested_at: requestedAt.toISOString(),
      acquired_at: acquiredAt.toISOString(),
      release_at: new Date().toISOString(),
      held_ms: Date.now() - acquiredAt.getTime(),
      requested_hold_ms: duration,
      marker_key: key,
      business_data_touched: false
    };
  } finally {
    try {
      var current = properties.getProperty(key);
      var currentRecord = current ? JSON.parse(current) : null;
      if (currentRecord && currentRecord.token === token) {
        currentRecord.release_requested_at_ms = Date.now();
        currentRecord.release_requested_at_utc = new Date(currentRecord.release_requested_at_ms).toISOString();
        properties.setProperty(key, JSON.stringify(currentRecord));
      }
    } finally {
      lock.releaseLock();
    }
    try {
      var afterRelease = properties.getProperty(key);
      var afterReleaseRecord = afterRelease ? JSON.parse(afterRelease) : null;
      if (afterReleaseRecord && afterReleaseRecord.token === token) properties.deleteProperty(key);
    } catch (ignoreCleanup) {}
  }
}

function di3TmpC06ProbeContendedLock(probeId, confirmation) {
  if (String(confirmation || "") !== "TEST_COPY_ONLY") {
    throw new Error('Для проверки явно передай "TEST_COPY_ONLY".');
  }
  if (typeof di3WithLock_ !== "function") {
    throw new Error("Не найден production helper di3WithLock_. Установи согласованные модули.");
  }
  var key = di3TmpC06LockProbeKey_(probeId);
  var properties = PropertiesService.getScriptProperties();
  var startedAt = new Date();
  var callbackEntered = false;
  var activeMarkerPresent = null;
  try {
    var result = di3WithLock_(function () {
      callbackEntered = true;
      var raw = properties.getProperty(key);
      var marker = null;
      try { marker = raw ? JSON.parse(raw) : null; } catch (ignoreMarker) {}
      activeMarkerPresent = !!(marker && Date.now() - Number(marker.started_at_ms || 0) <= 120000);
      return {
        acquired: true,
        active_marker_present: activeMarkerPresent,
        marker_probe_id: marker ? marker.probe_id : ""
      };
    });
    return {
      status: activeMarkerPresent ? "OVERLAP_DETECTED" : "ACQUIRED_AFTER_RELEASE",
      probe_id: String(probeId),
      started_at: startedAt.toISOString(),
      finished_at: new Date().toISOString(),
      waited_ms: Date.now() - startedAt.getTime(),
      callback_entered: callbackEntered,
      active_marker_present: activeMarkerPresent,
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
      probe_id: String(probeId),
      started_at: startedAt.toISOString(),
      finished_at: new Date().toISOString(),
      waited_ms: Date.now() - startedAt.getTime(),
      callback_entered: callbackEntered,
      active_marker_present: null,
      error: message,
      lock_depth_after_call: typeof DI3_SCRIPT_LOCK_DEPTH_ === "number" ? DI3_SCRIPT_LOCK_DEPTH_ : null,
      business_data_touched: false
    };
  }
}
