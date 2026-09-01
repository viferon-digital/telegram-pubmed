/**
 * Самопроверка парсера на зафиксированном фрагменте разметки t.me.
 * Запускается из редактора Apps Script: runParserSelfTest().
 * Ничего не пишет в таблицу и не ходит в сеть.
 */

function runParserSelfTest() {
  var page = parseChannelPage_(PARSER_FIXTURE_HTML_, 'testchannel');
  var failures = [];

  function check(name, actual, expected) {
    var ok = String(actual) === String(expected);
    if (!ok) failures.push(name + ': ожидали "' + expected + '", получили "' + actual + '"');
  }

  check('количество постов', page.posts.length, 3);
  check('пагинация before', page.moreBefore, 100);

  var first = page.posts[0];
  check('id первого поста', first.messageId, 101);
  check('канал', first.channel, 'testchannel');
  check('ссылка', first.url, 'https://t.me/testchannel/101');
  check('текст с переносом', first.text, 'Привет, мир!\nВторая строка & «кавычки»');
  check('просмотры', first.views, 12300);
  check('дата', first.date.toISOString(), '2026-08-30T10:15:00.000Z');

  var second = page.posts[1];
  check('медиа второго поста', second.media, 'photo');
  check('url медиа', second.mediaUrls, 'https://cdn.telegram.org/file/photo_1.jpg');
  check('пересылка', second.forwardedFrom, 'Другой канал');
  check('ссылка на источник пересылки', second.forwardedFromUrl, 'https://t.me/other');
  check('ответ на пост', second.replyTo, '101');

  var third = page.posts[2];
  check('видео', third.media, 'video');
  check('ссылка превью', third.linkPreviewUrl, 'https://example.com/article');
  check('заголовок превью', third.linkPreviewTitle, 'Заголовок статьи');
  check('текст третьего поста', third.text, 'Смотрите видео: https://example.com/article');

  check('парсер просмотров K', parseViews_('1.2K'), 1200);
  check('парсер просмотров M', parseViews_('3M'), 3000000);
  check('парсер просмотров число', parseViews_('842'), 842);
  check('html -> текст', htmlToText_('<b>a</b><br/>b&amp;c'), 'a\nb&c');
  check('число колонок строки совпадает с шапкой',
    postToRow_(first, { STORE_RAW: false }).length, SHEET_HEADERS.length);

  var summary = failures.length
    ? 'ПРОВАЛЕНО ' + failures.length + ':\n' + failures.join('\n')
    : 'Все проверки парсера пройдены (' + page.posts.length + ' поста разобрано).';
  Logger.log(summary);
  return summary;
}

var PARSER_FIXTURE_HTML_ = [
  '<div class="tgme_channel_history js-message_history">',
  '<div class="tgme_widget_message_wrap js-widget_message_wrap">',
  '  <div class="tgme_widget_message text_not_supported_wrap js-widget_message" data-post="testchannel/101">',
  '    <div class="tgme_widget_message_text js-message_text">Привет, мир!<br/>Вторая строка &amp; &laquo;кавычки&raquo;</div>',
  '    <div class="tgme_widget_message_footer compact js-message_footer">',
  '      <span class="tgme_widget_message_views">12.3K</span>',
  '      <a class="tgme_widget_message_date" href="https://t.me/testchannel/101">',
  '        <time datetime="2026-08-30T10:15:00+00:00" class="time">13:15</time></a>',
  '    </div>',
  '  </div>',
  '</div>',
  '<div class="tgme_widget_message_wrap js-widget_message_wrap">',
  '  <div class="tgme_widget_message js-widget_message" data-post="testchannel/102">',
  '    <div class="tgme_widget_message_forwarded_from accent_color">',
  '      Forwarded from&nbsp;<a class="tgme_widget_message_forwarded_from_name" href="https://t.me/other">',
  '        <span class="tgme_widget_message_forwarded_from_author">Другой канал</span></a>',
  '    </div>',
  '    <a class="tgme_widget_message_reply" href="https://t.me/testchannel/101">',
  '      <div class="tgme_widget_message_reply_text">Привет, мир!</div></a>',
  '    <a class="tgme_widget_message_photo_wrap" href="https://t.me/testchannel/102"',
  '       style="width:800px;background-image:url(\'https://cdn.telegram.org/file/photo_1.jpg\')"></a>',
  '    <div class="tgme_widget_message_text js-message_text">Фото дня</div>',
  '    <div class="tgme_widget_message_footer compact js-message_footer">',
  '      <span class="tgme_widget_message_views">842</span>',
  '      <a class="tgme_widget_message_date" href="https://t.me/testchannel/102">',
  '        <time datetime="2026-08-30T11:00:00+00:00" class="time">14:00</time></a>',
  '    </div>',
  '  </div>',
  '</div>',
  '<div class="tgme_widget_message_wrap js-widget_message_wrap">',
  '  <div class="tgme_widget_message js-widget_message" data-post="testchannel/103">',
  '    <video src="https://cdn.telegram.org/file/video_1.mp4" class="tgme_widget_message_video"></video>',
  '    <div class="tgme_widget_message_text js-message_text">Смотрите видео: ',
  '      <a href="https://example.com/article" target="_blank">https://example.com/article</a></div>',
  '    <a class="tgme_widget_message_link_preview" href="https://example.com/article">',
  '      <div class="link_preview_site_name accent_color">example.com</div>',
  '      <div class="link_preview_title">Заголовок статьи</div>',
  '      <div class="link_preview_description">Описание статьи</div></a>',
  '    <div class="tgme_widget_message_footer compact js-message_footer">',
  '      <span class="tgme_widget_message_views">1.1M</span>',
  '      <a class="tgme_widget_message_date" href="https://t.me/testchannel/103">',
  '        <time datetime="2026-08-30T12:30:00+00:00" class="time">15:30</time></a>',
  '    </div>',
  '  </div>',
  '</div>',
  '<a class="tme_messages_more js-messages_more" data-before="100" href="/s/testchannel?before=100">',
  'Load more</a>',
  '</div>'
].join('\n');
