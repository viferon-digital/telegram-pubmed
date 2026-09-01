/**
 * Работа с Google Таблицей: создание листа, дедупликация и запись постов.
 */

var SHEET_HEADERS = [
  'key',
  'collected_at',
  'source',
  'channel',
  'message_id',
  'date',
  'url',
  'text',
  'text_length',
  'views',
  'media',
  'media_urls',
  'forwarded_from',
  'forwarded_from_url',
  'reply_to',
  'link_preview_url',
  'link_preview_title',
  'raw'
];

function getSpreadsheet_(cfg) {
  if (cfg.SPREADSHEET_ID) return SpreadsheetApp.openById(cfg.SPREADSHEET_ID);
  var active = SpreadsheetApp.getActiveSpreadsheet();
  if (!active) {
    throw new Error(
      'Не найдена таблица. Привяжите скрипт к таблице или укажите SPREADSHEET_ID в свойствах скрипта.'
    );
  }
  return active;
}

/** Возвращает лист с постами, создавая его с шапкой при первом запуске. */
function getPostsSheet_(cfg) {
  var spreadsheet = getSpreadsheet_(cfg);
  var sheet = spreadsheet.getSheetByName(cfg.SHEET_NAME);
  if (!sheet) {
    sheet = spreadsheet.insertSheet(cfg.SHEET_NAME);
  }
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, SHEET_HEADERS.length).setValues([SHEET_HEADERS]).setFontWeight('bold');
    sheet.setFrozenRows(1);
    sheet.getRange('F:F').setNumberFormat('yyyy-mm-dd hh:mm:ss');
    sheet.getRange('B:B').setNumberFormat('yyyy-mm-dd hh:mm:ss');
  }
  return sheet;
}

/** Ключи уже сохранённых постов, чтобы не писать дубли. */
function loadExistingKeys_(sheet) {
  var keys = {};
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return keys;
  var values = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
  for (var i = 0; i < values.length; i++) {
    var key = values[i][0];
    if (key) keys[String(key)] = true;
  }
  return keys;
}

function postKey_(post) {
  return post.channel + '/' + post.messageId;
}

function postToRow_(post, cfg) {
  var text = post.text || '';
  return [
    postKey_(post),
    new Date(),
    post.source || '',
    post.channel || '',
    post.messageId,
    post.date || '',
    post.url || '',
    text,
    text.length,
    post.views === undefined ? '' : post.views,
    post.media || '',
    post.mediaUrls || '',
    post.forwardedFrom || '',
    post.forwardedFromUrl || '',
    post.replyTo || '',
    post.linkPreviewUrl || '',
    post.linkPreviewTitle || '',
    cfg.STORE_RAW ? (post.raw || '') : ''
  ];
}

/**
 * Дописывает посты в лист, пропуская уже сохранённые.
 * @return {{added: number, skipped: number}}
 */
function appendPosts_(sheet, posts, cfg, existingKeys) {
  var keys = existingKeys || loadExistingKeys_(sheet);
  var rows = [];
  var skipped = 0;

  posts.forEach(function (post) {
    var key = postKey_(post);
    if (keys[key]) {
      skipped++;
      return;
    }
    keys[key] = true;
    rows.push(postToRow_(post, cfg));
  });

  if (rows.length) {
    sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, SHEET_HEADERS.length).setValues(rows);
  }
  return { added: rows.length, skipped: skipped };
}
