# Supply and system menu snapshot after UX-01–UX-03

`Поставки` remains grouped into four submenus:

1. `Создание`: `Новая поставка`; `Внести старую поставку`; `Сохранить и оприходовать старую поставку`; `Preview пакетного импорта старых поставок (без записи)` (read-only staging).
2. `Выбор и просмотр`: `Загрузить выбранную поставку…`; `Открыть реестр поставок`; `Обновить реестр`.
3. `Редактирование`: `Рассчитать поставку`; `Сохранить поставку`; `Обновить черновик`; `Включить полное редактирование`; `Предварительно проверить изменения`; `Пересчитать номер по дате G2`; `Сохранить изменения поставки`; `Отменить корректировку`.
4. `Проведение и отмена`: `Применить следующий этап из формы`; `Отменить выбранную поставку…`; `Обновить списки формы`.

## UX-01 / UX-02 — unsaved form protection

- The Supply Workspace hashes editable business inputs (`B3:B8`, `G2:G7`, `A12:D31`, `M9`) against a hidden baseline in `N8`.
- Calculated values and selector B2 are not part of the hash.
- The baseline is refreshed after a form reset, document load, successful draft save, and a successfully committed stage transition.
- `Новая поставка` asks before clearing a dirty form.
- When B2 changes while the form is dirty, the installable onEdit handler remembers the requested number in hidden `N9`, restores the previous selector using `N10`, and shows a toast. The user then runs `Загрузить выбранную поставку…` and confirms before the current form is replaced.
- When FULL_EDIT is active, B2 switching is blocked and the selector is restored.
- If an older workbook has no baseline yet, the check is conservative: a non-empty form is treated as potentially dirty.

## UX-03 — FIFO diagnostic vs rebuild

The `Система` menu now contains two distinct commands:

- `Проверить целостность FIFO (без изменений)` → `di3RunFifoIntegrityCheck()` calls the read-only diagnostics and displays a compact report; the full report is written to the execution log.
- `Перестроить FIFO полностью…` → `di3RunFullFifoRebuild()` asks for explicit YES/NO confirmation before acquiring the lock, creating a backup, and rebuilding FIFO projections.

The read-only menu command does not call the rebuild path. Actual read-only behavior and the real user-facing dialogs still require acceptance in a restored Google Sheets test copy.

This document describes the patched local source package. It does not prove that the modules have been installed in the user's bound Apps Script project.


## Historical batch import staging

- `Preview пакетного импорта старых поставок (без записи)` runs `di3PreviewHistoricalSupplyBatchImport()`.
- The preview validates the 11-document source register, whole-pack quantities, line totals, shared partner-discount allocation, and known source conflicts. It logs the complete report and displays a short summary.
- `di3ImportHistoricalSuppliesBatch()` is deliberately fail-closed. It does not write anything until the missing source lines, the one-kopeck / fractional-kopeck cases, Mifuny's two shipment timelines, catalog identity mapping, and a tested adapter to the standard receipt/FIFO pipeline are resolved.
- Neither preview nor the blocked commit function writes to supply documents, Operations, StockLedger, StockLots or FIFO.
