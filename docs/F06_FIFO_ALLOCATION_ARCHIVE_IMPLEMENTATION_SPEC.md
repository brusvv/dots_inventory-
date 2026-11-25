# F-06 — FIFO allocation archive and crash-recovery implementation specification

Дата: 26.11.2026  
Статус: **source implementation pass; CI verified; Apps Script runtime acceptance pending**

## Source implementation progress — 26.11.2026

- Added clean-baseline schemas for `FifoAllocationArchive`, `FifoLotCacheArchive` and `FifoReplayEvents`, including both source and target lot-cache fingerprints.
- Extended `FifoAllocationRuns` with `operation_id`, parent `replay_id`, `scope_type`, `scope_json` and `input_fingerprint`.
- Passed the immutable `operation_id` from manual movement, supply receipt, order dispatch and order return handlers into `di3RebuildFifoAllocations_`.
- Added a SHA-256 fingerprint helper and persisted top-level run scope/input metadata. Added the archive tables to backup priority ordering.
- Verified the clean-baseline schema contract in the FIFO source test suite.

**Implemented in source:** deterministic allocation IDs for product/full replay; idempotent append-only allocation and lot-cache snapshots; PREPARED/COMMITTED/QUARANTINED event transitions; stable per-product replay IDs; pending run reuse; manual product-set run reuse by exact scope and input fingerprint; source restoration when active projection is neither source nor target; recovery before tail processing; read-only archive/event integrity diagnostics; backup full-hash priority for all FIFO archive tables; rollback tests for failures during allocation and lot-cache writes; and a mutation gate while FIFO runs remain unresolved. Archive snapshots are written before active projection replacement.

**Source verification:** Latest GitHub Actions run `45721449653` passed syntax checks for 50 `.gs` files and all seven Node suites (118/118: FIFO 41, Order Domain 17, Supply Workspace UX 15, Catalog/Order UX 12, System Safety UX 20, Warehouse Dashboard 9, Finance Schema 4). This validates the source/test harness only; Apps Script runtime fault-injection at every write boundary, full backup/restore acceptance and operator quarantine-resolution UX remain pending.
## 1. Цель и границы

F-06 должен сохранять каждую вытесненную версию активных FIFO-распределений и обеспечивать восстановление после остановки Apps Script между отдельными записями Google Sheets.

Контракт:
- `StockAllocations` остаётся единственной активной проекцией распределений.
- Архивные версии никогда не участвуют в расчёте остатков, возвратов, COGS, прибыли и Finance.
- `StockLedger` остаётся источником складских событий; порядок FIFO остаётся `effective_at`, `recorded_at`, `movement_id`.
- Архив append-only: уже записанные архивные строки и события не обновляются и не удаляются.
- Восстановление должно быть идемпотентным и привязанным к тому же replay identity, а не создавать новый run при каждой повторной попытке.

F-06 реализуется после F-07: sequence watermark даёт устойчивую идентичность входного ledger-среза и снимает зависимость recovery от физического номера строки.

## 2. Начальное состояние исходников до реализации F-06

На момент исходного аудита (до F-06 source patch) были проверены файлы `main`:
- `src/apps_script/24_DI3_IncrementalFifo.gs`
- `src/apps_script/27_DI3_OperationExecutor.gs`
- `src/apps_script/00_DI3_SchemaRegistry.gs`
- `src/apps_script/07_DI3_StockCore.gs`
- `src/apps_script/12_DI3_SupplyReceiving.gs`
- `src/apps_script/16_DI3_OrderWorkflow.gs`

### 2.1 Текущие таблицы

`StockAllocations` содержит 14 полей:
`allocation_id, allocation_run_id, movement_id, lot_id, product_id, allocation_type, quantity, unit_cost, cost_status, allocated_cost, effective_at, recorded_at, reverses_allocation_id, allocated_cost_minor`.

Исходная `FifoAllocationRuns` содержала 10 полей:
`run_id, run_sequence, status, reason, created_at, committed_at, ledger_rows_count, allocation_rows_count, products_count, error`.

`FifoProductState` содержит физический `last_ledger_row_number`; его замена sequence watermark относится к F-07.

Отдельной таблицы истории allocation snapshots сейчас нет.

### 2.2 Исходная замена проекции до F-06

`di3ReplaceFifoProjectionSafely_`:
1. читает текущие активные строки в память;
2. удаляет выбранные строки из `StockAllocations`;
3. добавляет новые строки;
4. обновляет `StockLots.remaining_quantity`;
5. при пойманной ошибке пытается восстановить старые allocations и lot cache.

Это rollback на уровне обработанной ошибки, но не транзакция. Принудительное завершение выполнения между операциями не запускает catch и может оставить частичную проекцию.

### 2.3 Исходный lifecycle run до F-06

`di3RebuildFifoAllocations_` создаёт новый `FifoAllocationRuns` со статусом `PREPARED`, затем меняет проекции, обновляет product state, cursor и order FIFO snapshots, после чего ставит `COMMITTED`. При пойманной ошибке run помечается `FAILED`.

При жёстком завершении запись могла остаться `PREPARED`. До F-06 patch повторный вызов создавал новый run ID; это устраняется текущим pending-run reuse.

### 2.4 Исходные вызовы из операций до передачи operation_id

FIFO rebuild вызывается из четырёх operation handlers:
- `MANUAL_STOCK_MOVEMENT` — `07_DI3_StockCore.gs`;
- `SUPPLY_RECEIVE` — `12_DI3_SupplyReceiving.gs`;
- `ORDER_DISPATCH` — `16_DI3_OrderWorkflow.gs`;
- `ORDER_RETURN` — `16_DI3_OrderWorkflow.gs`.

Все эти handlers получают `operationRecord` и могут передать неизменяемый `operation_id` в FIFO replay. Operation executor повторно вызывает handler с тем же immutable payload. Это позволяет связать FIFO run/replay с исходной операцией. Отдельный ручной full rebuild не имеет operation_id и должен восстанавливаться через незавершённый run ID.

### 2.5 Генерация allocation IDs до F-06

До F-06 patch `di3BuildFifoAllocationRows_` генерировал UUID для каждой строки. Сейчас replay-путь передаёт replay_id и создаёт детерминированные allocation IDs; обычный incremental append по-прежнему использует UUID.

## 3. Целевая схема baseline

Добавить таблицы непосредственно в чистый baseline schema. Не строить отдельную production migration для старой таблицы, если production workbook создаётся заново.

### 3.1 FifoAllocationArchive

Одна строка на одну вытесненную allocation snapshot. Рекомендуемые поля:

| Поле | Назначение |
|---|---|
| archive_row_id | Детерминированный уникальный ID: replay_id + source_allocation_id |
| replay_id | Идентификатор replay, который вытеснил исходную строку |
| archived_at | Время записи snapshot |
| archive_reason | Причина replay |
| source_allocation_id | Исходный allocation_id |
| source_allocation_run_id | Исходный allocation_run_id |
| movement_id | Складское движение |
| lot_id | FIFO-партия |
| product_id | Товар |
| allocation_type | Тип распределения |
| quantity | Количество |
| unit_cost | Цена единицы |
| cost_status | Статус себестоимости |
| allocated_cost | Денежная сумма |
| effective_at | Бизнес-время |
| recorded_at | Время регистрации |
| reverses_allocation_id | Ссылка на обратное распределение |
| allocated_cost_minor | Сумма в minor units |

Архив хранит исходные значения без округления или пересчёта. Поля должны соответствовать точной ширине активной allocation schema плюс provenance.

### 3.2 FifoReplayEvents

Append-only lifecycle log. Рекомендуемые поля:

| Поле | Назначение |
|---|---|
| replay_event_id | Уникальный event ID |
| replay_id | Стабильная идентичность replay |
| event_sequence | Монотонный порядковый номер события внутри replay |
| event_type | PREPARED / COMMITTED / QUARANTINED (ABORTED reserved, not currently used) |
| fifo_run_id | Run, выполняющий replay |
| operation_id | Исходная операция или пусто для ручного rebuild |
| scope_type | PRODUCT или FULL |
| scope_json | Один product_id для PRODUCT либо FULL |
| input_fingerprint | Fingerprint ledger/lot/detail входа |
| source_allocations_fingerprint | Fingerprint вытесняемого active snapshot |
| target_allocations_fingerprint | Fingerprint детерминированной новой проекции |
| source_lot_cache_fingerprint | Fingerprint исходных remaining_quantity для затронутых lot IDs |
| target_lot_cache_fingerprint | Fingerprint целевых remaining_quantity после replay |
| created_at | Время события |
| details_json | Ограниченные диагностические сведения |

Каждый lifecycle transition — новая строка. Запрещено обновлять PREPARED в COMMITTED на месте.

### 3.3 FifoLotCacheArchive

Нужно сохранить точный прежний `StockLots.remaining_quantity`, потому что это изменяемая часть проекции и она не восстанавливается только из allocation archive во всех промежуточных состояниях.

Рекомендуемые поля:
`archive_row_id, replay_id, lot_id, product_id, previous_remaining_quantity, archived_at`.

Архивируются только lot IDs, попадающие в scope replay. Полные строки StockLots не копировать: остальные поля — исходные данные партии, не часть FIFO projection.

### 3.4 Расширение FifoAllocationRuns

В baseline добавить как минимум:
- `operation_id` (nullable для ручного full rebuild);
- `replay_id`;
- `scope_type`;
- `scope_json`;
- `input_fingerprint`.

Run row остаётся диагностической записью исполнения. Для совместимости текущая изменяемая status-проекция может сохраняться, но авторитетное состояние replay определяется последним событием в `FifoReplayEvents`. Архивные таблицы остаются неизменяемыми.

## 4. Стабильная идентичность replay

### 4.1 Operation-backed replay

Для четырёх operation handlers передавать `operation_id` в `di3RebuildFifoAllocations_`.

Текущий control flow обрабатывает затронутые товары независимо: часть товаров может пройти incremental append, а часть — `PRODUCT_REPLAY_REQUIRED` и полную замену активной проекции. Поэтому одна складская операция может породить несколько независимых product replay.

Идентичность каждого product replay определяется:
- исходным `operation_id`;
- одним `product_id` в scope;
- типом `PRODUCT`;
- fingerprint полной истории ledger/details/immutable lot inputs этого товара после F-07.

Канонический ID: `OP:<operation_id>:PRODUCT:<product_id>`. Повтор той же операции с тем же товаром и fingerprint должен найти существующий PREPARED replay и продолжить его. Другой fingerprint для уже зарегистрированного replay ID — fail closed.

Incremental-путь, который только добавляет новые allocations и не заменяет старую проекцию, не создаёт archive replay event. Archive протокол применяется к каждому товару, для которого реально выполняется product replay.

### 4.2 Full replay

Full replay имеет scope `FULL` и один replay ID на весь ledger replay. Для ручного/системного запуска без operation ID канонический ID: `FULL:<fifo_run_id>`. Run row должен быть записан до archive snapshots и сохранять этот ID. При повторном запуске сначала ищется незавершённый full replay; новый run поверх него не создаётся.

Для operation-backed full replay (если такой путь появится) ID должен быть `OP:<operation_id>:FULL`.

### 4.3 Run identity и повторное использование

Один `FifoAllocationRuns` row представляет верхнеуровневый вызов FIFO и может содержать несколько product replay events. Для operation-backed вызова parent replay ID — `OP:<operation_id>`; для full replay — `FULL:<fifo_run_id>`. `FifoReplayEvents.replay_id` — дочерняя идентичность конкретного product replay либо full replay.

Если PREPARED event уже существует, recovery повторно использует его `fifo_run_id` и соответствующий run row. Если run row был помечен FAILED после пойманной ошибки, его можно вернуть в PREPARED только после проверки последнего lifecycle event и input fingerprint. Нельзя создавать новый run ID для продолжения уже начатого replay.

### 4.4 Стабильные allocation IDs

Новая allocation строка получает детерминированный ID, вычисленный из:
- replay_id;
- стабильного ordinal allocation в детерминированном FIFO plan.

Не использовать физический номер строки или случайный UUID. Повторная сборка одинакового replay должна выдавать идентичные строки и одинаковый target fingerprint.

## 5. Протокол записи и восстановления

Все шаги выполняются внутри существующего ScriptLock-контекста. Вложенный вызов `di3WithLock_` не должен пытаться повторно захватить lock.

### Шаг 0 — подготовка и проверка

1. Проверить отсутствие другого незавершённого FIFO replay.
2. Зафиксировать replay_id, operation_id, scope и входной fingerprint.
3. Сформировать полный целевой набор allocations и новые lot remaining values до первой мутации.
4. Проверить отсутствие отрицательных остатков и соответствие количества/стоимости replay plan.
5. Прочитать точный source snapshot текущих active allocations и remaining_quantity затронутых lots.
6. Вычислить source и target fingerprints.

Если preflight не прошёл, никаких archive/projection writes не выполнять.

### Шаг 1 — durable PREPARED snapshot

1. Append все исходные allocation snapshots в `FifoAllocationArchive`.
2. Append lot cache snapshots в `FifoLotCacheArchive`.
3. Для каждой archive row использовать детерминированный archive_row_id.
4. Если часть archive rows уже записана, повторная попытка проверяет содержимое по ID и добавляет только отсутствующие строки. Несовпадение существующей строки — integrity error.
5. После проверки полноты snapshots append событие PREPARED в `FifoReplayEvents`.

Важно: если выполнение оборвалось до PREPARED event, orphan snapshot rows безопасны и остаются неактивными. Повторная попытка того же replay достраивает snapshots и только затем фиксирует PREPARED.

### Шаг 2 — заменить active projection

1. Удалить из `StockAllocations` только строки в scope.
2. Записать детерминированные целевые строки.
3. Обновить remaining_quantity только для затронутых lot IDs.
4. Проверить source/target fingerprints и ожидаемое количество строк.
5. Не изменять allocations и lots вне scope.

Для product replay scope охватывает только один product_id и его lots. Для full replay scope охватывает всю активную таблицу и все lots, включённые в полный replay.

### Шаг 3 — завершить связанные проекции

1. Upsert FifoProductState с sequence watermarks (F-07).
2. Обновить затронутые order FIFO snapshots.
3. Обновить global FIFO cursor только после успешной обработки всего scope.
4. Повторно проверить active allocation и lot-cache fingerprints.

### Шаг 4 — COMMITTED

После завершения всех product states, order snapshots и global cursor append COMMITTED event для каждого PREPARED replay в этом верхнеуровневом run. Только после этого run можно считать завершённым.

### Recovery

Recovery должен запускаться до обработки нового ledger tail и до фильтрации по product state watermark. Это обязательно: product state или global cursor могли успеть обновиться перед принудительным завершением, и обычный tail reader уже не выберет replayваемые строки. Для последнего lifecycle event каждого replay:

- **Нет PREPARED, есть только частичные archive snapshots:** проверить replay identity и source snapshot; достроить недостающие архивные строки, затем PREPARED.
- **PREPARED + active allocation и lot-cache fingerprints равны source fingerprints:** проекция ещё старая; безопасно повторить замену.
- **PREPARED + active allocation и lot-cache fingerprints равны target fingerprints:** проекция уже записана; не заменять повторно, завершить state/cursor/order snapshots и append COMMITTED.
- **PREPARED + active projection fingerprint не равен ни source, ни target:** не пытаться угадать состояние; восстановить source projection из архива и lot cache, затем повторить только если input fingerprint всё ещё совпадает. Если безопасное восстановление не проходит — QUARANTINED.
- **COMMITTED:** no-op.
- **ABORTED:** no-op для автоматического recovery; новый replay требует новой явной операции.
- **QUARANTINED:** блокирует новые stock mutations до ручной сверки.

При recovery сначала проверить, что входной ledger fingerprint не изменился относительно PREPARED. Новые складские операции должны оставаться заблокированными, пока существует незавершённый replay.

## 6. Критические инварианты

1. В каждый момент после завершения операции active `StockAllocations` содержит ровно одну текущую версию для каждого активного allocation факта.
2. Archive никогда не читается функциями valuation/returns/finance как active rows.
3. Для replay_id + source_allocation_id существует не более одной archive snapshot.
4. PREPARED фиксируется только после полной записи и проверки source snapshots.
5. COMMITTED фиксируется только после проверки target projection, lot caches, product states, cursor и order snapshots.
6. Нельзя сдвигать global cursor раньше завершения всех продуктов replay.
7. Повторный запуск с тем же replay_id создаёт те же allocation IDs и те же target rows.
8. Архив не удаляется и не переписывается обычной работой, setup, restore или rebuild.
9. Ошибка сверки ведёт к fail-closed/quarantine, а не к автоматическому выбору одной из двух версий.
10. FIFO business ordering не зависит от ledger_sequence и остаётся `effective_at`, `recorded_at`, `movement_id`.

## 7. Fault-injection и regression matrix

Добавить source tests для каждого прерывания и сверки:

| Тест | Точка сбоя / условие | Ожидаемый результат |
|---|---|---|
| F06-01 | До записи archive snapshots | Active projection без изменений |
| F06-02 | После части allocation archive rows | Повтор достраивает недостающие строки без дублей |
| F06-03 | После archive snapshots, до PREPARED | Повтор проверяет snapshot и пишет PREPARED |
| F06-04 | После PREPARED, до удаления active rows | Recovery повторяет replace |
| F06-05 | После удаления active rows | Recovery видит neither source nor target, восстанавливает source из архива |
| F06-06 | После частичного append target rows | Recovery восстанавливает source и повторяет детерминированную замену |
| F06-07 | После target rows, до lot cache | Recovery определяет неполный target и безопасно завершает/восстанавливает |
| F06-08 | После lot cache, до product state | Recovery завершает product state |
| F06-09 | После product state, до global cursor | Recovery не дублирует allocations и завершает cursor |
| F06-10 | После cursor, до COMMITTED | Recovery проверяет target и append COMMITTED |
| F06-11 | Повтор recovery того же operation_id | Тот же replay_id, без дублей |
| F06-12 | Тот же operation_id с другим scope/fingerprint | Fail closed |
| F06-13 | Изменённая active projection не равна source/target | Quarantine, не угадывать |
| F06-14 | Product replay | Архивирует только allocations и lots затронутого товара |
| F06-15 | Full replay | Архивирует весь предыдущий active projection ровно один раз |
| F06-16 | Архивная строка попадает в valuation/return/finance reader | Тест должен падать; архив исключён из active aggregation |
| F06-17 | Return после последующего replay | Возврат использует текущие active allocation links и не читает архив как активные |
| F06-18 | Два одновременных stock operations | ScriptLock сериализует replay, второй не начинает мутации до завершения первого |
| F06-19 | Incremental vs full replay | Совпадают allocations, remaining lots, movement costs и order snapshots |
| F06-20 | Детерминированная повторная сборка | Одинаковые replay input дают byte-equivalent target rows и fingerprints |

Runtime acceptance проводить на disposable empty workbook после завершения F-07 и clean baseline. Включить принудительное завершение execution между каждым write boundary, а не только искусственные throw внутри catch.

## 8. Порядок реализации

1. Завершить F-07 stable ledger sequence и sequence-based recovery.
2. Добавить baseline schemas: FifoAllocationArchive, FifoLotCacheArchive, FifoReplayEvents; расширить FifoAllocationRuns.
3. Добавить canonical scope/input fingerprint и stable replay identity.
4. Передать operation_id из четырёх stock handlers.
5. Сделать детерминированные allocation IDs.
6. Реализовать archive snapshots + append-only replay lifecycle events.
7. Реализовать recovery state machine и fail-closed quarantine.
8. Добавить source tests и fault-injection harness.
9. Провести setup-twice, backup/restore-as-new и crash-recovery acceptance на пустой тестовой таблице.
10. Только после этого заморозить clean baseline schema version.

## 9. Не входит в F-06

- Backfill старой истории allocation из существующего workbook — production планируется создавать с нуля.
- Retention/compaction/deletion архивов.
- Изменение FIFO порядка, правил стоимости, возвратов или комиссии.
- Разрешение отрицательных остатков.
- Одновременная реализация F-02 исторических продаж или RC9 частичных возвратов.

## 10. Ограничения текущего этапа

Этот документ фиксирует архитектуру по текущему исходному коду. Код приложения, таблицы Google Sheets, схема установленной таблицы и данные не изменялись. Source tests и runtime fault-injection не запускались. Реализация F-06 не считается завершённой.
