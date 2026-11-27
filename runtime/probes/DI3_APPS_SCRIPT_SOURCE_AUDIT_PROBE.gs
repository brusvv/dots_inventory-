/**
 * Dots Inventory — read-only Apps Script source and bootstrap-backup audit.
 *
 * Run di3AuditExportRuntimeSourceSnapshot() from the bound test project.
 * It reads Apps Script project content and the named Bootstrap backup from
 * Drive. It does not write to Sheets, Drive, Script Properties or project code.
 *
 * The compact JSON output can be saved locally and checked with:
 *   node tools/audit_apps_script_snapshot.js --snapshot runtime-snapshot.json
 */
function di3AuditExportRuntimeSourceSnapshot() {
  var expectedBackupName =
    "DotsInventory_AppsScript_Source_20261126231507_BOOTSTRAP.json";
  var scriptId = String(ScriptApp.getScriptId() || "");
  var spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  if (!scriptId || !spreadsheet) {
    throw new Error("Аудит остановлен: не удалось определить Script ID или привязанную таблицу.");
  }

  var response = UrlFetchApp.fetch(
    "https://script.googleapis.com/v1/projects/" +
      encodeURIComponent(scriptId) + "/content",
    {
      method: "get",
      headers: {
        Authorization: "Bearer " + ScriptApp.getOAuthToken(),
        Accept: "application/json"
      },
      muteHttpExceptions: true
    }
  );
  if (Number(response.getResponseCode()) !== 200) {
    throw new Error(
      "Apps Script API projects.getContent вернул HTTP " +
      response.getResponseCode() + ": " +
      String(response.getContentText() || "").slice(0, 700)
    );
  }

  var project = JSON.parse(response.getContentText());
  if (project.scriptId && project.scriptId !== scriptId) {
    throw new Error("Apps Script API вернул другой Script ID.");
  }
  if (!Array.isArray(project.files)) {
    throw new Error("Apps Script API не вернул массив files.");
  }

  var files = project.files.filter(function (file) {
    return file && file.type === "SERVER_JS" &&
      file.name !== "DI3_GitHubBootstrap";
  }).map(function (file) {
    var source = String(file.source || "");
    return {
      name: String(file.name),
      type: String(file.type),
      git_blob_sha1: di3AuditGitBlobSha1_(source),
      size_bytes: Utilities.newBlob(source).getBytes().length
    };
  }).sort(function (a, b) {
    return a.name.localeCompare(b.name);
  });

  var backups = [];
  var driveFiles = DriveApp.getFilesByName(expectedBackupName);
  while (driveFiles.hasNext()) {
    var driveFile = driveFiles.next();
    var item = {
      name: driveFile.getName(),
      size_bytes: driveFile.getSize(),
      mime_type: driveFile.getMimeType(),
      created_at: driveFile.getDateCreated().toISOString(),
      description: driveFile.getDescription(),
      readable: false,
      payload_sha256_valid: false,
      file_hashes_valid: false,
      script_id_matches: false,
      spreadsheet_id_matches: false
    };

    try {
      var envelope = JSON.parse(
        driveFile.getBlob().getDataAsString("UTF-8")
      );
      var payload = envelope.payload || {};
      item.readable = true;
      item.payload_sha256_valid =
        envelope.payload_sha256 ===
        di3AuditSha256_(JSON.stringify(payload));
      item.script_id_matches = payload.script_id === scriptId;
      item.spreadsheet_id_matches =
        payload.spreadsheet_id === spreadsheet.getId();
      item.file_count = Number(payload.file_count || 0);
      item.files = (payload.files || []).map(function (backupFile) {
        var source = String(backupFile.source || "");
        var size = Utilities.newBlob(source).getBytes().length;
        return {
          name: String(backupFile.name || ""),
          type: String(backupFile.type || ""),
          size_bytes: size,
          sha256_valid:
            backupFile.sha256 === di3AuditSha256_(source) &&
            Number(backupFile.size_bytes) === size
        };
      });
      item.file_hashes_valid =
        item.files.length === item.file_count &&
        item.files.every(function (backupFile) {
          return backupFile.sha256_valid;
        });
    } catch (error) {
      item.error = String(error.message || error);
    }
    backups.push(item);
  }

  var report = {
    format: "dots-inventory-runtime-source-audit/v1",
    status: "READ_ONLY",
    captured_at: new Date().toISOString(),
    script_id: scriptId,
    spreadsheet_id: spreadsheet.getId(),
    project_file_count: project.files.length,
    source_module_count: files.length,
    files: files,
    backup_count: backups.length,
    backups: backups
  };

  Logger.log("DI3_RUNTIME_SOURCE_AUDIT_JSON");
  Logger.log(JSON.stringify(report));
  return report;
}

function di3AuditGitBlobSha1_(source) {
  var size = Utilities.newBlob(source).getBytes().length;
  var payload = "blob " + size + "\u0000" + source;
  return di3AuditHexDigest_(
    Utilities.computeDigest(
      Utilities.DigestAlgorithm.SHA_1,
      payload,
      Utilities.Charset.UTF_8
    )
  );
}

function di3AuditSha256_(value) {
  return di3AuditHexDigest_(
    Utilities.computeDigest(
      Utilities.DigestAlgorithm.SHA_256,
      String(value == null ? "" : value),
      Utilities.Charset.UTF_8
    )
  );
}

function di3AuditHexDigest_(digest) {
  return digest.map(function (byte) {
    var value = byte < 0 ? byte + 256 : byte;
    return ("0" + value.toString(16)).slice(-2);
  }).join("");
}
