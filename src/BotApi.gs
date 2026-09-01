/**
 * Режим Bot API: бот добавлен администратором в канал и получает посты.
 * Даёт полные метаданные (file_id, entities, авторство), но только новые
 * посты с момента добавления бота — истории у Bot API нет.
 *
 * Опрос через getUpdates и вебхук взаимно исключают друг друга:
 * если задан вебхук, getUpdates будет возвращать ошибку 409.
 */

/** Точка входа: забрать новые апдейты бота и записать посты в таблицу. */
function collectViaBot() {
  var cfg = getConfig();
  if (!cfg.BOT_TOKEN) {
    throw new Error('Не задан BOT_TOKEN. Выполните setBotToken("123:ABC...").');
  }

  var sheet = getPostsSheet_(cfg);
  var keys = loadExistingKeys_(sheet);
  var offset = getState_('BOT_UPDATE_OFFSET') || 0;
  var posts = [];
  var batches = 0;

  while (batches < 10 && posts.length < cfg.MAX_POSTS_PER_RUN) {
    var updates = callBotApi_(cfg, 'getUpdates', {
      offset: offset,
      limit: 100,
      timeout: 0,
      allowed_updates: JSON.stringify(['channel_post', 'edited_channel_post', 'message'])
    });
    batches++;
    if (!updates.length) break;

    updates.forEach(function (update) {
      if (update.update_id >= offset) offset = update.update_id + 1;
      var post = updateToPost_(update, cfg);
      if (post) posts.push(post);
    });

    if (updates.length < 100) break;
  }

  var result = appendPosts_(sheet, posts, cfg, keys);
  setState_('BOT_UPDATE_OFFSET', offset);

  var summary = 'Bot API: добавлено ' + result.added + ', пропущено дублей ' + result.skipped +
    ', offset ' + offset;
  Logger.log(summary);
  return summary;
}

/** Вызов метода Bot API. Возвращает поле result. */
function callBotApi_(cfg, method, params) {
  var url = 'https://api.telegram.org/bot' + cfg.BOT_TOKEN + '/' + method;
  var response = UrlFetchApp.fetch(url, {
    method: 'post',
    payload: params || {},
    muteHttpExceptions: true
  });
  var body = JSON.parse(response.getContentText());
  if (!body.ok) {
    throw new Error('Bot API ' + method + ': ' + (body.description || response.getContentText()));
  }
  return body.result;
}

/** Апдейт Telegram -> объект поста в том же формате, что и веб-парсер. */
function updateToPost_(update, cfg) {
  var message = update.channel_post || update.edited_channel_post || update.message;
  if (!message || !message.chat) return null;

  var chat = message.chat;
  var channel = chat.username || String(chat.id);
  var media = detectBotMedia_(message);
  var forwardedFrom = extractForwardSource_(message);

  return {
    source: update.edited_channel_post ? 'bot:edited' : 'bot',
    channel: channel,
    messageId: message.message_id,
    date: message.date ? new Date(message.date * 1000) : null,
    url: chat.username ? 'https://t.me/' + chat.username + '/' + message.message_id : '',
    text: message.text || message.caption || '',
    views: '',
    media: media.types.join(','),
    mediaUrls: media.fileIds.join('\n'),
    forwardedFrom: forwardedFrom,
    forwardedFromUrl: '',
    replyTo: message.reply_to_message ? message.reply_to_message.message_id : '',
    linkPreviewUrl: extractFirstUrl_(message),
    linkPreviewTitle: '',
    raw: cfg.STORE_RAW ? JSON.stringify(update) : ''
  };
}

/** Типы вложений и их file_id. Скачать файл можно методом getFile. */
function detectBotMedia_(message) {
  var types = [];
  var fileIds = [];

  if (message.photo && message.photo.length) {
    types.push('photo');
    fileIds.push(message.photo[message.photo.length - 1].file_id);
  }
  ['video', 'document', 'audio', 'voice', 'animation', 'sticker', 'video_note'].forEach(function (key) {
    if (message[key]) {
      types.push(key);
      if (message[key].file_id) fileIds.push(message[key].file_id);
    }
  });
  if (message.poll) types.push('poll');
  if (message.location) types.push('location');

  return { types: types, fileIds: fileIds };
}

/** Источник пересылки: новый forward_origin и устаревшие forward_* поля. */
function extractForwardSource_(message) {
  var origin = message.forward_origin;
  if (origin) {
    if (origin.chat) return origin.chat.title || origin.chat.username || '';
    if (origin.sender_user) {
      return [origin.sender_user.first_name, origin.sender_user.last_name]
        .filter(Boolean).join(' ');
    }
    if (origin.sender_user_name) return origin.sender_user_name;
    if (origin.sender_chat) return origin.sender_chat.title || '';
  }
  if (message.forward_from_chat) {
    return message.forward_from_chat.title || message.forward_from_chat.username || '';
  }
  if (message.forward_from) {
    return [message.forward_from.first_name, message.forward_from.last_name]
      .filter(Boolean).join(' ');
  }
  return '';
}

/** Первая ссылка из entities или из текста. */
function extractFirstUrl_(message) {
  var entities = message.entities || message.caption_entities || [];
  var text = message.text || message.caption || '';
  for (var i = 0; i < entities.length; i++) {
    var entity = entities[i];
    if (entity.type === 'text_link' && entity.url) return entity.url;
    if (entity.type === 'url') {
      return text.substr(entity.offset, entity.length);
    }
  }
  var match = /(https?:\/\/[^\s]+)/.exec(text);
  return match ? match[1] : '';
}
