# the clock's own frame: the file's (x, y, z) turned −8.6° about z, so the arbors run along X and the dial faces −X
import os, site, sys; sys.path.append(site.getusersitepackages())
import numpy as np, pickle
TH = np.radians(8.6)
def to_frame(P):
    c, s = np.cos(TH), np.sin(TH); return np.c_[P[:, 0] * c + P[:, 1] * s, -P[:, 0] * s + P[:, 1] * c, P[:, 2]]
def load():
    D = pickle.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'parts.pkl'), 'rb'))
    D['F'] = to_frame(D['P']); return D
