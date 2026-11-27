# Актуальный сводный план проекта и приёмки — 28.11.2026

> Этот раздел — текущая точка отсчёта и имеет приоритет над датированными историческими записями ниже. Старые разделы сохранены как журнал решений и промежуточных результатов; их статусы не следует трактовать как актуальные без сверки с этим блоком.

## 1. Текущая точка GitHub

- Рабочая ветка: `feature/github-preview-releases`.
- Текущий подтверждённый HEAD: `f4b294eae28da6fdb8c1718ee032c938415cbaf6`.
- PR #7 — [D-02: Stable and feature-branch Preview release channels](https://github.com/brusvv/dots_inventory-/pull/7), Draft, открыт, не объединён; base: `feature/github-runtime-acceptance`.
- Сравнение веток: Preview branch ahead 87 / behind 0 относительно `feature/github-runtime-acceptance` на момент проверки.
- PR #8 — [D-08: Browser-only GitHub first-install bootstrap](https://github.com/brusvv/dots_inventory-/pull/8) — отдельная работа по первоначальной загрузке через браузер; не считать частью уже принятого D-07.
- PR #1 — N-03 clean final schema baseline; остаётся отдельным незавершённым review/merge item. PR #2–#6 формируют предшествующую цепочку release/runtime acceptance. PR #9 закрыт по просьбе автора и не является активной веткой работы.
- Не создано ни одного release tag или опубликованного GitHub Release. PR #7 не объединён. Stable/Preview runtime flow ещё не запускался.

## 2. Подтверждённые source/CI результаты

Последние проверки на HEAD `f4b294eae28da6fdb8c1718ee032c938415cbaf6`:

- [Release Pipeline CI #46073321726](https://github.com/brusvv/dots_inventory-/actions/runs/46073321726): success.
- [Package build #46073321723](https://github.com/brusvv/dots_inventory-/actions/runs/46073321723): success.
- Apps Script syntax: 54/54.
- Release manifest tests: 15/15.
- Stable/Preview tag policy: 9/9.
- Регрессионные suites: FIFO 46/46; Order Domain 22/22; Supply Workspace UX 17/17; Catalog/Order UX 14/14; System Safety UX 39/39; Warehouse Dashboard 9/9; Finance schema 4/4; GitHub Deployment Manager 36/36.
- Всего по восьми регрессионным suites: **187/187**. Проверки манифеста, tag policy и синтаксиса считаются отдельно.
- Пакет [DotsInventory-v4-installation](https://github.com/brusvv/dots_inventory-/actions/runs/46073321723/artifacts/15233334353): 410,757 bytes; SHA-256 `6819ef1881bf22aa1958eedacc6a47d3a34c3cb6f4744b298cbd51d55d30e2f2`; срок хранения до 27.12.2026. Это source ZIP, не clasp-проект и не доказательство runtime-установки.

Эти результаты подтверждают качество исходников и сборки. Они **не** подтверждают работу Apps Script API, Drive backup, реальную миграцию, триггеры, FIFO в Sheets, конкурентность или восстановление.

## 3. Изменения и архитектурные решения, уже отражённые в исходниках

- F-01: возврат выбирает исходные `CONSUME`-аллокации по `dispatch_movement_id`, а не по глобально последнему FIFO run. Runtime-сценарий «отправка A → другая складская операция → возврат A» не принят.
- F-02: реализован workflow исторической продажи, date-only `business_date`, отдельные фактические дата/время отправки и завершения, миграция v3→v4 и retry guards. Runtime миграция и полный сценарий не приняты.
- F-03–F-07, F-09–F-10, F-13–F-16, F-18, F-20: соответствующая source-hardening реализация находится в ветке. Это не означает runtime acceptance. F-04 chunked payload storage не реализован: payload выше установленного лимита должен fail closed.
- F-08 и F-17 не закрыты. F-17/C-14 требуют фактического списка способов доставки от владельца; значения не выдумывать.
- F-19: pure-domain regression покрыт CI; Apps Script write-boundary fault injection и recovery остаются открытыми.
- N-02: реализованы PREPARED/QUARANTINED recovery semantics и owner-attested MANUALLY_RESOLVED workflow; runtime fault injection, archive verification и операторская приёмка не проведены.
- N-03: реализованы clean v4 baseline, preflight, interrupted-start recovery и защита заполненных рабочих областей. Не приняты runtime setup/rerun/interruption и v3→v4 migration.
- Dashboard: read-only diagnostics добавлены, но причина пустой диаграммы не установлена. Требуется проверить N1:O21 и фактические chart ranges в Google Sheets.
- Commission/Finance: buyer/seller payer logic и Finance schema mapping реализованы в исходниках; сверка реальных заказов и Finance Dashboard не проведена.
- Timezone приложения утверждён: `Europe/Moscow`. Код и release checks согласованы с ним. Фактические `appsscript.json.timeZone`, Apps Script runtime timezone и spreadsheet timezone целевого проекта должны уже совпадать; установщик их не переписывает.

## 4. Приоритетный план реализации и приёмки

### Этап A — подготовить и зафиксировать тестовые среды

1. Уточнить, что `Dots beta 4` — именно тестовая таблица, и записать её Spreadsheet ID и bound Apps Script Script ID.
2. Провести R0 read-only inventory: schema/version, timezone, листы и заголовки, контрольные агрегаты, меню, installable triggers, deployments, Script Properties (без вывода секретов).
3. Сохранить baseline для StockLedger, StockLots, StockAllocations, FifoProductState, Operations, V3_Orders, V3_Supplies и Settings.
4. Для N-03 использовать согласованную `Dots beta 4`, если она подтверждена как disposable/test-only. Не создавать новую среду без необходимости.
5. Для D-07 использовать отдельную восстановленную disposable-копию и отдельный bound Script ID; не считать N-03 тест и D-07 одним и тем же доказательством.

**Гейт:** никакого Clean Start, миграции, FIFO rebuild, записи кода или складской операции до завершения read-only preflight, проверенного backup и отдельного подтверждения конкретного действия.

### Этап B — N-03 / N-02 runtime

- N-03: пустой workbook preflight; Dry Run; защита populated/unknown tabs; подтверждённая чистая установка только на тестовой таблице; повторный запуск; прерывание и resume/recovery.
- N-03 schema: v3→v4 Dry Run, backup, миграция на disposable-копиях с данными и без данных; проверка заголовков, row IDs, timestamps, business_date и отсутствия изменения старого префикса.
- N-02: безопасно смоделировать transient service failure и integrity failure; проверить PREPARED retry и QUARANTINED resolution; проверить archived fingerprints, owner attestation, linked-operation requeue и то, что ручное разрешение само не меняет StockLedger/StockLots/StockAllocations/FifoProductState.
- Отдельно проверить legacy register/form upgrades и same-day date/time ordering, включая DST-invalid local time.

### Этап C — Supply Workspace и исторические поставки

- UX-01–06: повторно проверить только непокрытый duplicate-product-identity path и сохранность несохранённых полей.
- UX-07–10: реальные подтверждения, выбор NO, повторный запуск и отсутствие побочных записей.
- G5/G6/G7: проверить даты и переходы статусов, причём G7 — обычная приёмка, не Full Edit.
- Full Edit: before/after payload, неизменность supply ID/created_at, Operation COMMITTED, отсутствие stock writes; конкурирующие вкладки и PeriodGuard.
- Меню: доступность действий в каждом статусе; взаимоисключение «Новая поставка» / «Внести старую поставку» / Full Edit.
- Исторические поставки: сначала read-only сверка документов, затем штатный ввод и приёмка на тестовой копии; никаких прямых записей в StockLedger.

#### Подготовка исторического импорта — 11 документов

Источник данных: `Импорт старых поставок.txt`. Импорт ещё не выполнен. Перед Preview необходимо закрыть:
- №8 switheskeys Store: восстановить названия/варианты семи строк по исходным изображениям; не придумывать позиции.
- №11 Real Eagles: сверить общую сумму 3 701 ₽ с известными строками, распределить стоимость двух строк Jade Air только после подтверждения.
- №4 Mifuny: проверить точную дробную цену 1 579,15 ₽ на 2 упаковки, не округлять незаметно.
- №4 и №5: общую партнёрскую скидку 500 ₽ распределять между этими двумя поставками пропорционально товарам; NxGLOBAL №6 в неё не входит.
- №7, №10 и №11: отдельные скидки 500 ₽ по данным реестра.
- Проверить доставку, скидки, даты заказа/отправки/ожидания/получения и точность сумм всех 11 документов.
- После ввода выполнить сверку количества упаковок, точек в упаковке, себестоимости FIFO и общего складского остатка.

### Этап D — Warehouse Dashboard и финансовая логика

- Dashboard W-1–W-10: read-only диагностика N1:O21, chart ranges/type/anchor, refresh, скрытые колонки, фильтры и нулевой остаток; только после локализации причины менять код.
- Commission: контрольные заказы на 300 ₽ goods, 10% fee, FIFO cost 105 ₽ — плательщик BUYER и SELLER; сверить buyer payable, seller revenue, discount, platform fee, profit и persisted payer.
- C-15/C-16: реальные тестовые заказы, OrderCostSnapshots, UNKNOWN/FREE COGS, фильтры, периоды и Finance Dashboard.
- Проверить денежное округление half-up, включая 10,075 ₽, и сверку по minor units.

### Этап E — FIFO, OperationExecutor и надёжность

- F-01: dispatch A → unrelated stock movement / later FIFO run → return A; сверить source lots, allocated quantity/cost и новые return lots.
- F-02: историческая продажа с business_date, фактическими dispatch/completion timestamps, FIFO replay, PeriodGuard, retry/idempotency и признание выручки в completion period.
- F-03/F-05: lock boundaries, immutable payload fingerprint, повторные отправки и отказ на изменённом payload.
- F-04: проверить fail-closed поведение на payload limit; chunking не считать реализованным.
- F-06/F-07: interruption в точках до/после append, allocation archive integrity, deterministic IDs, ledger_sequence, cursor rebuild и replay.
- F-09/F-10: изоляция представлений, journal warning, close → reopen → re-close с сохранением append-only audit.
- F-13: Drive backup flush → snapshot → copy → read-back/hash; измерить elapsed, lock wait/held.
- F-14/C-06: две независимые GAS-сессии; receipt/cancel/dispatch races; доказать CONTENDED/ACQUIRED_AFTER_RELEASE и отсутствие OVERLAP.
- F-15: конфликт исторического режима и Full Edit; F-18 округление; F-19 fault/recovery на реальном Apps Script boundary.

### Этап F — полный тестовый цикл и матрица C-01–C-17

- C-01: GAS benchmark на 500/1 000/2 000 движениях; runtime, чтения/записи, replay и rebuild.
- C-02: PeriodGuard, historical profit, snapshots, close/reopen.
- C-03: частичные возвраты — только после отдельного утверждения бизнес-правил; вне обязательного RC9 scope, если не переоценено.
- C-04/C-05: fault injection, lost acknowledgement, retries, recovery.
- C-06: две независимые GAS-сессии / ScriptLock.
- C-07: unified onEdit, установленные триггеры и маршрутизация.
- C-08: TextFinder на 5/30 ключах, несколько раундов, row-set и median latency.
- C-09: следующая FIFO-себестоимость, несколько lots, UNKNOWN/FREE.
- C-10: Apps Script V8 и Money Core migration/rebuild.
- C-11: Installation Preflight.
- C-12: SettingsRepository и timezone.
- C-13: порядок листов.
- C-14: методы доставки — после получения реального каталога.
- C-15: buyer/seller commission reconciliation.
- C-16: Finance Dashboard.
- C-17: графики, formatting, filters, permissions/protection — после согласования role model.

### Этап G — Backup/Restore и Schema Versioning

- BM-01: Restore-as-new: spreadsheet, bound script, folders, triggers, data reconciliation.
- BM-02: масштабируемый backup catalog.
- BM-03: расписание daily/weekly.
- BM-04: retention Dry Run, защита последней валидной копии.
- BM-05: периодический isolated restore test.
- BM-06: release acceptance и runbook.
- Проверить schema migrations на disposable empty/non-empty copies. Обратные миграции не предполагаются; rollback — только через проверенный Backup/Restore.
- Selective document/ledger import-export оставить отдельным backlog, если не будет отдельно повышен приоритет.

### Этап H — GitHub Release Pipeline / D-07 / D-08

- D-01/D-02: source implementation и CI готовы; PR #7 всё ещё Draft и не объединён.
- D-03: read-only release discovery и manifest/source comparison — source implementation готова; runtime требует опубликованный Preview или Stable release.
- D-04: Drive source backup + read-back/hash — source implementation готова; требуется реальный тест с Drive.
- D-05: Preview, YES/NO, last-moment fingerprint, projects.updateContent и exact post-write verification — source implementation готова; runtime не проведён.
- D-06: verified code rollback с сохранением текущего appsscript.json — source implementation готова; runtime не проведён. Он не восстанавливает spreadsheet data, triggers, Script Properties или deployments.
- D-07: **BLOCKED / NOT RUN** до review/merge release chain, публикации намеренного Preview-релиза и подготовки отдельной disposable restored copy + Script ID. После Preview acceptance отдельно проверить Stable channel policy.
- D-08: browser-only first-install Bootstrap — отдельный PR #8; проверить его собственный bootstrap сценарий и runtime на новом пустом тестовом Apps Script project. Не смешивать первоначальную загрузку с обычным обновлением D-03–D-06.
- Проверить, что target manifest timezone, Apps Script runtime timezone и spreadsheet timezone уже равны `Europe/Moscow`; updater их не меняет.
- Не создавать release tags, не публиковать prerelease/stable, не переводить PR из Draft и не выполнять merge без отдельного решения владельца.

## 5. RC9 release gate

RC9 не готов, пока на disposable restored Google Sheets copy не доказаны:
1. полный цикл Supply → Receipt → FIFO → Order → Dispatch → Return → Finance;
2. F-01 и F-02, включая историческую хронологию и PeriodGuard;
3. повторные исполнения, fault recovery и FIFO archive integrity;
4. реальная конкурентность нескольких GAS-сессий;
5. commission, COGS и profit reconciliation;
6. Backup/Restore-as-new;
7. schema migration и clean install/rerun;
8. GitHub Preview install + exact verification + code rollback;
9. отсутствие неожиданных изменений triggers, deployments, Script Properties, spreadsheet data и stock;
10. итоговый UX/permissions review.

## 6. Вне RC9 / отдельные решения владельца

- `SUPPLY_CORRECTION`;
- partial returns C-03;
- duplicate historical-supply detection;
- cancelled-supply restoration F-08;
- selective document/ledger import-export;
- expanded backup scheduling/retention automation;
- delivery methods F-17/C-14 до получения реального списка;
- sheet protections C-17 до утверждения role model.

## 7. Правила фиксации результата

Каждая задача закрывается только при наличии четырёх отдельных доказательств:
1. source implementation / commit;
2. source CI;
3. Apps Script / Google Sheets runtime evidence (execution log, before/after data, screenshots where useful);
4. explicit PASS criteria and remaining-risk note.

Source CI никогда не заменяет runtime acceptance. Любой миграционный, Clean Start, FIFO rebuild, restore, stock write или release action — только на disposable/test copy, после backup/read-only preflight и отдельного подтверждения. Production RC8 остаётся нетронутой.

---

## D-07 runtime acceptance — runbook prepared, execution blocked — 26.11.2026

- Added [docs/GITHUB_RUNTIME_ACCEPTANCE.md](GITHUB_RUNTIME_ACCEPTANCE.md) with isolated-test-project prerequisites, D-03/D-04/D-05/D-06 happy path, negative/fault-injection scenarios, PASS/FAIL criteria and an evidence log template.
- The runbook explicitly requires a restored disposable Google Sheets copy and a separate bound Apps Script Script ID. Production RC8 and `main` remain out of scope.
- Current repository state has no published GitHub Releases, and PR #2–#5 remain unmerged. D-07 cannot execute its release-backed happy path until the release chain is separately reviewed/merged and an annotated stable tag is intentionally published.
- D-07 status remains **BLOCKED / NOT RUN**. Documentation is not runtime acceptance and does not change that gate.

---

## Consolidated status — 26.11.2026 (supersedes older point-in-time notes below)

Working branch: `feature/clean-final-baseline`; PR #1 remains Draft and unmerged. Target clean schema: v4. Existing RC8 workbook/deployment and `main` are not modified.

### Latest verified source CI
GitHub Actions run [45864704114](https://github.com/brusvv/dots_inventory-/actions/runs/45864704114), head `0257f3c9faef202bd8224e208e2adc1b5f83de9a`:
- Apps Script syntax: 50/50 `.gs` files.
- FIFO replay: 42/42.
- Order Domain: 22/22.
- Supply Workspace UX: 17/17.
- Catalog/Order UX: 14/14.
- System Safety UX: 39/39.
- Warehouse Dashboard: 9/9.
- Finance schema: 4/4.
- Total: **151/151**.

This is Node/source CI, not Google Apps Script runtime acceptance.

### Source implementation status
- **F-01:** fixed by selecting dispatch `CONSUME` allocations by original `dispatch_movement_id`; runtime return-after-later-FIFO-run scenario remains open.
- **F-02:** historical-sale workflow, date-only `business_date`, explicit dispatch/completion date-time, v3→v4 migration and retry guards implemented in PR source; runtime migration and end-to-end historical sale remain open.
- **F-03–F-07, F-09–F-10, F-13–F-16, F-18, F-20:** source hardening implemented as described in the dated sections below; runtime evidence remains outstanding. F-04 chunked payload storage is not included.
- **F-08, F-17:** not closed. F-17 requires the user's real delivery-method catalogue; do not invent options.
- **F-19:** pure-domain regression suite is executed by CI and passes 42/42. This does not replace Apps Script write-boundary fault injection.
- **N-03:** clean v4 baseline, preflight, interrupted-start recovery and populated-workspace guard are implemented in source. Empty-workbook setup/rerun/interruption and v3→v4 migration remain runtime gates.
- **N-02:** transient Sheets/service errors leave FIFO replay `PREPARED` for retry; immutable-input/integrity violations move it to `QUARANTINED`. Added `di3ResolveQuarantinedFifoReplay()` and a separate menu action. It verifies archived source fingerprints, requires explicit owner attestation and a detailed reason, appends immutable `MANUALLY_RESOLVED`, marks only the failed run as `MANUALLY_RESOLVED`, and requeues a linked quarantined operation into a new retry epoch. It does not edit StockLedger/StockLots/StockAllocations/FifoProductState or execute a stock operation. Source regression and diagnostics tests pass, including linked-operation requeue and damaged-archive fail-closed cases; runtime fault-injection and operator acceptance remain open.
- **Warehouse Dashboard:** chart source and diagnostics are implemented, but the user-reported blank chart still needs read-only inspection of N1:O21 and actual chart ranges in Sheets.
- **Commission/Finance:** buyer-vs-seller payer logic and Finance schema mapping are source-implemented; real migrated-order settlement and Finance Dashboard reconciliation remain open.

### Remaining work that cannot be truthfully closed by source CI
1. Restored-copy runtime acceptance: supply full edit/G6/G7/menu, F-01 return, historical sales, commission settlement, dashboard chart, PeriodGuard, same-day event order, manual IN/OUT, and all relevant UX confirmation-No paths.
2. FIFO/OperationExecutor: N-02 quarantined replay resolution design and acceptance; F-06 write-boundary interruption and archive recovery; C-04/C-05 retries and lost acknowledgements; C-06 two-session ScriptLock.
3. Runtime performance/finance: C-01 benchmarks, C-08 TextFinder, C-09 UNKNOWN/FREE, C-10 Money Core migration, C-15 commission reconciliation, C-16 Finance Dashboard.
4. Setup/UX: C-11 preflight, C-12 settings/timezone, C-13 tab order, C-14 delivery methods, C-17 visual/protection review.
5. Backup/release: BM-01 Restore-as-new and BM-02–BM-06 catalog/scheduling/retention/isolated restore/release runbooks.
6. Decisions needed before implementation: actual delivery-method options for F-17/C-14; business policy for partial returns C-03; a role model before enabling sheet protections in C-17.
7. Deferred beyond RC9 unless explicitly reprioritized: `SUPPLY_CORRECTION`, partial returns, duplicate historical-supply detection, cancelled-supply restoration, selective document/ledger import-export, expanded backup retention automation.

### Release gate
RC9 remains blocked until a restored disposable Google Sheets copy proves the end-to-end supply → receipt → FIFO → order → dispatch → return → finance flow, plus backup/restore, schema migration, recovery and concurrency. Do not merge PR #1 before those runtime gates pass.

---

# Roadmap and status — Dots Inventory v3 RC8

Дата актуализации: 26.11.2026. Старые блоки UX ниже сохраняют исторические результаты на момент соответствующего патча; актуальные суммарные результаты приведены в последнем разделе. Статусы ниже отражают фактическое содержимое предоставленного `40.rar` и runtime-сведения пользователя в текущем чате.

## Статусы Supply Workspace

| Направление | Состояние | Следующий критерий приёмки |
|---|---|---|
| Новая поставка / черновик | Код есть; ранняя acceptance ранее выполнялась | Пройти новый цикл после финального накопительного комплекта |
| Внести старую поставку | Код в `34_DI3_HistoricalSupply.gs`; пользователь сообщил, что одна поставка внесена и статус стал «Получена» | После ввода всех исторических поставок и продаж выполнить полную stock/FIFO/finance сверку |
| Полное редактирование Phase A/B | Код в `36_DI3_SupplyFullEdit.gs`, операция `SUPPLY_DOCUMENT_EDIT` в OperationExecutor | Подтвердить id/created_at, operation COMMITTED, before/after payload, отсутствие stock writes |
| Исправление G5 на `26JY021` | Визуально сохранено пользователем как 05.07.2026; статус остался «Отправлена» | Проверить backend evidence и unchanged stock/FIFO |
| Изменение G6 на отправленной поставке | Поддерживается кодом как изменение даты ожидания; целевой статус должен стать «Ожидает получения» | Runtime-тест на отдельной тестовой поставке, без G7 |
| G7 у ещё не полученной поставки | Не проводится через `SUPPLY_DOCUMENT_EDIT`; требуется обычный next-stage/receipt workflow | Отдельный runtime тест фактической приёмки |
| Полная корректировка полученной поставки | Не реализована; `SUPPLY_CORRECTION` отсутствует в operation registry | Phase C: immutable correction + candidate FIFO replay + COGS/history rebuild |
| Меню Supply Workspace | UX-01–UX-03 implemented in local patch: dirty-form fingerprint/confirm, safe B2 switch, separate read-only FIFO check and confirmed rebuild | Runtime UX acceptance in restored test copy; do not treat local tests as Sheets evidence |

## UX patch status — 25.11.2026

- **UX-01:** `Новая поставка` checks a SHA-256 fingerprint of editable form inputs and prompts before clearing a dirty form.
- **UX-02:** B2 switching is guarded. Dirty form state is retained; the attempted selector is staged in hidden N9 and restored to the previous value in B2. The user confirms via `Поставки → Выбор и просмотр → Загрузить выбранную поставку…`. FULL_EDIT blocks B2 switching.
- **UX-03:** `Проверить целостность FIFO (без изменений)` is a read-only menu path. `Перестроить FIFO полностью…` is a separate mutating command with an explicit confirmation before lock/backup/rebuild.
- Local checks: all 47 `.gs` syntax checks PASS; Supply Workspace UX tests 9/9 PASS; warehouse dashboard tests 5/5 PASS; TypeScript AST audit 532 top-level functions, 86 top-level variable declarations, no parse errors or duplicate names.
- Not runtime-accepted: dialogs, installable onEdit behavior, Apps Script hashing/Spreadsheet APIs and actual FIFO read-only behavior must be verified on a restored test spreadsheet. The blank Warehouse Dashboard chart remains an open issue.

## UX patch — product/order workspaces and navigation

- **UX-04:** protect `Новый заказ` with a dirty-form fingerprint and confirmation; successful order creation resets the form without a duplicate prompt.
- **UX-05:** protect the product card from clearing/replacing unsaved fields; selector changes are staged and require an explicit menu confirmation before loading another product.
- **UX-06:** group System commands into settings, diagnostics, accounting period, operations/FIFO and backups; order transition labels show allowed source/target states.
- Local tests are source/Node checks only. Real trigger prompts and menu behavior still require a restored Google Sheets test copy.

## UX patch — product/order workspaces and navigation (25.11.2026)

- **UX-04:** `Новый заказ` fingerprints B3:B8 and A12:C31 (excluding derived G4:G11) and prompts before clearing unsaved parameters/lines. After successful order creation, the form is reset without asking again.
- **UX-05:** `Новый товар` prompts before clearing B6:B15. When a different product is selected while dirty, the attempted option is staged in DocumentProperties and the previous selector restored. The explicit menu action asks before loading the new record. The duplicate-identity path also uses this confirmation and must not silently replace entered fields.
- **UX-06:** System navigation is grouped by task; order transition labels name expected source/target states. Menu labels are descriptive only—the domain functions remain the actual status guards.
- Local validation: syntax **48 `.gs` PASS**, Supply UX **9/9**, Catalog/Order UX **12/12**, Warehouse Dashboard **5/5**, TypeScript AST **546 functions / 87 top-level vars / no duplicates or parse errors**, menu reference audit **68 actions / 0 missing handlers**.
- These checks are source/Node-only. Real onEdit trigger behavior, toasts, confirmation dialogs and menus must be accepted in a restored Google Sheets copy before deployment.
- **UX-07:** batch recovery of pending operations now shows a read-only preflight summary and requires YES before entering the mutation lock; it distinguishes eligible, waiting, unsupported and quarantined operations.
- **UX-08:** Money minor-unit/FIFO migration now requires YES before Dry Run, backup and rebuild; the dialog states that rollback is by verified backup, not automatic.
- **UX-09:** reopening the latest accounting period now requires a second YES after the user enters a reason; the dialog explains that PeriodGuard will stop blocking backdated operations for that period.
- **UX-10:** manual warehouse IN/OUT now displays a command summary (product, reason, date, quantity, cost/price and FIFO effect) and requires YES before `di3PostManualStockMovement()` registers an operation.
- Local validation after UX-07–UX-10: syntax **49 `.gs` PASS**, Supply UX **9/9**, Catalog/Order UX **12/12**, System Safety UX **11/11**, Warehouse Dashboard **5/5**, TypeScript AST **549 functions / 87 top-level vars / no duplicates or parse errors**, menu reference audit **68 actions / 0 missing handlers**.

## Warehouse Dashboard

В текущем источнике `19_DI3_WarehouseViews.gs` уже содержит:
- paired chart source N:O (product label and value together);
- filter to positive fully-valued stock;
- descending inventory-value sort;
- Top 20 cap;
- hidden source dimensions explicitly included using `SHOW_BOTH`;
- bar-builder `reverseCategories()` called before `addRange()`;
- `setNumHeaders(1)` (not the unsupported `useFirstRowAsHeaders()` method);
- protection against clearing M25+ dashboard table cells during setup.

`38_DI3_WarehouseDashboardTests.gs`: seven pure tests passed locally on the current patched snapshot.

**Open:** actual rendering/refresh in Google Sheets. The user confirmed the chart remains blank in the live test copy. The latest local patch adds:
- `average_known_unit_cost` (known inventory value / known units), fixing the missing H11 KPI value;
- chart grid-row retention based on computed chart height (addresses D-1 clipping risk);
- read-only `di3DiagnoseWarehouseDashboardChart()` / `di3LogWarehouseDashboardChartDiagnostics()` to inspect N1:O21, hidden state, chart ranges/count/type/anchor.

The actual empty-chart cause is still unknown. Run the read-only diagnostics on a restored copy and inspect N1:O21 before changing the chart API code again. At the initial Dashboard patch stage the suite was 7/7; after adding view-refresh and journal-warning tests it is now 9/9. Neither result tests actual Sheets rendering.

## Cross-project remaining work

### FIFO / stock / sales
- C-01: benchmark in real GAS at 500/1,000/2,000 movements; measure runtime, Sheets reads/writes, TextFinder, quotas.
- C-02: runtime acceptance for PeriodGuard, historical profit and `OrderCostSnapshots`.
- **F-01:** return FIFO lookup is fixed in source and locally regression-tested; runtime scenario (dispatch A → later unrelated FIFO run → return A) remains pending on a restored copy.
- C-03: implement partial returns; agree policy first. This is separate from the full-return F-01 defect.
- C-04/C-05: real Apps Script fault/recovery acceptance for OperationExecutor flows.
- C-06: test LockService with two independent execution sessions, including receipt/cancel/dispatch races.
- C-07: verify installed unified onEdit triggers and routing.
- C-08: read-only TextFinder probe (`sample_keys: 5` and `30`, 3–5 rounds), exact row-set and median latency.
- C-09: runtime/UX validation of next FIFO unit cost including multiple lots and UNKNOWN/FREE.

### Finance
- C-10: Apps Script V8 probe, backup, Money Core migration/rebuild on non-empty test copy, per-lot/per-order reconciliation.
- C-15: reconcile buyer-paid platform fee, seller revenue, discounts and profit on real test orders.
- C-16: Finance Dashboard runtime/visual acceptance with real control orders, FIFO snapshots, UNKNOWN COGS, filters/charts and period boundaries.

### Setup / UX
- C-11: source hardening now inventories workbook tabs and blocks populated unknown tabs; verify read-only Dry Run behavior on a new empty workbook and a workbook with an unrelated populated tab.
- C-12: SettingsRepository runtime acceptance and timezone switch.
- C-13: verify sheet tab order.
- C-14: delivery-method add/select/order flow.
- C-17 phase 2: charts, conditional formatting, filters, tab order, permission/protection review.

### Backup / schema
- BM-01: restore-as-new runtime acceptance with manifest, bound script, folder rebind, trigger repair and data reconciliation.
- BM-02: scalable backup catalog.
- BM-03: scheduled daily/weekly backup.
- BM-04: retention with Dry Run and protection of last valid backup.
- BM-05: periodic isolated restore test.
- BM-06: release acceptance and documentation.
- Selective export/import for documents and ledger is a separate future feature.
- Schema Versioning: runtime acceptance for baseline and v1→v2 on empty/non-empty copies, plus the new v2→v3 `commission_payer` migration on restored empty/non-empty copies. Reverse migrations absent; rollback through verified backup/restore.

## RC9 readiness gate

Do not call RC9 ready until the real Google Sheets end-to-end cycle is verified: supply → receipt → FIFO → order → dispatch → return → finance, with backup/restore, idempotent recovery and concurrency acceptance. Local Node tests are not a substitute for Google Apps Script runtime evidence.

## Latest local patch — commission payer and Dashboard diagnostics (25.11.2026)

- Fixed percent-rate parsing for both native percentage cells and literal-percent cells. The user's screenshot showed 300 ₽ goods × displayed 10% producing only 0.30 ₽; the old `/100` reader could double-divide a native percent value stored as 0.1.
- Reinterpreted order calculator B3 as **Комиссию оплачивает покупатель**. Checked: fee is added to buyer payment. Unchecked: fee is deducted from seller revenue and profit. The commission base remains gross goods before seller discount.
- Added `commission_payer` to `V3_Orders` and schema v3 migration `RC8_ORDER_COMMISSION_PAYER_V3` (v2→v3). Existing orders are backfilled to `BUYER`.
- Settlement and Finance Dashboard use the stored payer; commission remains separately reported.
- Added 13 Order Domain tests for commission payer/percentage handling, including 300 ₽ / 10% / 105 ₽ FIFO examples for both payer modes.
- Dashboard totals now calculate average known FIFO unit cost. Chart row retention is aligned to chart height. Added read-only chart diagnostics.
- Local validation after the commission/Dashboard patch: syntax 49/49; Order Domain 13/13; Supply UX 9/9; Catalog/Order UX 12/12; System Safety 11/11; Dashboard 7/7.
- User visually accepted UX-01–UX-06 except duplicate-product-identity test, which remains untested.
- No live schema migration, order creation, dispatch, stock mutation or chart runtime test was performed.


## Latest local patch — F-01 order return FIFO lookup (25.11.2026)

- Fixed `di3BuildOrderReturnPayload_()`: the active `StockAllocations` projection can contain valid active rows from several FIFO runs, so return lookup must not filter by the globally latest `FifoAllocationRuns.run_id`.
- Return allocations are now selected by the original order-line `dispatch_movement_id` and `allocation_type=CONSUME`. Per-line allocated-quantity equality remains fail-closed and is checked before registering the return operation.
- FIFO run IDs remain provenance only (`source_fifo_run_ids`; `source_fifo_run_id` is set only when one source run is present). Source lot IDs, pack variants and exact allocated cost are retained for new return lots.
- Added a full return-payload regression fixture: dispatch A's allocations carry `RUN-OLD-A`; an unrelated movement exists in `RUN-LATEST`; the return payload must still build from A's original lots. Added a partial-allocation rejection test.
- Local validation: syntax 49/49; Order Domain 16/16; Supply UX 9/9; Catalog/Order UX 12/12; System Safety UX 11/11; Dashboard 7/7; TypeScript AST 556 functions / 87 top-level vars / no parse errors or duplicate declarations.
- **Runtime acceptance pending:** on a disposable restored copy, dispatch order A, create a later FIFO run through a separate stock operation, then return A and reconcile return lots, costs and stock valuation. No live order or stock movement was used for this patch.


## Source-only hardening after F-01 — 25.11.2026

The following issues have source changes and local regression coverage. They are **code-hardened, not runtime-accepted** until the consolidated Google Sheets acceptance on a restored test copy.

| Audit ID | Source change | Remaining limitation / acceptance |
|---|---|---|
| **F-03** | Historical-supply confirmation dialogs moved outside the global ScriptLock. A short preflight lock builds a state snapshot; after YES, the code reacquires the lock and rechecks supply ID/status, prepared-operation identity/hash, and a fingerprint of the current form before writes. | Real dialog/LockService interleaving still needs two-session runtime acceptance. |
| **F-04** | Operation payload serialization now fails closed above 45,000 characters before `OperationPayloads`/`Operations` writes. | This prevents oversized-cell writes but does not implement chunked payload storage or compact audit retention. |
| **F-05** | Full-supply-edit prepared-operation retries compare the current editable-form fingerprint with the verified immutable payload fingerprint. Legacy prepared operations without a fingerprint fail closed for manual inspection. | Runtime retry/recovery and legacy-operation behavior still require a disposable copy. |
| **F-09** | Warehouse-view refresh isolates failures per view. Stock journal can display already-recorded movements while showing a visible warning when operations are pending. | Repeated full-table reads/performance and reconciliation-safe semantics remain open; never use a journal with pending operations for reconciliation/period close. |
| **F-11** | Supply-number preview uses a read-only peek; sequence reservation remains in the save path. | Confirm preview does not consume a number in a real Apps Script execution. |
| **F-13** | Backup code calls `SpreadsheetApp.flush()` before reading the snapshot and before `makeCopy()`. | Actual Drive consistency, time/quota and lock duration remain unverified. |
| **F-15** | Historical-supply mode and full-edit mode now reject enabling the other mode while one is active. | Verify hidden markers and both UI entry paths at runtime. |
| **F-16** | Finance Dashboard resolves table columns by schema field names from `DI3_TABLE_SCHEMAS`, not numeric indexes. Added four schema-mapping regression tests. | Run against the installed schema v3 workbook and verify finance totals. |
| **F-18** | Minor-unit conversion normalizes floating-point representation and applies symmetric half-up rounding, with safe-integer validation. | Real Sheets locale/currency inputs remain part of Money Core runtime acceptance. |

### Latest local verification

- Syntax: **50/50 `.gs` files PASS** (43 app modules + 7 runtime probes).
- Local Node regression suites: **70/70 PASS** — Order Domain 17/17; Supply UX 15/15; Catalog/Order UX 12/12; System Safety UX 13/13; Warehouse Dashboard 9/9; Finance schema 4/4.
- TypeScript AST: **570 functions / 88 top-level variables**, zero parse errors and duplicate declarations.
- Menu audit: **68 actions / 0 missing handlers**.
- No Google Sheets workbook, live stock, order, receipt, dispatch, return, backup, restore, schema migration or FIFO rebuild was executed.

### Still open or only partially mitigated

- **F-01:** source fix and regression coverage are complete. Return allocations are selected by original dispatch movement ID rather than the globally latest FIFO run. Runtime acceptance remains: dispatch A → perform unrelated stock movement/FIFO run → return A → reconcile returned lots and exact cost.
- **F-02:** v3→v4 source implementation is complete on PR #1: date-only `business_date`, dedicated historical-sale form, guarded historical FIFO dispatch/completion, immutable retry checks, financial preview/confirmation and register display. Shared date/time controls are implemented. Latest source CI is 145/145 (run #225); disposable-workbook migration and business-cycle acceptance remain pending. See `docs/F02_HISTORICAL_SALES_DESIGN.md`.
- **F-03:** source fix complete. Confirmation dialogs are outside the global ScriptLock; a short preflight lock captures a snapshot, then after YES the code reacquires and revalidates state/fingerprint before writes. Real two-session dialog interleaving remains pending.
- **F-04:** 45,000-character payload guard fails closed before operation writes. Chunked payload storage and compact audit retention are not implemented and remain future design work.
- **F-05:** full-supply-edit retries compare the current form fingerprint with the immutable prepared-operation payload; legacy prepared operations without fingerprints fail closed. Runtime retry/recovery remains pending.
- **F-06:** source implementation complete: deterministic allocation IDs, append-only allocation and lot-cache snapshots, PREPARED/COMMITTED/QUARANTINED replay events, per-product replay identity, idempotent recovery, integrity diagnostics and backup hash coverage. Runtime fault injection at every write boundary, archive restore and quarantine-resolution UX remain pending. See `docs/F06_FIFO_ALLOCATION_ARCHIVE_IMPLEMENTATION_SPEC.md`.
- **F-07:** source implementation complete: 13-column StockLedger with immutable `ledger_sequence`, lock-protected sequence assignment, global/per-product watermarks and stable FIFO replay cursors. It is a clean-baseline target; the old 12-column RC8 ledger is not compatible without a separately approved migration. Runtime acceptance on a disposable empty workbook remains pending. See `docs/F07_STABLE_LEDGER_SEQUENCE_IMPLEMENTATION_SPEC.md`.
- **F-09:** per-view refresh isolation and pending-operation journal warning are implemented. Full-history read cost, scoped refresh and benchmark-based optimization remain open; do not optimize blindly before C-01 runtime measurements.
- **F-10:** append-only `LOCKED` / `REOPENED` period events are implemented; current state is derived from latest event. Close → reopen → re-close and preservation of legacy history need runtime acceptance. Previously overwritten legacy history cannot be recovered.
- **F-13:** backup flush is mandatory; manifest records phase timings; manual backup reports lock wait/hold time and shows toast after lock release. Drive consistency and actual timing baseline remain pending.
- **F-14:** a two-execution ScriptLock probe now detects contention, successful serialization after release and overlap. Real concurrent execution remains pending on a restored disposable copy.
- **F-17:** delivery-method catalogue needs the user's actual options; none are invented.
- **F-18:** minor-unit conversion normalizes floating-point representation and applies symmetric half-up rounding with safe-integer validation. Real Sheets locale/currency acceptance remains pending.
- **F-20:** centralized actor capture and initiator-vs-executor attribution are implemented across order, supply and manual-stock audit paths; runtime recovery identity acceptance remains pending. See `docs/F20_OPERATION_IDENTITY_AUDIT.md`.
- **Dashboard:** the chart is still reported blank in the user's Sheets copy. Run the read-only diagnostics on the restored test copy and inspect N1:O21 plus the actual chart source range.



## F-19 — FIFO replay and recovery regression coverage — 25.11.2026

- Extended the pure Stock Core suite with incremental-vs-full replay equivalence, backdated-event replay selection, partially-applied OUT recovery routing, UNKNOWN/FREE cost semantics and same-timestamp deterministic ordering.
- Added tools/run_fifo_replay_tests.js to execute the Stock Core suite with the Incremental FIFO module loaded in a Node VM.
- Added docs/F19_FIFO_REPLAY_RECOVERY_TESTS.md with coverage, execution command and acceptance boundaries.
- **Tests added, not executed here:** the GitHub repository could not be checked out in this environment, so neither the new runner nor the repository syntax script was run. Run both locally before treating F-19 as source-verified.
- These are pure in-memory tests only. Google Sheets write interruption, OperationExecutor recovery, LockService concurrency and restored-workbook acceptance remain open.
- No Apps Script behavior, workbook data, stock ledger, FIFO projection or cursor was changed.


## F-06 / F-07 FIFO history and stable-cursor design — 25.11.2026

- Audited the current FIFO replacement and cursor paths in 24_DI3_IncrementalFifo.gs.
- Confirmed that StockAllocations is the active projection: product replay and full replay replace rows, while the current rollback helper only restores on caught write errors and cannot make multi-sheet writes atomic against process termination.
- Confirmed that fifo_ledger_cursor is currently a physical data-row count; incremental tail reads use cursor + 2, and FifoProductState stores/compares a physical last ledger row number.
- Documented a separate append-only allocation-history event log with replay-scoped PREPARED/COMMITTED events and deterministic recovery, keeping StockAllocations active-only.
- Documented migration to immutable ledger_sequence watermarks for global and per-product cursors, preserving FIFO business ordering by effective_at → recorded_at → movement_id.
- Added regression, recovery, migration and concurrency acceptance criteria.
- **Design only:** no Apps Script behavior, schema, workbook data, ledger, allocation projection or FIFO cursor was changed. Implementation is deferred until the sequence migration and archive recovery protocol can be tested together on a restored disposable copy.
- Design: docs/F06_F07_FIFO_HISTORY_AND_STABLE_CURSOR_DESIGN.md.


## F-10 source patch — append-only period audit (25.11.2026)

- `di3CloseAccountingPeriod()` and `di3ReopenAccountingPeriod()` now append events to `PeriodLocks`; neither updates an existing event row.
- `di3GetLatestPeriodEvents_()` folds the event log by physical row order. `di3GetLatestLockedPeriod_()` considers only the latest event for each period, so a later `REOPENED` event actually removes that period from the active lock set.
- Re-closing a reopened period appends a new `LOCKED` event. Period status returns one current snapshot per period, including the actor and reason fields.
- The existing 10-column schema is reused; no schema migration or workbook write was performed.
- Added three structural regression checks to `41_DI3_SystemSafetyUxTests.gs`.
- **Not yet verified:** the tests were added through GitHub source editing and have not been executed here. Run syntax + all six local Node suites before relying on the patch. Then use a restored test workbook to verify close → reopen → re-close, one appended row per transition, immutable prior rows and correct PeriodGuard blocking.
- **Legacy limitation:** historical rows that were overwritten by earlier versions cannot be recovered; the append-only guarantee applies from this patch onward.


## F-02 source audit and v4 design — 25.11.2026

- Audited the current order creation/dispatch/completion flow, v3 order schema, OperationExecutor, PeriodGuard and FIFO replay.
- Confirmed the existing FIFO engine orders stock events by `effective_at`, then `recorded_at`, and can trigger product replay for a backdated movement. Its replay rejects insufficient historical stock.
- Identified that the current order-draft validator uses today's available quantity and the dispatch validator requires `dispatched_at >= created_at`; both require a controlled historical-mode path.
- Proposed append-only `business_date` in `V3_Orders` (schema v3→v4), preserving `created_at` as actual record-entry time, with dispatch and completion timestamps remaining separate.
- Proposed retry-safe orchestration using the existing `ORDER_CREATE` and `ORDER_DISPATCH` operations plus the existing completion settlement transition; no second FIFO engine or new operation type unless tests prove the existing lifecycle cannot safely resume.
- **Not implemented:** no source behavior, schema, menu, tests or workbook data changed for F-02. The design is documented in `docs/F02_HISTORICAL_SALES_DESIGN.md`.
- **Decision confirmed 26.11.2026:** exact dispatch date/time is mandatory. Use separate date-picker and time controls (same form row), date `ДД.ММ.ГГГГ`, time `ЧЧ:ММ` in 24-hour format; do not rely on date-cell number formatting to preserve a time value. Completion uses the same pair; business date remains date-only. Missing time must block submission.


## F-20 — operation identity and actor attribution audit — 25.11.2026

- Audited operation registration, immutable payloads, attempt/recovery journal, manual quarantine release, domain actor fields and the unified edit trigger.
- Confirmed the intended distinction already exists in the schema: `Operations.actor` captures the registration actor; `OperationAttempts.actor` captures the actor for each execution attempt.
- Found inconsistent actor acquisition paths (shared helper/fallback, direct `Session.getActiveUser()`, and settings-specific helper). Some domain audit rows acquire actor inside the handler, so recovery can attribute the event to the recovery executor rather than the original initiator.
- Found that `di3GetOperationAttemptStats_` omits the persisted actor field from its returned attempt diagnostics.
- Documented identity limitations: active-user identity may be unavailable; effective-user identity must not be substituted as the initiating person; trigger context currently does not persist actor source or execution context.
- Proposed a normalized actor context with separate initiator, executor and domain-event semantics, plus pure tests and restored-workbook acceptance scenarios.
- **Design only:** no Apps Script behavior, schema, manifest, triggers, workbook data, operation payloads or business records changed. No tests were run for this audit.
- Design: `docs/F20_OPERATION_IDENTITY_AUDIT.md`.


## F-20 — diagnostic actor visibility — 25.11.2026

- `di3GetOperationAttemptStats_` now exposes the persisted `OperationAttempts.actor` on every attempt diagnostic object, including `last_attempt` and `manual_reviews`.
- The active retry-epoch projection now carries the actor through its internal row adapter instead of replacing the actor column with an empty string.
- Added a regression test with three distinct identities: original executor, manual reviewer and recovery executor. It checks that the active retry epoch reports the recovery executor while the manual review retains its own actor.
- No schema, spreadsheet, operation payload, business record, stock event, or runtime behavior was changed.
- **Test execution pending:** the existing `tools/run_system_safety_ux_tests.js` runner loads both the executor and the updated test module, but it was not executed in this environment. Run the runner and full syntax check before deployment.
- Remaining F-20 work: centralize actor-context capture, distinguish initiator from executor, and propagate the persisted initiator into domain audit writes without substituting the trigger/recovery executor.


## F-20 — centralized actor identity capture — 25.11.2026

- Added `di3CaptureActorContext_()` as the single source for active-user identity, with explicit `IDENTIFIED` / `UNAVAILABLE` status and `ACTIVE_USER` / `NONE` source.
- Preserved `di3GetActorEmail_()` as the backwards-compatible string API and routed the duplicated actor reads in supply, order, period, schema migration, operation executor and settings paths through it.
- Removed the direct Session fallback from operation registration/execution. No effective-user fallback is introduced.
- Added regression checks in `di3RunSystemSafetyUxUnitTests()` for identified, empty-email and unavailable Session contexts, as well as the absence of effective-user fallback.
- **Not verified:** test suite and syntax checks have not been run. No deployment or workbook changes were made.
- **Still open:** propagate the persisted initiating actor from `Operations.actor` into domain audit events during recovery; preserve the actual executor in `OperationAttempts.actor`; add identity-status persistence only after schema and runtime semantics are reviewed.


## F-20 — operation initiator attribution — 25.11.2026

- Added `di3GetOperationInitiatorActor_(operationId)`, which resolves the initiator from immutable `Operations.actor`. A blank/missing operation actor remains blank; it is not replaced by the recovery executor.
- Order creation/status history and order dispatch/return movement details now use the original initiator. Supply receipt status history uses the same rule.
- `OperationAttempts.actor` remains the actual executor for each attempt.
- Added regression coverage for initiator A vs recovery executor B, blank/missing actor cases, and the relevant order/supply audit writers.
- **Not verified:** source tests and syntax checks have not been run; restored-workbook recovery acceptance is pending. No workbook or deployment changes.

- Supply receipt `StockMovementDetails.actor` is now populated from the same immutable initiator record; its regression assertion was added.
- Manual warehouse stock movement details now also record the original operation initiator in `StockMovementDetails.actor`; regression coverage was extended.
- Extended `tools/run_system_safety_ux_tests.js` to load the actor helper, settings accessor, and manual-stock source modules referenced by the expanded suite. Runner execution remains pending.


## F-20 — remaining manual and administrative audit paths — 26.11.2026

- Confirmed supply draft history and settings/manual review use the centralized active-user accessor.
- Confirmed full supply-document edits persist `edited_by` in the immutable operation payload and reuse it for status history during recovery.
- Confirmed period close/reopen and schema migration records use the centralized accessor; period events remain append-only.
- Simplified redundant actor lookup wrappers.
- Extended the system-safety runner to load the supply-domain, schema-versioning and full-edit modules; added structural assertions for these paths.
- **Source verification passed:** GitHub Actions PR integration run `45728149345` (run #93) passed syntax checks for all 50 `.gs` files and the System Safety UX suite (31/31); all seven suites passed 129/129. This executes the F-20 actor-attribution and administrative-path structural assertions in the Node harness.
- Runtime acceptance remains open: restored-workbook checks are still required to verify Apps Script Sessions behavior, actual editor/recovery identities, and persisted audit rows in Google Sheets.

## C-01 / F-09 — performance audit plan — 26.11.2026

- Source inspection confirms that the common FIFO path reads only the appended StockLedger tail when its cursor is valid. The remaining scaling risk is repeated tagged lookups per affected product; a backdated event can trigger a full product replay.
- The stock journal currently reads full StockLedger, StockMovementDetails, StockLots, active allocations, products and product codes, then materializes and sorts the complete history.
- Added docs/C01_F09_PERFORMANCE_AUDIT_AND_BENCHMARK_PLAN.md with a disposable-workbook benchmark matrix for 500 / 1,000 / 2,000 movements, one vs. many affected products, product replay, full rebuild, journal and dashboard refresh.
- This is a source audit and measurement plan only. No performance claim, code optimization, Apps Script execution, or workbook change is made. Batch reads, journal windowing and selective view refresh should be implemented only after runtime measurements identify the bottleneck.
- C-01 remains open until real Apps Script timing and read/write counts are recorded. F-09 remains partially mitigated; per-view error isolation is in place, but full-history read cost and scoped refresh remain open.

## Clean-workbook architecture decision — 26.11.2026

- The owner confirmed that recreating the spreadsheet from zero is acceptable because little business data has been entered.
- Preferred release strategy: implement the final baseline schema before creating the production workbook, rather than carrying avoidable legacy schema/cursor migrations into the new workbook.
- F-06/F-07 design now records the clean-install path: ledger_sequence and append-only FIFO allocation history exist from the first stock movement; legacy backfill is retained only as a compatibility/test case.
- This does not authorize live workbook deletion or recreation. The production workbook should be created only after baseline schema, setup idempotency, backup/restore and end-to-end acceptance pass on a disposable empty workbook.

## F-07 — stable ledger sequence implementation specification — 26.11.2026

- Follow-up F-07 call-site audit checked the other supply/order/history/backup/schema modules: no additional direct StockLedger append path was found. Historical supply uses the existing supply-receipt operation path; full supply-document edit is explicitly document-only. The four writer paths in the F-07 spec remain the complete identified set.

- Verified current schema and cursor implementation: StockLedger has 12 columns without ledger_sequence; FIFO state v3 stores physical last_ledger_row_number; fifo_ledger_cursor is a physical data-row count; tail reading uses cursor + 2.
- Identified four domain writer paths to update: manual warehouse movement (07), supply receipt (12), order dispatch and return (16). These public paths are lock-wrapped; recovery must reuse sequence values persisted in immutable operation payloads.
- Added docs/F07_STABLE_LEDGER_SEQUENCE_IMPLEMENTATION_SPEC.md. The proposed design appends ledger_sequence to the clean baseline, changes global and per-product cursors to sequence watermarks, discovers tail rows by scanning the narrow sequence column (not physical row offsets), and preserves effective_at / recorded_at / movement_id as FIFO business ordering.
- Important schema-versioning finding: current versioning assumes baseline v1 plus sequential migrations through v3. A clean final baseline requires explicit clean-baseline adoption distinct from legacy upgrade paths; merely increasing DI3_SCHEMA_VERSION would break the existing initialization assumptions.
- No application code or workbook changed in this step. F-07 remains open pending implementation, source tests, and runtime acceptance on a disposable empty workbook.


## F-07 — source implementation pass — 26.11.2026

- Implemented the first source pass: 13-column StockLedger baseline with immutable ledger_sequence, FIFO state version 4, renamed product watermark, and sequence-based global cursor metadata.
- Added ScriptLock-only max+1 block allocation from a validated narrow-column scan. Movement ID, product ID and sequence columns are scanned; missing, invalid, non-positive and duplicate populated sequences fail closed. Gaps are accepted.
- Persisted assigned sequence values in immutable payloads for manual stock movement, supply receipt, order dispatch and order return. Each corresponding ledger row builder writes the sequence as the final field and validates it before append.
- Replaced physical-row tail offsets with sequence-based tail discovery and grouped full-row reads for only rows whose sequence exceeds the cursor. Physical row reorder no longer determines whether an event is skipped.
- Product watermarks store max processed sequence; business event watermark remains effective_at / recorded_at / movement_id. FIFO integrity diagnostics now compare sequence watermarks, not row counts.
- Added regression cases for reordered rows, sequence gaps, duplicate/missing values, ScriptLock enforcement and independent business/ingestion ordering. Updated the System Safety runner to load the sequence helper and added a GitHub Actions quality-gates workflow for syntax and all local test suites.
- **Source verification passed:** Latest GitHub Actions run `45721449653` completed successfully. Syntax passed for 50 `.gs` files; all seven local suites passed 118/118 (FIFO 41, Order Domain 17, Supply Workspace UX 15, Catalog/Order UX 12, System Safety UX 20, Warehouse Dashboard 9, Finance Schema 4). Added a fail-closed consistency check so a physical row sort between narrow-index scan and full-row fetch aborts tail processing rather than applying a mismatched event. No Apps Script runtime acceptance was performed.
- **Deployment warning:** the new StockLedger schema is 13 columns and is intentionally incompatible with the existing 12-column workbook. Do not deploy to the current workbook. Production remains blocked on clean-baseline adoption, complete review, executed test suites, backup/restore validation and disposable-workbook runtime acceptance.
- F-07 remains open; this is an implementation pass, not a release sign-off.

## Clean-baseline versioning audit — 26.11.2026

- Added docs/CLEAN_BASELINE_SCHEMA_VERSIONING_DESIGN.md. It defines separate clean-final-baseline adoption and explicit legacy-upgrade paths; it does not assign a final schema version number until F-02 and F-06 contracts are frozen.
- Source inspection found the current installer creates/initializes the schema before calling schema versioning, while the versioning code assumes baseline v1 and migrations v2/v3. A clean final workbook therefore needs its own idempotent adoption record, not a fabricated historical migration chain.
- Source inspection also found di3DryRunInstallation() checks known system sheets/workspaces but does not inventory and block every unknown populated tab. The clean-install preflight must close this gap.
- No source runtime or workbook changes were made. Clean-baseline versioning remains a design task before implementation.

## F-06 — FIFO allocation archive and crash-recovery specification — 26.11.2026


- Audited the active allocation replacement path, FIFO run lifecycle, allocation ID generation, and all four stock-operation call sites.
- Confirmed that the current rollback helper only handles caught write errors; abrupt Apps Script termination between sheet writes can leave a partially replaced projection. A subsequent retry currently creates a new FIFO run ID, so it cannot reliably identify the interrupted replay.
- Confirmed that allocation rows currently receive random UUIDs on every rebuild. F-06 therefore requires deterministic allocation IDs for a stable replay identity and target fingerprint.
- Added `docs/F06_FIFO_ALLOCATION_ARCHIVE_IMPLEMENTATION_SPEC.md`. It defines separate append-only allocation and lot-cache archives, an append-only replay lifecycle event log, operation-linked replay identity, PREPARED/COMMITTED recovery, fail-closed quarantine, and 20 fault-injection/regression cases.
- F-06 depends on F-07 sequence-based input identity. The spec is for the clean baseline; no production backfill or legacy migration is planned for the recreated workbook.
- No Apps Script source, spreadsheet schema, workbook data, or deployment was changed. Tests and runtime fault injection were not run. F-06 remains open pending implementation and acceptance.

## F-06 — source implementation groundwork — 26.11.2026

- Added clean-baseline schemas for allocation snapshots, lot-cache snapshots and append-only replay events; expanded FIFO run metadata with operation ID, parent replay ID, scope and input fingerprint.
- Linked all four stock-operation handlers to the FIFO run using their immutable operation ID. Added SHA-256 run input fingerprinting and prioritized the new archive tables in backup ordering.
- Updated F-06 identity design after reviewing the live control flow: one stock operation may process multiple products, and only some may require a full product replay. Therefore each replaced product receives its own stable child replay identity; incremental-only products do not create archive events.
- Implemented append-only allocation/lot snapshots, deterministic replay allocation IDs, PREPARED/COMMITTED/QUARANTINED lifecycle events, per-product replay identity, pending run reuse, source restoration, recovery before tail processing, and a gate blocking new stock events while runs are unresolved.
- GitHub Actions run `45710935351` passed syntax checks for 50 `.gs` files and all seven source suites (99/99). Runtime fault-injection and backup/restore acceptance remain open. F-06 remains open.
## N-03 — clean final baseline implementation — 26.11.2026

- Implemented a separate `CLEAN_FINAL_BASELINE_ADOPTION` path in `33_DI3_SchemaVersioning.gs`: a new workbook with the exact final target headers records one 0 → current-version baseline instead of fabricating RC8 baseline-v1 and v1→v2→v3 migration history.
- Kept the explicit RC8/legacy migration path separate. An unversioned workbook without recognized legacy migration identity is blocked rather than auto-adopted.
- Added fail-closed checks for duplicate/mismatched clean-baseline journal records, legacy or partial headers, out-of-schema populated columns, and missing system tables after baseline adoption.
- A `STARTED` baseline may resume only after revalidating the target headers; an adopted baseline remains recognizable after normal business rows have been created.
- Added 12 focused System Safety UX regression cases and updated `docs/CLEAN_BASELINE_SCHEMA_VERSIONING_DESIGN.md`.
- Branch: `feature/clean-final-baseline`; draft PR: https://github.com/brusvv/dots_inventory-/pull/1.
- GitHub Actions code run `45728096949` and PR integration run `45728149345` (run #93, merge commit `a17111e`) passed syntax for 50 `.gs` files and 129/129 Node tests: FIFO 41, Order Domain 17, Supply UX 15, Catalog/Order UX 12, System Safety 31, Warehouse Dashboard 9, Finance 4. The idempotency test verifies recovery after schema_version has been written but before the baseline journal row is completed. This remains source-level validation, not Google Sheets runtime acceptance.
- Added a regression case proving that a fully cleared header row after baseline adoption is BLOCKED; CI rerun for this final guard is pending.
- **Still not runtime-accepted:** actual Google Sheets Dry Run, empty-workbook setup, setup rerun, interruption injection at both journal boundaries, backup/restore-as-new, and end-to-end supply/dispatch/return/finance flows. Existing RC8 remains untouched.


## Verification update — 26.11.2026 (supersedes earlier pending-CI notes)

- Latest PR quality-gates run: GitHub Actions run 45728640689, completed successfully against PR merge commit 903b546 (head a20dfba).
- Apps Script syntax: **50/50 .gs files PASS**.
- Regression suites: **130/130 PASS** — FIFO replay 41/41; Order Domain 17/17; Supply Workspace UX 15/15; Catalog/Order UX 12/12; System Safety UX 32/32; Warehouse Dashboard 9/9; Finance Schema 4/4.
- This run includes the final clean-baseline guard rejecting a fully cleared core-table header after adoption. It also executes the current F-20 identity/initiator regression assertions through the System Safety runner.
- These results are source/Node CI only. They do not establish Google Apps Script runtime behavior, Google Sheets chart rendering, multi-user LockService behavior, backup/restore consistency, or live business-cycle correctness.
- N-03 source-CI gate is now passed. Remaining N-03 acceptance is Google Sheets Dry Run/setup/rerun/interruption recovery on a disposable empty workbook, plus backup/restore-as-new. PR #1 remains Draft and unmerged; main and the existing RC8 workbook remain unchanged.


## Date/time UX scope expanded — 26.11.2026

The confirmed separate date-picker + mandatory `HH:mm` time-input pattern applies consistently to **orders, supplies and manual warehouse movements**, not only F-02 historical sales. New design contract: `docs/OPERATION_DATE_TIME_UX_DESIGN.md`.

- Orders: ordinary lifecycle transitions use separate date/time controls. F-02 historical sales add a manually entered date-only customer-order `business_date` and separately capture actual historical dispatch and completion date/time. Historical dispatch may precede `created_at` only in the explicit historical-sale path; FIFO still uses actual dispatch `effective_at`.
- Supplies: normal next-stage input becomes a date/time pair; historical supply actual events sent/awaiting/received (G5:G7) each use a date/time pair. Store order date and expected arrival date remain date-only.
- Warehouse: manual IN/OUT operation date and time become adjacent required inputs.
- Canonical event timestamps remain single timestamps; `recorded_at`/`created_at` remain system times. No supply/StockLedger schema migration is introduced solely for UI separation.
- Shared parser must combine the pair in the configured spreadsheet timezone, reject missing/invalid time, preserve time across date-picker changes, normalize seconds to `00`, and feed the same canonical timestamp into confirmation, idempotency hash and operation payload.
- This is a design freeze only. Source implementation and regression tests remain pending; PR #1 remains Draft/unmerged and no workbook/runtime changes are authorized by this documentation update.


## F-02 — customer-order date and historical lifecycle clarification — 26.11.2026

- The customer-order `business_date` is distinct from the actual workbook `created_at`. Example: customer order 25 November 23:00, entered 26 November 08:00 → business_date = 25 November; created_at = 26 November 08:00.
- A historical sale still requires its actual dispatch date/time and completion date/time. These are independent lifecycle event timestamps; `business_date` is never used as StockLedger `effective_at`.
- Historical mode must bypass current-stock availability rejection during draft creation and rely on scoped FIFO preflight/replay at the actual dispatch timestamp. It may bypass the ordinary dispatch-not-before-created_at guard only inside the explicit historical-sale workflow; all other FIFO, pending-operation, PeriodGuard and returned-order checks remain.
- Completion chronology is checked against the actual dispatch timestamp. Finance Dashboard continues recognizing sales on `completed_at`; `business_date` does not move recognized revenue/COGS into another financial period.
- The v3→v4 schema appends only `V3_Orders.business_date` (AD); existing 29 columns remain in place. The proposed dispatch precision/window/uncertainty fields remain removed.
- Source audit found implementation blockers: current order draft rejects quantities above today's stock; current `di3DispatchOrder_` rejects dispatch before `created_at`; the ordinary order form has no business-date or historical lifecycle controls; and the order register currently shows only `created_at`. These must be addressed in one coordinated F-02 source patch, with tests for historical vs ordinary behavior and idempotent recovery.
- No source code, schema registry, workbook or runtime data changed in this documentation update. PR #1 remains Draft/unmerged; existing RC8 workbook remains untouched.


## F-02 — source implementation pass — 26.11.2026

- Added the v3→v4 `RC8_ORDER_BUSINESS_DATE_V4` migration. It appends `business_date` in AD, backfills from local `created_at` date, preserves the existing 29-column prefix, validates AD and source timestamps before writing, and is resumable through SchemaMigrations.
- Updated schema compatibility and installation preflight. The setup path allows a validated v3 prefix to reach the journaled migration only after the existing backup + Dry Run flow; clean baseline adoption targets v4 directly.
- Added a separate historical-sale workspace and menu entry. It captures date-only customer business date, actual dispatch date/time and actual completion date/time.
- Implemented the historical lifecycle orchestration over existing `ORDER_CREATE` and `ORDER_DISPATCH`; historical mode bypasses only current-stock draft rejection and the dispatch-not-before-`created_at` guard. FIFO preflight/replay, PeriodGuard, returned-order guard and pending-operation checks remain.
- Request hashing now binds the business date, dispatch/completion timestamps and commercial fields. Existing dispatch operation retries compare the immutable timestamp; changed input fails closed. Completion retries verify timestamps and refresh derived views.
- Order register displays business_date separately. Finance Dashboard continues to recognize revenue/COGS on completed_at.
- Added three F-02 source regression tests: request-hash timestamp/date binding, historical-only backdate permission, and immutable dispatch timestamp mismatch rejection.
- **Runtime not accepted:** no Google Sheets migration, form submission, FIFO replay, PeriodGuard, commission settlement or Finance Dashboard runtime test has been executed. Run these only on a restored disposable workbook after backup and Dry Run. Production RC8 remains untouched; PR #1 remains Draft/unmerged.

- **F-02 source CI verification:** GitHub Actions run `45848797676` (run #173) passed syntax for 50 Apps Script files and 137/137 regression tests (FIFO 41, Order Domain 21, Supply UX 15, Catalog/Order UX 13, System Safety 34, Warehouse Dashboard 9, Finance 4). Later commits after that run changed documentation only. Google Sheets runtime acceptance remains open.

## F-02 — historical dispatch recovery hardening — 26.11.2026

- Recovered the remaining retry gap where ORDER_DISPATCH had already written order status IN_TRANSIT but its operation journal was still PREPARED. The retry now validates the immutable dispatch timestamp and historical-mode marker and resumes the existing operation instead of returning ALREADY_DISPATCHED.
- Historical-sale orchestration re-enters dispatch for NEW and IN_TRANSIT orders; before final success it requires a COMMITTED ORDER_DISPATCH payload matching the exact historical timestamp and mode.
- Completion retry repairs a missing completion status-history row idempotently after checking the immutable completed_at value.
- Added the IN_TRANSIT + PREPARED recovery regression. Added a financial preview and explicit YES/NO confirmation before historical stock mutation; preview and create now use the same parsed form snapshot. Added a Catalog/Order UX regression for this invariant.
- Latest source CI run #163 (45848104778): syntax 50/50; all seven suites **135/135 PASS** (FIFO 41, Order Domain 21, Supply UX 15, Catalog/Order UX 13, System Safety 32, Warehouse Dashboard 9, Finance 4). Later commits changed documentation only.
- Runtime acceptance remains pending on a restored disposable workbook: schema Dry Run/backup/v3→v4 migration, clean-baseline setup/rerun, historical form, FIFO historical sufficient/insufficient cases, PeriodGuard, commission/Finance Dashboard, operation fault injection and backup/restore-as-new. No production RC8 workbook or deployment was changed.


## Cross-workspace date/time input implementation — 26.11.2026

**Source implementation complete; runtime acceptance pending.**

- Added the shared timezone-aware `di3BuildEffectiveDateTime_()` parser and `di3SplitEffectiveDateTime_()` presentation helper. Input time is strict `HH:mm`, mandatory, minute-precision; seconds/milliseconds normalize to zero; nonexistent local times in DST gaps fail closed.
- Order register: date P + time Q; hidden `order_id` moved to R; `business_date` is S. The 13/18-column legacy register layouts migrate by order ID; date-only/ambiguous legacy timestamps do not silently receive midnight.
- Supply register: date M + time N; 13-column legacy register upgrades to 14 columns by `supply_id`.
- Supply form: actual stage dates G5:G7 and times H5:H7 for ordinary lifecycle, historical entry and full edit. Time cells are included in dirty-form fingerprints and unsaved-data checks. Existing combined stage timestamps are split on setup; ambiguous midnight input requires re-entry.
- Manual warehouse IN/OUT: date B4 + time C4; existing combined B4 timestamps are split non-destructively.
- Historical sale: business date B4 remains date-only; dispatch B5/C5 and completion B6/C6 are adjacent date/time pairs.
- Canonical data model is unchanged: each event remains one timestamp in operation payloads and stock/order/supply tables. No timestamp-split columns were added to StockLedger or V3_Supplies.
- Regression coverage includes parser format/seconds/DST-gap behavior, supply and order register pairs/migrations, dirty-form state, historical-sale fields and manual warehouse input.
- **Latest source CI:** run #212 ([45852013073](https://github.com/brusvv/dots_inventory-/actions/runs/45852013073)) passed syntax for 50 `.gs` files and 142/142 tests: FIFO 41, Order Domain 22, Supply Workspace UX 17, Catalog/Order UX 14, System Safety UX 35, Warehouse Dashboard 9, Finance Schema 4.
- **Still pending:** Google Sheets runtime acceptance on a restored disposable workbook, including setup migration/rerun, date/time input behavior, DST timezone behavior, order/supply status transitions, manual movements, FIFO ordering, PeriodGuard, commissions, Finance Dashboard and retry/fault recovery. Production RC8 and deployed Apps Script remain untouched. PR #1 remains Draft/unmerged.


## F-13 — backup flush, phase timing and lock duration — 26.11.2026

**Source hardening implemented; runtime timing baseline pending.**

- Backup now fails closed if `SpreadsheetApp.flush()` is unavailable; it no longer silently skips the flush step.
- The required flush is executed before source snapshot reads and Drive `makeCopy()`.
- Manifest timing now distinguishes backup start from actual copy creation time and records flush, source snapshot, Drive copy, verification, manifest write and total elapsed milliseconds. The returned result reports full elapsed time; manifest labels the pre-final-update interval explicitly to avoid overstating precision.
- The manual backup wrapper measures lock wait and lock-held duration. Toast/UI notification now occurs after `di3WithLock_()` returns, so UI latency does not extend the global mutation lock.
- Added System Safety regressions for flush → snapshot → copy → verify ordering, timing fields, and lock metrics/toast placement.
- **Source CI:** run #221 ([45852754294](https://github.com/brusvv/dots_inventory-/actions/runs/45852754294)) passed syntax for 50 `.gs` files and 144/144 tests: FIFO 41, Order Domain 22, Supply Workspace UX 17, Catalog/Order UX 14, System Safety UX 37, Warehouse Dashboard 9, Finance Schema 4.
- **Runtime acceptance pending:** run a verified backup on a restored disposable workbook, inspect manifest timestamps and phase timings, compare source/copy snapshots, and capture lock wait/hold duration. Setup/schema-migration backups use the same phase instrumentation but are still subject to the outer setup lock. Do not change backup retention or restore behavior as part of this task.


## F-14 — two-execution ScriptLock probe — 26.11.2026

**Probe hardened in source; real concurrency test pending.**

- Updated `runtime/probes/DI3_C06_LOCK_CONTENTION_PROBE.gs` to require a shared `probeId` and explicit `TEST_COPY_ONLY` confirmation.
- Session A acquires the native ScriptLock, writes a temporary marker to ScriptProperties, holds the lock, then marks release and removes the marker. No business tables are read or written.
- Session B enters through the production `di3WithLock_()` helper. Outcomes distinguish `CONTENDED` (20-second lock timeout), `ACQUIRED_AFTER_RELEASE` (serialized successfully), and `OVERLAP_DETECTED` (hard failure).
- Marker cleanup is token-checked and stale markers older than 120 seconds may be cleared on the next probe.
- Added a System Safety regression proving the probe uses ScriptLock + ScriptProperties only and does not reference business tables.
- **Source CI:** run #231 ([45853915962](https://github.com/brusvv/dots_inventory-/actions/runs/45853915962)) passed syntax for 50 `.gs` files and 145/145 tests: FIFO 41, Order Domain 22, Supply Workspace UX 17, Catalog/Order UX 14, System Safety UX 38, Warehouse Dashboard 9, Finance Schema 4.
- **Runtime acceptance:** on a restored disposable copy, start Session A with a 25-second hold, then start Session B within the first few seconds using the same probe ID. Expected B result is `CONTENDED` with `callback_entered=false`. Repeat with a 5–15 second hold; B should return `ACQUIRED_AFTER_RELEASE`. Any `OVERLAP_DETECTED` fails the test. Starting B only after A has completed does not test contention.


## F-06 — retryable recovery failure classification — 26.11.2026

- Source audit found that the recovery catch previously appended QUARANTINED for every exception, including transient Google Sheets write failures after the target projection had already been applied. That made a recoverable PREPARED replay terminal.
- Recovery now distinguishes explicit integrity/input failures (which quarantine) from unexpected execution/service failures (which leave the immutable replay PREPARED and report that it can be retried).
- Added a FIFO regression for a transient failure during product-state update; it asserts no QUARANTINED event is written. Existing changed-input fingerprint regression still asserts quarantine before projection writes.
- **Source CI passed:** GitHub Actions run `45854606470` (run #237): syntax 50/50; 146/146 tests (FIFO 42, Order Domain 22, Supply UX 17, Catalog/Order UX 14, System Safety 38, Warehouse Dashboard 9, Finance 4). Runtime fault injection and disposable-workbook recovery remain required.


## N-03 follow-up hardening — populated managed workspaces — 26.11.2026

- A focused source audit found one remaining clean-adoption edge case: a known application-owned workspace (for example, `Продукты`) could contain user-entered content while the core system tables were absent/empty. Because those workspaces are derived views and setup may rebuild them from the system tables, treating such a workbook as a clean empty install could overwrite data.
- `di3GetCleanBaselineState_()` now blocks first-time clean adoption when any managed workspace contains cells or charts before a `CLEAN_FINAL_BASELINE_ADOPTION` identity exists. A genuinely empty managed tab remains allowed; after a completed baseline, normal workspace content is expected and does not block reruns.
- Added a regression case covering both a populated managed workspace (BLOCKED) and an empty managed workspace (eligible).
- Latest PR quality-gates run: [45864597621](https://github.com/brusvv/dots_inventory-/actions/runs/45864597621), run #240, completed successfully on head `5698e8321f255055f7472a8374e8ca4b846184e5`.
- Apps Script syntax: **50/50 .gs files PASS**. Regression suites: **147/147 PASS** — FIFO 42, Order Domain 22, Supply Workspace UX 17, Catalog/Order UX 14, System Safety UX 39, Warehouse Dashboard 9, Finance Schema 4.
- This is source/Node CI only. Google Sheets Dry Run, clean setup/rerun, interruption recovery, and backup/restore-as-new still require runtime acceptance on a disposable empty workbook. PR #1 remains Draft and unmerged; main and the existing RC8 workbook remain unchanged.


## GitHub release pipeline — D-01 / D-02 — 26.11.2026

**Source implementation complete; first published release intentionally deferred.**

- Added `tools/build_release_manifest.js`: creates deterministic `dots-inventory-release/v1` metadata from a full commit SHA and annotated semver tag.
- Release manifest includes exact Git commit, schema target read from `DI3_SCHEMA_VERSION`, application timezone read from `DI3_APP_CONFIG.TIME_ZONE`, updater minimum version, target-manifest preservation policy and sorted Apps Script source entries.
- Each `.gs` entry is pinned to an immutable `raw.githubusercontent.com` URL and records byte length and SHA-256. The manifest has a detached SHA-256 sidecar; source hashes are recorded separately.
- Only `.gs` modules from `src/apps_script/` are included as Apps Script files. Runtime probes, QA tools and docs are not executable project modules.
- Added tag-triggered `.github/workflows/release.yml`. It requires an annotated `dots-inventory-vMAJOR.MINOR.PATCH` tag whose commit is already reachable from `main`, runs release-manifest tests, builds a source ZIP and publishes GitHub Release assets.
- The release deliberately omits `appsscript.json` and `.clasp.json`. The in-project updater preserves the actual target manifest and does not fabricate a Script ID.
- **CI:** run [45880750420](https://github.com/brusvv/dots_inventory-/actions/runs/45880750420) passed 9/9 manifest tests, Apps Script syntax 50/50 and all seven source regression suites 151/151. The PR quality-gates run [45880757060](https://github.com/brusvv/dots_inventory-/actions/runs/45880757060) also passed.
- PR #2: [D-01/D-02 release pipeline](https://github.com/brusvv/dots_inventory-/pull/2), Draft, based on `feature/clean-final-baseline`. No release tag has been created; publication awaits merge of the baseline into `main` and a deliberate version tag.
- **Status at this historical D-01/D-02 checkpoint:** D-03 through D-07 had not yet been implemented. Subsequent sections below record the later D-03/D-04, D-05 and D-06 implementation. D-07 live Apps Script runtime acceptance remains NOT RUN.
- No live Apps Script project, Google Sheet, RC8 workbook or deployment was modified. Replacing code through `projects.updateContent` remains a future operation and must preserve the target manifest and all explicitly unmanaged files because the API replaces the full project file set.


## GitHub deployment manager — D-03 / D-04 — 26.11.2026

**Source implementation complete; live authorization and Drive acceptance remain pending.**

- Added `43_DI3_GitHubDeploymentManager.gs` and the menu path **Система → GitHub и обновления**.
- D-03 checks the latest stable GitHub Release, verifies the detached manifest SHA-256, validates the manifest contract and immutable source URLs, then compares the published per-file SHA-256/byte sizes with current Apps Script `SERVER_JS` source via `projects.getContent`.
- Comparison reports new, changed and unchanged modules. Additional local `.gs` files and all non-`SERVER_JS` files are identified as preserved; the target `appsscript.json` must be present.
- GitHub release assets are fetched through the repository's API asset endpoint. Redirects are accepted only for GitHub-owned asset hosts; the optional GitHub token is not forwarded to the signed asset URL.
- D-04 reads the complete Apps Script project content, including the required actual `appsscript.json`, writes a JSON source snapshot into the existing Dots Inventory Drive backup folder and verifies the saved file after reading it back. The envelope and each file have SHA-256/byte-length checks.
- Uses least-privilege Apps Script API scope `script.projects.readonly` plus `script.external_request`; private GitHub repository access can use a fine-grained Contents: read token in Script Properties. No token is hard-coded.
- Added 11 deployment-manager unit tests covering manifest validation, safe redirect hosts, file comparison, manifest preservation and backup tamper detection.
- CI run [45882134713](https://github.com/brusvv/dots_inventory-/actions/runs/45882134713) passed: 51/51 Apps Script syntax files; 151/151 existing regression tests; 9/9 release-manifest tests; 11/11 deployment-manager tests.
- PR #3: [D-03/D-04 GitHub release check and source backup](https://github.com/brusvv/dots_inventory-/pull/3), Draft, based on PR #2's feature branch. PR #2 remains Draft; neither PR has been merged.
- **Status at this historical D-03/D-04 checkpoint:** D-05 was then staged as a read-only preview. The later sections below record the confirmed installer and D-06 rollback implementation. D-07 live runtime acceptance remains pending.
- No live Apps Script project, Google Sheet, RC8 workbook, source code, deployment or spreadsheet data was accessed or modified. Actual OAuth consent and Drive backup test must be performed separately in a disposable/test Apps Script project.


## 26.11.2026 — D-05 staged install preview

- Added a read-only GitHub install preview that downloads only full-commit-pinned release sources, disables redirects, and independently verifies byte length and SHA-256 before building the candidate project file set.
- Candidate composition preserves the target project's actual appsscript.json, all non-SERVER_JS files and all local SERVER_JS modules not present in the release. Existing release modules are replaced in place; new modules are appended; no file is deleted.
- The preview fails closed for incomplete project files, duplicate identities, missing manifest, missing/extra downloaded sources, hash/size mismatches and collisions with non-server file names.
- Menu: Система → GitHub и обновления → Предварительно собрать обновление (без установки).
- The candidate file set exists only in memory and is shown as a summary. No Apps Script project content, Drive file, deployment, spreadsheet, schema, FIFO or stock data is written or changed.
- CI [45882939657](https://github.com/brusvv/dots_inventory-/actions/runs/45882939657) passed: 52/52 syntax files, 151/151 existing regressions, 9/9 release-manifest tests, 16/16 deployment-manager tests (176/176 total).
- Added a separately confirmed installer: it requires an exact D-04 Drive backup, a YES/NO dialog, a final concurrency check, and post-write full-file verification. It calls projects.updateContent only after explicit YES. This code has not been run against a live Apps Script project.
- At this historical preview checkpoint, D-06 and D-07 were pending. D-06 was implemented in the subsequent section; D-07 remains NOT RUN. No live install has been performed.


## 26.11.2026 — D-05 confirmed installer implementation

- Added a separate menu command for installing the latest stable GitHub release.
- Before the write, the installer rebuilds the release preview, fingerprints the complete current project, creates a D-04 source backup, reads that Drive file back and verifies all checksums, Script ID and exact pre-install fingerprint.
- The user receives a YES/NO confirmation with the release tag/commit, full file counts, zero-deletion statement and verified backup link. NO cancels without changing project content.
- After YES, a last-moment read prevents overwriting project edits made while the dialog was open.
- Only then does the installer call projects.updateContent with the complete file set. It then reads the project back and compares every file name, type and exact source. Only an exact match is marked INSTALLED_AND_VERIFIED.
- A post-write mismatch is reported with the backup location; automatic rollback is deliberately not attempted. D-06 handles code rollback separately.
- Required additional target manifest scope: https://www.googleapis.com/auth/script.projects. This repository does not alter or synthesize the real appsscript.json.
- No deployment version is created or advanced. No setup, migration, FIFO rebuild or spreadsheet-data operation is invoked. No live installation has been performed.


## 26.11.2026 — D-06 verified code rollback

- Added an explicit menu rollback path that requires a Drive source-backup file ID.
- The selected backup must have the expected filename prefix, VERIFIED metadata, matching payload checksum, matching Script ID and membership in the configured Dots Inventory backup folder.
- The complete backup envelope and per-file checksums are revalidated before rollback preparation.
- The current target appsscript.json is preserved intentionally; rollback restores the other project files from the selected snapshot.
- A verified backup of the current project is created before the YES/NO confirmation. A final fingerprint check prevents overwriting edits made while the dialog is open.
- After explicit YES, the full project file set is restored with projects.updateContent and then read back for exact verification. No automatic rollback/retry is attempted on uncertain outcomes.
- Spreadsheet data, triggers, Script Properties, versioned deployments and deployment pointers are outside the source rollback.
- No live Apps Script project was accessed or modified.


## GitHub Preview release channels (2026-11-26)

Implemented on `feature/github-preview-releases`: Stable tags are restricted to commits reachable from `main`; Preview tags use `-preview.N`, carry an explicit `source-branch:` annotation, and publish as GitHub prereleases. Manifest pins channel, source branch and full commit SHA. Apps Script config selects `stable` (default) or `preview`; manager rejects cross-channel releases. No tag/release was created and no live Apps Script project or spreadsheet was modified. CI passed on PR #7 (run 45888826706): 13/13 manifest tests, 9/9 isolated Git tag-policy scenarios, 54/54 Apps Script syntax checks, 27/27 deployment-manager tests and all existing regression suites at that checkpoint. This is source CI only; no actual GitHub Release/tag was created and D-07 Apps Script/Drive runtime acceptance remains NOT RUN.


## 28.11.2026 — Release updater hardening and CI acceptance

- Updated the project timezone in `DI3_APP_CONFIG.TIME_ZONE` to the approved `Europe/Moscow`. The package workflow now targets `feature/github-preview-releases` and fails if the source config does not declare `Europe/Moscow`.
- Release-manifest generation now validates `DI3_APP_CONFIG.TIME_ZONE` as a real IANA timezone (using Node's timezone database) and rejects invalid identifiers before publishing.
- Fixed all Warehouse Dashboard test references to the current `di3BuildWarehouseValueChartDataV2_` helper.
- Added updater version `0.2.0` and strict numeric `MAJOR.MINOR.PATCH` comparison. The release manifest must declare a valid `minimum_updater_version`; older updaters reject releases requiring a newer updater.
- Tightened release validation to accept only exact Stable `dots-inventory-vX.Y.Z` tags and Preview `dots-inventory-vX.Y.Z-preview.N` tags from `feature/*`, `release/*` or `hotfix/*` branches. The manifest validator now independently enforces the same policy as the publishing workflow.
- Added read-only, fail-closed install compatibility checks: workbook `_AppMeta.schema_version`, installed `DI3_SCHEMA_VERSION` and release `target_schema_version` must match; configured timezone, actual target `appsscript.json.timeZone`, Apps Script runtime timezone, spreadsheet timezone and release timezone must all match.
- The compatibility gate runs during Preview and is repeated immediately before `projects.updateContent`. The updater does not migrate schema, modify timezone settings or rewrite existing dates/timestamps.
- CI workflow now runs the regression suites independently and aggregates failures instead of stopping at the first failing suite.
- Latest PR #7 CI run [46073271492](https://github.com/brusvv/dots_inventory-/actions/runs/46073222307) passed: Apps Script syntax 54/54 modules; release manifest 15/15; Stable/Preview tag policy 9/9; FIFO 46/46; Order Domain 22/22; Supply Workspace UX 17/17; Catalog/Order UX 14/14; System Safety UX 39/39; Warehouse Dashboard 9/9; Finance Schema 4/4; GitHub Deployment Manager 36/36. Deployment-manager coverage now includes direct integration tests for reading the actual Apps Script manifest and blocking missing/mismatched runtime timezone sources.
- The installation package workflow [46073271487](https://github.com/brusvv/dots_inventory-/actions/runs/46073222292) also passed on the PR. It uploaded artifact `DotsInventory-v4-installation` (410,768 bytes; SHA-256 `7082d8fd3427340501da34f7c307c43c76025f359fa87ba0050e5ffbf35faf21`). The artifact is a source package only, not a clasp project or runtime-tested installation.
- The eight source regression suites total 187/187 passing assertions. Manifest/tag-policy tests and syntax checks are additional checks, not included in that 183 total.
- PR #7 remains Draft and unmerged, targeting `feature/github-runtime-acceptance`. No release tag or GitHub Release was created.
- D-07 remains **BLOCKED / NOT RUN** until the release chain is reviewed/merged and an intentionally published release exists. Runtime acceptance must use a disposable restored spreadsheet and separate Apps Script Script ID.
- No production RC8 workbook, live Apps Script project, spreadsheet data, FIFO state, deployment or trigger was modified. No schema migration or stock operation was run.
