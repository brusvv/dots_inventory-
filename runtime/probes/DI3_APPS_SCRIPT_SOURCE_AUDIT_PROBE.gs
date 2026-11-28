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
      muteHttpExceptions: true,
      // This request carries an OAuth bearer token. Never forward it through
      // an automatic redirect; fail closed on any 3xx response.
      followRedirects: false
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

  var manifestFiles = project.files.filter(function (file) {
    return file && file.type === "JSON" && file.name === "appsscript";
  });
  var manifestInfo = {
    found: manifestFiles.length === 1,
    parse_valid: false,
    time_zone: "",
    oauth_scopes: [],
    runtime_version: "",
    exception_logging: ""
  };
  if (manifestFiles.length === 1) {
    try {
      var manifest = JSON.parse(String(manifestFiles[0].source || ""));
      manifestInfo.parse_valid = true;
      manifestInfo.time_zone = String(manifest.timeZone || "");
      manifestInfo.oauth_scopes = Array.isArray(manifest.oauthScopes) ? manifest.oauthScopes.slice().sort() : [];
      manifestInfo.runtime_version = String(manifest.runtimeVersion || "");
      manifestInfo.exception_logging = String(manifest.exceptionLogging || "");
    } catch (manifestError) {
      manifestInfo.error = String(manifestError.message || manifestError);
    }
  }

  var projectFiles = project.files.map(function (file) {
    var source = String(file.source || "");
    return {
      name: String(file.name || ""),
      type: String(file.type || ""),
      git_blob_sha1: di3AuditGitBlobSha1_(source),
      size_bytes: Utilities.newBlob(source).getBytes().length
    };
  }).sort(function (a, b) {
    var left = a.type + "|" + a.name;
    var right = b.type + "|" + b.name;
    return left < right ? -1 : left > right ? 1 : 0;
  });
  var projectFingerprint = di3AuditSha256_(JSON.stringify(projectFiles));

  var propertyInventory = { status: "UNAVAILABLE", keys: [] };
  try {
    propertyInventory.keys = PropertiesService.getScriptProperties().getKeys().map(String).sort();
    propertyInventory.status = "OK";
  } catch (propertyError) {
    propertyInventory.error = String(propertyError.message || propertyError);
  }

  var triggerInventory = { status: "UNAVAILABLE", items: [] };
  try {
    triggerInventory.items = ScriptApp.getProjectTriggers().map(function (trigger) {
      return {
        handler_function: String(trigger.getHandlerFunction() || ""),
        event_type: String(trigger.getEventType() || ""),
        trigger_source: String(trigger.getTriggerSource() || "")
      };
    }).sort(function (a, b) {
      var left = a.handler_function + "|" + a.event_type + "|" + a.trigger_source;
      var right = b.handler_function + "|" + b.event_type + "|" + b.trigger_source;
      return left < right ? -1 : left > right ? 1 : 0;
    });
    triggerInventory.status = "OK";
  } catch (triggerError) {
    triggerInventory.error = String(triggerError.message || triggerError);
  }

  var deploymentInventory = di3AuditListDeployments_(scriptId);

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
      description_marker_present: false,
      metadata_valid: false,
      backup_folder_membership_matches: null,
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
      var description = String(driveFile.getDescription() || "");
      var descriptionPrefix = "DI3_APPS_SCRIPT_SOURCE_BACKUP_V1:";
      item.description_marker_present = description.indexOf(descriptionPrefix) === 0;
      if (item.description_marker_present) {
        try {
          var metadata = JSON.parse(description.slice(descriptionPrefix.length));
          item.metadata_valid = metadata.status === "VERIFIED" &&
            metadata.script_id === scriptId &&
            Number(metadata.file_count) === Number(payload.file_count) &&
            metadata.payload_sha256 === envelope.payload_sha256;
        } catch (metadataError) {
          item.metadata_error = String(metadataError.message || metadataError);
        }
      }
      try {
        var configuredFolderId = String(PropertiesService.getScriptProperties().getProperty("DI3_BACKUP_FOLDER_ID") || "");
        if (configuredFolderId) {
          var parents = driveFile.getParents();
          item.backup_folder_membership_matches = false;
          while (parents.hasNext()) {
            if (String(parents.next().getId()) === configuredFolderId) {
              item.backup_folder_membership_matches = true;
            }
          }
        }
      } catch (folderError) {
        item.folder_check_error = String(folderError.message || folderError);
      }
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
    project_fingerprint_sha256: projectFingerprint,
    project_files: projectFiles,
    manifest: manifestInfo,
    script_properties: propertyInventory,
    triggers: triggerInventory,
    deployments: deploymentInventory,
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

function di3AuditListDeployments_(scriptId) {
  var result = { status: "UNAVAILABLE", items: [], pages: 0, truncated: false };
  var pageToken = "";
  var maxPages = 10;
  for (var page = 0; page < maxPages; page++) {
    var url = "https://script.googleapis.com/v1/projects/" +
      encodeURIComponent(scriptId) + "/deployments?pageSize=100";
    if (pageToken) url += "&pageToken=" + encodeURIComponent(pageToken);
    var response;
    try {
      response = UrlFetchApp.fetch(url, {
        method: "get",
        headers: {
          Authorization: "Bearer " + ScriptApp.getOAuthToken(),
          Accept: "application/json"
        },
        muteHttpExceptions: true,
        followRedirects: false
      });
    } catch (error) {
      result.error = String(error.message || error);
      return result;
    }
    var code = Number(response.getResponseCode());
    if (code !== 200) {
      result.http_status = code;
      result.required_scope = "https://www.googleapis.com/auth/script.deployments.readonly";
      result.error = code === 403 ?
        "Нет доступа к списку deployments; проверь read-only scope script.deployments.readonly." :
        "Apps Script deployments.list вернул HTTP " + code + ".";
      return result;
    }
    var body;
    try { body = JSON.parse(response.getContentText() || "{}"); }
    catch (parseError) {
      result.error = "Ответ deployments.list содержит некорректный JSON.";
      return result;
    }
    if (!Array.isArray(body.deployments)) {
      result.error = "Ответ deployments.list не содержит массива deployments.";
      return result;
    }
    body.deployments.forEach(function (deployment) {
      var config = deployment.deploymentConfig || {};
      result.items.push({
        deployment_id: String(deployment.deploymentId || ""),
        version_number: Number(config.versionNumber || 0),
        manifest_file_name: String(config.manifestFileName || ""),
        description_present: !!String(config.description || ""),
        script_id_matches: !config.scriptId || String(config.scriptId) === String(scriptId)
      });
    });
    result.pages++;
    pageToken = String(body.nextPageToken || "");
    if (!pageToken) {
      result.status = "OK";
      return result;
    }
  }
  result.truncated = !!pageToken;
  result.status = result.truncated ? "PARTIAL" : "OK";
  return result;
}
