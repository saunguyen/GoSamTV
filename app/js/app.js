/* GoSamTV — Tizen web app
 * Home screen for Samsung TVs: live TV (HLS), news, weather, market, apps.
 * No external libraries; guarded Tizen APIs so it also runs in a browser.
 */
(function () {
  'use strict';

  var T = window.tizen || null;
  var DATA = window.LP_DATA || { vn: [], intl: [] };

  /* Older Tizen TV engines (Chromium 56-63) lack Promise.allSettled. */
  if (!Promise.allSettled) {
    Promise.allSettled = function (list) {
      return Promise.all(Array.prototype.map.call(list, function (p) {
        return Promise.resolve(p).then(
          function (value) { return { status: 'fulfilled', value: value }; },
          function (reason) { return { status: 'rejected', reason: reason }; }
        );
      }));
    };
  }

  /* Flex `gap` only landed in Chromium 84; older Tizen TVs need margins. */
  (function detectFlexGap() {
    try {
      var probe = document.createElement('div');
      probe.style.cssText = 'display:flex;flex-direction:column;gap:4px;position:absolute;visibility:hidden;height:auto';
      var a = document.createElement('div');
      a.style.height = '10px';
      var b = document.createElement('div');
      b.style.height = '10px';
      probe.appendChild(a);
      probe.appendChild(b);
      document.documentElement.appendChild(probe);
      var height = probe.getBoundingClientRect().height;
      document.documentElement.removeChild(probe);
      if (height < 24) document.documentElement.classList.add('no-flex-gap');
    } catch (e) { /* assume modern */ }
  })();

  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  var $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };

  /* ------------------------------------------------------------------ *
   * state
   * ------------------------------------------------------------------ */

  var CITIES = [
    { id: 'hanoi', name: 'Hà Nội', lat: 21.0285, lon: 105.8542 },
    { id: 'hcm', name: 'TP. Hồ Chí Minh', lat: 10.8231, lon: 106.6297 },
    { id: 'danang', name: 'Đà Nẵng', lat: 16.0544, lon: 108.2022 },
    { id: 'haiphong', name: 'Hải Phòng', lat: 20.8449, lon: 106.6881 },
    { id: 'cantho', name: 'Cần Thơ', lat: 10.0452, lon: 105.7469 },
    { id: 'hue', name: 'Huế', lat: 16.4637, lon: 107.5909 }
  ];

  var ACCENTS = ['violet', 'ocean', 'sunset', 'mint'];

  var DEFAULT_FEEDS = [
    { name: 'VnExpress', url: 'https://vnexpress.net/rss/tin-moi-nhat.rss' },
    { name: 'Tuổi Trẻ', url: 'https://tuoitre.vn/rss/tin-moi-nhat.rss' },
    { name: 'Thanh Niên', url: 'https://thanhnien.vn/rss/home.rss' },
    { name: 'BBC Việt', url: 'https://feeds.bbci.co.uk/vietnamese/rss.xml' }
  ];

  var STORE_KEY = 'lp.state.v2';
  // Samsung may forward the launch OK button into the first focused control.
  // Consume only that launch press; a newly pressed OK works normally.
  var launchEnterReleased = false;
  var launchEnterGuardUntil = Date.now() + 1300;

  var state = {
    tab: 'home',
    city: 'hanoi',
    accent: 'violet',
    source: 'vn',
    filter: 'all',
    showWeather: true,
    showNews: true,
    showMarket: true,
    showQuick: true,
    favorites: [],
    recent: [],
    lastChannel: null,
    feeds: DEFAULT_FEEDS.slice(),
    custom: [],
    customEpgUrl: null
  };

  function loadState() {
    try {
      var raw = localStorage.getItem(STORE_KEY);
      if (!raw) return;
      var saved = JSON.parse(raw);
      Object.keys(saved).forEach(function (k) {
        if (k === 'feeds' || k === 'custom') return;
        state[k] = saved[k];
      });
      if (Array.isArray(saved.feeds) && saved.feeds.length) state.feeds = saved.feeds;
      if (Array.isArray(saved.custom)) state.custom = saved.custom;
    } catch (e) { /* ignore corrupt state */ }
  }

  function saveState() {
    try {
      var copy = {};
      Object.keys(state).forEach(function (k) { copy[k] = state[k]; });
      if (copy.custom && copy.custom.length > 1200) copy.custom = copy.custom.slice(0, 1200);
      localStorage.setItem(STORE_KEY, JSON.stringify(copy));
    } catch (e) { /* quota */ }
  }

  /* ------------------------------------------------------------------ *
   * helpers
   * ------------------------------------------------------------------ */

  function el(tag, cls, text) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text != null) node.textContent = text;
    return node;
  }

  function visible(node) {
    if (!node || node.closest('[hidden]')) return false;
    return node.getClientRects().length > 0;
  }

  var toastTimer = null;
  function toast(message) {
    var node = $('#toast');
    node.textContent = message;
    node.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { node.classList.remove('show'); }, 2600);
  }

  function hashHue(text) {
    var h = 0;
    for (var i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) % 360;
    return h;
  }

  function initials(name) {
    var clean = (name || '?').replace(/[^\p{L}\p{N} ]/gu, ' ').trim();
    var parts = clean.split(/\s+/).filter(Boolean);
    if (!parts.length) return '?';
    if (parts.length === 1) return parts[0].slice(0, 3).toUpperCase();
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }

  function tileLabel(name) {
    if (!name) return '?';
    if (name.length <= 14) return name;
    var first = name.split(/\s+/)[0];
    return first.length <= 14 ? first : first.slice(0, 12);
  }

  function logoTile(node, name) {
    var hue = hashHue(name || '?');
    var label = tileLabel(name);
    var tile = el('div', 'tile', label);
    tile.style.background =
      'linear-gradient(150deg, hsl(' + hue + ',62%,44%), hsl(' + ((hue + 38) % 360) + ',58%,32%))';
    tile.style.fontSize = label.length > 9 ? '17px' : '24px';
    node.appendChild(tile);
  }

  function fillLogo(node, channel, compact) {
    node.innerHTML = '';
    // Paint a tile first: remote logos can be slow or blocked, and an empty
    // box looks broken on a TV.
    var label = compact && channel.name.length > 7 ? initials(channel.name) : tileLabel(channel.name);
    var hue = hashHue(channel.name || '?');
    var placeholder = el('div', 'tile tile-ph', label);
    placeholder.style.background =
      'linear-gradient(150deg, hsl(' + hue + ',62%,44%), hsl(' + ((hue + 38) % 360) + ',58%,32%))';
    placeholder.style.fontSize = label.length > 9 ? '17px' : '24px';
    node.appendChild(placeholder);

    if (channel.logo) {
      var img = el('img', 'logo-img');
      img.loading = 'lazy';
      img.alt = channel.name;
      img.onload = function () {
        img.classList.add('ready');
        placeholder.style.visibility = 'hidden';
      };
      img.onerror = function () { img.remove(); };
      img.src = channel.logo;
      node.appendChild(img);
    }
  }

  function fmtTime(date) {
    var diff = (Date.now() - date.getTime()) / 60000;
    if (isNaN(diff)) return '';
    if (diff < 1) return 'vừa xong';
    if (diff < 60) return Math.round(diff) + ' phút trước';
    if (diff < 60 * 24) return Math.round(diff / 60) + ' giờ trước';
    return date.getDate() + '/' + (date.getMonth() + 1);
  }

  /* ------------------------------------------------------------------ *
   * focus engine (TV remote)
   * ------------------------------------------------------------------ */

  var focusMemory = {};

  function activeLayer() {
    var layers = ['#zap', '#epg-panel', '#search', '#sheet', '#reader'];
    for (var i = 0; i < layers.length; i++) {
      var node = $(layers[i]);
      if (node && !node.hidden) return node;
    }
    return null;
  }

  var Focus = {
    items: function () {
      var root = activeLayer() || document.body;
      return $$('[data-focus]', root).filter(visible);
    },
    set: function (node) {
      if (!node || !node.focus) return;
      try { node.focus({ preventScroll: true }); } catch (e) { node.focus(); }
      Focus.reveal(node);
    },
    reveal: function (node) {
      if (!node || !node.scrollIntoView) return;
      node.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
    },
    first: function () {
      var list = Focus.items();
      if (list.length) Focus.set(list[0]);
    },
    move: function (dir) {
      var current = document.activeElement;
      var list = Focus.items();
      if (!list.length) return;
      if (!current || list.indexOf(current) === -1) { Focus.set(list[0]); return; }

      var cr = current.getBoundingClientRect();
      var cx = cr.left + cr.width / 2;
      var cy = cr.top + cr.height / 2;
      var best = null;
      var bestScore = Infinity;

      for (var i = 0; i < list.length; i++) {
        var node = list[i];
        if (node === current) continue;
        var r = node.getBoundingClientRect();
        var dx = r.left + r.width / 2 - cx;
        var dy = r.top + r.height / 2 - cy;
        var primary, secondary;
        if (dir === 'left') {
          if (dx > -8) continue;
          primary = -dx; secondary = Math.abs(dy);
        } else if (dir === 'right') {
          if (dx < 8) continue;
          primary = dx; secondary = Math.abs(dy);
        } else if (dir === 'up') {
          if (dy > -8) continue;
          primary = -dy; secondary = Math.abs(dx);
        } else {
          if (dy < 8) continue;
          primary = dy; secondary = Math.abs(dx);
        }
        var score = primary + secondary * 2.4;
        if (score < bestScore) { bestScore = score; best = node; }
      }

      if (best) { Focus.set(best); return; }

      // nothing in that direction: let the page scroll a bit
      var screen = current.closest('.screen');
      if (screen) {
        if (dir === 'down') screen.scrollBy({ top: 220, behavior: 'smooth' });
        if (dir === 'up') screen.scrollBy({ top: -220, behavior: 'smooth' });
      }
    }
  };

  document.addEventListener('focusin', function (e) {
    $$('.is-focused').forEach(function (n) { n.classList.remove('is-focused'); });
    if (e.target.classList) e.target.classList.add('is-focused');
  });

  /* ------------------------------------------------------------------ *
   * clock & date
   * ------------------------------------------------------------------ */

  var WEEKDAYS = ['Chủ Nhật', 'Thứ Hai', 'Thứ Ba', 'Thứ Tư', 'Thứ Năm', 'Thứ Sáu', 'Thứ Bảy'];
  var SHORT_DAYS = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];

  function pad2(n) { return (n < 10 ? '0' : '') + n; }

  /* Vietnamese lunar calendar (Ho Ngoc Duc's algorithm, timezone +7).
     Computed in-app so it does not depend on the TV browser's Intl data. */
  var Lunar = (function () {
    var PI = Math.PI;
    var TZ = 7;

    function INT(d) { return Math.floor(d); }

    function jdFromDate(dd, mm, yy) {
      var a = INT((14 - mm) / 12);
      var y = yy + 4800 - a;
      var m = mm + 12 * a - 3;
      var jd = dd + INT((153 * m + 2) / 5) + 365 * y + INT(y / 4) - INT(y / 100) + INT(y / 400) - 32045;
      if (jd < 2299161) jd = dd + INT((153 * m + 2) / 5) + 365 * y + INT(y / 4) - 32083;
      return jd;
    }

    function NewMoon(k) {
      var T = k / 1236.85, T2 = T * T, T3 = T2 * T, dr = PI / 180;
      var Jd1 = 2415020.75933 + 29.53058868 * k + 0.0001178 * T2 - 0.000000155 * T3;
      Jd1 += 0.00033 * Math.sin((166.56 + 132.87 * T - 0.009173 * T2) * dr);
      var M = 359.2242 + 29.10535608 * k - 0.0000333 * T2 - 0.00000347 * T3;
      var Mpr = 306.0253 + 385.81691806 * k + 0.0107306 * T2 + 0.00001236 * T3;
      var F = 21.2964 + 390.67050646 * k - 0.0016528 * T2 - 0.00000239 * T3;
      var C1 = (0.1734 - 0.000393 * T) * Math.sin(M * dr) + 0.0021 * Math.sin(2 * dr * M);
      C1 = C1 - 0.4068 * Math.sin(Mpr * dr) + 0.0161 * Math.sin(dr * 2 * Mpr);
      C1 = C1 - 0.0004 * Math.sin(dr * 3 * Mpr);
      C1 = C1 + 0.0104 * Math.sin(dr * 2 * F) - 0.0051 * Math.sin(dr * (M + Mpr));
      C1 = C1 - 0.0074 * Math.sin(dr * (M - Mpr)) + 0.0004 * Math.sin(dr * (2 * F + M));
      C1 = C1 - 0.0004 * Math.sin(dr * (2 * F - M)) - 0.0006 * Math.sin(dr * (2 * F + Mpr));
      C1 = C1 + 0.0010 * Math.sin(dr * (2 * F - Mpr)) + 0.0005 * Math.sin(dr * (2 * Mpr + M));
      var deltat;
      if (T < -11) {
        deltat = 0.001 + 0.000839 * T + 0.0002261 * T2 - 0.00000845 * T3 - 0.000000081 * T * T3;
      } else {
        deltat = -0.000278 + 0.000265 * T + 0.000262 * T2;
      }
      return Jd1 + C1 - deltat;
    }

    function SunLongitude(jdn) {
      var T = (jdn - 2451545.0) / 36525;
      var T2 = T * T, dr = PI / 180;
      var M = 357.52910 + 35999.05030 * T - 0.0001559 * T2 - 0.00000048 * T * T2;
      var L0 = 280.46645 + 36000.76983 * T + 0.0003032 * T2;
      var DL = (1.914600 - 0.004817 * T - 0.000014 * T2) * Math.sin(dr * M);
      DL += (0.019993 - 0.000101 * T) * Math.sin(dr * 2 * M) + 0.000290 * Math.sin(dr * 3 * M);
      var L = (L0 + DL) * dr;
      L = L - PI * 2 * INT(L / (PI * 2));
      return L;
    }

    function getNewMoonDay(k) { return INT(NewMoon(k) + 0.5 + TZ / 24); }

    function getSunLongitude(dayNumber) {
      return INT(SunLongitude(dayNumber - 0.5 - TZ / 24) / PI * 6);
    }

    function getLunarMonth11(yy) {
      var off = jdFromDate(31, 12, yy) - 2415021;
      var k = INT(off / 29.530588853);
      var nm = getNewMoonDay(k);
      if (getSunLongitude(nm) >= 9) nm = getNewMoonDay(k - 1);
      return nm;
    }

    function getLeapMonthOffset(a11) {
      var k = INT((a11 - 2415021.076998695) / 29.530588853 + 0.5);
      var last = 0, i = 1;
      var arc = getSunLongitude(getNewMoonDay(k + i));
      do {
        last = arc;
        i++;
        arc = getSunLongitude(getNewMoonDay(k + i));
      } while (arc !== last && i < 14);
      return i - 1;
    }

    function fromSolar(dd, mm, yy) {
      var dayNumber = jdFromDate(dd, mm, yy);
      var k = INT((dayNumber - 2415021.076998695) / 29.530588853);
      var monthStart = getNewMoonDay(k + 1);
      if (monthStart > dayNumber) monthStart = getNewMoonDay(k);
      var a11 = getLunarMonth11(yy);
      var b11 = a11;
      var lunarYear;
      if (a11 >= monthStart) {
        lunarYear = yy;
        a11 = getLunarMonth11(yy - 1);
      } else {
        lunarYear = yy + 1;
        b11 = getLunarMonth11(yy + 1);
      }
      var lunarDay = dayNumber - monthStart + 1;
      var diff = INT((monthStart - a11) / 29);
      var leap = 0;
      var lunarMonth = diff + 11;
      if (b11 - a11 > 365) {
        var leapMonthDiff = getLeapMonthOffset(a11);
        if (diff >= leapMonthDiff) {
          lunarMonth = diff + 10;
          if (diff === leapMonthDiff) leap = 1;
        }
      }
      if (lunarMonth > 12) lunarMonth -= 12;
      if (lunarMonth >= 11 && diff < 4) lunarYear -= 1;
      return { day: lunarDay, month: lunarMonth, year: lunarYear, leap: leap };
    }

    return { fromSolar: fromSolar };
  })();

  var CAN = ['Giáp', 'Ất', 'Bính', 'Đinh', 'Mậu', 'Kỷ', 'Canh', 'Tân', 'Nhâm', 'Quý'];
  var CHI = ['Tý', 'Sửu', 'Dần', 'Mão', 'Thìn', 'Tỵ', 'Ngọ', 'Mùi', 'Thân', 'Dậu', 'Tuất', 'Hợi'];

  function lunarText(now) {
    try {
      var lunar = Lunar.fromSolar(now.getDate(), now.getMonth() + 1, now.getFullYear());
      if (!lunar || !lunar.day) return '';
      var canChi = CAN[(lunar.year + 6) % 10] + ' ' + CHI[(lunar.year + 8) % 12];
      return lunar.day + '/' + lunar.month + (lunar.leap ? ' nhuận' : '') +
        ' âm lịch · ' + canChi;
    } catch (e) {
      return '';
    }
  }

  function tickClock() {
    var now = new Date();
    $('#clock-time').textContent = pad2(now.getHours()) + ':' + pad2(now.getMinutes());
    $('#clock-date').textContent = WEEKDAYS[now.getDay()] + ', ' + now.getDate() + ' tháng ' + (now.getMonth() + 1);
    $('#date-weekday').textContent = WEEKDAYS[now.getDay()];
    $('#date-day').textContent = pad2(now.getDate());
    $('#date-month').textContent = 'THÁNG ' + (now.getMonth() + 1);
    $('#date-year').textContent = 'Năm ' + now.getFullYear();
    var lunar = lunarText(now);
    $('#date-lunar').textContent = lunar || '\u00a0';
    renderMiniCal(now);
  }

  /* Month grid under the date; only rebuilt when the month changes. */
  function renderMiniCal(now) {
    var grid = $('#mc-grid');
    var key = now.getFullYear() + '-' + now.getMonth();
    if (grid.dataset.key === key) {
      $$('.mc-cell', grid).forEach(function (cell) {
        cell.classList.toggle('is-today', cell.textContent === String(now.getDate()));
      });
      return;
    }
    grid.dataset.key = key;

    var first = new Date(now.getFullYear(), now.getMonth(), 1);
    var offset = (first.getDay() + 6) % 7; // Monday-first
    var total = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();

    grid.innerHTML = '';
    var frag = document.createDocumentFragment();
    for (var i = 0; i < offset; i++) frag.appendChild(el('span', 'mc-cell is-empty'));
    for (var day = 1; day <= total; day++) {
      var cell = el('span', 'mc-cell' + (day === now.getDate() ? ' is-today' : ''), String(day));
      frag.appendChild(cell);
    }
    grid.appendChild(frag);
  }

  /* ------------------------------------------------------------------ *
   * weather
   * ------------------------------------------------------------------ */

  var WMO = {
    0: ['Trời quang', 'sun'], 1: ['Ít mây', 'sun'], 2: ['Có mây', 'cloud'], 3: ['Nhiều mây', 'cloud'],
    45: ['Sương mù', 'fog'], 48: ['Sương mù', 'fog'],
    51: ['Mưa phùn', 'rain'], 53: ['Mưa phùn', 'rain'], 55: ['Mưa phùn', 'rain'],
    61: ['Mưa nhẹ', 'rain'], 63: ['Mưa', 'rain'], 65: ['Mưa to', 'rain'],
    66: ['Mưa lạnh', 'rain'], 67: ['Mưa lạnh', 'rain'],
    71: ['Tuyết nhẹ', 'fog'], 73: ['Tuyết', 'fog'], 75: ['Tuyết dày', 'fog'], 77: ['Tuyết', 'fog'],
    80: ['Mưa rào', 'rain'], 81: ['Mưa rào', 'rain'], 82: ['Mưa lớn', 'storm'],
    85: ['Mưa tuyết', 'fog'], 86: ['Mưa tuyết', 'fog'],
    95: ['Dông', 'storm'], 96: ['Dông kèm mưa đá', 'storm'], 99: ['Dông mạnh', 'storm']
  };

  function weatherInfo(code) {
    return WMO[code] || ['—', 'cloud'];
  }

  function weatherIconId(kind) {
    return kind === 'sun' ? 'i-sun' : kind === 'rain' ? 'i-rain' :
      kind === 'storm' ? 'i-storm' : kind === 'fog' ? 'i-fog' : 'i-cloud';
  }

  function setWeatherIcon(kind) {
    $('#weather-icon').innerHTML = '<svg class="ic"><use href="#' +
      weatherIconId(kind) + '"></use></svg>';
  }

  function currentCity() {
    for (var i = 0; i < CITIES.length; i++) if (CITIES[i].id === state.city) return CITIES[i];
    return CITIES[0];
  }

  var weatherCache = null;

  function loadWeather() {
    if (!state.showWeather) { $('#hero-weather').hidden = true; return; }
    $('#hero-weather').hidden = false;
    var city = currentCity();
    $('#weather-city').textContent = city.name;

    var url = 'https://api.open-meteo.com/v1/forecast?latitude=' + city.lat +
      '&longitude=' + city.lon +
      '&current=temperature_2m,weather_code&daily=weather_code,temperature_2m_max,temperature_2m_min' +
      '&timezone=Asia%2FBangkok&forecast_days=5';

    fetchJson(url).then(function (data) {
      weatherCache = data;
      renderWeather(data);
    }).catch(function () {
      $('#weather-desc').textContent = 'Không có dữ liệu';
      $('#weather-temp').textContent = '--°';
    });
  }

  function renderWeather(data) {
    if (!data || !data.current) return;
    var cur = data.current;
    var info = weatherInfo(cur.weather_code);
    $('#weather-temp').textContent = Math.round(cur.temperature_2m) + '°';
    $('#weather-desc').textContent = info[0];
    setWeatherIcon(info[1]);

    var daily = data.daily || {};
    var times = daily.time || [];
    var box = $('#weather-forecast');
    box.innerHTML = '';
    for (var i = 1; i < Math.min(times.length, 5); i++) {
      var d = new Date(times[i] + 'T00:00:00');
      var code = daily.weather_code ? daily.weather_code[i] : cur.weather_code;
      var dayInfo = weatherInfo(code);

      var cell = el('div', 'fc');
      cell.appendChild(el('div', 'fc-day', SHORT_DAYS[d.getDay()]));

      var icon = el('div', 'fc-icon');
      icon.innerHTML = '<svg class="ic"><use href="#' +
        weatherIconId(dayInfo[1]) + '"></use></svg>';
      cell.appendChild(icon);

      var temp = el('div', 'fc-temp', Math.round(daily.temperature_2m_max[i]) + '°');
      temp.appendChild(el('span', null, Math.round(daily.temperature_2m_min[i]) + '°'));
      cell.appendChild(temp);
      box.appendChild(cell);
    }
  }

  /* ------------------------------------------------------------------ *
   * network helpers
   * ------------------------------------------------------------------ */

  function withTimeout(url, ms) {
    if (typeof AbortController === 'undefined') {
      return fetch(url, { cache: 'no-store' });
    }
    var ctrl = new AbortController();
    var timer = setTimeout(function () { ctrl.abort(); }, ms || 9000);
    return fetch(url, { signal: ctrl.signal, cache: 'no-store' })
      .then(function (response) {
        clearTimeout(timer);
        return response;
      }, function (error) {
        clearTimeout(timer);
        throw error;
      });
  }

  function fetchJson(url) {
    return withTimeout(url).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    });
  }

  function fetchText(url) {
    return withTimeout(url).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.text();
    });
  }

  /* ------------------------------------------------------------------ *
   * market ticker
   * ------------------------------------------------------------------ */

  var tickerTimer = null;

  function loadMarket() {
    var ticker = $('#ticker');
    if (!state.showMarket) { ticker.hidden = true; return; }

    var jobs = [];

    jobs.push(fetchJson('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum&vs_currencies=usd&include_24hr_change=true')
      .then(function (data) {
        var out = [];
        [['bitcoin', 'BTC'], ['ethereum', 'ETH']].forEach(function (pair) {
          var item = data[pair[0]];
          if (!item) return;
          var change = item.usd_24h_change;
          out.push({
            label: pair[1],
            value: '$' + Number(item.usd).toLocaleString('en-US', { maximumFractionDigits: 0 }),
            change: change
          });
        });
        return out;
      }));

    jobs.push(fetchJson('https://open.er-api.com/v6/latest/USD')
      .then(function (data) {
        var rates = data.rates || {};
        var out = [];
        var fmt = function (value) {
          return Number(value).toLocaleString('vi-VN', { maximumFractionDigits: 0 }) + ' đ';
        };
        if (rates.VND) {
          out.push({ label: 'USD/VND', value: fmt(rates.VND) });
          if (rates.EUR) out.push({ label: 'EUR/VND', value: fmt(rates.VND / rates.EUR) });
          if (rates.JPY) out.push({ label: 'JPY/VND', value: Number(rates.VND / rates.JPY).toFixed(1) + ' đ' });
          if (rates.GBP) out.push({ label: 'GBP/VND', value: fmt(rates.VND / rates.GBP) });
        }
        return out;
      }));

    Promise.allSettled(jobs).then(function (results) {
      var items = [];
      results.forEach(function (r) { if (r.status === 'fulfilled') items = items.concat(r.value); });
      if (!items.length) { ticker.hidden = true; return; }
      renderTicker(items);
      ticker.hidden = false;
    });

    clearInterval(tickerTimer);
    tickerTimer = setInterval(loadMarket, 10 * 60 * 1000);
  }

  var tickerAnim = null;

  function renderTicker(items) {
    var track = $('#ticker-track');
    var view = track.parentElement;
    track.innerHTML = '';
    if (tickerAnim) { tickerAnim.cancel(); tickerAnim = null; }

    var copy = el('div', 'ticker-copy');
    items.forEach(function (item, index) {
      var node = el('div', 'tick');
      node.appendChild(el('span', null, item.label));
      node.appendChild(el('b', null, item.value));
      if (typeof item.change === 'number' && !isNaN(item.change)) {
        var cls = item.change >= 0 ? 'up' : 'down';
        node.appendChild(el('span', cls,
          (item.change >= 0 ? '▲ ' : '▼ ') + Math.abs(item.change).toFixed(2) + '%'));
      }
      if (index < items.length - 1) node.appendChild(el('span', null, '·'));
      copy.appendChild(node);
    });
    track.appendChild(copy);

    var width = copy.getBoundingClientRect().width;
    if (width > view.clientWidth) {
      track.appendChild(copy.cloneNode(true));
      var span = width + 26;
      tickerAnim = track.animate(
        [{ transform: 'translateX(0)' }, { transform: 'translateX(-' + span + 'px)' }],
        { duration: (span / 40) * 1000, iterations: Infinity, easing: 'linear' }
      );
    }
  }

  /* ------------------------------------------------------------------ *
   * channels
   * ------------------------------------------------------------------ */

  var Channels = {
    list: function () {
      var source = state.source;
      if (source === 'vn') return DATA.vn;
      if (source === 'intl') return DATA.intl;
      return state.custom;
    },
    sourceName: function () {
      if (state.source === 'vn') return 'Việt Nam';
      if (state.source === 'intl') return 'Quốc tế';
      return 'M3U của tôi';
    },
    filtered: function () {
      var all = Channels.list();
      if (state.filter === 'fav') {
        return all.filter(function (c) { return state.favorites.indexOf(c.id) !== -1; });
      }
      if (state.filter === 'recent') {
        var out = [];
        state.recent.forEach(function (id) {
          var found = all.filter(function (c) { return c.id === id; })[0];
          if (found) out.push(found);
        });
        return out;
      }
      return all;
    },
    byId: function (id) {
      var pools = [Channels.list(), DATA.vn, DATA.intl, state.custom];
      for (var p = 0; p < pools.length; p++) {
        var pool = pools[p] || [];
        for (var i = 0; i < pool.length; i++) {
          if (pool[i].id === id) return pool[i];
        }
      }
      return null;
    },
    toggleFavorite: function (id) {
      var index = state.favorites.indexOf(id);
      if (index === -1) state.favorites.push(id);
      else state.favorites.splice(index, 1);
      saveState();
      renderChannels();
    }
  };

  var CHUNK = 40;

  function channelCard(channel, index, onPick) {
    var card = el('button', 'chan');
    card.setAttribute('data-focus', '');
    card.dataset.index = String(index);
    card.dataset.id = channel.id;

    var logo = el('div', 'chan-logo');
    fillLogo(logo, channel);
    if (state.favorites.indexOf(channel.id) !== -1) {
      logo.appendChild(el('span', 'star', '★'));
    }
    card.appendChild(logo);
    card.appendChild(el('div', 'chan-name', channel.name));
    card.appendChild(el('div', 'chan-cat', channel.category || ''));

    card.addEventListener('click', function () {
      if (onPick) { onPick(channel, index); return; }
      playChannel(index);
    });
    card.addEventListener('contextmenu', function (e) {
      e.preventDefault();
      Channels.toggleFavorite(channel.id);
    });
    return card;
  }

  var renderedCount = 0;
  var flatRow = null;

  var GROUP_ORDER = ['VTV', 'VTVcab', 'HTV', 'Vĩnh Long', 'Miền Bắc', 'Miền Trung', 'Miền Nam',
    'Tin tức', 'Radio', 'Địa phương', 'Giao thông', 'Âm nhạc', 'Quốc tế', 'VOV'];

  function groupChannels(list) {
    var order = [];
    var buckets = {};
    list.forEach(function (channel) {
      var group = channel.category || 'Khác';
      if (!buckets[group]) {
        buckets[group] = [];
        order.push(group);
      }
      buckets[group].push(channel);
    });
    order.sort(function (a, b) {
      var ia = GROUP_ORDER.indexOf(a);
      var ib = GROUP_ORDER.indexOf(b);
      if (ia === -1) ia = GROUP_ORDER.length;
      if (ib === -1) ib = GROUP_ORDER.length;
      if (ia !== ib) return ia - ib;
      return a.localeCompare(b, 'vi');
    });
    return order.map(function (group) {
      return { name: group, channels: buckets[group] };
    });
  }

  function renderChannels() {
    var wrap = $('#tv-row');
    var list = Channels.filtered();
    wrap.innerHTML = '';
    renderedCount = 0;
    flatRow = null;
    $('#tv-empty').hidden = list.length > 0;
    $('#btn-source').textContent = 'Nguồn: ' + Channels.sourceName();
    if (!list.length) {
      $('#tv-empty').textContent = state.filter === 'fav'
        ? 'Chưa có kênh yêu thích. Giữ OK trên một kênh để thêm vào yêu thích.'
        : state.filter === 'recent'
          ? 'Chưa xem kênh nào gần đây.'
          : 'Chưa có kênh. Dùng "Nhập M3U" để thêm danh sách kênh.';
      return;
    }

    var groups = groupChannels(list);
    // Small enough lists are laid out one row per group-title, like the
    // playlist format described in the content guide. Huge lists stay a
    // single lazily extended row so the TV does not build 1000 cards at once.
    if (groups.length > 1 && list.length <= 220) {
      var frag = document.createDocumentFragment();
      groups.forEach(function (group) {
        var block = el('div', 'tv-group');
        block.appendChild(el('div', 'group-head', group.name));
        // grid, so a group wraps onto as many lines as it needs instead of
        // running off the right edge of the screen
        var grid = el('div', 'tv-grid');
        group.channels.forEach(function (channel) {
          grid.appendChild(channelCard(channel, list.indexOf(channel)));
        });
        block.appendChild(grid);
        frag.appendChild(block);
      });
      wrap.appendChild(frag);
      return;
    }

    flatRow = el('div', 'row');
    wrap.appendChild(flatRow);
    appendChunk();
  }

  function appendChunk() {
    if (!flatRow) return;
    var list = Channels.filtered();
    var end = Math.min(renderedCount + CHUNK, list.length);
    var frag = document.createDocumentFragment();
    for (var i = renderedCount; i < end; i++) frag.appendChild(channelCard(list[i], i));
    flatRow.appendChild(frag);
    renderedCount = end;
  }

  // infinite horizontal scroll for the flat (long) list
  document.addEventListener('scroll', function (e) {
    var row = e.target;
    if (!row || !row.classList || !row.classList.contains('row')) return;
    if (row !== flatRow) return;
    if (row.scrollLeft + row.clientWidth > row.scrollWidth - 600) appendChunk();
  }, true);

  // when focus gets near the end, extend the flat row
  document.addEventListener('focusin', function (e) {
    var card = e.target.closest ? e.target.closest('.chan') : null;
    if (!card || !flatRow || !flatRow.contains(card)) return;
    if (renderedCount < Channels.filtered().length) {
      var index = Number(card.dataset.index);
      if (index > renderedCount - 8) appendChunk();
    }
  });

  /* ------------------------------------------------------------------ *
   * EPG - lịch phát sóng
   * ------------------------------------------------------------------ */

  var EPG_API = 'https://lichphatsong.io.vn/api/v1/guide?channel=';

  var EPG = {
    map: window.LP_EPG || {},
    cache: {},

    idFor: function (channel) {
      return channel ? (this.map[channel.id] || null) : null;
    },

    /* A channel has a schedule when VNEPG knows its id, or when the imported
       playlist declared an XMLTV guide (x-tvg-url) we can read. */
    available: function (channel) {
      if (this.idFor(channel)) return true;
      return !!(state.source === 'custom' && state.customEpgUrl);
    },

    _xmltv: { url: null, at: 0, map: null, pending: null },

    /* XMLTV (guide.xml / guide.xml.gz) as declared by the playlist header. */
    loadXmltv: function (url) {
      var self = this;
      var cache = this._xmltv;
      if (cache.map && cache.url === url && Date.now() - cache.at < 30 * 60 * 1000) {
        return Promise.resolve(cache.map);
      }
      if (cache.pending && cache.pending.url === url) return cache.pending.promise;

      var ids = {};
      Channels.list().forEach(function (c) { ids[c.id] = true; });

      var promise = withTimeout(url, 25000).then(function (response) {
        if (!response.ok) throw new Error('HTTP ' + response.status);
        return response.arrayBuffer();
      }).then(function (buffer) {
        var bytes = new Uint8Array(buffer);
        if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
          if (typeof DecompressionStream === 'undefined') throw new Error('no gunzip');
          var stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
          return new Response(stream).text();
        }
        return new TextDecoder('utf-8').decode(bytes);
      }).then(function (xml) {
        var map = {};
        var pattern = /<programme\b([^>]*)>([\s\S]*?)<\/programme>/g;
        var match;
        while ((match = pattern.exec(xml))) {
          var attrs = match[1];
          var channel = /channel="([^"]+)"/.exec(attrs);
          if (!channel || !ids[channel[1]]) continue;
          var start = /start="([^"]+)"/.exec(attrs);
          var stop = /stop="([^"]+)"/.exec(attrs);
          var title = /<title[^>]*>([\s\S]*?)<\/title>/.exec(match[2]);
          var desc = /<desc[^>]*>([\s\S]*?)<\/desc>/.exec(match[2]);
          var entry = {
            start: parseXmltvTime(start && start[1]),
            stop: parseXmltvTime(stop && stop[1]),
            title: title ? decodeEntities(title[1]).trim() : 'Chưa rõ tên',
            description: desc ? decodeEntities(desc[1]).trim() : ''
          };
          if (!entry.start || !entry.stop) continue;
          (map[channel[1]] = map[channel[1]] || []).push(entry);
        }
        Object.keys(map).forEach(function (key) {
          map[key].sort(function (a, b) { return a.start - b.start; });
        });
        cache.url = url;
        cache.at = Date.now();
        cache.map = map;
        cache.pending = null;
        return map;
      }).catch(function (error) {
        cache.pending = null;
        throw error;
      });

      cache.pending = { url: url, promise: promise };
      return promise;
    },

    get: function (channel) {
      var id = this.idFor(channel);
      if (!id) {
        if (!this.available(channel)) return Promise.resolve(null);
        return this.loadXmltv(state.customEpgUrl).then(function (map) {
          return map[channel.id] || null;
        }).catch(function () { return null; });
      }
      var hit = this.cache[id];
      if (hit && Date.now() - hit.at < 10 * 60 * 1000) return Promise.resolve(hit.list);

      return fetchJson(EPG_API + encodeURIComponent(id)).then(function (body) {
        var list = ((body && body.data) || []).map(function (p) {
          return {
            start: new Date(p.start).getTime(),
            stop: new Date(p.stop).getTime(),
            title: p.title || 'Chưa rõ tên',
            description: p.description || ''
          };
        }).filter(function (p) {
          return p.start && p.stop && p.stop > p.start;
        }).sort(function (a, b) { return a.start - b.start; });

        EPG.cache[id] = { at: Date.now(), list: list };
        return list;
      }).catch(function () { return null; });
    },

    today: function (list) {
      return this.dayList(list, 0);
    },

    /* Programmes of the day <offset> days from today (0 = today). */
    dayList: function (list, offset) {
      var target = new Date();
      target.setDate(target.getDate() + (offset || 0));
      var y = target.getFullYear(), m = target.getMonth(), d = target.getDate();
      return (list || []).filter(function (p) {
        var s = new Date(p.start);
        return s.getFullYear() === y && s.getMonth() === m && s.getDate() === d;
      });
    },

    dayLabel: function (offset) {
      var target = new Date();
      target.setDate(target.getDate() + (offset || 0));
      var label = offset === 0 ? 'Hôm nay' : WEEKDAYS[target.getDay()];
      return label + ' · ' + pad2(target.getDate()) + '/' + pad2(target.getMonth() + 1);
    },

    /* First/last day covered by the guide, as offsets from today. */
    dayBounds: function (list) {
      if (!list || !list.length) return { min: 0, max: 0 };
      var today = new Date();
      var base = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
      var toOffset = function (time) {
        var d = new Date(time);
        var start = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
        return Math.round((start - base) / 86400000);
      };
      return {
        min: toOffset(list[0].start),
        max: toOffset(list[list.length - 1].start)
      };
    },

    nowNext: function (list) {
      var now = Date.now();
      var live = null, next = null;
      (list || []).forEach(function (p) {
        if (p.start <= now && now < p.stop) live = p;
        else if (p.start > now && (!next || p.start < next.start)) next = p;
      });
      return { live: live, next: next };
    }
  };

  function clock(timestamp) {
    var d = new Date(timestamp);
    return pad2(d.getHours()) + ':' + pad2(d.getMinutes());
  }

  function decodeEntities(text) {
    return String(text)
      .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#0?39;/g, "'")
      .replace(/&amp;/g, '&');
  }

  /* XMLTV timestamps look like "20261101194000 +0700". */
  function parseXmltvTime(value) {
    if (!value) return 0;
    var m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})?\s*([+-]\d{4})?/.exec(value);
    if (!m) return 0;
    var offset = m[7] ? m[7].slice(0, 3) + ':' + m[7].slice(3) : 'Z';
    var iso = m[1] + '-' + m[2] + '-' + m[3] + 'T' + m[4] + ':' + m[5] + ':' +
      (m[6] || '00') + offset;
    var time = Date.parse(iso);
    return isNaN(time) ? 0 : time;
  }

  var guideState = { channel: null };

  function openGuide(channel) {
    var list = Channels.list().filter(function (c) { return EPG.available(c); });
    if (!list.length) {
      toast('Nguồn kênh này chưa có lịch phát sóng');
      return;
    }
    var start = channel ||
      (state.lastChannel ? Channels.byId(state.lastChannel) : null) ||
      list[0];
    if (list.indexOf(start) === -1) start = list[0];

    openSheet('Lịch phát sóng', function (body) {
      var wrap = el('div', 'guide');
      var left = el('div', 'guide-channels');
      var right = el('div', 'guide-panel');
      wrap.appendChild(left);
      wrap.appendChild(right);
      body.appendChild(wrap);

      var guideData = null;
      var guideDay = 0;

      var head = el('div', 'guide-head');
      var title = el('div', 'guide-title');
      var headActions = el('div', 'guide-head-actions');
      var dayPrev = el('button', 'pill ghost', '‹ Ngày trước');
      var dayPill = el('div', 'guide-date');
      var dayNext = el('button', 'pill ghost', 'Ngày sau ›');
      dayPrev.setAttribute('data-focus', '');
      dayNext.setAttribute('data-focus', '');
      headActions.appendChild(dayPrev);
      headActions.appendChild(dayPill);
      headActions.appendChild(dayNext);
      head.appendChild(title);
      head.appendChild(headActions);

      var status = el('div', 'guide-status', 'Chọn một kênh để xem lịch.');
      var rows = el('div', 'guide-list');
      right.appendChild(head);
      right.appendChild(status);
      right.appendChild(rows);

      function paintGuide() {
        dayPill.textContent = EPG.dayLabel(guideDay);
        var bounds = EPG.dayBounds(guideData || []);
        dayPrev.disabled = guideDay <= bounds.min;
        dayNext.disabled = guideDay >= bounds.max;

        var programmes = EPG.dayList(guideData, guideDay);
        rows.innerHTML = '';
        if (!programmes.length) {
          status.textContent = 'Không có dữ liệu cho ngày này.';
          return;
        }
        var nowNext = guideDay === 0 ? EPG.nowNext(programmes) : { live: null };
        status.textContent = nowNext.live
          ? 'Đang phát: ' + nowNext.live.title
          : programmes.length + ' chương trình';

        var frag = document.createDocumentFragment();
        programmes.forEach(function (programme) {
          var row = el('div', 'epg-row' + (nowNext.live === programme ? ' current' : ''));
          row.appendChild(el('time', null, clock(programme.start) + ' – ' + clock(programme.stop)));
          var box = el('div', 'epg-title', programme.title);
          if (programme.description) box.appendChild(el('small', null, programme.description));
          row.appendChild(box);
          frag.appendChild(row);
        });
        rows.appendChild(frag);
        rows.scrollTop = 0;
        if (guideDay === 0) {
          // Scroll only the programme list, never the panel around it.
          var currentRow = rows.querySelector('.epg-row.current');
          if (currentRow) {
            var offset = currentRow.getBoundingClientRect().top -
              rows.getBoundingClientRect().top + rows.scrollTop;
            rows.scrollTop = Math.max(0, offset - rows.clientHeight / 2 + currentRow.offsetHeight / 2);
          }
        }
      }

      dayPrev.addEventListener('click', function () {
        if (dayPrev.disabled) return;
        guideDay -= 1;
        paintGuide();
      });
      dayNext.addEventListener('click', function () {
        if (dayNext.disabled) return;
        guideDay += 1;
        paintGuide();
      });

      function select(target) {
        guideState.channel = target;
        $$('.guide-chan', left).forEach(function (button) {
          button.classList.toggle('is-active', button.dataset.id === target.id);
        });
        title.textContent = target.name;
        status.textContent = 'Đang tải lịch…';
        rows.innerHTML = '';
        guideData = null;
        guideDay = 0;

        EPG.get(target).then(function (data) {
          if (guideState.channel !== target) return;
          if (data === null) {
            status.textContent = 'Không tải được lịch phát sóng cho kênh này.';
            return;
          }
          guideData = data;
          paintGuide();
        });
      }

      list.forEach(function (c) {
        var button = el('button', 'guide-chan');
        button.setAttribute('data-focus', '');
        button.dataset.id = c.id;
        var logo = el('span', 'guide-logo');
        fillLogo(logo, c, true);
        button.appendChild(logo);
        button.appendChild(el('span', 'guide-name', c.name));
        button.addEventListener('click', function () { select(c); });
        left.appendChild(button);
      });

      select(start);
    });
  }

  /* player ---------------------------------------------------------- */

  var Player = {
    open: false,
    zapOpen: false,
    epgOpen: false,
    list: [],
    index: 0,
    osdTimer: null,
    hls: null,
    hlsLoading: null,
    streamToken: 0,
    streamRetries: 0,
    streamTimer: null,
    avplayActive: false,
    avplayPreparing: false,
    avplayFailed: false,

    useAvplay: function () {
      return !!(window.webapis && window.webapis.avplay);
    },

    stopAvplay: function () {
      if (this.useAvplay()) {
        try { window.webapis.avplay.stop(); } catch (e) {}
        try { window.webapis.avplay.close(); } catch (e) {}
      }
      this.avplayActive = false;
      this.avplayPreparing = false;
      // Restore the normal Home UI after the native video plane is closed.
      document.documentElement.classList.remove('avplay-on');
    },

    startAvplay: function (url) {
      if (!this.useAvplay()) return false;
      var self = this;
      var api = window.webapis.avplay;
      var token = this.streamToken;
      this.stopAvplay();
      try {
        // AVPlay renders on a native plane underneath the WebView. Make the
        // WebView transparent first, otherwise its black page/player layer
        // hides the picture while the audio remains audible.
        document.documentElement.classList.add('avplay-on');
        api.open(url);
        this.avplayActive = true;
        this.avplayPreparing = true;
        // Samsung uses logical 1920x1080 coordinates even for 4K panels.
        api.setDisplayRect(0, 0, 1920, 1080);
        try { api.setDisplayMethod('PLAYER_DISPLAY_MODE_LETTER_BOX'); } catch (e) {}
        try { api.setBufferingParam('PLAYER_BUFFER_FOR_PLAY', 'PLAYER_BUFFER_SIZE_IN_SECOND', 4); } catch (e) {}
        api.setListener({
          onbufferingstart: function () {
            if (token !== self.streamToken) return;
            $('#osd-status').textContent = 'Đang tải hình ảnh…';
            self.armStreamTimer();
          },
          onbufferingcomplete: function () {
            if (token !== self.streamToken) return;
            self.clearStreamTimer();
            var hasVideo = true;
            try {
              var streams = api.getCurrentStreamInfo() || [];
              hasVideo = streams.some(function (item) { return item.type === 'VIDEO'; });
              console.log('[GoSamTV AVPlay] streams=' + JSON.stringify(streams));
            } catch (e) { console.log('[GoSamTV AVPlay] stream info: ' + e); }
            $('#osd-status').textContent = hasVideo ? 'Đang phát (Samsung)' : 'Nguồn này không có luồng hình ảnh';
          },
          oncurrentplaytime: function () {
            if (token !== self.streamToken) return;
            self.clearStreamTimer();
            self.streamRetries = 0;
            $('#osd-status').textContent = 'Đang phát (Samsung)';
          },
          onerror: function (err) {
            if (token !== self.streamToken) return;
            $('#osd-status').textContent = 'Luồng lỗi: ' + String(err);
            self.armStreamTimer();
          },
          onerrormsg: function (type, msg) {
            if (token !== self.streamToken) return;
            $('#osd-status').textContent = 'Không thể giải mã kênh';
            self.armStreamTimer();
          }
        });
        api.prepareAsync(function () {
          if (token !== self.streamToken || !self.open) return;
          self.avplayPreparing = false;
          // Re-apply the full-screen native video rectangle once the stream
          // is READY; this also handles TVs that reset it during prepareAsync.
          try { api.setDisplayRect(0, 0, 1920, 1080); } catch (e) {}
          try { api.setDisplayMethod('PLAYER_DISPLAY_MODE_LETTER_BOX'); } catch (e) {}
          try { api.play(); } catch (e) { self.armStreamTimer(); }
        }, function () {
          if (token !== self.streamToken) return;
          self.avplayPreparing = false;
          $('#osd-status').textContent = 'Kênh không tương thích — đang thử lại';
          self.armStreamTimer();
        });
        return true;
      } catch (e) {
        this.stopAvplay();
        return false;
      }
    },

    clearStreamTimer: function () {
      clearTimeout(this.streamTimer);
      this.streamTimer = null;
    },

    armStreamTimer: function () {
      var self = this;
      var token = this.streamToken;
      this.clearStreamTimer();
      this.streamTimer = setTimeout(function () {
        if (!self.open || token !== self.streamToken) return;
        var video = $('#video');
        if (self.avplayActive) {
          try {
            if (window.webapis.avplay.getState() === 'PLAYING') return;
          } catch (e) {}
        } else if (video.readyState >= 3 && !video.paused) return;
        if (self.streamRetries >= 2) {
          $('#osd-status').textContent = 'Luồng không phản hồi — chọn kênh khác';
          return;
        }
        self.streamRetries++;
        $('#osd-status').textContent = 'Đang thử kết nối lại (' + self.streamRetries + '/2)…';
        var channel = self.list[self.index];
        if (!channel) return;
        if (self.useAvplay() && self.startAvplay(channel.url)) {
          self.armStreamTimer();
        } else {
          self.attach(video, channel.url);
          self.safePlay(video);
          self.armStreamTimer();
        }
      }, 14000);
    },

    safePlay: function (video) {
      try {
        var result = video.play();
        // Older Samsung Tizen engines return undefined, not a Promise.
        if (result && typeof result.catch === 'function') {
          result.catch(function () {
            $('#osd-status').textContent = 'Nhấn OK để phát kênh';
          });
        }
      } catch (e) {
        $('#osd-status').textContent = 'Không thể khởi động video';
      }
    },

    /* Tizen plays HLS natively; desktop Chrome/Firefox do not, so the web
       build lazily loads hls.js the first time it is needed. */
    nativeHls: function () {
      var video = $('#video');
      return !!(video.canPlayType('application/vnd.apple.mpegurl') ||
        video.canPlayType('application/x-mpegURL'));
    },

    loadHlsJs: function () {
      if (window.Hls) return Promise.resolve(true);
      if (this.hlsLoading) return this.hlsLoading;
      var self = this;
      this.hlsLoading = new Promise(function (resolve) {
        var script = document.createElement('script');
        script.src = 'vendor/hls.min.js';
        script.onload = function () { resolve(!!window.Hls); };
        script.onerror = function () { resolve(false); };
        document.head.appendChild(script);
      }).then(function (ok) {
        if (!ok) self.hlsLoading = null;
        return ok;
      });
      return this.hlsLoading;
    },

    attach: function (video, url) {
      var self = this;
      this.detach(video);

      var isStream = /\.m3u8(\?|$)/i.test(url);
      if (!isStream || this.nativeHls()) {
        video.src = url;
        return;
      }

      var token = this.streamToken;
      this.loadHlsJs().then(function (ok) {
        // Loading the player script may finish after channel switch or exit.
        if (!self.open || token !== self.streamToken) return;
        if (!ok || !window.Hls || !window.Hls.isSupported()) {
          video.src = url;   // last resort: let the browser try
          self.safePlay(video);
          return;
        }
        var hls = new window.Hls({ lowLatencyMode: false, enableWorker: false });
        self.hls = hls;
        hls.loadSource(url);
        hls.attachMedia(video);
        hls.on(window.Hls.Events.ERROR, function (event, data) {
          if (!data || !data.fatal) return;
          if (data.type === window.Hls.ErrorTypes.NETWORK_ERROR) hls.startLoad();
          else if (data.type === window.Hls.ErrorTypes.MEDIA_ERROR) hls.recoverMediaError();
          else {
            $('#osd-status').textContent = 'Kênh đang lỗi — thử kênh khác';
            try { hls.destroy(); } catch (e) { /* ignore */ }
          }
        });
        $('#osd-status').textContent = 'Đang kết nối (web)…';
        self.safePlay(video);
      });
    },

    detach: function (video) {
      if (this.hls) {
        try { this.hls.destroy(); } catch (e) { /* ignore */ }
        this.hls = null;
      }
      video.removeAttribute('src');
      video.load();
    },

    play: function (list, index) {
      this.list = list;
      this.index = index;
      this.streamToken++;
      this.streamRetries = 0;
      this.clearStreamTimer();
      this.stopAvplay();
      var channel = list[index];
      if (!channel) return;

      this.open = true;
      $('#player').hidden = false;
      var video = $('#video');
      var isRadio = channel.type === 'radio';
      var stage = $('#radio-stage');
      stage.hidden = !isRadio;
      video.classList.toggle('audio-only', isRadio);
      if (isRadio) {
        var art = $('#radio-art');
        fillLogo(art, channel);
        $('#radio-title').textContent = channel.name;
      }
      if (this.useAvplay() && this.startAvplay(channel.url)) {
        video.style.display = 'none';
      } else {
        video.style.display = '';
        this.attach(video, channel.url);
        this.safePlay(video);
      }
      this.armStreamTimer();
      $('#osd-title').textContent = channel.name;
      $('#osd-sub').textContent = isRadio ? 'Radio' : (channel.category || '');
      $('#osd-next').textContent = '';
      $('#osd-index').textContent = String(index + 1);
      $('#osd-status').textContent = 'Đang kết nối…';
      this.showOsd();

      var self = this;
      EPG.get(channel).then(function (data) {
        if (!self.open || self.list[self.index] !== channel || !data) return;
        var nowNext = EPG.nowNext(data);
        if (!nowNext.live) return;
        $('#osd-sub').textContent = (channel.category ? channel.category + ' · ' : '') +
          'Đang phát: ' + nowNext.live.title;
        if (nowNext.next) {
          $('#osd-next').textContent = 'Tiếp theo ' + clock(nowNext.next.start) + ': ' + nowNext.next.title;
        }
      });

      state.lastChannel = channel.id;
      state.recent = [channel.id].concat(state.recent.filter(function (id) { return id !== channel.id; })).slice(0, 12);
      saveState();
      renderResume();
    },

    showOsd: function () {
      var osd = $('#osd');
      var hint = $('#player-hint');
      osd.classList.add('show');
      // The bottom hint would sit under the side panels.
      if (!this.zapOpen && !this.epgOpen) hint.classList.add('show');
      clearTimeout(this.osdTimer);
      var self = this;
      this.osdTimer = setTimeout(function () {
        osd.classList.remove('show');
        hint.classList.remove('show');
      }, 4200);
    },

    toggleOsd: function () {
      var osd = $('#osd');
      if (osd.classList.contains('show')) {
        osd.classList.remove('show');
        $('#player-hint').classList.remove('show');
        clearTimeout(this.osdTimer);
      } else {
        this.showOsd();
      }
    },

    step: function (delta) {
      if (!this.list.length) return;
      var next = (this.index + delta + this.list.length) % this.list.length;
      this.play(this.list, next);
    },

    close: function () {
      this.open = false;
      this.streamToken++;
      this.clearStreamTimer();
      this.stopAvplay();
      closeZap();
      closeEpgPanel();
      var video = $('#video');
      try { video.pause(); } catch (e) {}
      this.detach(video);
      video.style.display = '';
      video.classList.remove('audio-only');
      $('#radio-stage').hidden = true;
      $('#player').hidden = true;
      clearTimeout(this.osdTimer);
      renderResume();
      var target = $('#hero-resume');
      if (visible(target)) Focus.set(target);
    }
  };

  function playChannel(index) {
    var list = Channels.filtered();
    Player.play(list, index);
  }

  /* Channel picker: press ◀ while watching. Channels are listed under the
     group-title headings from the playlist (VTV, Vĩnh Long, VTVcab, ...). */
  var zapFavMode = false;

  function renderZap() {
    var list = Player.list;
    var box = $('#zap-list');
    box.innerHTML = '';
    var frag = document.createDocumentFragment();
    var currentItem = null;

    function makeTile(channel) {
      var index = list.indexOf(channel);
      var item = el('button', 'zap-item' + (index === Player.index ? ' is-current' : ''));
      item.setAttribute('data-focus', '');
      item.dataset.index = String(index);
      item.dataset.id = channel.id;

      var logo = el('span', 'zap-logo');
      fillLogo(logo, channel, true);
      item.appendChild(logo);

      var meta = el('span', 'zap-meta');
      meta.appendChild(el('span', 'zap-name', channel.name));
      meta.appendChild(el('span', 'zap-cat', channel.category || ''));
      item.appendChild(meta);

      if (state.favorites.indexOf(channel.id) !== -1) {
        item.appendChild(el('span', 'zap-star', '★'));
      }
      if (index === Player.index) {
        item.appendChild(el('span', 'zap-badge', 'Đang xem'));
        currentItem = item;
      }

      item.addEventListener('click', function () {
        if (zapFavMode) {
          Channels.toggleFavorite(channel.id);
          renderZap();
          var again = $('#zap-list .zap-item[data-id="' + channel.id + '"]');
          if (again) Focus.set(again);
          toast(state.favorites.indexOf(channel.id) !== -1
            ? 'Đã thêm ' + channel.name + ' vào yêu thích'
            : 'Đã bỏ ' + channel.name + ' khỏi yêu thích');
          return;
        }
        closeZap();
        Player.play(Player.list, index);
      });
      return item;
    }

    var favourites = list.filter(function (c) {
      return state.favorites.indexOf(c.id) !== -1;
    });
    if (favourites.length) {
      frag.appendChild(el('div', 'zap-section', '★ Yêu thích · ' + favourites.length));
      favourites.forEach(function (channel) { frag.appendChild(makeTile(channel)); });
    }

    groupChannels(list).forEach(function (group) {
      frag.appendChild(el('div', 'zap-section', group.name));
      group.channels.forEach(function (channel) { frag.appendChild(makeTile(channel)); });
    });

    box.appendChild(frag);
    $('#zap-count').textContent = list.length + ' kênh';

    var favButton = $('#zap-favmode');
    if (favButton) {
      favButton.classList.toggle('is-on', zapFavMode);
      favButton.textContent = zapFavMode ? '★ Đang sửa yêu thích' : '☆ Sửa yêu thích';
    }

    return currentItem || box.querySelector('.zap-item');
  }

  function openZap() {
    if (!Player.open || Player.zapOpen) return;
    var current = renderZap();
    $('#zap').hidden = false;
    Player.zapOpen = true;
    $('#player-hint').classList.remove('show');
    Player.showOsd();
    if (current) Focus.set(current);
  }

  function closeZap() {
    var panel = $('#zap');
    if (!panel || panel.hidden) return;
    panel.hidden = true;
    Player.zapOpen = false;
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
  }

  /* Schedule of the channel being watched, with the channel list on the left
     so other channels' schedules can be checked before switching. */
  var epgSelected = null;
  var epgData = [];
  var epgDayOffset = 0;

  function showSchedule(channel) {
    var list = $('#epg-panel-list');
    if (list.dataset.channel === channel.id) return;
    list.dataset.channel = channel.id;
    epgSelected = channel;
    $('#epg-panel-sub').textContent = channel.name;
    list.innerHTML = '<div class="epg-status">Đang tải lịch phát sóng…</div>';

    EPG.get(channel).then(function (data) {
      if (!Player.epgOpen || epgSelected !== channel) return;
      if (channel.type === 'radio') {
        list.innerHTML = '<div class="epg-status">Đài radio không có lịch phát sóng. ' +
          'Dùng ◀ để mở danh sách kênh.</div>';
        return;
      }
      epgData = data || [];
      var bounds = EPG.dayBounds(epgData);
      epgDayOffset = Math.min(bounds.max, Math.max(bounds.min, 0));
      renderSchedule();
      if (epgDayOffset === 0) {
        var currentRow = list.querySelector('.epg-row.current');
        if (currentRow) {
          var top = currentRow.getBoundingClientRect().top -
            list.getBoundingClientRect().top + list.scrollTop;
          list.scrollTop = Math.max(0, top - 30);
        }
      } else {
        list.scrollTop = 0;
      }
    });
  }

  /* Draws the selected channel's schedule for epgDayOffset (0 = today). */
  function renderSchedule() {
    var list = $('#epg-panel-list');
    $('#epg-today').textContent = EPG.dayLabel(epgDayOffset);
    var bounds = EPG.dayBounds(epgData);
    $('#epg-prev').disabled = epgDayOffset <= bounds.min;
    $('#epg-next').disabled = epgDayOffset >= bounds.max;

    var programmes = EPG.dayList(epgData, epgDayOffset);
    if (!programmes.length) {
      list.innerHTML = '<div class="epg-status">Không có dữ liệu cho ngày này.</div>';
      return;
    }

    var nowNext = epgDayOffset === 0 ? EPG.nowNext(programmes) : { live: null, next: null };
    list.innerHTML = '';
    var frag = document.createDocumentFragment();
    programmes.forEach(function (programme) {
      var row = el('div', 'epg-row' + (nowNext.live === programme ? ' current' : ''));
      // Focusable so ▶ from the channel column drops into the programme list
      // and ▲▼ scroll it row by row.
      row.setAttribute('data-focus', '');
      row.tabIndex = -1;
      row.appendChild(el('time', null, clock(programme.start) + ' – ' + clock(programme.stop)));
      var box = el('div', 'epg-title', programme.title);
      if (programme.description) box.appendChild(el('small', null, programme.description));
      row.appendChild(box);
      frag.appendChild(row);
    });
    list.appendChild(frag);
  }

  function shiftScheduleDay(delta) {
    if (!epgData || !epgData.length) return;
    var bounds = EPG.dayBounds(epgData);
    var next = epgDayOffset + delta;
    if (next < bounds.min || next > bounds.max) {
      toast(next < bounds.min ? 'Đã là ngày sớm nhất trong lịch' : 'Đã là ngày muộn nhất trong lịch');
      return;
    }
    var inList = !!document.activeElement &&
      $('#epg-panel-list').contains(document.activeElement);
    epgDayOffset = next;
    renderSchedule();
    var list = $('#epg-panel-list');
    list.scrollTop = 0;
    if (inList) {
      var first = list.querySelector('.epg-row');
      if (first) Focus.set(first);
    }
    keepDaybarFocus();
    Player.showOsd();
  }

  /* A day button that just became disabled cannot hold focus. */
  function keepDaybarFocus() {
    var active = document.activeElement;
    if (!active || !active.disabled) return;
    var fallback = !$('#epg-prev').disabled ? $('#epg-prev') : $('#epg-next');
    if (fallback) Focus.set(fallback);
  }

  function openEpgPanel() {
    if (!Player.open || Player.epgOpen) return;
    var box = $('#epg-channels');
    box.innerHTML = '';
    epgData = [];
    epgDayOffset = 0;
    var frag = document.createDocumentFragment();

    Player.list.forEach(function (channel, index) {
      var item = el('button', 'zap-item' + (index === Player.index ? ' is-current' : ''));
      item.setAttribute('data-focus', '');
      item.dataset.index = String(index);
      item.dataset.id = channel.id;

      var logo = el('span', 'zap-logo');
      fillLogo(logo, channel, true);
      item.appendChild(logo);

      var meta = el('span', 'zap-meta');
      meta.appendChild(el('span', 'zap-name', channel.name));
      meta.appendChild(el('span', 'zap-cat', channel.category || ''));
      item.appendChild(meta);

      item.addEventListener('focus', function () { showSchedule(channel); });
      item.addEventListener('click', function () {
        closeEpgPanel();
        Player.play(Player.list, index);
      });
      frag.appendChild(item);
    });
    box.appendChild(frag);

    $('#epg-panel-list').dataset.channel = '';
    $('#epg-panel').hidden = false;
    Player.epgOpen = true;
    $('#player-hint').classList.remove('show');
    Player.showOsd();

    var start = box.querySelector('.zap-item.is-current') || box.firstChild;
    if (start) Focus.set(start);
    epgSelected = Player.list[Player.index];
    showSchedule(Player.list[Player.index]);
  }

  function closeEpgPanel() {
    var panel = $('#epg-panel');
    if (!panel || panel.hidden) return;
    panel.hidden = true;
    Player.epgOpen = false;
    epgData = [];
    epgDayOffset = 0;
    epgSelected = null;
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
  }

  $('#video').addEventListener('playing', function () {
    Player.clearStreamTimer();
    Player.streamRetries = 0;
    $('#osd-status').textContent = 'Đang phát';
  });
  $('#video').addEventListener('waiting', function () {
    if (!Player.open) return;
    $('#osd-status').textContent = 'Đang tải…';
    Player.armStreamTimer();
  });
  $('#video').addEventListener('error', function () {
    if (!Player.open) return;
    $('#osd-status').textContent = 'Không phát được — đang thử lại';
    Player.armStreamTimer();
  });

  function renderResume() {
    var channel = state.lastChannel ? Channels.byId(state.lastChannel) : null;
    var logo = $('#resume-logo');
    if (channel) {
      fillLogo(logo, channel);
      $('#resume-name').textContent = channel.name;
      var lastLabel = $('#home2-last');
      if (lastLabel) lastLabel.textContent = 'Đã xem gần đây: ' + channel.name;
      $('#resume-sub').textContent = channel.category || 'Truyền hình';
      EPG.get(channel).then(function (data) {
        if (!data || !channel) return;
        var nowNext = EPG.nowNext(data);
        if (!nowNext.live) return;
        if (state.lastChannel !== channel.id) return;
        $('#resume-sub').textContent = 'Đang phát: ' + nowNext.live.title;
      });
    } else {
      logo.innerHTML = '<svg class="ic resume-ghost"><use href="#i-tv"></use></svg>';
      $('#resume-name').textContent = 'Chưa chọn kênh';
      $('#resume-sub').textContent = 'Bấm để chọn kênh bên dưới';
    }
  }

  /* ------------------------------------------------------------------ *
   * news
   * ------------------------------------------------------------------ */

  var News = {
    items: [],
    loaded: false,
    isSnapshot: false,

    /* Headlines baked into the package: the front page always has news,
       even when the TV cannot reach any feed (CORS / proxy limits). */
    loadBundled: function () {
      if (!state.showNews) return Promise.resolve(false);

      var apply = function (data) {
        if (!data || !data.items || !data.items.length) return false;
        if (News.items.length) return true;   // live news already arrived
        News.items = data.items;
        News.loaded = true;
        News.isSnapshot = true;
        renderNews();
        renderFeatured();
        return true;
      };

      // Preferred: the snapshot is a plain script (data/news.js), which works
      // on every Tizen engine without fetch/CORS.
      if (window.LP_NEWS) return Promise.resolve(apply(window.LP_NEWS));

      // Older packages only shipped the JSON file.
      return fetchText('data/news.json').then(function (text) {
        return apply(JSON.parse(text));
      }).catch(function () { return false; });
    },

    load: function () {
      if (!state.showNews) { $('#section-news').hidden = true; return; }
      $('#section-news').hidden = false;
      var feeds = state.feeds.slice(0, 6);
      var jobs = feeds.map(function (feed) {
        return loadFeed(feed).catch(function () { return []; });
      });

      Promise.allSettled(jobs).then(function (results) {
        var all = [];
        results.forEach(function (r) { if (r.status === 'fulfilled') all = all.concat(r.value); });
        all.sort(function (a, b) { return b.date - a.date; });

        var seen = {};
        var unique = [];
        all.forEach(function (item) {
          var key = item.title.toLowerCase().slice(0, 60);
          if (seen[key]) return;
          seen[key] = 1;
          unique.push(item);
        });

        if (!unique.length) {
          // every feed failed: keep what is on screen (bundled snapshot or
          // cache) instead of blanking the front page
          if (News.items.length) return;
          var cached = loadNewsCache();
          if (cached.length) {
            News.items = cached;
            News.loaded = true;
            renderNews();
            renderFeatured();
            toast('Không tải được tin mới — đang hiện tin đã lưu');
          }
          return;
        }

        saveNewsCache(unique);
        News.items = unique.slice(0, 40);
        News.loaded = true;
        News.isSnapshot = false;
        renderNews();
        renderFeatured();
      });
    }
  };

  /* News is cached so a dead network does not empty the front page. */
  var NEWS_CACHE_KEY = 'lp.news.v1';

  function saveNewsCache(items) {
    try {
      localStorage.setItem(NEWS_CACHE_KEY, JSON.stringify(items.slice(0, 30)));
    } catch (e) { /* quota */ }
  }

  function loadNewsCache() {
    try {
      var raw = localStorage.getItem(NEWS_CACHE_KEY);
      var items = raw ? JSON.parse(raw) : [];
      return Array.isArray(items) ? items : [];
    } catch (e) {
      return [];
    }
  }

  var rssJsonBlocked = false;

  function loadFeed(feed) {
    return fetchText(feed.url).then(function (text) {
      var items = parseFeed(text, feed.name);
      if (!items.length) throw new Error('empty feed');
      return items;
    }).catch(function () {
      // Tizen usually allows cross-origin reads; when a feed still refuses,
      // fall back to a JSON feed reader that sends CORS headers. It rate
      // limits aggressively (HTTP 429), so stop using it after a refusal.
      if (rssJsonBlocked) return [];
      var api = 'https://api.rss2json.com/v1/api.json?rss_url=' +
        encodeURIComponent(feed.url);
      return fetchJson(api).then(function (data) {
        if (!data || !data.items || !data.items.length) return [];
        return data.items.map(function (item) {
          return {
            title: item.title,
            link: item.link,
            source: feed.name,
            date: item.pubDate ? new Date(item.pubDate).getTime() : Date.now(),
            description: item.description || '',
            content: item.content || item.description || '',
            image: item.thumbnail || (item.enclosure && item.enclosure.link) || null
          };
        });
      }).catch(function () {
        rssJsonBlocked = true;
        return [];
      });
    });
  }

  function parseFeed(text, sourceName) {
    var doc = new DOMParser().parseFromString(text, 'text/xml');
    if (doc.querySelector('parsererror')) throw new Error('bad feed');
    var nodes = Array.prototype.slice.call(doc.querySelectorAll('item, entry'));
    return nodes.map(function (node) {
      var title = textOf(node, 'title');
      var link = textOf(node, 'link') || attrOf(node, 'link', 'href');
      var dateText = textOf(node, 'pubDate') || textOf(node, 'updated') || textOf(node, 'published');
      var description = textOf(node, 'description') || textOf(node, 'content') || textOf(node, 'summary');
      var content = textOf(node, 'encoded') || textOf(node, 'content');
      var image = extractImage(node, content || description);
      return {
        title: title,
        link: link,
        source: sourceName,
        date: dateText ? new Date(dateText).getTime() : Date.now(),
        description: description,
        content: content || description,
        image: image
      };
    }).filter(function (item) { return item.title; });
  }

  function localName(node) { return node.localName || node.nodeName; }

  function textOf(parent, name) {
    var found = null;
    for (var i = 0; i < parent.children.length; i++) {
      if (localName(parent.children[i]) === name) { found = parent.children[i]; break; }
    }
    return found ? found.textContent.trim() : '';
  }

  function attrOf(parent, name, attr) {
    for (var i = 0; i < parent.children.length; i++) {
      if (localName(parent.children[i]) === name) return parent.children[i].getAttribute(attr);
    }
    return '';
  }

  function extractImage(node, html) {
    var enclosure = attrOf(node, 'enclosure', 'url');
    if (enclosure && /\.(jpe?g|png|webp)/i.test(enclosure)) return enclosure;
    for (var i = 0; i < node.children.length; i++) {
      var child = node.children[i];
      var name = localName(child);
      if (name === 'content' || name === 'thumbnail') {
        var url = child.getAttribute('url');
        if (url) return url;
      }
    }
    if (html) {
      var match = /<img[^>]+src=["']([^"']+)["']/i.exec(html);
      if (match) return match[1];
    }
    return null;
  }

  function renderNews() {
    var row = $('#news-row');
    row.innerHTML = '';
    $('#news-empty').hidden = News.items.length > 0;
    var frag = document.createDocumentFragment();
    News.items.slice(0, 14).forEach(function (item, index) {
      var card = el('button', 'news');
      card.setAttribute('data-focus', '');
      var image = el('div', 'news-img');
      if (item.image) image.style.backgroundImage = 'url("' + item.image + '")';
      card.appendChild(image);

      var body = el('div', 'news-body');
      var meta = el('div', 'news-meta');
      meta.appendChild(el('span', null, item.source));
      meta.appendChild(el('span', null, '·'));
      meta.appendChild(el('span', null, fmtTime(new Date(item.date))));
      body.appendChild(meta);
      body.appendChild(el('div', 'news-title', item.title));
      card.appendChild(body);

      card.addEventListener('click', function () { openReader(index); });
      frag.appendChild(card);
    });
    row.appendChild(frag);
  }

  var featuredTimer = null;
  var featuredIndex = 0;

  /* A few headlines take turns on the card, newest first. */
  function featuredList() {
    var withImage = News.items.filter(function (item) { return item.image; });
    var pool = withImage.length >= 2 ? withImage : News.items;
    return pool.slice(0, 3);
  }

  function paintFeatured(list, index) {
    featuredIndex = index;
    var item = list[index];
    $('#featured-title').textContent = item.title;
    $('#featured-source').textContent = item.source + ' · ' + fmtTime(new Date(item.date)) +
      (News.isSnapshot ? ' · tin lưu' : '');
    var img = $('#featured-img');
    img.style.background = item.image
      ? 'center/cover url("' + item.image + '")'
      : 'linear-gradient(150deg,#2a2f4a,#131624)';
    $$('#featured-dots i').forEach(function (dot, i) {
      dot.className = i === index ? 'on' : '';
    });
  }

  function renderFeatured() {
    var card = $('#hero-featured');
    card.hidden = false;
    clearInterval(featuredTimer);

    var list = featuredList();
    var dots = $('#featured-dots');
    dots.innerHTML = '';

    if (!list.length) {
      $('#featured-title').textContent = 'Chưa tải được tin tức';
      $('#featured-source').textContent = 'Kiểm tra mạng rồi bấm OK để tải lại';
      $('#featured-img').style.background = 'linear-gradient(150deg,#2a2440,#12131f)';
      card.onclick = function () { News.load(); toast('Đang tải lại tin…'); };
      return;
    }

    list.forEach(function () { dots.appendChild(el('i')); });
    paintFeatured(list, 0);

    card.onclick = function () {
      var item = list[featuredIndex];
      openReader(News.items.indexOf(item));
    };

    if (list.length > 1) {
      featuredTimer = setInterval(function () {
        paintFeatured(list, (featuredIndex + 1) % list.length);
      }, 12000);
    }
  }

  function openReader(index) {
    var item = News.items[index];
    if (!item) return;
    $('#reader-title').textContent = item.title;
    $('#reader-source').textContent = item.source;
    $('#reader-time').textContent = fmtTime(new Date(item.date));
    var img = $('#reader-image');
    if (item.image) {
      img.style.backgroundImage = 'url("' + item.image + '")';
      img.hidden = false;
    } else {
      img.hidden = true;
    }
    $('#reader-body').innerHTML = sanitize(item.content || item.description || 'Nội dung không có sẵn.');
    $('#reader').hidden = false;
    $('#reader').scrollTop = 0;
    var panel = $('.reader-panel');
    if (panel) panel.scrollTop = 0;
    Focus.set($('#reader [data-focus]'));
  }

  function sanitize(html) {
    var doc = new DOMParser().parseFromString(html, 'text/html');
    $$('script, style, iframe, object, embed, form, input', doc).forEach(function (n) { n.remove(); });
    $$('*', doc).forEach(function (n) {
      Array.prototype.slice.call(n.attributes).forEach(function (attr) {
        if (/^on/i.test(attr.name)) n.removeAttribute(attr.name);
      });
    });
    return doc.body.innerHTML;
  }

  function closeReader() {
    $('#reader').hidden = true;
    var card = $('#hero-featured');
    if (visible(card)) Focus.set(card);
  }

  /* ------------------------------------------------------------------ *
   * apps (Tizen application manager, with graceful fallback)
   * ------------------------------------------------------------------ */

  var Apps = { list: [] };

  function loadApps() {
    var list = [];
    try {
      if (T && T.application && T.application.getAppsInfo) {
        list = T.application.getAppsInfo().filter(function (app) {
          return app.id !== 'LaunchPadTV.Home';
        }).map(function (app) {
          return { id: app.id, name: app.name, icon: app.iconPath || null };
        });
      }
    } catch (e) { list = []; }

    Apps.list = list;
    renderQuick();
    renderAppsScreen();
  }

  function appTile(app, small) {
    var tile = el('button', 'app tile-app');
    tile.setAttribute('data-focus', '');
    if (app.icon) {
      var img = el('img', 'app-icon');
      img.src = app.icon;
      img.alt = app.name;
      img.onerror = function () {
        img.replaceWith(fallbackIcon(app.name));
      };
      tile.appendChild(img);
    } else {
      tile.appendChild(fallbackIcon(app.name));
    }
    tile.appendChild(el('div', 'app-name', app.name));
    tile.addEventListener('click', function () {
      try {
        T.application.launch(app.id, function () { }, function () { toast('Không mở được ' + app.name); });
      } catch (e) {
        toast('Không mở được ứng dụng này');
      }
    });
    return tile;
  }

  function fallbackIcon(name) {
    var hue = hashHue(name);
    var node = el('div', 'app-icon-fallback', initials(name));
    node.style.background = 'linear-gradient(150deg, hsl(' + hue + ',60%,45%), hsl(' + ((hue + 40) % 360) + ',55%,32%))';
    return node;
  }

  function renderQuick() {
    var section = $('#section-quick');
    if (!state.showQuick || !Apps.list.length) { section.hidden = true; return; }
    section.hidden = false;
    var row = $('#quick-row');
    row.innerHTML = '';
    Apps.list.slice(0, 8).forEach(function (app) { row.appendChild(appTile(app, true)); });

    var more = el('div', 'app tile-app add-app');
    more.setAttribute('data-focus', '');
    var plus = el('div', 'plus', '+');
    more.appendChild(plus);
    more.appendChild(el('div', 'app-name', 'Thêm app'));
    more.addEventListener('click', function () { switchTab('apps'); });
    row.appendChild(more);
  }

  function renderAppsScreen() {
    var grid = $('#apps-grid');
    grid.innerHTML = '';
    $('#apps-empty').hidden = Apps.list.length > 0;
    Apps.list.forEach(function (app) { grid.appendChild(appTile(app)); });
  }

  /* ------------------------------------------------------------------ *
   * sheet overlays
   * ------------------------------------------------------------------ */

  var lastFocusBeforeSheet = null;

  function openSheet(title, buildBody) {
    lastFocusBeforeSheet = document.activeElement;
    $('#sheet-title').textContent = title;
    var body = $('#sheet-body');
    body.innerHTML = '';
    buildBody(body);
    $('#sheet').hidden = false;
    setTimeout(function () {
      var list = Focus.items();
      var inBody = list.filter(function (node) { return body.contains(node); });
      var first = inBody[0] || list[0];
      if (first) Focus.set(first);
    }, 30);
  }

  function closeSheet() {
    $('#sheet').hidden = true;
    if (lastFocusBeforeSheet && visible(lastFocusBeforeSheet)) Focus.set(lastFocusBeforeSheet);
  }

  function rowsPanel(rows) {
    var wrap = el('div', 'sheet-rows');
    rows.forEach(function (row) {
      var button = el('button', 'rowitem');
      button.setAttribute('data-focus', '');
      button.appendChild(el('span', 'k', row.label));
      if (row.value != null) button.appendChild(el('span', 'v', row.value));
      button.addEventListener('click', row.action);
      wrap.appendChild(button);
    });
    return wrap;
  }

  /* Real package version on the TV, so the user can tell which build is installed. */
  function installedVersion() {
    try {
      if (T && T.application) {
        var info = T.application.getCurrentApplication().appInfo;
        if (info && info.version) return info.version;
      }
    } catch (e) { /* not on a TV */ }
    return '1.5.5';
  }

  /* ------------------------------------------------------------------ *
   * connection status (Wi-Fi / cable / Bluetooth) in the top bar
   * ------------------------------------------------------------------ */

  var NetStatus = {
    timer: null,
    info: { type: 'NONE', ip: '', ssid: '', bt: 'unknown', btName: '' },

    init: function () {
      // Always show the chips: on a TV they carry real values, in the browser
      // they fall back to a placeholder so the layout can be checked.
      $('#net-status').hidden = false;
      $('#net-wifi').addEventListener('click', function () { NetStatus.openDetails(); });
      $('#net-cable').addEventListener('click', function () { NetStatus.openDetails(); });
      $('#net-bt').addEventListener('click', function () { NetStatus.openDetails(); });

      this.refresh();
      var self = this;
      this.timer = setInterval(function () { self.refresh(); }, 30000);
    },

    refresh: function () {
      var info = this.info;
      var api = T && T.webapis; 

      if (!api || (!api.network && !api.bluetooth)) {
        // Browser preview. Browsers refuse to expose the Wi-Fi name, the LAN
        // IP or the Bluetooth adapter state, so show what they do give us.
        this.isTv = false;
        info.type = navigator.onLine ? 'WIFI' : 'NONE';
        info.ssid = '';
        info.ip = '';

        var conn = navigator.connection || navigator.mozConnection ||
          navigator.webkitConnection;
        info.speed = '';
        if (conn) {
          var bits = [];
          if (conn.downlink) bits.push(conn.downlink + ' Mbps');
          info.speed = bits.join(' · ');
        }

        info.bt = 'unknown';
        if (navigator.bluetooth && navigator.bluetooth.getAvailability) {
          navigator.bluetooth.getAvailability().then(function (available) {
            info.bt = available ? 'available' : 'off';
            NetStatus.paint();
          }).catch(function () { /* blocked */ });
        }

        this.paint();
        return;
      }
      this.isTv = true;
      try {
        if (api.network && api.network.getActiveConnectionType) {
          info.type = String(api.network.getActiveConnectionType() || 'NONE').toUpperCase();
        }
      } catch (e) { info.type = 'NONE'; }

      try {
        if (api.network && api.network.getIp) info.ip = api.network.getIp() || '';
      } catch (e) { info.ip = ''; }

      try {
        if (api.bluetooth && api.bluetooth.getAdapterState) {
          info.bt = String(api.bluetooth.getAdapterState() || 'off').toLowerCase();
        }
      } catch (e) { info.bt = 'unknown'; }

      try {
        if (T.systeminfo && info.type === 'WIFI') {
          T.systeminfo.getPropertyValue('WIFI_NETWORK', function (wifi) {
            info.ssid = (wifi && wifi.ssid) || '';
            NetStatus.paint();
          }, function () { /* not allowed */ });
        }
      } catch (e) { /* ignore */ }

      this.paint();
    },

    paint: function () {
      var info = this.info;
      $('#net-wifi').classList.toggle('on', info.type === 'WIFI');
      $('#net-wifi').classList.toggle('off', info.type !== 'WIFI');
      $('#net-cable').classList.toggle('on', info.type === 'ETHERNET');
      $('#net-cable').classList.toggle('off', info.type !== 'ETHERNET');
      var btOn = info.bt === 'on' || info.bt === 'available';
      var wifiLabel = document.querySelector('#net-wifi span');
      if (wifiLabel) wifiLabel.textContent = this.isTv ? 'Wi-Fi' : 'Internet';
      $('#net-bt').classList.toggle('on', btOn);
      $('#net-bt').classList.toggle('off', !btOn);
    },

    openDetails: function () {
      var info = this.info;
      var typeLabel = info.type === 'WIFI' ? 'Wi-Fi'
        : info.type === 'ETHERNET' ? 'Cáp mạng'
        : info.type === 'CELLULAR' ? 'Di động' : 'Không có kết nối';

      openSheet('Kết nối', function (body) {
        var wrap = el('div', 'sheet-rows');
        var rows;

        if (NetStatus.isTv) {
          rows = [
            ['Mạng đang dùng', typeLabel],
            ['Địa chỉ IP', info.ip || '—'],
            ['Tên Wi-Fi (SSID)', info.ssid || (info.type === 'WIFI' ? 'Đang đọc…' : '—')],
            ['Bluetooth', info.bt === 'on' ? 'Đang bật' : info.bt === 'off' ? 'Đang tắt' : 'Không rõ']
          ];
        } else {
          rows = [
            ['Kết nối Internet', info.type === 'NONE' ? 'Không có' : 'Có'],
            ['Tốc độ (ước lượng)', info.speed || '—'],
            ['Bluetooth trên máy', info.bt === 'available' ? 'Có sẵn' :
              info.bt === 'off' ? 'Không có' : 'Không đọc được'],
            ['Tên Wi-Fi / IP LAN', 'Trình duyệt không cho đọc']
          ];
        }

        rows.forEach(function (pair) {
          var row = el('div', 'rowitem');
          row.appendChild(el('span', 'k', pair[0]));
          row.appendChild(el('span', 'v', pair[1]));
          wrap.appendChild(row);
        });
        body.appendChild(wrap);
        if (!NetStatus.isTv) {
          body.appendChild(el('p', 'hint',
            'Trình duyệt trên máy tính không cho đọc tên Wi-Fi, IP trong mạng LAN hay trạng thái ' +
            'bật/tắt Bluetooth. Trên TV, các chip này đọc trực tiếp từ hệ thống nên hiện đủ.'));
        }
        NetStatus.refresh();
      });
    }
  };

  function openSettings() {
    openSheet('Cài đặt', function (body) {
      var rows = [];

      rows.push({
        label: 'Thành phố',
        value: currentCity().name,
        action: function () {
          var index = CITIES.findIndex(function (c) { return c.id === state.city; });
          state.city = CITIES[(index + 1) % CITIES.length].id;
          saveState();
          loadWeather();
          openSettings();
        }
      });

      rows.push({
        label: 'Màu nhấn',
        value: state.accent,
        action: function () {
          var index = ACCENTS.indexOf(state.accent);
          state.accent = ACCENTS[(index + 1) % ACCENTS.length];
          document.body.dataset.accent = state.accent;
          saveState();
          openSettings();
        }
      });

      rows.push({
        label: 'Thời tiết',
        value: state.showWeather ? 'Bật' : 'Tắt',
        action: function () {
          state.showWeather = !state.showWeather;
          saveState();
          loadWeather();
          openSettings();
        }
      });

      rows.push({
        label: 'Tin tức',
        value: state.showNews ? 'Bật' : 'Tắt',
        action: function () {
          state.showNews = !state.showNews;
          saveState();
          if (state.showNews) News.load(); else $('#section-news').hidden = true;
          openSettings();
        }
      });

      rows.push({
        label: 'Bảng giá thị trường',
        value: state.showMarket ? 'Bật' : 'Tắt',
        action: function () {
          state.showMarket = !state.showMarket;
          saveState();
          loadMarket();
          openSettings();
        }
      });

      rows.push({
        label: 'Truy cập nhanh',
        value: state.showQuick ? 'Bật' : 'Tắt',
        action: function () {
          state.showQuick = !state.showQuick;
          saveState();
          renderQuick();
          openSettings();
        }
      });

      rows.push({
        label: 'Nguồn kênh',
        value: Channels.sourceName(),
        action: function () {
          state.source = state.source === 'vn' ? 'intl' : state.source === 'intl' ? 'custom' : 'vn';
          if (state.source === 'custom' && !state.custom.length) {
            toast('Chưa có danh sách M3U — hãy nhập link trước');
            state.source = 'vn';
          }
          saveState();
          renderChannels();
          renderResume();
          openSettings();
        }
      });

      rows.push({ label: 'Thêm danh sách M3U…', action: function () { openM3uDialog(); } });
      rows.push({ label: 'Nguồn tin RSS…', action: function () { openFeedsDialog(); } });
      rows.push({
        label: 'Giới thiệu',
        value: installedVersion(),
        action: function () {
          openSheet('Giới thiệu', function (body) {
            body.appendChild(el('p', 'hint',
              'GoSamTV cho Samsung Tizen — giao diện trang chủ gọn cho TV: truyền hình trực tuyến, lịch phát sóng, tin tức, thời tiết, thị trường và ứng dụng trên một màn hình. ' +
              'Điều khiển bằng remote: phím mũi tên để di chuyển, OK để chọn, RETURN để quay lại.'));
          });
        }
      });

      body.appendChild(rowsPanel(rows));
    });
  }

  function openM3uDialog() {
    openSheet('Nhập danh sách M3U', function (body) {
      body.appendChild(el('p', 'hint', 'Dán link M3U/M3U8 công khai (http hoặc https) rồi bấm Tải. Danh sách sẽ được lưu trên TV.'));
      var field = el('div', 'field');
      var input = document.createElement('input');
      input.type = 'text';
      input.placeholder = 'https://example.com/playlist.m3u';
      input.setAttribute('data-focus', '');
      var button = el('button', 'pill', 'Tải');
      button.setAttribute('data-focus', '');
      button.addEventListener('click', function () {
        var url = input.value.trim();
        if (!url) { toast('Chưa nhập link'); return; }
        button.textContent = 'Đang tải…';
        fetchText(url).then(function (text) {
          var parsed = parseM3u(text);
          if (!parsed.channels.length) throw new Error('empty');
          state.custom = parsed.channels.slice(0, 1200);
          state.customEpgUrl = parsed.epgUrl || null;
          state.source = 'custom';
          saveState();
          renderChannels();
          closeSheet();
          toast('Đã thêm ' + state.custom.length + ' kênh' +
            (parsed.epgUrl ? ' (có lịch phát sóng)' : ''));
        }).catch(function () {
          button.textContent = 'Tải';
          toast('Không tải được danh sách này');
        });
      });
      field.appendChild(input);
      field.appendChild(button);
      body.appendChild(field);
      if (state.custom.length) {
        body.appendChild(el('p', 'hint', 'Đang có ' + state.custom.length + ' kênh trong danh sách M3U của bạn.'));
      }
    });
  }

  function parseM3u(text) {
    var lines = text.split(/\r?\n/);
    var out = [];
    var pending = null;
    var epgUrl = null;
    lines.forEach(function (raw) {
      var line = raw.trim();
      if (!line) return;
      if (line.indexOf('#EXTM3U') === 0) {
        // Playlists may declare their XMLTV guide on the header line, as
        // described in the content guide (x-tvg-url).
        var guide = /(?:x-tvg-url|url-tvg)="([^"]+)"/i.exec(line);
        if (guide) epgUrl = guide[1];
        return;
      }
      if (line.indexOf('#EXTINF') === 0) {
        var comma = line.lastIndexOf(',');
        var name = comma !== -1 ? line.slice(comma + 1).trim() : 'Kênh';
        name = name.replace(/\s*\(\d{3,4}p\)\s*$/i, '');
        var idMatch = /tvg-id="([^"]*)"/i.exec(line);
        var logoMatch = /tvg-logo="([^"]*)"/i.exec(line);
        var groupMatch = /group-title="([^"]*)"/i.exec(line);
        pending = {
          id: (idMatch && idMatch[1]) || name,
          name: name,
          logo: (logoMatch && logoMatch[1]) || null,
          category: (groupMatch && groupMatch[1]) || 'Kênh'
        };
      } else if (line[0] === '#') {
        return;
      } else if (pending) {
        pending.url = line;
        out.push(pending);
        pending = null;
      }
    });
    // drop duplicates by url
    var seen = {};
    var channels = out.filter(function (ch) {
      if (seen[ch.url]) return false;
      seen[ch.url] = 1;
      return true;
    });
    return { channels: channels, epgUrl: epgUrl };
  }

  function openFeedsDialog() {
    openSheet('Nguồn tin RSS', function (body) {
      body.appendChild(el('p', 'hint', 'Mỗi dòng là một nguồn tin. Bấm vào nguồn để xoá khỏi danh sách.'));
      var rows = state.feeds.map(function (feed, index) {
        return {
          label: feed.name,
          value: 'Xoá',
          action: function () {
            state.feeds.splice(index, 1);
            saveState();
            News.load();
            openFeedsDialog();
          }
        };
      });
      body.appendChild(rowsPanel(rows));

      body.appendChild(el('p', 'hint', 'Thêm nguồn mới:'));
      var field = el('div', 'field');
      var input = document.createElement('input');
      input.type = 'text';
      input.placeholder = 'https://vnexpress.net/rss/tin-moi-nhat.rss';
      input.setAttribute('data-focus', '');
      var button = el('button', 'pill', 'Thêm');
      button.setAttribute('data-focus', '');
      button.addEventListener('click', function () {
        var url = input.value.trim();
        if (!url) return;
        var host = '';
        try { host = new URL(url).hostname.replace('www.', ''); } catch (e) { host = 'Nguồn mới'; }
        state.feeds.push({ name: host, url: url });
        saveState();
        News.load();
        openFeedsDialog();
      });
      field.appendChild(input);
      field.appendChild(button);
      body.appendChild(field);
    });
  }

  /* Picking the channel source explicitly; the button used to cycle through
     sources, which made "Việt Nam" jump to the international list. */
  function openSourcePicker() {
    openSheet('Nguồn kênh', function (body) {
      var wrap = el('div', 'sheet-rows');
      var options = [
        { id: 'vn', label: 'Việt Nam', count: DATA.vn.length },
        { id: 'intl', label: 'Quốc tế', count: DATA.intl.length },
        { id: 'custom', label: 'M3U của tôi', count: state.custom.length }
      ];
      options.forEach(function (option) {
        var row = el('button', 'rowitem');
        row.setAttribute('data-focus', '');
        row.appendChild(el('span', 'k', option.label));
        row.appendChild(el('span', 'v',
          option.count + ' kênh' + (state.source === option.id ? ' · đang dùng' : '')));
        row.addEventListener('click', function () {
          if (option.id === 'custom' && !state.custom.length) {
            toast('Chưa có danh sách M3U — hãy nhập link trước');
            return;
          }
          state.source = option.id;
          state.filter = 'all';
          saveState();
          renderChannels();
          renderResume();
          closeSheet();
          toast('Nguồn: ' + Channels.sourceName() + ' · ' + Channels.list().length + ' kênh');
        });
        wrap.appendChild(row);
      });
      body.appendChild(wrap);
    });
  }

  /* ------------------------------------------------------------------ *
   * channel search
   * ------------------------------------------------------------------ */

  function deaccent(text) {
    return (text || '').toString()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/đ/g, 'd').replace(/Đ/g, 'D')
      .toLowerCase();
  }

  function runSearch(query) {
    var box = $('#search-results');
    var list = Channels.list();
    var needle = deaccent(query.trim());
    var hits = [];

    for (var i = 0; i < list.length; i++) {
      var channel = list[i];
      if (!needle ||
          deaccent(channel.name).indexOf(needle) !== -1 ||
          deaccent(channel.category || '').indexOf(needle) !== -1) {
        hits.push({ channel: channel, index: i });
      }
    }

    box.innerHTML = '';
    if (!hits.length) {
      box.appendChild(el('div', 'search-empty', 'Không tìm thấy kênh “' + query + '”'));
      $('#search-foot').textContent = 'Thử từ khoá khác · RETURN đóng';
      return;
    }

    $('#search-foot').textContent = hits.length + ' kênh · ▲▼◀▶ chọn · OK xem kênh · RETURN đóng';

    var frag = document.createDocumentFragment();
    hits.slice(0, 60).forEach(function (hit) {
      frag.appendChild(channelCard(hit.channel, hit.index, function (channel, index) {
        closeSearch();
        Player.play(Channels.list(), index);
      }));
    });
    box.appendChild(frag);
  }

  function openSearch() {
    $('#search').hidden = false;
    var input = $('#search-input');
    input.value = '';
    runSearch('');
    setTimeout(function () {
      Focus.set(input);
      try { input.focus(); } catch (e) { /* no tv keyboard */ }
    }, 60);
  }

  function closeSearch() {
    $('#search').hidden = true;
    var button = document.querySelector('[data-action="search"]');
    if (button && visible(button)) Focus.set(button);
  }

  function openChannelList() {
    openSheet('Danh sách kênh · ' + Channels.sourceName(), function (body) {
      var list = Channels.list();
      if (!list.length) { body.appendChild(el('p', 'hint', 'Chưa có kênh nào.')); return; }

      // Grouped by group-title, like the on-video picker. Very long lists
      // (the international playlist) keep the incremental flat grid.
      if (list.length <= 400) {
        var groups = groupChannels(list);
        var wrap = el('div', 'sheet-groups');

        var favourites = list.filter(function (c) {
          return state.favorites.indexOf(c.id) !== -1;
        });
        if (favourites.length) {
          var favBlock = el('div', 'sheet-group');
          favBlock.appendChild(el('div', 'group-head', '★ Yêu thích · ' + favourites.length));
          var favGrid = el('div', 'sheet-grid');
          favourites.forEach(function (channel) {
            favGrid.appendChild(channelCard(channel, list.indexOf(channel)));
          });
          favBlock.appendChild(favGrid);
          wrap.appendChild(favBlock);
        }

        groups.forEach(function (group) {
          var block = el('div', 'sheet-group');
          block.appendChild(el('div', 'group-head', group.name + ' · ' + group.channels.length));
          var grid = el('div', 'sheet-grid');
          group.channels.forEach(function (channel) {
            grid.appendChild(channelCard(channel, list.indexOf(channel)));
          });
          block.appendChild(grid);
          wrap.appendChild(block);
        });
        body.appendChild(wrap);
        return;
      }

      var grid = el('div', 'sheet-grid');
      var shown = 0;

      function append() {
        var frag = document.createDocumentFragment();
        var end = Math.min(shown + 48, list.length);
        for (var i = shown; i < end; i++) {
          var channel = list[i];
          var card = channelCard(channel, i);
          card.addEventListener('click', function (index) {
            return function () {
              closeSheet();
              playChannel(index);
            };
          }(i));
          frag.appendChild(card);
        }
        grid.appendChild(frag);
        shown = end;
        if (shown < list.length) {
          var more = el('button', 'pill more', 'Xem thêm ' + (list.length - shown) + ' kênh');
          more.setAttribute('data-focus', '');
          more.addEventListener('click', function () { more.remove(); append(); });
          grid.appendChild(more);
          more.id = 'more-channels';
        }
      }
      append();
      body.appendChild(grid);
    });
  }

  /* ------------------------------------------------------------------ *
   * tabs & actions
   * ------------------------------------------------------------------ */

  function switchTab(tab) {
    state.tab = tab;
    saveState();
    $$('.tab').forEach(function (button) {
      button.classList.toggle('is-active', button.dataset.tab === tab);
    });
    $('#screen-home').hidden = tab !== 'home';
    $('#screen-apps').hidden = tab !== 'apps';
    var list = Focus.items();
    var active = $('.tab.is-active');
    if (active) Focus.set(active);
    var screen = tab === 'home' ? $('#screen-home') : $('#screen-apps');
    screen.scrollTop = 0;
    if (tab === 'apps' && !Apps.list.length) loadApps();
    void list;
  }

  $('#tabs').addEventListener('click', function (e) {
    var tab = e.target.closest('.tab');
    if (tab) switchTab(tab.dataset.tab);
  });

  document.addEventListener('click', function (e) {
    var filter = e.target.closest('[data-filter]');
    if (filter) {
      state.filter = filter.dataset.filter;
      $$('#tv-filters .pill').forEach(function (pill) {
        pill.classList.toggle('is-active', pill === filter);
      });
      saveState();
      renderChannels();
      return;
    }

    var action = e.target.closest('[data-action]');
    if (!action) return;
    var name = action.dataset.action;
    if (name === 'settings') openSettings();
    else if (name === 'refresh') { refreshAll(); toast('Đang cập nhật…'); }
    else if (name === 'resume') {
      var last = state.lastChannel ? Channels.byId(state.lastChannel) : null;
      if (last) { var playingList = Channels.filtered(); var playingIndex = playingList.indexOf(last); Player.play(playingIndex >= 0 ? playingList : [last], playingIndex >= 0 ? playingIndex : 0); }
      else openChannelList();
    }
    else if (name === 'apps') switchTab('apps');
    else if (name === 'channel-list') openChannelList();
    else if (name === 'guide') openGuide();
    else if (name === 'add-m3u') openM3uDialog();
    else if (name === 'feeds') openFeedsDialog();
    else if (name === 'refresh-news') { News.load(); toast('Đang tải tin mới…'); }
    else if (name === 'refresh-apps') loadApps();
    else if (name === 'source') openSourcePicker();
    else if (name === 'search') openSearch();
    else if (name === 'search-close') closeSearch();
    else if (name === 'sheet-close') closeSheet();
    else if (name === 'reader-close') closeReader();
  });

  /* Day buttons inside the guide panel (arrow keys only - Samsung TVs do not
     deliver CH+/CH- without the tv.inputdevice privilege). */
  $('#epg-prev').addEventListener('click', function () { shiftScheduleDay(-1); });
  $('#epg-next').addEventListener('click', function () { shiftScheduleDay(1); });  $('#epg-today').addEventListener('click', function () {
    if (!epgData || !epgData.length) return;
    if (epgDayOffset === 0) return;
    epgDayOffset = 0;
    renderSchedule();
    $('#epg-panel-list').scrollTop = 0;
  });

  /* Return buttons: same as the remote's RETURN key, for people who look for
     an on-screen arrow. */
  $('#search-input').addEventListener('input', function () { runSearch(this.value); });
  $('#zap-back').addEventListener('click', closeZap);
  $('#epg-back').addEventListener('click', closeEpgPanel);
  $('#zap-favmode').addEventListener('click', function () {
    zapFavMode = !zapFavMode;
    var current = renderZap();
    if (current) Focus.set(current);
    toast(zapFavMode
      ? 'Bật sửa yêu thích: bấm OK trên kênh để thêm/bỏ'
      : 'Đã tắt sửa yêu thích');
  });

  $('#hero-resume').addEventListener('click', function () {
    if (state.lastChannel) {
      var channel = Channels.byId(state.lastChannel);
      if (channel) {
        var list = Channels.list();
        Player.play(list, list.indexOf(channel));
        return;
      }
    }
    var target = $('#tv-row .chan');
    if (target) Focus.set(target);
  });

  /* ------------------------------------------------------------------ *
   * keyboard / remote
   * ------------------------------------------------------------------ */

  function handleKey(e) {
    var code = e.keyCode;
    // Opening the app from Smart Hub uses OK. Discard any trailing/repeated
    // keydown from the same press so it cannot play the resume channel.
    if (code === 13 && Date.now() < launchEnterGuardUntil) {
      e.preventDefault();
      return;
    }

    if (Player.open) {
      if (Player.zapOpen) {
        // The channel picker owns the remote while it is open.
        if (code === 10009 || code === 27) { e.preventDefault(); closeZap(); return; }
        if (code === 37) { e.preventDefault(); Focus.move('left'); return; }
        if (code === 39) { e.preventDefault(); Focus.move('right'); return; }
        if (code === 38 || code === 427) { e.preventDefault(); Focus.move('up'); return; }
        if (code === 40 || code === 428) { e.preventDefault(); Focus.move('down'); return; }
        if (code === 13) {
          e.preventDefault();
          var chosen = document.activeElement;
          if (chosen && chosen.click) chosen.click();
          return;
        }
        return;
      }
      if (Player.epgOpen) {
        if (code === 10009 || code === 27) {
          e.preventDefault(); closeEpgPanel(); return;
        }
        if (code === 427) { e.preventDefault(); shiftScheduleDay(1); return; }   // CH+ ngày sau
        if (code === 428) { e.preventDefault(); shiftScheduleDay(-1); return; }  // CH− ngày trước
        if (code === 37) {
          e.preventDefault();
          // ◀ from the programme list returns to the channel being browsed.
          if ($('#epg-panel-list').contains(document.activeElement) && epgSelected) {
            var back = $('#epg-channels .zap-item[data-id="' + epgSelected.id + '"]');
            if (back) { Focus.set(back); return; }
          }
          Focus.move('left');
          return;
        }
        if (code === 39) { e.preventDefault(); Focus.move('right'); return; }
        if (code === 38) { e.preventDefault(); Focus.move('up'); return; }
        if (code === 40) { e.preventDefault(); Focus.move('down'); return; }
        if (code === 13) {
          e.preventDefault();
          var picked = document.activeElement;
          // Programme rows are focus targets only; everything else (channel
          // tiles, day buttons) acts on OK.
          if (picked && picked.click && !picked.classList.contains('epg-row')) picked.click();
          return;
        }
        return;
      }
      if (code === 10009 || code === 27) { e.preventDefault(); Player.close(); return; }
      if (code === 13) { e.preventDefault(); Player.toggleOsd(); return; }
      if (code === 37) { e.preventDefault(); openZap(); return; }        // ◀ danh sách kênh
      if (code === 39) { e.preventDefault(); openEpgPanel(); return; }   // ▶ lịch phát sóng
      if (code === 38 || code === 427) { e.preventDefault(); Player.step(1); return; }   // ▲ tăng kênh
      if (code === 40 || code === 428) { e.preventDefault(); Player.step(-1); return; }  // ▼ giảm kênh
      return;
    }

    if (code === 37) { e.preventDefault(); Focus.move('left'); return; }
    if (code === 38) { e.preventDefault(); Focus.move('up'); return; }
    if (code === 39) { e.preventDefault(); Focus.move('right'); return; }
    if (code === 40) { e.preventDefault(); Focus.move('down'); return; }

    if (code === 13) {
      var active = document.activeElement;
      if (active && active.click) { e.preventDefault(); active.click(); }
      return;
    }

    if (code === 10009 || code === 27) {
      e.preventDefault();
      if (!$('#search').hidden) { closeSearch(); return; }
      if (!$('#sheet').hidden) { closeSheet(); return; }
      if (!$('#reader').hidden) { closeReader(); return; }
      if (T && T.application) {
        try { T.application.getCurrentApplication().exit(); } catch (err) { /* browser */ }
      }
      return;
    }

    if (code === 461 || code === 10009) { /* back alias */ }
  }

  document.addEventListener('keydown', handleKey);
  document.addEventListener('keyup', function (e) {
    if (e.keyCode === 13) launchEnterReleased = true;
  });

  function registerTvKeys() {
    if (!T || !T.tvinputdevice) return;
    ['MediaPlayPause', 'MediaPlay', 'MediaPause', 'ChannelUp', 'ChannelDown', 'Info']
      .forEach(function (key) {
        try { T.tvinputdevice.registerKey(key); } catch (e) { /* not on this device */ }
      });
  }

  /* ------------------------------------------------------------------ *
   * refresh / boot
   * ------------------------------------------------------------------ */

  function refreshAll() {
    loadWeather();
    loadMarket();
    News.load();
    loadApps();
  }

  function boot() {
    loadState();
    // Always start on Home. The previous channel is only a shortcut;
    // it must never open automatically on startup.
    state.tab = 'home';
    document.documentElement.classList.remove('avplay-on');
    $('#player').hidden = true;
    Player.open = false;
    Player.stopAvplay();
    // One-time recovery: the old "source" button toggled to the international
    // list by accident, so start those installs back on the Vietnamese list.
    if (!state.srcFix) {
      if (state.source === 'intl') state.source = 'vn';
      state.srcFix = true;
    }
    // A saved "M3U của tôi" source with no list would leave the row empty.
    if (state.source === 'custom' && !state.custom.length) state.source = 'vn';
    document.body.dataset.accent = state.accent || 'violet';
    tickClock();
    setInterval(tickClock, 1000);

    renderChannels();
    renderResume();
    if (state.filter !== 'all') {
      $$('#tv-filters .pill').forEach(function (pill) {
        pill.classList.toggle('is-active', pill.dataset.filter === state.filter);
      });
    }
    // Saved tab choices must not override Home on the next launch.
    switchTab('home');

    loadWeather();
    loadMarket();
    // bundled headlines first (instant, works offline) then try live feeds
    News.loadBundled().then(function () { News.load(); });
    renderFeatured();
    loadApps();
    NetStatus.init();
    registerTvKeys();

    setTimeout(function () {
      // Focus a non-playing navigation item, never the resume card.
      // Press OK to open a channel only after the user chooses a shortcut.
      var start = $('.tab.is-active') || $('.home2-secondary');
      if (start) Focus.set(start);
      $('#screen-home').scrollTop = 0;
    }, 120);
  }

  // Tizen may resume the existing app instead of starting a new process.
  // Bring Home back when the app becomes visible after being backgrounded.
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) return;
    launchEnterReleased = false;
    launchEnterGuardUntil = Date.now() + 1000;
    if (Player.open) Player.close();
    switchTab('home');
    var home = $('#screen-home');
    if (home) home.scrollTop = 0;
  });

  window.LP = {
    state: state,
    Channels: Channels,
    News: News,
    Player: Player,
    EPG: EPG,
    openGuide: openGuide,
    focus: Focus
  };

  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    setTimeout(boot, 0);
  } else {
    document.addEventListener('DOMContentLoaded', boot);
  }
})();
