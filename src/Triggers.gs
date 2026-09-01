/**
 * Меню в таблице и триггеры по времени.
 */

var COLLECT_TRIGGER_FUNCTION = 'collectNewPosts';

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Telegram')
    .addItem('Задать каналы…', 'promptChannels')
    .addItem('Собрать новые посты', 'collectNewPosts')
    .addItem('Догрузить историю', 'backfillHistory')
    .addSeparator()
    .addItem('Собрать через бота', 'collectViaBot')
    .addSeparator()
    .addItem('Автосбор каждые 15 минут', 'installTrigger')
    .addItem('Выключить автосбор', 'removeTriggers')
    .addItem('Показать настройки', 'showConfig')
    .addToUi();
}

/** Спрашивает список каналов и сохраняет его в свойства скрипта. */
function promptChannels() {
  var ui = SpreadsheetApp.getUi();
  var current = getConfig().CHANNELS || '';
  var response = ui.prompt(
    'Каналы Telegram',
    'Через запятую, например: durov, meduzalive\nСейчас: ' + (current || '(не задано)'),
    ui.ButtonSet.OK_CANCEL
  );
  if (response.getSelectedButton() !== ui.Button.OK) return;

  var value = response.getResponseText().trim();
  setConfigValue('CHANNELS', value);
  var parsed = getConfig().CHANNEL_LIST;
  ui.alert(parsed.length
    ? 'Сохранено каналов: ' + parsed.length + '\n' + parsed.join(', ')
    : 'Список каналов очищен.');
}

/**
 * Ставит триггер сбора каждые N минут.
 * Apps Script допускает только 1, 5, 10, 15 или 30 минут.
 */
var ALLOWED_TRIGGER_MINUTES = [1, 5, 10, 15, 30];

function installTrigger(minutes) {
  var interval = minutes || 15;
  if (ALLOWED_TRIGGER_MINUTES.indexOf(interval) === -1) {
    throw new Error('Интервал должен быть одним из: ' + ALLOWED_TRIGGER_MINUTES.join(', ') + ' мин.');
  }
  removeTriggers();
  ScriptApp.newTrigger(COLLECT_TRIGGER_FUNCTION)
    .timeBased()
    .everyMinutes(interval)
    .create();
  Logger.log('Триггер установлен: ' + COLLECT_TRIGGER_FUNCTION + ' каждые ' + interval + ' мин.');
  return interval;
}

/** Ставит ежедневный триггер догрузки истории. */
function installBackfillTrigger(hour) {
  ScriptApp.newTrigger('backfillHistory')
    .timeBased()
    .everyDays(1)
    .atHour(hour === undefined ? 4 : hour)
    .create();
  Logger.log('Триггер догрузки истории установлен.');
}

/** Удаляет все триггеры этого проекта. */
function removeTriggers() {
  var triggers = ScriptApp.getProjectTriggers();
  triggers.forEach(function (trigger) {
    ScriptApp.deleteTrigger(trigger);
  });
  Logger.log('Удалено триггеров: ' + triggers.length);
  return triggers.length;
}
