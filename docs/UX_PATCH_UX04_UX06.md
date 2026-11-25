# UX patch — UX-04 through UX-06

**Date:** 25.11.2026  
**Base:** full RC8 repository snapshot synced to GitHub after UX-01–UX-03  
**Scope:** product/order form safety and menu navigation only. No Google Sheets workbook, stock table, operation, FIFO projection, trigger or deployment was changed or executed.

## UX-04 — protect the order calculator

`Новый заказ` now fingerprints B3:B8 and A12:C31 and asks before clearing unsaved inputs. Calculated output G4:G11 is excluded. A blank legacy form without a baseline remains safe; a populated legacy form is treated as dirty. After a successful `Создать заказ`, the post-save reset bypasses a second prompt because the order has already been persisted.

## UX-05 — protect the product editor

`Новый товар` asks before clearing edited fields. Loading another product while B6:B15 differ from the last loaded/saved baseline is deferred: the installable onEdit handler restores the previous selector, stores the requested option, and displays instructions. The explicit `Продукты → Загрузить выбранный товар…` action then asks before replacing the form. The fingerprint excludes selector B4 and read-only pack summary B16. If a newly entered identity already exists in the catalog, the auto-load of that existing product also passes through the same discard confirmation; no hidden bypass is used.

## UX-06 — menu discoverability

System commands are grouped under Settings, Installation/Diagnostics, Accounting Period, Operations/FIFO, and Backups. Order transition labels now display expected source/target statuses, clarifying that menu items are static while domain guards remain authoritative.

## Additional safety correction found during review

The duplicate-identity path in `di3SaveNewProductForm()` originally loaded the existing product using an internal confirmation bypass. That could replace unsaved fields even though the user had just entered a new product. The bypass was removed: this path now uses the same explicit dirty-form confirmation as any other product load. A regression test covers this branch.

## Validation

- Source syntax: **48 `.gs` files PASS**.
- Supply Workspace UX regression: **9 passed / 0 failed**.
- Catalog/Order UX regression: **12 passed / 0 failed**.
- Warehouse Dashboard regression: **5 passed / 0 failed**.
- TypeScript AST audit: **546 top-level functions**, **87 top-level variable declarations**, no parse errors and no duplicate top-level names.
- Menu handler audit: **68 menu actions**, **0 missing function references**.
- Real Google Sheets trigger prompts, dialogs, and menu behavior remain unverified; this patch must be tested on a restored copy before deployment.
