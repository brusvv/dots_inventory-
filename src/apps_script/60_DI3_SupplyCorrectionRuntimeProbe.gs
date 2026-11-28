/**
 * Read-only runtime probe for the SC-04 preview path.
 *
 * Run from the Apps Script editor on a restored test workbook. It compares
 * the source/projection tables before and after di3PreviewSupplyCorrection.
 * It never calls di3CorrectReceivedSupply and never writes a correction.
 */
function di3BuildSupplyCorrectionPreviewRuntimeSnapshot_() {
  var spreadsheet = di3GetSpreadsheet_();
  var names = [
    "Products", "ProductPublicCodes", "PackVariants",
    "V3_Supplies", "V3_SupplyItems",
    "StockLedger", "StockMovementDetails", "StockLots", "StockAllocations",
    "ProductCostHistory", "Operations", "OperationPayloads",
    "SupplyCorrectionEvents", "FifoAllocationRuns", "FifoAllocationArchive",
    "FifoLotCacheArchive", "FifoReplayEvents", "FifoProductState"
  ];
  var snapshot = {};
  names.forEach(function (name) {
    var sheet = spreadsheet.getSheetByName(name);
    if (!sheet) {
      snapshot[name] = null;
      return;
    }
    var values = sheet.getDataRange().getValues();
    snapshot[name] = values.map(function (row) {
      return row.map(function (value) {
        return value instanceof Date ? value.toISOString() : value;
      });
    });
  });
  return snapshot;
}

function di3RunSupplyCorrectionPreviewRuntimeProbe(supplyId, correctionSpec) {
  return di3WithLock_(function () {
    var before = di3BuildSupplyCorrectionPreviewRuntimeSnapshot_();
    var beforeFingerprint = di3BuildManualOperationPayloadHash_(before);
    var preview = di3PreviewSupplyCorrection(supplyId, correctionSpec);
    var after = di3BuildSupplyCorrectionPreviewRuntimeSnapshot_();
    var afterFingerprint = di3BuildManualOperationPayloadHash_(after);
    var unchanged = beforeFingerprint === afterFingerprint;
    return {
      status: unchanged ? "PASS" : "SIDE_EFFECT_DETECTED",
      read_only: true,
      preview: preview,
      workbook_unchanged: unchanged,
      before_fingerprint: beforeFingerprint,
      after_fingerprint: afterFingerprint
    };
  });
}
