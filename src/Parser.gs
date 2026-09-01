/**
 * Разбор HTML публичной превью-страницы канала https://t.me/s/<канал>.
 * В Apps Script нет DOM, поэтому парсим строкой: режем страницу на блоки
 * сообщений и вытаскиваем поля с учётом вложенности тегов.
 */

/**
 * @param {string} html      HTML страницы t.me/s/<канал>
 * @param {string} channel   username канала (фолбэк, если нет data-post)
 * @return {{posts: Array<Object>, moreBefore: ?number, moreAfter: ?number}}
 */
function parseChannelPage_(html, channel) {
  var posts = [];
  var chunks = String(html || '').split('tgme_widget_message_wrap');
  for (var i = 1; i < chunks.length; i++) {
    var post = parsePostBlock_(chunks[i], channel);
    if (post) posts.push(post);
  }
  posts.sort(function (a, b) { return a.messageId - b.messageId; });
  return {
    posts: posts,
    moreBefore: matchInt_(html, /class="[^"]*tme_messages_more[^"]*"[^>]*data-before="(\d+)"/),
    moreAfter: matchInt_(html, /class="[^"]*tme_messages_more[^"]*"[^>]*data-after="(\d+)"/)
  };
}

/** Разбирает один блок сообщения. Возвращает null, если это не пост. */
function parsePostBlock_(block, channel) {
  var postPath = matchStr_(block, /data-post="([^"]+)"/);
  if (!postPath) return null;

  var slash = postPath.lastIndexOf('/');
  var channelName = slash > -1 ? postPath.substring(0, slash) : (channel || '');
  var messageId = slash > -1 ? parseInt(postPath.substring(slash + 1), 10) : NaN;
  if (!isFinite(messageId)) return null;

  var textHtml = extractElementByClass_(block, 'tgme_widget_message_text');
  var dateIso = matchStr_(block, /class="[^"]*tgme_widget_message_date[^"]*"[\s\S]*?datetime="([^"]+)"/)
    || matchStr_(block, /datetime="([^"]+)"/);

  var media = detectMedia_(block);
  var forwardedHtml = extractElementByClass_(block, 'tgme_widget_message_forwarded_from_name')
    || extractElementByClass_(block, 'tgme_widget_message_forwarded_from');

  return {
    source: 'web',
    channel: channelName,
    messageId: messageId,
    date: dateIso ? new Date(dateIso) : null,
    url: 'https://t.me/' + postPath,
    text: htmlToText_(textHtml),
    viewsRaw: matchStr_(block, /class="[^"]*tgme_widget_message_views[^"]*"[^>]*>([^<]*)</) || '',
    views: parseViews_(matchStr_(block, /class="[^"]*tgme_widget_message_views[^"]*"[^>]*>([^<]*)</)),
    forwardedFrom: htmlToText_(forwardedHtml).replace(/^Forwarded from\s*/i, ''),
    forwardedFromUrl: matchStr_(block,
      /<a[^>]*class="[^"]*tgme_widget_message_forwarded_from_name[^"]*"[^>]*href="([^"]+)"/),
    replyTo: matchStr_(block, /class="[^"]*tgme_widget_message_reply[^"]*"[^>]*href="[^"]*\/(\d+)"/) || '',
    media: media.types.join(','),
    mediaUrls: media.urls.join('\n'),
    linkPreviewUrl: matchStr_(block, /<a[^>]*class="[^"]*tgme_widget_message_link_preview[^"]*"[^>]*href="([^"]+)"/)
      || matchStr_(block, /href="([^"]+)"[^>]*class="[^"]*tgme_widget_message_link_preview[^"]*"/) || '',
    linkPreviewTitle: htmlToText_(extractElementByClass_(block, 'link_preview_title')),
    raw: ''
  };
}

/** Определяет типы вложений и ссылки на медиа внутри блока сообщения. */
function detectMedia_(block) {
  var types = [];
  var urls = [];

  collectTagsByClass_(block, 'tgme_widget_message_photo_wrap').forEach(function (tag) {
    var url = matchStr_(tag, /background-image:url\('([^']+)'\)/);
    if (url) urls.push(url);
    if (types.indexOf('photo') === -1) types.push('photo');
  });

  var videoRe = /<video[^>]*src="([^"]+)"/gi;
  var videoMatch;
  while ((videoMatch = videoRe.exec(block)) !== null) {
    urls.push(videoMatch[1]);
    if (types.indexOf('video') === -1) types.push('video');
  }
  if (types.indexOf('video') === -1 && /tgme_widget_message_video_thumb/.test(block)) {
    types.push('video');
  }
  if (/tgme_widget_message_roundvideo/.test(block) && types.indexOf('video_note') === -1) {
    types.push('video_note');
  }

  [
    ['tgme_widget_message_voice', 'voice'],
    ['tgme_widget_message_document', 'document'],
    ['tgme_widget_message_poll', 'poll'],
    ['tgme_widget_message_sticker', 'sticker'],
    ['tgme_widget_message_location', 'location']
  ].forEach(function (pair) {
    if (new RegExp(pair[0]).test(block) && types.indexOf(pair[1]) === -1) types.push(pair[1]);
  });

  collectTagsByClass_(block, 'tgme_widget_message_sticker').forEach(function (tag) {
    var url = matchStr_(tag, /data-webp="([^"]+)"/);
    if (url) urls.push(url);
  });

  return { types: types, urls: dedupeArray_(urls) };
}

/**
 * Возвращает внутренний HTML первого элемента с указанным классом
 * с учётом вложенных одноимённых тегов.
 */
function extractElementByClass_(html, className) {
  if (!html) return '';
  var startRe = new RegExp('<([a-zA-Z0-9]+)[^>]*class="[^"]*\\b' + className + '\\b[^"]*"', 'i');
  var start = startRe.exec(html);
  if (!start) return '';

  var tag = start[1];
  var openEnd = html.indexOf('>', start.index);
  if (openEnd < 0) return '';
  if (html.charAt(openEnd - 1) === '/') return '';

  var openRe = new RegExp('<' + tag + '(?=[\\s/>])', 'gi');
  var closeRe = new RegExp('</' + tag + '\\s*>', 'gi');
  var depth = 1;
  var pos = openEnd + 1;

  while (depth > 0) {
    openRe.lastIndex = pos;
    closeRe.lastIndex = pos;
    var open = openRe.exec(html);
    var close = closeRe.exec(html);
    if (!close) return html.substring(openEnd + 1);
    if (open && open.index < close.index) {
      depth++;
      pos = open.index + 1;
    } else {
      depth--;
      pos = close.index + 1;
      if (depth === 0) return html.substring(openEnd + 1, close.index);
    }
  }
  return '';
}

/** Все открывающие теги с указанным классом. */
function collectTagsByClass_(html, className) {
  var re = new RegExp('<[a-zA-Z0-9]+[^>]*class="[^"]*\\b' + className + '\\b[^"]*"[^>]*>', 'gi');
  var result = [];
  var match;
  while ((match = re.exec(html)) !== null) result.push(match[0]);
  return result;
}

/**
 * HTML сообщения -> плоский текст.
 * Переносы строк внутри поста Telegram отдаёт тегом <br/>, а реальные
 * переводы строк в исходнике — это форматирование самой разметки,
 * поэтому их схлопываем в пробел.
 */
var NEWLINE_TOKEN_ = '\u0001';

function htmlToText_(html) {
  if (!html) return '';
  var text = String(html);
  text = text.replace(/<br\s*\/?>/gi, NEWLINE_TOKEN_);
  text = text.replace(/<\/(p|div|li)>/gi, NEWLINE_TOKEN_);
  text = text.replace(/<[^>]+>/g, '');
  text = text.replace(/\r/g, '');
  text = text.replace(/[ \t]*\n[ \t]*/g, ' ');
  text = decodeHtmlEntities_(text);
  text = text.split(NEWLINE_TOKEN_).map(function (line) {
    return line.replace(/^[ \t]+/, '').replace(/[ \t]+$/, '');
  }).join('\n');
  text = text.replace(/\n{3,}/g, '\n\n');
  return text.trim();
}

var HTML_ENTITIES = {
  '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'",
  '&#39;': "'", '&nbsp;': ' ', '&laquo;': '«', '&raquo;': '»',
  '&mdash;': '—', '&ndash;': '–', '&hellip;': '…'
};

function decodeHtmlEntities_(text) {
  var result = String(text).replace(/&[a-zA-Z]+;|&#39;/g, function (entity) {
    return HTML_ENTITIES[entity] !== undefined ? HTML_ENTITIES[entity] : entity;
  });
  result = result.replace(/&#(\d+);/g, function (_, code) {
    return String.fromCharCode(parseInt(code, 10));
  });
  result = result.replace(/&#x([0-9a-fA-F]+);/g, function (_, code) {
    return String.fromCharCode(parseInt(code, 16));
  });
  return result;
}

/** '12.3K' -> 12300, '1.1M' -> 1100000, '842' -> 842. */
function parseViews_(value) {
  if (!value) return '';
  var text = String(value).trim().replace(/\s/g, '');
  var match = /^([\d.,]+)([KMkmКМ]?)$/.exec(text);
  if (!match) return '';
  var number = parseFloat(match[1].replace(',', '.'));
  if (!isFinite(number)) return '';
  var suffix = match[2].toUpperCase();
  if (suffix === 'K' || suffix === 'К') number *= 1000;
  if (suffix === 'M' || suffix === 'М') number *= 1000000;
  return Math.round(number);
}

function matchStr_(text, regex) {
  var match = regex.exec(String(text || ''));
  return match ? match[1] : '';
}

function matchInt_(text, regex) {
  var value = matchStr_(text, regex);
  return value ? parseInt(value, 10) : null;
}

function dedupeArray_(items) {
  var seen = {};
  return items.filter(function (item) {
    if (!item || seen[item]) return false;
    seen[item] = true;
    return true;
  });
}
