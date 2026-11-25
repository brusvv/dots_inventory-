# Menu structure — RC8 after UX-01–UX-06

This file reflects `di3BuildMenus_()` in `src/apps_script/22_DI3_MenuAndFilterUtils.gs`. Menu entries describe commands and expected workflows; actual availability and permission control remain in their respective handlers.

## Products

- Open catalogue / refresh catalogue
- New product / open product card / **load selected product…** / save product
- The explicit load action protects dirty card inputs. A selector change while the product card is dirty is deferred until the user confirms replacement.

## Supplies

- **Creation:** new supply; enter historical supply; save and receive historical supply.
- **Selection and viewing:** load selected supply…; open supply register; refresh register.
- **Editing:** preview supply; save supply; update draft; enable full edit; preview changes; recalculate number by G2; save changes; cancel edit.
- **Stage and cancellation:** apply next stage; cancel selected supply…; refresh form lists.

## Warehouse

- Open/refresh dashboard
- Open warehouse management; submit warehouse in/out form; refresh product lists
- Open/refresh stock journal; clear journal filters
- Open/refresh FIFO history; refresh all warehouse views

## Orders

- New order / calculate / create order / refresh form lists
- Open/refresh order register
- **Dispatch selected order (New → In transit)…**
- **Complete selected order (In transit → Completed)…**
- Mark returning (from In transit)… / accept return (from Returning)…
- Cancel order (New only)…

The label documents the expected status path. Every transition opens a YES/NO dialog before calling the domain layer; the dialog distinguishes status-only transitions from dispatch/return transitions that create stock movements. The domain layer remains authoritative and rejects invalid transitions.

## Finance

- Open/refresh finance dashboard
- Refresh product options

## System

- **Settings:** open settings workspace; refresh settings.
- **Installation and diagnostics:** installation Dry Run; system diagnostics; grid report; timezone configuration; repair triggers after restore.
- **Accounting period:** show period status; close month…; reopen last closed month…
- **Operations and FIFO:** operation recovery report; recover pending operations…; clear quarantine after manual reconciliation…; minor-unit money migration…; **read-only FIFO integrity check**; **full FIFO rebuild… (mutating)**.
- **Backups:** create backup; list backups; open backup folder; restore backup into a new spreadsheet…

## Known UX limitations

- Apps Script custom menu entries are static: they are not dynamically hidden/disabled by selected document status. Handlers and domain guards must enforce the legal state transitions.
- Product/order/supply forms depend on the unified installable `onEdit` trigger for some selector workflows. Real trigger behavior and YES/NO dialogs still require restored-copy acceptance.
- This source/menu audit does not prove that current menu code is installed in the user's live bound Apps Script project.
