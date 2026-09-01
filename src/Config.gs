/**
 * Настройки скрипта.
 *
 * Значения по умолчанию можно переопределить в Свойствах скрипта
 * (Project Settings -> Script Properties) или функциями-хелперами ниже.
 * Токен бота держим только в свойствах скрипта, в коде его быть не должно.
 */

var CONFIG_DEFAULTS = {
  // Список каналов через запятую: 'durov, telegram' или 'https://t.me/durov'
  CHANNELS: '',
  // Имя листа, куда складываем посты
  SHEET_NAME: 'posts',
  // ID таблицы. Пусто = активная таблица (скрипт привязан к таблице)
  SPREADSHEET_ID: '',
  // Сколько страниц t.me пролистывать за один запуск (1 страница ~ 16-20 постов)
  MAX_PAGES: 5,
  // Предохранитель по количеству постов за запуск
  MAX_POSTS_PER_RUN: 300,
  // Пауза между запросами к t.me, мс (чтобы не ловить троттлинг)
  FETCH_DELAY_MS: 700,
  // 'yes' - сохранять исходный JSON апдейта Bot API в колонку raw
  STORE_RAW: 'no',
  // Токен бота для режима Bot API (если используется)
  BOT_TOKEN: '',
  // Секрет для вебхука: он же ?s=... в URL вебхука
  WEBHOOK_SECRET: ''
};

var CONFIG_NUMERIC_KEYS = ['MAX_PAGES', 'MAX_POSTS_PER_RUN', 'FETCH_DELAY_MS'];

/** Собирает итоговый конфиг: свойства скрипта поверх значений по умолчанию. */
function getConfig() {
  var props = PropertiesService.getScriptProperties().getProperties();
  var cfg = {};
  Object.keys(CONFIG_DEFAULTS).forEach(function (key) {
    var raw = props[key];
    var value = (raw === undefined || raw === '') ? CONFIG_DEFAULTS[key] : raw;
    cfg[key] = CONFIG_NUMERIC_KEYS.indexOf(key) > -1 ? Number(value) : value;
  });
  cfg.CHANNEL_LIST = parseChannelList_(cfg.CHANNELS);
  cfg.STORE_RAW = String(cfg.STORE_RAW).toLowerCase() === 'yes';
  return cfg;
}

/**
 * Приводит произвольную строку со списком каналов к массиву username-ов.
 * Понимает '@durov', 'https://t.me/durov', 'https://t.me/s/durov'.
 */
function parseChannelList_(value) {
  if (!value) return [];
  return String(value)
    .split(/[,;\n\r\t ]+/)
    .map(function (item) { return normalizeChannel_(item); })
    .filter(function (item) { return !!item; });
}

function normalizeChannel_(value) {
  var name = String(value || '').trim();
  if (!name) return '';
  name = name.replace(/^https?:\/\//i, '').replace(/^t\.me\//i, '').replace(/^s\//i, '');
  name = name.replace(/^@/, '');
  name = name.split(/[/?#]/)[0];
  return name.trim();
}

/** Записывает значение в свойства скрипта. */
function setConfigValue(key, value) {
  if (!(key in CONFIG_DEFAULTS)) {
    throw new Error('Неизвестный параметр конфигурации: ' + key);
  }
  PropertiesService.getScriptProperties().setProperty(key, String(value));
  return getConfig()[key];
}

/** Хелпер: задать список каналов. Запустить один раз из редактора. */
function setChannels(channels) {
  return setConfigValue('CHANNELS', channels || 'durov');
}

/** Хелпер: задать токен бота (режим Bot API). */
function setBotToken(token) {
  return setConfigValue('BOT_TOKEN', token || '');
}

/** Печатает текущий конфиг в лог (токен маскируется). */
function showConfig() {
  var cfg = getConfig();
  var safe = {};
  Object.keys(cfg).forEach(function (key) {
    safe[key] = (key === 'BOT_TOKEN' || key === 'WEBHOOK_SECRET')
      ? (cfg[key] ? '***установлен***' : '(пусто)')
      : cfg[key];
  });
  Logger.log(JSON.stringify(safe, null, 2));
  return safe;
}
