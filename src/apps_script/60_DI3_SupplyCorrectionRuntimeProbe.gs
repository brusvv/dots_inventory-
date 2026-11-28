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
    var notes = range.getNotes();
    var numberFormats = range.getNumberFormats();
    var backgrounds = range.getBackgrounds();
    var fontColors = range.getFontColors();
    var fontWeights = range.getFontWeights();
    var validations = range.getDataValidations().map(function (row) {
      return row.map(function (rule) {
        if (!rule) return null;
        return {
          criteria_type: String(rule.getCriteriaType()),
          criteria_values: (rule.getCriteriaValues() || []).map(function (value) {
            if (value && typeof value.getA1Notation === "function") {
              return {
                sheet_id: value.getSheet().getSheetId(),
                a1: value.getA1Notation()
              };
            }
            return value instanceof Date ? value.toISOString() : value;
          }),
          allow_invalid: rule.getAllowInvalid(),
          help_text: rule.getHelpText()
        };
      });
    });
    snapshot.sheets.push({
      sheet_id: sheet.getSheetId(),
      name: sheet.getName(),
      hidden: sheet.isSheetHidden(),
      max_rows: sheet.getMaxRows(),
      max_columns: sheet.getMaxColumns(),
      last_row: sheet.getLastRow(),
      last_column: sheet.getLastColumn(),
      frozen_rows: sheet.getFrozenRows(),
      frozen_columns: sheet.getFrozenColumns(),
      values: values.map(function (row) {
        return row.map(function (value) {
          return value instanceof Date ? value.toISOString() : value;
        });
      }),
      formulas: formulas,
      notes: notes,
      number_formats: numberFormats,
      backgrounds: backgrounds,
      font_colors: fontColors,
      font_weights: fontWeights,
      data_validations: validations
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
