/* Live weather on the page's sky clock (G, 15/10/2026: "sun/moon có thêm live weather: gió, mưa, nhiệt độ, sấm sét").
   The weather where the visitor is (G, 17/10/2026: "clock and weather base on local browser user"): at the place the
   page's sun is worked out for (window.HL_SUN.place, src/sun: the principal city of their clock's time zone; Pleiku,
   the room's own place, for a clock on Vietnam's time), so the weather and the sunrise and sunset over it are the same
   place's, and the 3D garden's rain and light with them. From Open-Meteo: model estimates, refreshed every 15 minutes,
   no account, key or location permission (kept 15 minutes in the browser for that place, so a reload does not ask again).
   - Under the clock: the weather's sign, the temperature, what the sky is doing, the wind (an arrow the way it blows,
     km/h), the rain of the last quarter hour, a storm when there is one; the rest (humidity, gusts, when it was
     measured) in its tooltip. In both of the page's languages.
   - In the clock's own sky: as many of its clouds as the cloud cover, drifting with the wind (faster as it blows
     harder; the clock faces south, sunrise on the left, so a wind from the east carries them right), grey under rain
     and dark in a storm; rain falling from them, slanting with the wind, a drizzle to a downpour; in a storm, now and
     then a fork of lightning and the sky flashing; fog as a haze; the sun or moon dimmed under thick cloud.
   For a look at each: ?wx=clear, ?wx=wind, ?wx=fog, ?wx=drizzle, ?wx=rain, ?wx=storm. The weather is also given to the
   rest of the page: window.HL_WEATHER, the event 'hl-weather', and <html data-wx="clear | cloud | fog | rain | storm">. */
(function () {
  'use strict';
  var P = (window.HL_SUN && window.HL_SUN.place) || { lat: 13.98, lon: 108.0, city: 'Pleiku' };
  var LOC = { lat: Math.round(P.lat * 100) / 100, lon: Math.round(P.lon * 100) / 100, name: P.city || '' };
  var API = 'https://api.open-meteo.com/v1/forecast?latitude=' + LOC.lat + '&longitude=' + LOC.lon +
    '&current=temperature_2m,relative_humidity_2m,precipitation,rain,showers,weather_code,cloud_cover,wind_speed_10m,wind_direction_10m,wind_gusts_10m,is_day&timezone=auto';
  var REFRESH = 15 * 60 * 1000, KEY = 'hiddenLibrary.weather.v2';   // ({ cur, at, lat, lon }: another place's is not used)
  try { localStorage.removeItem('hiddenLibrary.weather.v1'); } catch (e) { /* storage blocked */ }   // (Pleiku's, from before)
  var FAKE = {   // (?wx=…: what each looks like)
    clear: { weather_code: 0, temperature_2m: 26, cloud_cover: 2, wind_speed_10m: 6, wind_direction_10m: 100, wind_gusts_10m: 12, precipitation: 0, relative_humidity_2m: 60 },
    wind: { weather_code: 2, temperature_2m: 22, cloud_cover: 45, wind_speed_10m: 34, wind_direction_10m: 250, wind_gusts_10m: 58, precipitation: 0, relative_humidity_2m: 70 },
    fog: { weather_code: 45, temperature_2m: 17, cloud_cover: 90, wind_speed_10m: 3, wind_direction_10m: 40, wind_gusts_10m: 6, precipitation: 0, relative_humidity_2m: 99 },
    drizzle: { weather_code: 53, temperature_2m: 20, cloud_cover: 95, wind_speed_10m: 9, wind_direction_10m: 120, wind_gusts_10m: 16, precipitation: 0.1, relative_humidity_2m: 94 },
    rain: { weather_code: 63, temperature_2m: 21, cloud_cover: 100, wind_speed_10m: 16, wind_direction_10m: 200, wind_gusts_10m: 32, precipitation: 1.2, relative_humidity_2m: 96 },
    storm: { weather_code: 95, temperature_2m: 23, cloud_cover: 100, wind_speed_10m: 24, wind_direction_10m: 230, wind_gusts_10m: 55, precipitation: 3.4, relative_humidity_2m: 93 }
  };
  var root = document.documentElement, force = null;
  try { force = new URLSearchParams(location.search).get('wx'); } catch (e) { /* no query */ }
  if (force && !FAKE[force]) force = null;
  var reduce = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;

  // ---- what the WMO code says, in both languages; the kind of sky (for the drawing) and how hard it rains (0 to 1)
  var NAMES = {
    0: ['Clear', 'Trời quang'], 1: ['Mostly clear', 'Ít mây'], 2: ['Partly cloudy', 'Mây rải rác'], 3: ['Overcast', 'Nhiều mây'],
    45: ['Fog', 'Sương mù'], 48: ['Freezing fog', 'Sương giá'], 51: ['Light drizzle', 'Mưa phùn nhẹ'], 53: ['Drizzle', 'Mưa phùn'], 55: ['Heavy drizzle', 'Mưa phùn dày'],
    56: ['Freezing drizzle', 'Mưa phùn lạnh'], 57: ['Freezing drizzle', 'Mưa phùn lạnh'], 61: ['Light rain', 'Mưa nhỏ'], 63: ['Rain', 'Mưa vừa'], 65: ['Heavy rain', 'Mưa to'],
    66: ['Freezing rain', 'Mưa lạnh'], 67: ['Freezing rain', 'Mưa lạnh'], 71: ['Light snow', 'Tuyết nhẹ'], 73: ['Snow', 'Tuyết'], 75: ['Heavy snow', 'Tuyết dày'], 77: ['Snow grains', 'Hạt tuyết'],
    80: ['Showers', 'Mưa rào'], 81: ['Heavy showers', 'Mưa rào to'], 82: ['Violent showers', 'Mưa rào rất to'], 85: ['Snow showers', 'Mưa tuyết'], 86: ['Snow showers', 'Mưa tuyết'],
    95: ['Thunderstorm', 'Dông'], 96: ['Thunderstorm, hail', 'Dông, mưa đá'], 99: ['Thunderstorm, hail', 'Dông, mưa đá']
  };
  var RAIN_K = { 51: .18, 53: .26, 55: .34, 56: .26, 57: .34, 61: .4, 63: .62, 65: .9, 66: .45, 67: .7, 80: .45, 81: .72, 82: 1, 95: .8, 96: .9, 99: 1 };
  function kindOf(c) {
    if (c >= 95) return 'storm';
    if (RAIN_K[c]) return 'rain';
    if (c === 45 || c === 48) return 'fog';
    return c >= 2 ? 'cloud' : 'clear';
  }
  var DIRS = [['N', 'B'], ['NNE', 'BĐB'], ['NE', 'ĐB'], ['ENE', 'ĐĐB'], ['E', 'Đ'], ['ESE', 'ĐĐN'], ['SE', 'ĐN'], ['SSE', 'NĐN'], ['S', 'N'], ['SSW', 'NTN'], ['SW', 'TN'], ['WSW', 'TTN'], ['W', 'T'], ['WNW', 'TTB'], ['NW', 'TB'], ['NNW', 'BTB']];
  var num = function (v, d) { return (Math.round(v * Math.pow(10, d)) / Math.pow(10, d)).toString(); };
  var vi = function () { return root.getAttribute('data-lang') === 'vi'; };
  var both = function (en, v) { return '<span class="en">' + en + '</span><span class="vi">' + v + '</span>'; };

  // ---- small line icons (24-unit boxes, drawn in the text's colour)
  var CLOUD = 'M7 18h10a4 4 0 0 0 .4-8 5.5 5.5 0 0 0-10.6 1.2A3.4 3.4 0 0 0 7 18z';
  var ICONS = {
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5.3 5.3l1.6 1.6M17.1 17.1l1.6 1.6M5.3 18.7l1.6-1.6M17.1 6.9l1.6-1.6"/>',
    moon: '<path d="M19.5 14.6A8 8 0 1 1 9.4 4.5a6.4 6.4 0 0 0 10.1 10.1z"/>',
    partSun: '<path d="M8.2 4.2v1.4M3.6 8.8h1.4M4.9 5.5l1 1M11.5 5.5l-1 1"/><path d="M5.6 11.2a3 3 0 1 1 5.1-2.9"/><path d="M8.5 20h9a3.6 3.6 0 0 0 .3-7.2 5 5 0 0 0-9.6 1.1A3.1 3.1 0 0 0 8.5 20z"/>',
    partMoon: '<path d="M10.6 9.4A4.4 4.4 0 0 1 5 4a4.6 4.6 0 1 0 5.6 5.4z"/><path d="M8.5 20h9a3.6 3.6 0 0 0 .3-7.2 5 5 0 0 0-9.6 1.1A3.1 3.1 0 0 0 8.5 20z"/>',
    cloud: '<path d="' + CLOUD + '"/>',
    fog: '<path d="' + 'M7 13h10a4 4 0 0 0 .4-8 5.5 5.5 0 0 0-10.6 1.2A3.4 3.4 0 0 0 7 13z' + '"/><path d="M4 16.5h16M6 20h12"/>',
    drizzle: '<path d="M7 14h10a4 4 0 0 0 .4-8 5.5 5.5 0 0 0-10.6 1.2A3.4 3.4 0 0 0 7 14z"/><path d="M9 17l-.4 1.2M13 17l-.4 1.2M11 20.2l-.4 1.2M15 20.2l-.4 1.2"/>',
    rain: '<path d="M7 14h10a4 4 0 0 0 .4-8 5.5 5.5 0 0 0-10.6 1.2A3.4 3.4 0 0 0 7 14z"/><path d="M8.6 16.6l-1.2 3.6M12.6 16.6l-1.2 3.6M16.6 16.6l-1.2 3.6"/>',
    storm: '<path d="M7 14h10a4 4 0 0 0 .4-8 5.5 5.5 0 0 0-10.6 1.2A3.4 3.4 0 0 0 7 14z"/><path d="M12.8 14.5l-2.6 3.8h3.2l-2.4 3.7"/>',
    snow: '<path d="M7 14h10a4 4 0 0 0 .4-8 5.5 5.5 0 0 0-10.6 1.2A3.4 3.4 0 0 0 7 14z"/><path d="M9 18h.01M12 20h.01M15 18h.01M10.5 21.5h.01M13.5 21.5h.01"/>',
    arrow: '<path d="M12 20V5M6.5 10.5L12 5l5.5 5.5"/>',
    drop: '<path d="M12 3.5c-3 4.2-5.2 7.2-5.2 10a5.2 5.2 0 0 0 10.4 0c0-2.8-2.2-5.8-5.2-10z"/>',
    bolt: '<path d="M13.5 2.5L6 13.2h5l-1.5 8.3L18 10.5h-5.2z"/>'
  };
  var svg = function (name, cls, style) { return '<svg class="' + (cls || '') + '" viewBox="0 0 24 24" aria-hidden="true"' + (style ? ' style="' + style + '"' : '') + '>' + ICONS[name] + '</svg>'; };
  function iconOf(c, day) {
    if (c >= 95) return 'storm';
    if (c >= 71 && c <= 77 || c === 85 || c === 86) return 'snow';
    if (c >= 61 || c >= 80) return 'rain';
    if (c >= 51) return 'drizzle';
    if (c === 45 || c === 48) return 'fog';
    if (c === 3) return 'cloud';
    if (c >= 1) return day ? 'partSun' : 'partMoon';
    return day ? 'sun' : 'moon';
  }

  // ---- the state, from the API (or a look forced by ?wx=)
  var W = { cur: null, at: 0, kind: null };
  window.HL_WEATHER = W;
  function isDay() { return window.HL_SUN.isDay(); }   // (the page's own day: sunrise to sunset where the visitor is, src/sun)
  function take(cur, at) {
    W.cur = cur; W.at = at; W.kind = kindOf(cur.weather_code);
    root.setAttribute('data-wx', W.kind);
    render(); clouds();
    try { window.dispatchEvent(new CustomEvent('hl-weather', { detail: W })); } catch (e) { /* old browser */ }
  }
  function load() {
    if (force) { var f = Object.assign({ time: '' }, FAKE[force]); take(f, Date.now()); return; }
    var cached = null; try { cached = JSON.parse(localStorage.getItem(KEY)); } catch (e) { /* storage blocked */ }
    if (cached && (cached.lat !== LOC.lat || cached.lon !== LOC.lon)) cached = null;   // (kept for another place: the clock's zone has changed)
    if (cached && cached.cur && Date.now() - cached.at < REFRESH) { take(cached.cur, cached.at); return; }
    if (cached && cached.cur && Date.now() - cached.at < 6 * 3600 * 1000) take(cached.cur, cached.at);   // (shown while the new one comes)
    var ctl = window.AbortController ? new AbortController() : null, to = setTimeout(function () { if (ctl) ctl.abort(); }, 12000);
    fetch(API, { credentials: 'omit', signal: ctl ? ctl.signal : undefined }).then(function (r) { return r.ok ? r.json() : null; }).then(function (d) {
      clearTimeout(to);
      var c = d && d.current; if (!c || typeof c.weather_code !== 'number') return;
      var at = Date.now(); try { localStorage.setItem(KEY, JSON.stringify({ cur: c, at: at, lat: LOC.lat, lon: LOC.lon })); } catch (e) { /* storage blocked */ }
      take(c, at);
    }).catch(function () { clearTimeout(to); });
  }

  // ---- the line under each clock
  function render() {
    var c = W.cur; if (!c) return;
    var day = isDay(), code = c.weather_code, name = NAMES[code] || ['', ''], k = W.kind;
    var to = ((c.wind_direction_10m || 0) + 180) % 360, d = DIRS[Math.round((c.wind_direction_10m || 0) / 22.5) % 16];
    var mm = c.precipitation || 0, rainy = k === 'rain' || k === 'storm' || mm > 0.05;
    // the place the weather is for, first (G, 18/10/2026: "em add local city name"): the visitor's city as their clock names it (sun/sun-clock.js)
    var city = (window.HL_SUN && window.HL_SUN.place && window.HL_SUN.place.city) || '';
    var html = (city ? '<span class="wx-city">' + city.replace(/[<>&"]/g, '') + '</span><span class="wx-sep">·</span>' : '') + svg(iconOf(code, day), 'wx-ico') + '<b>' + num(c.temperature_2m, 0) + '°C</b><span class="wx-sep">·</span>' +
      '<span class="wx-name">' + both(name[0], name[1]) + '</span><span class="wx-sep">·</span>' +
      '<span class="wx-wind">' + svg('arrow', 'wx-arrow', 'transform:rotate(' + (-to) + 'deg)') + num(c.wind_speed_10m || 0, 0) + ' km/h</span>' +
      (rainy ? '<span class="wx-sep">·</span><span class="wx-mm">' + svg('drop') + num(mm * 4, 1).replace('.', vi() ? ',' : '.') + ' mm/h</span>' : '') +
      (k === 'storm' ? '<span class="wx-sep">·</span><span class="wx-storm">' + svg('bolt') + both('Lightning', 'Sấm sét') + '</span>' : '');
    var when = c.time ? c.time.slice(11, 16) : '';
    var tip = vi()
      ? placeName(true) + ' · ' + name[1] + ' · gió ' + d[1] + ' ' + num(c.wind_speed_10m || 0, 0) + ' km/h, giật ' + num(c.wind_gusts_10m || 0, 0) + ' km/h · độ ẩm ' + num(c.relative_humidity_2m || 0, 0) + '% · mây ' + num(c.cloud_cover || 0, 0) + '%' + (when ? ' · đo lúc ' + when : '') + ' (Open-Meteo)'
      : placeName(false) + ' · ' + name[0] + ' · wind ' + d[0] + ' ' + num(c.wind_speed_10m || 0, 0) + ' km/h, gusts ' + num(c.wind_gusts_10m || 0, 0) + ' km/h · humidity ' + num(c.relative_humidity_2m || 0, 0) + '% · cloud ' + num(c.cloud_cover || 0, 0) + '%' + (when ? ' · at ' + when : '') + ' (Open-Meteo)';
    skies().forEach(function (s) {
      var line = s.querySelector('.wx');
      if (!line) { line = document.createElement('div'); line.className = 'wx'; line.setAttribute('role', 'note'); s.appendChild(line); }
      line.innerHTML = html; line.title = tip;
      s.classList.toggle('wx-grey', k === 'rain'); s.classList.toggle('wx-dark', k === 'storm'); s.classList.toggle('wx-fog', k === 'fog');
      s.classList.toggle('wx-dim', (c.cloud_cover || 0) > 80 || rainy || k === 'fog');
    });
  }
  function placeName(v) {   // (the tooltip's place: Pleiku with its province; a time zone's city, said to be taken from the clock; else where)
    if (LOC.name === 'Pleiku') return v ? 'Pleiku (Gia Lai)' : 'Pleiku (Gia Lai, Vietnam)';
    if (LOC.name) return LOC.name + (v ? ' (theo múi giờ máy bạn)' : ' (by your clock’s time zone)');
    var deg = function (x) { return num(Math.abs(x), 1).replace('.', v ? ',' : '.') + '°'; };
    return v ? deg(LOC.lat) + (LOC.lat < 0 ? ' Nam, ' : ' Bắc, ') + deg(LOC.lon) + (LOC.lon < 0 ? ' Tây' : ' Đông')
      : deg(LOC.lat) + (LOC.lat < 0 ? ' S, ' : ' N, ') + deg(LOC.lon) + (LOC.lon < 0 ? ' W' : ' E');
  }
  function skies() { return Array.prototype.slice.call(document.querySelectorAll('.sky')).filter(function (s) { return s.querySelector('.sky-box'); }); }

  // ---- the clock's clouds: as many as the cloud cover, drifting with the wind
  function clouds() {
    var c = W.cur; if (!c) return;
    var k = W.kind, cover = c.cloud_cover || 0, n = Math.round(cover / 100 * 5);
    if (k === 'rain' || k === 'storm') n = Math.max(n, 4); else if (k === 'fog') n = Math.max(n, 2);
    var s10 = c.wind_speed_10m || 0, east = Math.sin((c.wind_direction_10m || 0) * Math.PI / 180);   // (from the east: carried right)
    var rate = (east >= 0 ? 1 : -1) * Math.max(0.3, Math.abs(east)) * Math.min(4.5, 0.35 + s10 / 9);
    skies().forEach(function (s) {
      Array.prototype.forEach.call(s.querySelectorAll('.cloud'), function (cl, i) {
        cl.classList.toggle('wx-off', i >= n);
        if (cl.getAnimations && !reduce) cl.getAnimations().forEach(function (a) { if (a.playbackRate !== rate) { if (a.updatePlaybackRate) a.updatePlaybackRate(rate); else a.playbackRate = rate; } });
      });
    });
    keepGoing();
  }
  // (played backwards, a cloud's drift would at last run back to before it began and stop: it is moved on by whole
  // drifts, which looks the same)
  function keepGoing() {
    document.querySelectorAll('.sky .cloud').forEach(function (cl) {
      if (cl.getAnimations) cl.getAnimations().forEach(function (a) {
        var d = a.effect && a.effect.getComputedTiming ? a.effect.getComputedTiming().duration : 0;
        if (a.playbackRate < 0 && d > 0 && typeof a.currentTime === 'number' && a.currentTime < d * 3) a.currentTime += d * 40;
      });
    });
  }

  // ---- rain and lightning, drawn over the clock's sky (the one on the page showing), only while it is in view
  var R = { cv: null, g: null, sky: null, drops: [], bolt: null, nextBolt: 0, raf: 0, last: 0, w: 0, h: 0, dpr: 1, ink: '#000' };
  function paintSky() { return document.querySelector('.page.is-active .sky') || skies()[0] || null; }
  function prepare() {
    var s = paintSky(); if (!s) return false;
    if (R.sky !== s) {
      R.sky = s; var box = s.querySelector('.sky-box');
      R.cv = box.querySelector('.wx-rain');
      if (!R.cv) { R.cv = document.createElement('canvas'); R.cv.className = 'wx-rain'; R.cv.setAttribute('aria-hidden', 'true'); box.appendChild(R.cv);
        var fl = document.createElement('div'); fl.className = 'wx-flash'; fl.setAttribute('aria-hidden', 'true'); box.appendChild(fl); }
      R.g = R.cv.getContext('2d'); R.w = 0;
    }
    var w = R.cv.clientWidth, h = R.cv.clientHeight, dpr = Math.min(2, window.devicePixelRatio || 1);
    if (w !== R.w || h !== R.h || dpr !== R.dpr) { R.w = w; R.h = h; R.dpr = dpr; R.cv.width = Math.max(1, Math.round(w * dpr)); R.cv.height = Math.max(1, Math.round(h * dpr)); R.drops.length = 0; }
    R.ink = getComputedStyle(R.cv).color;
    return w > 0 && h > 0;
  }
  function intensity() { var c = W.cur; if (!c) return 0; var k = RAIN_K[c.weather_code] || 0, mmh = (c.precipitation || 0) * 4; return Math.max(k, mmh > 0.1 ? Math.min(1, 0.2 + Math.log(1 + mmh) / Math.log(21) * 0.8) : 0); }
  function frame(now) {
    R.raf = 0;
    var c = W.cur, rain = intensity(), storm = W.kind === 'storm';
    if (!c || (!rain && !storm) || document.hidden || document.body.classList.contains('is-idle') || !prepare()) { if (R.g) R.g.clearRect(0, 0, R.cv.width, R.cv.height); return; }
    var dt = Math.min(0.05, R.last ? (now - R.last) / 1000 : 0.016); R.last = now;
    var g = R.g, W2 = R.w, H2 = R.h, s10 = c.wind_speed_10m || 0, east = Math.sin((c.wind_direction_10m || 0) * Math.PI / 180), slant = east * Math.min(0.9, s10 / 30);
    g.setTransform(R.dpr, 0, 0, R.dpr, 0, 0); g.clearRect(0, 0, W2, H2);
    // the rain: falling from under the clouds (the upper part of the clock's sky) to the line under it
    var want = Math.round(8 + 70 * rain);
    while (R.drops.length < want) R.drops.push({ x: Math.random() * W2, y: Math.random() * H2, v: 0.8 + Math.random() * 0.5, l: 0.6 + Math.random() * 0.6 });
    R.drops.length = want;
    g.strokeStyle = R.ink; g.lineCap = 'round'; g.lineWidth = 1;
    var top = H2 * 0.28, speed = 70 + 60 * rain, len = 4 + 6 * rain;
    g.globalAlpha = 0.22 + 0.25 * rain; g.beginPath();
    for (var i = 0; i < R.drops.length; i++) {
      var d = R.drops[i]; d.y += speed * d.v * dt; d.x += slant * speed * d.v * dt;
      if (d.y > H2) { d.y = top + Math.random() * 6; d.x = Math.random() * (W2 + 40) - 20; }
      if (d.x < -10) d.x += W2 + 20; else if (d.x > W2 + 10) d.x -= W2 + 20;
      if (d.y < top) continue;
      g.moveTo(d.x, d.y); g.lineTo(d.x - slant * len * d.l, d.y - len * d.l);
    }
    g.stroke(); g.globalAlpha = 1;
    // a storm: now and then a fork of lightning from a cloud to the line, and the sky flashing
    if (storm && !reduce) {
      if (!R.nextBolt) R.nextBolt = now + 2500 + Math.random() * 4000;
      if (now > R.nextBolt) { R.bolt = bolt(W2, H2); R.bolt.t0 = now; R.nextBolt = now + 5000 + Math.random() * 9000;
        var fl = R.sky.querySelector('.wx-flash'); if (fl) { fl.style.setProperty('--fx', (R.bolt.x0 / W2 * 100).toFixed(0) + '%'); fl.classList.remove('on'); void fl.offsetWidth; fl.classList.add('on'); } }
      if (R.bolt) {
        var age = now - R.bolt.t0, a = age < 90 ? 1 : age < 140 ? 0.25 : age < 220 ? 0.85 : Math.max(0, 1 - (age - 220) / 260);
        if (a <= 0) R.bolt = null;
        else { g.save(); g.globalAlpha = a; g.strokeStyle = '#f4f7ff'; g.shadowColor = 'rgba(190, 210, 255, .95)'; g.shadowBlur = 8; g.lineJoin = 'round';
          R.bolt.paths.forEach(function (p, j) { g.lineWidth = j ? 0.8 : 1.6; g.beginPath(); p.forEach(function (q, m) { if (m) g.lineTo(q[0], q[1]); else g.moveTo(q[0], q[1]); }); g.stroke(); });
          g.restore(); }
      }
    }
    R.raf = requestAnimationFrame(frame);
  }
  function bolt(W2, H2) {   // a jagged stroke down from a cloud, with a branch or two
    var x0 = W2 * (0.15 + Math.random() * 0.7), y0 = H2 * 0.3, main = [[x0, y0]], x = x0, y = y0, paths = [main];
    while (y < H2 - 2) { y += 3 + Math.random() * 5; x += (Math.random() - 0.5) * 9; main.push([x, Math.min(H2 - 1, y)]); }
    for (var b = 0; b < 1 + Math.floor(Math.random() * 2); b++) {
      var st = main[1 + Math.floor(Math.random() * (main.length / 2))], br = [st.slice()], bx = st[0], by = st[1], dir = Math.random() < 0.5 ? -1 : 1;
      for (var k = 0; k < 3 + Math.floor(Math.random() * 3); k++) { by += 3 + Math.random() * 4; bx += dir * (2 + Math.random() * 5); br.push([bx, by]); }
      paths.push(br);
    }
    return { x0: x0, paths: paths };
  }
  function animate() { if (!R.raf) { R.last = 0; R.raf = requestAnimationFrame(frame); } }

  // ---- start: once the page has drawn its clocks; again on the page's language switch, a page change, the minute, waking
  function start() {
    if (!skies().length) { setTimeout(start, 400); return; }
    load(); setInterval(function () { if (!document.hidden) load(); }, REFRESH);
    setInterval(function () { render(); }, 60000);   // (day or night: its sign)
    new MutationObserver(function () { render(); }).observe(root, { attributes: true, attributeFilter: ['data-lang'] });
    var mo = new MutationObserver(function () { clouds(); animate(); });   // (waking from idle; another page shown)
    mo.observe(document.body, { attributes: true, attributeFilter: ['class'] });
    document.querySelectorAll('.page').forEach(function (p) { mo.observe(p, { attributes: true, attributeFilter: ['class'] }); });
    document.addEventListener('visibilitychange', function () { if (!document.hidden) { if (Date.now() - W.at > REFRESH) load(); animate(); } });
    setInterval(function () { animate(); keepGoing(); }, 2000);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
