"""Where each time zone is -> src/sun/zones.js (for the sun of the visitor's own place: src/sun/sun-clock.js)

    python3 tools/sunplace/make.py [path/to/zone.tab]

A page cannot ask where its visitor is without asking them (and inside the Wix frame it cannot ask at all: a cross-origin
frame gets no geolocation unless the page around it allows it), but the browser does say which time zone its clock
keeps: Intl.DateTimeFormat().resolvedOptions().timeZone, a name from the IANA time zone database. The database gives
each zone the place it is named after, its principal city (zone.tab: "the latitude and longitude of the zone's
principal location", ISO 6709). So the sun can be worked out for the visitor's own city, or the one their clock is set
by, to a few hundred kilometres at worst.

- zone.tab: the one macOS keeps (/usr/share/zoneinfo/zone.tab, tzdata 2026d when this was made), 418 zones;
- the names Chromium reports instead for 19 of them (cldr-zones.json, Intl.supportedValuesOf('timeZone') in Chromium
  143: ICU keeps CLDR's older names, so a clock in Vietnam says Asia/Saigon, not Asia/Ho_Chi_Minh, and one in India
  Asia/Calcutta): each matched to its zone by the zone's file in /usr/share/zoneinfo (the same bytes), so a zone has its
  place under either name.

Written as one string: the zones grouped by their area, "Area:City lat lon,City lat lon;Area:...", lat and lon in tenths
of a degree (some 10 km; a tenth of a degree of longitude is 24 s of the sun's time).
"""
import json, os, sys

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.normpath(os.path.join(HERE, '..', '..'))
TAB = sys.argv[1] if len(sys.argv) > 1 else '/usr/share/zoneinfo/zone.tab'
ZONEINFO = os.path.dirname(TAB)
OUT = os.path.join(SRC, 'sun', 'zones.js')


def iso6709(s):   # +DDMM+DDDMM or +DDMMSS+DDDMMSS -> (lat, lon) in degrees
    k = max(i for i in range(1, len(s)) if s[i] in '+-')
    def deg(p, dw):
        sg = -1 if p[0] == '-' else 1; d = p[1:]
        v = int(d[:dw]) + int(d[dw:dw + 2]) / 60 + (int(d[dw + 2:dw + 4]) / 3600 if len(d) > dw + 2 else 0)
        return sg * v
    return deg(s[:k], 2), deg(s[k:], 3)


zones = {}
for line in open(TAB, encoding='utf-8'):
    if line.startswith('#') or not line.strip():
        continue
    f = line.rstrip('\n').split('\t')
    zones[f[2]] = iso6709(f[1])
version = open(os.path.join(ZONEINFO, '+VERSION')).read().strip() if os.path.exists(os.path.join(ZONEINFO, '+VERSION')) else '?'

# Chromium's older names: the zone whose file is the same
cldr = json.load(open(os.path.join(HERE, 'cldr-zones.json')))['zones']
blob = lambda z: open(os.path.join(ZONEINFO, z), 'rb').read()
unclaimed = [z for z in zones if z not in cldr]
aliases = {}
for name in sorted(set(cldr) - set(zones)):
    if not os.path.exists(os.path.join(ZONEINFO, name)):
        sys.exit('no zone file for ' + name)
    same = [z for z in unclaimed if blob(z) == blob(name)]
    if len(same) != 1:
        sys.exit(f'{name}: {len(same)} zones with the same file: {same}')
    aliases[name] = same[0]
for a, z in aliases.items():
    print(f'  {a:24s} -> {z}')

places = dict(zones)
places.update({a: zones[z] for a, z in aliases.items()})
areas = {}
for name in sorted(places):
    area, _, city = name.partition('/')
    lat, lon = places[name]
    areas.setdefault(area, []).append(f'{city} {round(lat * 10)} {round(lon * 10)}')
data = ';'.join(area + ':' + ','.join(cities) for area, cities in areas.items())
js = (f'// Where each time zone is: its principal city (tzdata {version}, zone.tab), under its IANA name and the older one\n'
      f'// Chromium reports for it. Made by tools/sunplace/make.py: "Area:City lat lon,...;Area:...", in tenths of a degree.\n'
      f"var ZONES = '{data}';\n")
open(OUT, 'w', encoding='utf-8').write(js)
print(f'{len(zones)} zones + {len(aliases)} older names -> {OUT} ({len(js) / 1024:.1f} KB)')
