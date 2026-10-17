/* The sun where the visitor is, by their own clock (G, 17/10/2026: "do research và cho mặt trời mọc và mặt trời lặn
   depend on local time"): window.HL_SUN, for the page (its day/night theme, its sky clock's sunrise and sunset, the
   weather's sign; and the weather itself is that place's: weather/sky-weather.js, G, 17/10/2026: "clock and weather
   base on local browser user") and the 3D room (fx/hour.js: its light; fx/sky.js: the real sky). Put in the page's
   <head> by build.py, after zones.js, so the theme is right from the first paint. South of the equator <html> gets the
   class hl-south: the moon, the clock's and the room's, is seen from there turned over (its lit side on the left as it
   waxes), so its picture (taken from the north) is turned half round.
   - Where: the time zone the browser's clock keeps (Intl.DateTimeFormat().resolvedOptions().timeZone), at the zone's
     principal city (zones.js: the IANA time zone database's zone.tab). No permission is asked: inside the Wix frame
     the page could not ask for the visitor's position anyway (a cross-origin frame gets no geolocation unless the page
     around it allows it). A clock on Vietnam's time (Asia/Ho_Chi_Minh, or Asia/Saigon as Chromium names it) is taken
     to be at Pleiku (13.98° N, 108.0° E), the room's own place and its weather's; so is any UTC+7 clock in a browser
     that speaks Vietnamese (Windows keeps "(UTC+07:00) Bangkok, Hanoi, Jakarta" as Asia/Bangkok unless its region is
     set to Vietnam). A zone the table lacks (UTC, Etc/GMT-7): 14° N on its standard meridian (its UTC offset × 15°).
   - Where the sun is: NOAA's solar equations (from Meeus, "Astronomical Algorithms", as NOAA's Solar Calculator works
     them: sunrise and sunset to within a minute between 72° N and 72° S), from the instant itself, so daylight saving
     time and the date take no special care; its elevation as it is seen, lifted by the air's refraction (NOAA's
     approximation: ~0.57° at the horizon, nothing near the zenith).
   - Sunrise and sunset: the sun's top edge on a level horizon, its centre 0.833° below it (34′ of refraction and 16′
     of the sun's radius): from the sun's noon, stepped to the hour angle of that with the sun's place worked out
     again at each step. Where the sun does not rise or set that day (inside the polar circles), all day or all night.
   - The page's day runs from sunrise to sunset in whole minutes of the local clock, the same rule wherever it is asked
     (the theme, the sky clock, the weather's sign, the room), so they all turn in the same minute.
   Where the clock's zone cannot be read at all, Pleiku. */
(function () {
  'use strict';
  var DEG = Math.PI / 180, DAY = 864e5, COS_RISE = Math.cos(90.833 * DEG);
  var PLEIKU = { lat: 13.98, lon: 108.0 };

  function stdOffset() {   // the zone's standard UTC offset in hours (the smaller of winter's and summer's)
    var y = new Date().getFullYear();
    return -Math.max(new Date(y, 0, 1).getTimezoneOffset(), new Date(y, 6, 1).getTimezoneOffset()) / 60;
  }
  function where() {
    var zone = '';
    try { zone = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch (e) { /* no Intl */ }
    var langs = (navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language || '']);
    var vi = langs.some(function (l) { return /^vi\b/i.test(l); });
    if (/^Asia\/(Ho_Chi_Minh|Saigon)$/.test(zone) || (vi && stdOffset() === 7)) return { lat: PLEIKU.lat, lon: PLEIKU.lon, zone: zone, city: 'Pleiku' };
    var area = zone.split('/')[0], city = zone.slice(area.length + 1), all = ';' + ZONES + ';', g = all.indexOf(';' + area + ':');
    if (area && city && g >= 0) {
      var list = all.slice(g + area.length + 2, all.indexOf(';', g + 1)).split(',');
      for (var i = 0; i < list.length; i++) {
        var p = list[i].split(' ');
        if (p[0] === city) return { lat: p[1] / 10, lon: p[2] / 10, zone: zone, city: city.split('/').pop().replace(/_/g, ' ') };
      }
    }
    return { lat: 14, lon: stdOffset() * 15, zone: zone, city: '' };
  }

  function solar(t) {   // the sun's declination (radians) and the equation of time (minutes) at the instant t (ms)
    var T = (t / DAY + 2440587.5 - 2451545) / 36525;   // Julian centuries from J2000
    var L0 = (280.46646 + T * (36000.76983 + T * 0.0003032)) % 360, M = (357.52911 + T * (35999.05029 - 0.0001537 * T)) * DEG;
    var ecc = 0.016708634 - T * (0.000042037 + 0.0000001267 * T);
    var C = Math.sin(M) * (1.914602 - T * (0.004817 + 0.000014 * T)) + Math.sin(2 * M) * (0.019993 - 0.000101 * T) + Math.sin(3 * M) * 0.000289;
    var om = (125.04 - 1934.136 * T) * DEG, lam = (L0 + C - 0.00569 - 0.00478 * Math.sin(om)) * DEG;   // its apparent longitude
    var eps = (23 + (26 + (21.448 - T * (46.815 + T * (0.00059 - T * 0.001813))) / 60) / 60 + 0.00256 * Math.cos(om)) * DEG;   // the obliquity
    var y = Math.pow(Math.tan(eps / 2), 2), L = L0 * DEG;
    var eot = 4 / DEG * (y * Math.sin(2 * L) - 2 * ecc * Math.sin(M) + 4 * ecc * y * Math.sin(M) * Math.cos(2 * L) - 0.5 * y * y * Math.sin(4 * L) - 1.25 * ecc * ecc * Math.sin(2 * M));
    return { dec: Math.asin(Math.sin(eps) * Math.sin(lam)), eot: eot };
  }
  var wrap = function (a) { return ((a % 360) + 540) % 360 - 180; };   // degrees into −180..180
  function hourAngle(t, s) {   // the sun's hour angle (degrees, 0 at its noon, west positive) at the instant t
    return wrap(((t % DAY) + DAY) % DAY / 6e4 / 4 + s.eot / 4 + P.lon - 180);
  }
  function refraction(e) {   // how far the air lifts the sun at a true elevation e (degrees; NOAA's approximation)
    if (e > 85) return 0;
    var te = Math.tan(e * DEG);
    return (e > 5 ? 58.1 / te - 0.07 / Math.pow(te, 3) + 0.000086 / Math.pow(te, 5)
      : e > -0.575 ? 1735 + e * (-518.2 + e * (103.4 + e * (-12.79 + e * 0.711))) : -20.772 / te) / 3600;
  }
  function at(d) {   // where the sun is seen at the date d (now if none): elevation and azimuth (degrees; azimuth from north, clockwise)
    var t = d ? +d : Date.now(), s = solar(t), ha = hourAngle(t, s) * DEG, lat = P.lat * DEG;
    var e = Math.asin(Math.max(-1, Math.min(1, Math.sin(lat) * Math.sin(s.dec) + Math.cos(lat) * Math.cos(s.dec) * Math.cos(ha)))) / DEG;
    var az = (Math.atan2(Math.sin(ha), Math.cos(ha) * Math.sin(lat) - Math.tan(s.dec) * Math.cos(lat)) / DEG + 540) % 360;
    return { e: e + refraction(e), az: az };
  }
  function times(d) {   // that local day's sunrise, the sun's noon and sunset (instants, ms); polar: 'day' or 'night' where it does not rise or set
    var noon = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12).getTime(), out = { rise: null, noon: 0, set: null, polar: null };
    for (var i = 0; i < 2; i++) noon -= hourAngle(noon, solar(noon)) / 360 * DAY;
    out.noon = noon;
    [-1, 1].forEach(function (sign) {
      var t = noon;
      for (var i = 0; i < 4; i++) {
        var s = solar(t), lat = P.lat * DEG, c = (COS_RISE - Math.sin(lat) * Math.sin(s.dec)) / (Math.cos(lat) * Math.cos(s.dec));
        if (c < -1 || c > 1) { out.polar = c < -1 ? 'day' : 'night'; return; }
        t += wrap(sign * Math.acos(c) / DEG - hourAngle(t, s)) / 360 * DAY;
      }
      out[sign < 0 ? 'rise' : 'set'] = t;
    });
    return out;
  }
  var cache = { key: '', m: null };
  function minutes(d) {   // that local day's sunrise, the sun's noon and sunset in minutes of the local clock (0..1440);
    d = d || new Date();  // the same object all day; all day {rise 0, set 1440} or all night {0, 0} where it does not rise or set
    var key = d.getFullYear() + '-' + d.getMonth() + '-' + d.getDate();
    if (cache.key === key) return cache.m;
    var T = times(d), day0 = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    var clock = function (t) {   // (to the nearest minute; past midnight counts on, so a sunset after it stays after the sunrise)
      var x = new Date(t + 3e4), dd = Math.round((new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime() - day0) / DAY);
      return Math.max(0, Math.min(1440, dd * 1440 + x.getHours() * 60 + x.getMinutes()));
    };
    var m = T.polar ? { rise: 0, noon: clock(T.noon), set: T.polar === 'day' ? 1440 : 0 } : { rise: clock(T.rise), noon: clock(T.noon), set: clock(T.set) };
    cache.key = key; cache.m = m;
    return m;
  }
  function isDay(d) {   // the page's day: from sunrise to sunset, in whole minutes of the local clock
    d = d || new Date();
    var m = minutes(d), x = d.getHours() * 60 + d.getMinutes();
    return x >= m.rise && x < m.set;
  }

  var P;
  try { P = where(); } catch (e) { P = { lat: PLEIKU.lat, lon: PLEIKU.lon, zone: '', city: 'Pleiku' }; }   // (the place unreadable: the room's own)
  window.HL_SUN = { place: P, at: at, times: times, minutes: minutes, isDay: isDay };
  if (P.lat < 0) document.documentElement.classList.add('hl-south');
})();
