# D-09 — GitHub branch selector runtime acceptance

Статус: **NOT RUN**. Документ описывает runtime-проверку выбора ветки GitHub в отдельном Apps Script проекте. Успешные Node/CI тесты не являются доказательством работы Google Apps Script, Script Properties, Drive backup или Apps Script API.

## 1. Безопасная тестовая среда

- Использовать только disposable-копию Google Sheets, восстановленную из проверенной резервной копии.
- У копии должен быть отдельный Apps Script Script ID. Записать spreadsheet ID и Script ID в протокол.
- Не использовать RC8 production workbook, production Apps Script project или production deployment.
- Перед тестом зафиксировать project file inventory/fingerprint, фактический appsscript.json, scopes, triggers, deployments, Script Properties key names (без значений), schema version, timezone и контрольные агрегаты бизнес-таблиц.
- Проверить, что в тестовой таблице _AppMeta.schema_version, DI3_SCHEMA_VERSION и timezone согласованы с выбранной веткой. Для текущего Dots Inventory baseline ожидаются schema v4 и Europe/Moscow; фактические значения тестовой копии нужно прочитать, а не предполагать.
- Включить Apps Script API в связанном Google Cloud project и проверить scopes, необходимые для GitHub fetch, чтения/записи проекта и Drive backup. Сохранять все существующие scopes; не подменять фактический appsscript.json файлом из репозитория.

## 2. Однократный bootstrap updater

Выбор ветки доступен только после установки branch-selector-aware updater в тестовый Apps Script project.

1. В редакторе Apps Script тестового проекта вручную обновить модуль меню 22_DI3_MenuAndFilterUtils.gs (в нём зарегистрированы команды выбора/сброса ветки) и updater-модули 43_DI3_GitHubDeploymentManager.gs, 44_DI3_GitHubInstallPreview.gs, 45_DI3_GitHubConfirmedInstaller.gs и 46_DI3_GitHubCodeRollback.gs из одного и того же проверенного commit ветки feature/github-branch-selector.
2. Не заменять и не удалять фактический appsscript.json, HTML/JSON-файлы или другие локальные модули.
3. Сохранить проект, авторизовать требуемые scopes и перезагрузить связанную Google Sheet.
4. Убедиться, что в меню Система → GitHub и обновления появились команды выбора и сброса ветки.

Если bootstrap не завершился однозначно, остановиться и сравнить полный список файлов проекта. Не запускать установщик повторно вслепую.

## 3. Выбор и закрепление ветки

Селектор читает список GitHub branches постранично (до 1 000 веток); если репозиторий превышает этот предел, он должен остановиться, а не показать неполный список.

1. Открыть Система → GitHub и обновления → Выбрать ветку GitHub для обновления….
2. Выбрать ветку со слешем, например feature/github-branch-selector. Ввести точное имя из списка.
3. Записать выбранное имя и полный 40-символьный commit SHA из диалога.
4. Повторно открыть проверку источника. Убедиться, что источник обозначен как **BRANCH**, а не Stable или Preview, и commit SHA совпадает с записанным.
5. Выполнить read-only preview. Проверить, что все source URLs закреплены за тем же commit, Git tree прошёл preflight, файлы проверены по Git blob SHA-1, SHA-256 и размеру.
6. Проверить compatibility gate: схема таблицы, схема текущего кода, схема ветки, конфигурационный timezone, фактический manifest timezone, runtime timezone и timezone Google Sheets должны совпадать. При любом несовпадении установка должна блокироваться до Drive backup и project write.

Ожидаемый результат: ветка сохранена в Script Properties вместе с полным SHA; preview использует именно этот SHA. Выбор ветки не создаёт GitHub Release и не означает, что сама ветка прошла CI.

## 4. Проверка неизменности закреплённого commit

Проводить только на отдельной временной тестовой ветке, не переписывая рабочие ветки проекта.

1. Создать временную ветку с допустимым именем, например test/d09-pinning-20261128, и выбрать её в тестовом Apps Script project.
2. Записать commit SHA, сохранённый updater-ом.
3. Добавить новый безопасный документационный commit в эту временную ветку, чтобы её HEAD изменился.
4. Повторить read-only preview без повторного выбора ветки. Ожидается прежний SHA и прежний source snapshot.
5. Повторно выбрать ту же ветку. Ожидается новый SHA, совпадающий с её текущим HEAD.
6. Сбросить выбор ветки и убедиться, что updater возвращается к настроенному Stable/Preview channel.

После проверки удалить временную ветку можно только отдельным осознанным действием владельца; этот runbook не требует автоматического удаления.

## 5. Совместимость со старыми ветками

1. Выбрать ветку, которая заведомо предшествует branch-selector-aware updater.
2. Проверить preview: updater-модули 43–46 из текущего тестового проекта должны быть сохранены как локальные дополнительные файлы, а не заменены более старой реализацией.
3. Убедиться, что ветка с branch-selector-aware manager, но без полного согласованного набора модулей 43–46, блокируется до скачивания/установки неполного updater набора.
4. Проверить, что более старая версия updater не может заменить установленную более новую версию.

Негативный сценарий с неполным updater-набором можно считать покрытым unit regression test, если нет специально подготовленной изолированной тестовой ветки. Не портить рабочие ветки ради fault injection.

## 6. Preview, backup, install и read-back

1. Запустить read-only check и записать источник BRANCH, branch name, commit SHA, schema/timezone и diff.
2. Собрать preview и проверить количество добавленных/изменённых/неизменённых файлов, preserved local files и нулевое число удалений.
3. Запустить confirmed installer и выбрать NO. Сравнить полный project file inventory/fingerprint до и после. Исходники проекта не должны измениться; созданный и проверенный Drive backup допустим.
4. Повторить подготовку и confirmed install на disposable project, выбрать YES только после проверки branch/commit, состава файлов, compatibility gate и ссылки на VERIFIED backup.
5. Дождаться INSTALLED_AND_VERIFIED. Сравнить полный список файлов (name/type/source) с подготовленным preview.
6. Убедиться, что не менялись spreadsheet data, schema, FIFO, stock, triggers, versioned deployments и deployment pointers. Code installation не запускает setup, schema migration, FIFO rebuild или складские операции.
7. При отдельной проверке D-06 использовать только backup этого же Script ID и выполнить точную проверку rollback. Не смешивать проверку D-09 с восстановлением данных таблицы.


## 6A. Проверка создания, обновления и отмены (D-09 probe)

В релиз добавлен безопасный read-only файл `47_DI3_GitHubInstallLifecycleProbe.gs`. Он возвращает установленную ревизию и Script ID; сам ничего не записывает.

Проверка выполняется только в disposable Apps Script project:

1. Убедиться, что файла `47_DI3_GitHubInstallLifecycleProbe.gs` ещё нет. Сделать preview и выбрать YES. Ожидается `INSTALLED_AND_VERIFIED`; файл должен появиться. Запустить `di3RunGitHubInstallLifecycleProbe()`: ожидается `PROBE_OK`, ревизия `D09-PROBE-V1` и тот же тестовый Script ID.
2. В отдельном безопасном commit тестовой ветки изменить только константу `DI3_GITHUB_INSTALL_LIFECYCLE_PROBE_REVISION` на `D09-PROBE-V2`. Повторно выбрать эту ветку, выполнить preview и запустить установку, затем нажать NO. Ожидается `CANCELLED` и `write_performed: false`. Повторный запуск probe должен по-прежнему вернуть `D09-PROBE-V1`; fingerprint и исходник файла должны совпасть с состоянием до отмены.
3. Повторить preview для того же commit V2 и подтвердить YES. Ожидается `INSTALLED_AND_VERIFIED`; probe должен вернуть `D09-PROBE-V2`. Файл должен остаться единственным, без дублей.
4. Сохранить результаты трёх запусков, fingerprints до/после отмены и после подтверждённой установки.

Критерии: первый YES создаёт файл; NO не создаёт/не обновляет файлы и не меняет fingerprint; следующий YES обновляет существующий файл до V2. Не редактировать production и не использовать тестовый probe как механизм очистки.

## 7. Негативные сценарии

| ID | Сценарий | Ожидаемое поведение |
|---|---|---|
| D09-N01 | Ввести ветку, отсутствующую в списке GitHub | Отказ до сохранения выбора |
| D09-N02 | Небезопасное имя ветки (.., пустой сегмент, .hidden, .lock) | Fail closed |
| D09-N03 | В Script Properties есть branch, но отсутствует/повреждён commit SHA | Fail closed; предложить сбросить и выбрать ветку заново |
| D09-N04 | Git tree truncated, symlink/non-regular blob, дубликат имени или превышен лимит | Отказ до загрузки исходников |
| D09-N05 | Размер, Git blob SHA-1 или SHA-256 не совпадает | Отказ до preview/install |
| D09-N06 | Нет canonical schema/timezone declarations | Отказ до установки |
| D09-N07 | Schema/timezone compatibility mismatch | Отказ до Drive backup и project write |
| D09-N08 | Branch-selector-aware manager поставляется без полного набора модулей 43–46 | Отказ до установки |
| D09-N09 | Выбранная ветка продвинулась после выбора | Сохранённый snapshot остаётся на старом commit до повторного выбора |
| D09-N10 | Пользователь отменяет выбор или выбирает NO при установке | Project content не меняется |

## 8. Критерии завершения

D-09 runtime acceptance = PASS только после фактического выполнения на disposable project:
- выбор ветки со слешем и фиксация точного commit SHA;
- BRANCH preview и успешный compatibility gate;
- verified Drive source backup;
- NO без изменения project content;
- YES с точным post-write read-back;
- branch movement test (старый snapshot остаётся закреплённым; повторный выбор получает новый SHA);
- reset возвращает configured Stable/Preview channel;
- старые/неполные updater ветки обрабатываются fail-closed;
- spreadsheet data, schema, FIFO, stock, triggers и deployments остаются неизменными.

До этого статус D-09: **SOURCE/CI PASS; RUNTIME ACCEPTANCE NOT RUN**.

## 9. Журнал

Сохранять дату/время с timezone, spreadsheet ID, Script ID, branch, old/new commit SHA, execution IDs, backup file ID/URL/SHA-256, before/after project fingerprint, file counts, triggers/deployments inventory и ожидаемый/фактический результат. Не прикладывать OAuth token, GitHub token или Script Properties values.
