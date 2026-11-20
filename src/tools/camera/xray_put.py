# python3 xray_put.py <xray.json> <camxray.js>: the outlines (from xray.py) written into the module, between its two marks
import os, sys
data = open(sys.argv[1]).read().strip(); p = sys.argv[2]; s = open(p).read()
a, b = '/*XRAY-DATA*/', '/*XRAY-END*/'; i, j = s.index(a) + len(a), s.index(b); open(p, 'w').write(s[:i] + data + s[j:]); print('put', len(data), 'bytes into', os.path.basename(p))
