/**
 * Сбор постов из публичных каналов через веб-превью https://t.me/s/<канал>.
 * Бот и права администратора не нужны, доступна история канала.
 *
 * Состояние хранится в свойствах скрипта:
 *   LAST_ID_<канал>   - максимальный собранный message_id (движение вперёд)
 *   OLDEST_ID_<канал> - минимальный собранный message_id (докачка истории назад)
 */

var USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

/** Точка входа: собрать новые посты по всем каналам из конфига. */
function collectNewPosts() {
  var cfg = getConfig();
  requireChannels_(cfg);

  var sheet = getPostsSheet_(cfg);
  var keys = loadExistingKeys_(sheet);
  var report = [];

  cfg.CHANNEL_LIST.forEach(function (channel) {
    try {
      var posts = fetchNewPosts_(channel, cfg);
      var result = appendPosts_(sheet, posts, cfg, keys);
      report.push(channel + ': добавлено ' + result.added + ', пропущено дублей ' + result.skipped);
    } catch (error) {
      report.push(channel + ': ОШИБКА - ' + error.message);
      console.error(channel + ': ' + error.stack);
    }
  });

  var summary = report.join('\n');
  Logger.log(summary);
  return summary;
}

/** Точка входа: догрузить историю канала назад от самого старого собранного поста. */
function backfillHistory() {
  var cfg = getConfig();
  requireChannels_(cfg);

  var sheet = getPostsSheet_(cfg);
  var keys = loadExistingKeys_(sheet);
  var report = [];

  cfg.CHANNEL_LIST.forEach(function (channel) {
    try {
      var posts = fetchOlderPosts_(channel, cfg);
      var result = appendPosts_(sheet, posts, cfg, keys);
      var oldest = getState_('OLDEST_ID_' + channel);
      report.push(channel + ': добавлено ' + result.added +
        ', дошли до message_id ' + (oldest || '-'));
    } catch (error) {
      report.push(channel + ': ОШИБКА - ' + error.message);
      console.error(channel + ': ' + error.stack);
    }
  });

  var summary = report.join('\n');
  Logger.log(summary);
  return summary;
}

/**
 * Новые посты канала: идём от свежих к старым, пока не упрёмся в уже собранное.
 * На первом запуске берём только первую страницу и запоминаем границы.
 */
function fetchNewPosts_(channel, cfg) {
  var lastId = getState_('LAST_ID_' + channel) || 0;
  var firstRun = !lastId;

  var collected = [];
  var before = null;
  var pages = 0;
  var maxId = lastId;
  var minId = null;

  while (pages < cfg.MAX_PAGES) {
    var page = parseChannelPage_(fetchChannelHtml_(channel, { before: before }, cfg), channel);
    pages++;
    if (!page.posts.length) break;

    var reachedKnown = false;
    page.posts.forEach(function (post) {
      if (minId === null || post.messageId < minId) minId = post.messageId;
      if (post.messageId > maxId) maxId = post.messageId;
      if (post.messageId > lastId) {
        collected.push(post);
      } else {
        reachedKnown = true;
      }
    });

    if (firstRun || reachedKnown || collected.length >= cfg.MAX_POSTS_PER_RUN) break;
    var nextBefore = page.moreBefore || minId;
    if (!nextBefore || nextBefore <= 1) break;
    if (before !== null && nextBefore >= before) break; // страница не сдвинулась
    before = nextBefore;
  }

  if (maxId > lastId) setState_('LAST_ID_' + channel, maxId);
  var oldestKnown = getState_('OLDEST_ID_' + channel);
  if (minId !== null && (!oldestKnown || minId < oldestKnown)) {
    setState_('OLDEST_ID_' + channel, minId);
  }

  return collected.slice(0, cfg.MAX_POSTS_PER_RUN);
}

/** Догрузка истории: листаем назад от OLDEST_ID и двигаем эту границу. */
function fetchOlderPosts_(channel, cfg) {
  var oldest = getState_('OLDEST_ID_' + channel);
  var collected = [];
  var before = oldest || null;
  var pages = 0;

  while (pages < cfg.MAX_PAGES && collected.length < cfg.MAX_POSTS_PER_RUN) {
    var page = parseChannelPage_(fetchChannelHtml_(channel, { before: before }, cfg), channel);
    pages++;
    if (!page.posts.length) break;

    var minId = null;
    page.posts.forEach(function (post) {
      if (minId === null || post.messageId < minId) minId = post.messageId;
      if (!oldest || post.messageId < oldest) collected.push(post);
    });

    if (minId === null) break;
    if (!oldest || minId < oldest) {
      oldest = minId;
      setState_('OLDEST_ID_' + channel, oldest);
    }
    var next = page.moreBefore || minId;
    if (!next || next <= 1) break;
    if (before !== null && next >= before) break; // страница не сдвинулась
    before = next;
  }

  return collected;
}

/** Запрос страницы канала с повторами при сетевых сбоях. */
function fetchChannelHtml_(channel, params, cfg) {
  var url = 'https://t.me/s/' + encodeURIComponent(channel);
  if (params && params.before) url += '?before=' + params.before;
  else if (params && params.after) url += '?after=' + params.after;

  var attempts = 3;
  var lastError = null;

  for (var attempt = 0; attempt < attempts; attempt++) {
    var response = null;
    try {
      response = UrlFetchApp.fetch(url, {
        method: 'get',
        muteHttpExceptions: true,
        followRedirects: true,
        headers: {
          'User-Agent': USER_AGENT,
          'Accept-Language': 'ru,en;q=0.9'
        }
      });
    } catch (error) {
      lastError = error;
    }

    if (response) {
      var code = response.getResponseCode();
      if (code === 200) {
        var html = response.getContentText();
        if (html.indexOf('tgme_widget_message_wrap') === -1 &&
            html.indexOf('tgme_channel_history') === -1) {
          throw new Error('Канал @' + channel +
            ' недоступен для веб-превью (приватный, без постов или переименован).');
        }
        if (cfg.FETCH_DELAY_MS > 0) Utilities.sleep(cfg.FETCH_DELAY_MS);
        return html;
      }
      if (code === 404) throw new Error('Канал @' + channel + ' не найден (404).');
      lastError = new Error('t.me вернул HTTP ' + code + ' для ' + url);
    }

    Utilities.sleep(1000 * Math.pow(2, attempt));
  }

  throw lastError || new Error('Не удалось загрузить ' + url);
}

function requireChannels_(cfg) {
  if (!cfg.CHANNEL_LIST.length) {
    throw new Error('Не задан список каналов. Выполните setChannels("durov, telegram").');
  }
}

function getState_(key) {
  var value = PropertiesService.getScriptProperties().getProperty(key);
  return value ? Number(value) : 0;
}

function setState_(key, value) {
  PropertiesService.getScriptProperties().setProperty(key, String(value));
}

/** Сбрасывает прогресс сбора (посты в таблице остаются). */
function resetState() {
  var props = PropertiesService.getScriptProperties();
  var all = props.getProperties();
  var removed = 0;
  Object.keys(all).forEach(function (key) {
    if (key.indexOf('LAST_ID_') === 0 || key.indexOf('OLDEST_ID_') === 0 ||
        key === 'BOT_UPDATE_OFFSET') {
      props.deleteProperty(key);
      removed++;
    }
  });
  Logger.log('Сброшено ключей состояния: ' + removed);
  return removed;
}
