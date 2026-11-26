# D-07 — Apps Script runtime acceptance runbook

Дата подготовки: 26.11.2026

## Назначение и статус

Этот документ задаёт воспроизводимую процедуру runtime-приёмки D-03–D-06 на отдельном тестовом Apps Script проекте, привязанном к восстановленной копии Google Sheets.

**Статус: NOT RUN.** Это план проверки, а не доказательство успешной установки или отката. Node/CI-тесты не заменяют выполнение в Apps Script, Drive и Google Sheets.

На момент подготовки:
- PR #2–#5 остаются Draft и не слиты;
- в репозитории ещё нет опубликованного стабильного GitHub Release;
- следовательно, D-03/D-05 пока не могут пройти полный happy path через `/releases/latest`.

Не создавай релизный тег и не сливай PR в рамках этого runbook. Для появления стабильного релиза требуется отдельное решение о ревью и слиянии всей цепочки PR #2 → #3 → #4 → #5.

## 1. Обязательные условия

### 1.1 Изолированная среда

- Использовать отдельную disposable-копию Google Sheets, восстановленную через Restore-as-new.
- Проверить, что spreadsheet ID и bound Apps Script Script ID записаны в протоколе.
- Не использовать RC8 production workbook, рабочий Apps Script проект или production deployment.
- Перед тестом сохранить контрольные значения ключевых листов: `StockLedger`, `StockLots`, `StockAllocations`, `FifoProductState`, `Operations`, `V3_Orders`, `V3_Supplies`, `Settings`.
- Зафиксировать список installable triggers, deployments и Script Properties до начала.
- На тестовой копии не проводить реальные продажи, приёмки или складские операции.

### 1.2 Apps Script / Google Cloud

В связанном Google Cloud проекте включить Google Apps Script API.

В фактическом `appsscript.json` тестового проекта проверить наличие необходимых scopes, сохранив все существующие scopes:
- `https://www.googleapis.com/auth/script.projects.readonly` — чтение проекта (D-03/D-04);
- `https://www.googleapis.com/auth/script.projects` — запись проекта (D-05/D-06);
- `https://www.googleapis.com/auth/script.external_request` — GitHub и Apps Script API через UrlFetch;
- существующие Drive scopes, достаточные для создания, чтения и описания файлов в backup folder.

После изменения manifest повторно авторизовать тестовый проект. Не подменять фактический manifest манифестом из репозитория: репозиторий намеренно не содержит целевой `appsscript.json`.

Репозиторий публичный, поэтому `DI3_GITHUB_READ_TOKEN` не требуется. Если он станет приватным, использовать только fine-grained token с Contents: read и хранить его в Script Properties.

### 1.3 Релиз

До запуска happy path проверить наличие опубликованного стабильного релиза с корректным тегом `dots-inventory-vX.Y.Z`, release assets и manifest. Не использовать draft/prerelease. Manifest должен указывать полный commit SHA и target schema/timezone.

Если релиза нет, зафиксировать D-07 как BLOCKED: RELEASE_NOT_PUBLISHED. Не подменять release веткой или вручную созданным manifest.

## 2. Протокол исходного состояния

Перед первым запуском заполнить:
- дата/время и часовой пояс;
- spreadsheet ID;
- Apps Script Script ID;
- GitHub release tag и commit SHA;
- Apps Script manifest timezone и scopes;
- количество project files по типам;
- project fingerprint (если получен диагностикой);
- число и список triggers;
- список deployments и их version/deployment IDs;
- число листов и контрольные агрегаты ключевых таблиц;
- идентификатор папки Dots Inventory Backups.

Если любой из этих пунктов неизвестен, не переходить к записи проекта.

## 3. Последовательность happy path

### D-03 — read-only release check

1. Запустить меню `Система → GitHub и обновления → Проверить опубликованный релиз и сравнить код`.
2. Убедиться, что результат содержит ожидаемые release tag, commit, schema version и timezone.
3. Убедиться, что все опубликованные файлы сравнены с текущими SERVER_JS, а локальные дополнительные модули и non-server files показаны как сохраняемые.
4. Проверить `write_performed: false`.
5. Сверить project fingerprint, число файлов, deployments, triggers, Script Properties и контрольные агрегаты листов с исходным протоколом.

Ожидаемый результат: `UP_TO_DATE` или `UPDATE_AVAILABLE` в зависимости от версии тестового проекта; проект и таблица не изменены.

### D-04 — verified source backup

1. Запустить `Создать резервную копию кода Apps Script`.
2. Сохранить file ID, URL, размер, file count, Script ID и payload SHA-256.
3. Открыть файл в папке Dots Inventory Backups и убедиться, что он читается как JSON.
4. Проверить описание с маркером VERIFIED и совпадение Script ID / payload checksum.
5. Убедиться, что backup содержит фактический `appsscript.json` и все файлы проекта.
6. Повторно сравнить project fingerprint и контрольные агрегаты таблицы.

Ожидаемый результат: `VERIFIED`, backup прочитан обратно; project content и данные таблицы не изменились.

### D-05 — preview и отмена

1. Запустить `Предварительно собрать обновление (без установки)`.
2. Проверить release tag/commit, counts added/changed/unchanged/preserved и нулевое число удалений.
3. Проверить, что actual `appsscript.json`, все non-SERVER_JS файлы и локальные unmanaged SERVER_JS модули сохраняются.
4. Запустить confirmed installer, затем выбрать NO в диалоге подтверждения.
5. Сравнить fingerprint и полный список файлов с исходным состоянием. Убедиться, что проект не изменён.
6. Учесть, что проверенный source backup, созданный перед диалогом, может остаться в Drive даже после NO.

Ожидаемый результат: preview готов; отмена не меняет project content. Backup-файл, если создан, не считать изменением кода.

### D-05 — confirmed install на disposable-проекте

1. Перед установкой ещё раз проверить, что это тестовый Script ID.
2. Запустить confirmed installer и сверить release tag/commit, file counts, preserved files, нулевые удаления и ссылку на backup.
3. В отдельном диалоге подтвердить YES.
4. Дождаться результата `INSTALLED_AND_VERIFIED`.
5. Записать file ID и SHA-256 backup, созданного непосредственно перед установкой.
6. Получить project content повторно и проверить точное совпадение полного набора файлов (name/type/source) с целевым preview.
7. Убедиться, что deployments, deployment pointers, triggers, Script Properties кроме ожидаемых `DI3_INSTALLED_RELEASE_TAG` и `DI3_INSTALLED_RELEASE_COMMIT`, spreadsheet data, schema, FIFO и stock не изменились.

Ожидаемый результат: `INSTALLED_AND_VERIFIED`; это не означает, что была создана новая versioned deployment. D-05 не запускает setup, миграции или FIFO rebuild.

### D-06 — confirmed code rollback

1. Использовать file ID D-04/D-05 backup, созданного до установки и относящегося к тому же Script ID.
2. Запустить `Откатить код из резервной копии…`.
3. Проверить выбранный backup filename, дату, Script ID и число файлов.
4. Убедиться, что перед подтверждением создан и повторно проверен отдельный backup текущего (установленного) состояния.
5. Подтвердить YES.
6. Дождаться `ROLLED_BACK_AND_VERIFIED`.
7. Проверить точное совпадение восстановленных файлов с выбранным backup, кроме `appsscript.json`: он намеренно должен остаться текущим.
8. Убедиться, что `DI3_INSTALLED_RELEASE_TAG` и `DI3_INSTALLED_RELEASE_COMMIT` очищены.
9. Повторно сверить deployments, triggers, spreadsheet data, schema, FIFO, stock и прочие Script Properties.

Ожидаемый результат: исходники восстановлены и проверены; данные таблицы, триггеры, Script Properties (кроме двух release marker properties), versioned deployments и deployment pointers не откатываются.

## 4. Негативные и fault-injection сценарии

Каждый сценарий выполнять на отдельной disposable-копии или после восстановления известного baseline. Не повреждать единственную копию backup.

| ID | Сценарий | Ожидаемое поведение |
|---|---|---|
| D07-N01 | Нет опубликованного stable release | D-03/D-05 fail closed; никаких project writes |
| D07-N02 | Нет Apps Script API / read scope | D-03/D-04 завершаются ошибкой; проект не меняется |
| D07-N03 | Нет write scope | D-05/D-06 не должны получить подтверждённый success; проверить проект вручную, если ответ неоднозначен |
| D07-N04 | Неверный или несуществующий Drive file ID | D-06 прекращается до backup/confirmation/write |
| D07-N05 | Backup другого Script ID | D-06 отклоняет backup |
| D07-N06 | Backup без VERIFIED metadata / вне ожидаемой папки | D-06 отклоняет backup |
| D07-N07 | Изменён payload или file checksum | D-06 отклоняет backup |
| D07-N08 | Изменить файл проекта между preview и install confirmation | D-05 обнаруживает несовпадение fingerprint и отменяет установку |
| D07-N09 | Изменить файл проекта после открытия YES/NO диалога, но до YES | финальная проверка D-05/D-06 обнаруживает изменение и не пишет |
| D07-N10 | Потерять ответ updateContent / недоступно post-write чтение | возвращается неопределённый/непроверенный статус с backup link; не повторять операцию вслепую |
| D07-N11 | Выбрать NO в D-05 и D-06 | project content не меняется; возможные новые backup-файлы допустимы |
| D07-N12 | Добавить локальный unmanaged SERVER_JS и non-server file | preview/install сохраняют их; rollback возвращает набор backup |

Для проверки N08/N09 использовать две независимые вкладки редактора или контролируемую тестовую правку. Не создавать гонку на production проекте.

Не имитировать потерю ответа API на живом проекте без отдельного плана восстановления и проверенного backup.

## 5. Критерии PASS / FAIL

D-07 можно отметить PASS только если:
- D-03 release check завершился с корректным manifest и не менял проект;
- D-04 backup прошёл read-back и полную checksum verification;
- D-05 preview корректно сохраняет manifest и unmanaged files;
- D-05 NO оставляет project content неизменным;
- D-05 YES приводит к точному post-write совпадению всего file set;
- D-06 отклоняет недопустимые backup и точно восстанавливает допустимый backup;
- текущий manifest после rollback сохранён;
- все negative/fault-injection проверки завершились ожидаемым fail-closed результатом;
- deployments, triggers, spreadsheet data, schema, FIFO и stock не изменились;
- все неоднозначные результаты разобраны вручную и не повторялись вслепую.

Любое несовпадение file fingerprint, Script ID, backup checksum, stock/data aggregates или неожиданный deployment/trigger change — FAIL и остановка дальнейших тестов до расследования.

## 6. Журнал результатов

Для каждого запуска сохранять:
- ID сценария;
- timestamp с timezone;
- spreadsheet ID / Script ID;
- release tag / commit;
- Apps Script execution ID и статус;
- backup file ID / URL / SHA-256;
- before/after project fingerprint;
- before/after file count и типы;
- before/after triggers и deployments;
- before/after контрольные агрегаты листов;
- ожидаемый результат и фактический результат;
- ссылку на скриншот/лог без секретов.

Никогда не прикладывать OAuth token, GitHub token, Script Properties целиком или приватные данные покупателей.

## 7. Текущие блокеры

- PR #2–#5 должны пройти отдельное ревью и быть слиты в установленном порядке, прежде чем можно будет создать стабильный релиз. Слияние не входит в D-07 и требует отдельного решения владельца.
- Нужна disposable restored copy с отдельным Apps Script Script ID.
- Нужны подтверждённые OAuth scopes и включённый Apps Script API.
- Нужен фактический операторский запуск и фиксация доказательств.

До устранения этих блокеров статус D-07 остаётся **BLOCKED / NOT RUN**.
