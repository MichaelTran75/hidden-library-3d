# python3 -I xray_put.py <clockxray.js>: xray.json (from xray.py) written into the module, between its two marks
import os, sys, re
here = os.path.dirname(os.path.abspath(__file__)); data = open(os.path.join(here, 'xray.json')).read().strip(); p = sys.argv[1]; s = open(p).read()
a, b = '/*XRAY-DATA*/', '/*XRAY-END*/'; i, j = s.index(a) + len(a), s.index(b); open(p, 'w').write(s[:i] + data + s[j:]); print('put', len(data), 'bytes into', os.path.basename(p))
