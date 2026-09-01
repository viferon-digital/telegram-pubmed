/**
 * Приём постов вебхуком (веб-приложение Apps Script).
 * Даёт запись в реальном времени, но требует деплоя как Web App
 * с доступом «Все, включая анонимных пользователей».
 *
 * Apps Script не отдаёт HTTP-заголовки в doPost, поэтому секретный токен
 * передаём в query-строке URL вебхука: .../exec?s=<WEBHOOK_SECRET>.
 */

function doPost(e) {
  var cfg = getConfig();
  try {
    if (cfg.WEBHOOK_SECRET) {
      var provided = e && e.parameter ? e.parameter.s : '';
      if (provided !== cfg.WEBHOOK_SECRET) {
        return jsonResponse_({ ok: false, error: 'forbidden' });
      }
    }

    var update = JSON.parse(e.postData.contents);
    var post = updateToPost_(update, cfg);
    if (!post) return jsonResponse_({ ok: true, skipped: true });

    var lock = LockService.getScriptLock();
    lock.waitLock(20000);
    try {
      var sheet = getPostsSheet_(cfg);
      var result = appendPosts_(sheet, [post], cfg);
      return jsonResponse_({ ok: true, added: result.added });
    } finally {
      lock.releaseLock();
    }
  } catch (error) {
    console.error(error.stack);
    return jsonResponse_({ ok: false, error: String(error.message) });
  }
}

function doGet() {
  return jsonResponse_({ ok: true, service: 'telegram-posts-collector' });
}

function jsonResponse_(payload) {
  return ContentService.createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * Регистрирует вебхук на URL текущего веб-приложения.
 * Запускать после деплоя (Deploy -> New deployment -> Web app).
 */
function setWebhook() {
  var cfg = getConfig();
  if (!cfg.BOT_TOKEN) throw new Error('Не задан BOT_TOKEN.');

  var secret = cfg.WEBHOOK_SECRET;
  if (!secret) {
    secret = Utilities.getUuid();
    setConfigValue('WEBHOOK_SECRET', secret);
  }

  var url = ScriptApp.getService().getUrl();
  if (!url) {
    throw new Error('Веб-приложение не задеплоено: Deploy -> New deployment -> Web app.');
  }

  var result = callBotApi_(cfg, 'setWebhook', {
    url: url + '?s=' + encodeURIComponent(secret),
    allowed_updates: JSON.stringify(['channel_post', 'edited_channel_post', 'message']),
    drop_pending_updates: 'false'
  });
  Logger.log('Вебхук установлен: ' + result);
  return result;
}

/** Снимает вебхук (нужно, чтобы снова работал getUpdates). */
function deleteWebhook() {
  var cfg = getConfig();
  if (!cfg.BOT_TOKEN) throw new Error('Не задан BOT_TOKEN.');
  var result = callBotApi_(cfg, 'deleteWebhook', {});
  Logger.log('Вебхук снят: ' + result);
  return result;
}

/** Диагностика: что Telegram думает о текущем вебхуке. */
function getWebhookInfo() {
  var cfg = getConfig();
  if (!cfg.BOT_TOKEN) throw new Error('Не задан BOT_TOKEN.');
  var info = callBotApi_(cfg, 'getWebhookInfo', {});
  Logger.log(JSON.stringify(info, null, 2));
  return info;
}
