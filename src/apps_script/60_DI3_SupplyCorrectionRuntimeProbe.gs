/**
 * Read-only runtime probe for the SC-04 preview path.
 *
 * Run from the Apps Script editor on a restored test workbook. It compares
 * the source/projection tables before and after di3PreviewSupplyCorrection.
 * It never calls di3CorrectReceivedSupply and never writes a correction.
 */
function di3BuildSupplyCorrectionPreviewRuntimeSnapshot_() {
  var spreadsheet = di3GetSpreadsheet_();
  var snapshot = {
    spreadsheet_id: spreadsheet.getId(),
    sheets: []
  };
  // Snapshot every sheet, including hidden and auxiliary sheets. A fixed list
  // can miss a side effect if the preview later starts touching a new table.
  spreadsheet.getSheets().forEach(function (sheet) {
    var range = sheet.getDataRange();
    var values = range.getValues();
    var formulas = range.getFormulas();
    snapshot.sheets.push({
      sheet_id: sheet.getSheetId(),
      name: sheet.getName(),
      hidden: sheet.isSheetHidden(),
      max_rows: sheet.getMaxRows(),
      max_columns: sheet.getMaxColumns(),
      last_row: sheet.getLastRow(),
      last_column: sheet.getLastColumn(),
      values: values.map(function (row) {
        return row.map(function (value) {
          return value instanceof Date ? value.toISOString() : value;
        });
      }),
      formulas: formulas
    });
  });
  return snapshot;
}

function di3RunSupplyCorrectionPreviewRuntimeProbe(supplyId, correctionSpec) {
  return di3WithLock_(function () {
    var before = di3BuildSupplyCorrectionPreviewRuntimeSnapshot_();
    var beforeFingerprint = di3BuildManualOperationPayloadHash_(before);
    var preview;
    try {
      preview = di3PreviewSupplyCorrection(supplyId, correctionSpec);
    } catch (error) {
      preview = {
        status: "BLOCKED",
        reason: error && error.message ? error.message : String(error)
      };
    }
    var after = di3BuildSupplyCorrectionPreviewRuntimeSnapshot_();
    var afterFingerprint = di3BuildManualOperationPayloadHash_(after);
    var unchanged = beforeFingerprint === afterFingerprint;
    return {
      status: !unchanged ? "SIDE_EFFECT_DETECTED" : (preview && preview.status === "READY" ? "PASS" : "PREVIEW_BLOCKED_NO_SIDE_EFFECT"),
      read_only: true,
      preview: preview,
      workbook_unchanged: unchanged,
      before_fingerprint: beforeFingerprint,
      after_fingerprint: afterFingerprint
    };
  });
}
