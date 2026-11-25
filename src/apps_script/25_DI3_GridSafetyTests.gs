/**
 * Runtime integration check for the real Google Sheets API.
 * Creates a temporary tab, physically compacts 1,000×26 to 1×3, safely freezes panes,
 * compacts again, verifies the resulting 2×3 grid, and always deletes the test tab.
 */
function di3RunGridSafetyRuntimeTest() {
  var ss = di3GetSpreadsheet_();
  var testName = "__DI3_GRID_TEST_" + Utilities.getUuid().slice(0, 8);
  var sheet = ss.insertSheet(testName);
  try {
    var initial = { rows: sheet.getMaxRows(), columns: sheet.getMaxColumns() };
    sheet.getRange(1, 1, 1, 3).setValues([["test_a", "test_b", "test_c"]]);
    var firstCompact = di3CompactSheet_(sheet, 1, 3);
    if (sheet.getMaxRows() !== 1 || sheet.getMaxColumns() !== 3) {
      throw new Error("Первое уплотнение не создало сетку 1×3.");
    }

    di3SetFrozenRowsSafely_(sheet, 1);
    di3SetFrozenColumnsSafely_(sheet, 2);
    var finalCompact = di3CompactSheet_(sheet, 1, 3);
    var result = {
      status: "PASS",
      initial_grid: initial.rows + "×" + initial.columns,
      first_compact_grid: "1×3",
      rows_deleted: firstCompact.deleted_rows,
      columns_deleted: firstCompact.deleted_columns,
      frozen_rows: sheet.getFrozenRows(),
      frozen_columns: sheet.getFrozenColumns(),
      final_rows: sheet.getMaxRows(),
      final_columns: sheet.getMaxColumns(),
      final_compaction_deleted_rows: finalCompact.deleted_rows,
      final_compaction_deleted_columns: finalCompact.deleted_columns
    };
    if (result.final_rows !== 2 || result.final_columns !== 3 ||
        result.frozen_rows !== 1 || result.frozen_columns !== 2) {
      throw new Error("Неверная итоговая сетка или закреплённые области: " + JSON.stringify(result));
    }
    return result;
  } finally {
    ss.deleteSheet(sheet);
  }
}
