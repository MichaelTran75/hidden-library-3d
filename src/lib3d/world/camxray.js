import './camera.js';   // build order: the module before this one runs first
import { VCAM } from './camera.js';

/* ---------------------------------------------------------------- the camera as an X-ray plate, seen from its side
   Beside the camera while it is out of its shelf: its side view, flat (an SVG), as an X-ray shows a thing, drawn on
   paper as the clock's plate is (clockxray.js): every part a piece of paper a little see-through, in ink, so that what
   lies behind shows through and the washes add up where parts overlap. Seen from the rewind side: the lens points
   left, the eyepiece right. It is the 3D camera's own projection, whole (the 3D one beside it comes apart; the plate
   shows the same parts where they sit): each outline is the part's triangles laid on the plane through the lens's
   axis (tools/camera/xray_dump.cjs takes them from the page, xray.py makes XCAM below).
   What lies on the lens's axis is drawn boldest (the glass, the stop, the mirror box, the screen, the prism, the
   shutter), what lies off it to either side paler (the cassette, the take-up spool, the sprocket, the shafts); the
   mirror is the one solid black piece, the film the one red. One line is not a part: the way of the light, from the
   lens to the mirror, up through the screen, twice turned in the prism (its roof, its front face) and out by the
   eyepiece; dotted on from the mirror to the film, where it goes while the mirror is up. Its dashes run the way the
   light goes.
   The plate takes room at the right of the screen (VCAM.xray.room: camera.js sets the camera and its parts' names aside
   by it), and is left out on a narrow window. */
const XCAM = /*XRAY-DATA*/{"W":744,"H":808,"K":8.0,"parts":{"body":"M322 296l358 0 2 4 1 20 -4 6 0 395 5 8 -4 18 -248 0 -5 -5 -3 -29 -5 -6 -94 1 -9 -21 0 -387z","top":"M421 23l17 5 6 0 1 2 8 3 23 8 5 0 6 4 185 64 10 5 3 4 -1 93 1 13 2 4 0 31 -1 30 -5 3 -1 5 -358 0 0 -4 -6 -4 1 -81 -2 -12 0 -20 8 -8 2 -30 36 -44 0 -2 4 -3 7 -11 4 -3 0 -2 4 -3 11 -16 4 -3 7 -11z","bottom":"M432 746l249 0 5 5 1 30 -4 5 -253 0 -5 -5 0 -14 1 -15z","knobs":"M489 149l146 0 2 1 1 7 2 0 1 2 -3 2 0 4 4 3 12 0 1 3 4 2 0 2 -3 1 3 2 0 2 -3 1 3 2 0 2 -3 1 0 9 -2 2 28 0 0 -45 32 1 2 5 0 39 3 0 2 3 3 14 0 5 -4 3 -4 0 -1 52 -21 3 -5 9 -7 2 0 -66 -235 1 -2 -2 0 -17 -5 -2 0 -5 2 0 0 -2 -3 -4 0 -2 2 0 0 -3 -2 -1 -1 -4 0 -14 16 -1 1 -16zM425 324l2 0 3 5 0 79 -2 4 -3 1 -14 -16 -5 5 -24 0 -1 -2 -2 0 0 -63 3 -3 22 0 5 5 2 0z","barrel":"M160 298l75 1 1 11 10 1 4 2 23 0 1 2 17 0 3 8 14 1 24 23 2 0 2 -3 4 3 4 -3 4 3 4 -3 4 3 4 -3 5 3 0 330 -4 4 -4 -4 -4 4 -4 -4 -4 4 -4 -4 -4 4 -3 -4 -2 0 -24 23 -14 1 -3 8 -17 0 -9 2 -22 1 -3 2 -4 0 -1 11 -75 1 -2 -16 -38 3 -5 3 -2 9 -22 0 -2 -14 -31 -2 -2 -16 -37 1 -1 -364 37 1 3 -16 16 0 1 -2 14 0 1 -14 23 0 2 10 5 2 13 0 1 2 24 1z","glass0":"M96 390l13 0 0 244 -13 0 0 -2 -1 0 0 -2 -1 0 0 -2 -1 0 0 -2 -1 0 -1 -6 -1 0 0 -2 -1 0 0 -3 -1 0 0 -3 -1 0 0 -3 -1 0 0 -4 -1 0 0 -4 -1 0 0 -4 -1 0 0 -3 -1 0 0 -2 -1 0 0 -4 -1 0 0 -4 -1 0 0 -5 -1 0 0 -4 -1 0 0 -5 -1 0 0 -4 -1 0 -1 -15 -1 0 0 -9 -1 0 0 -17 -1 0 1 -43 1 0 0 -9 1 0 1 -15 1 0 0 -4 1 0 0 -5 1 0 0 -4 1 0 0 -5 1 0 1 -8 1 0 1 -5 1 0 2 -12 1 0 2 -9 1 0 0 -2 1 0 1 -6 1 0 0 -2 1 0z","glass1":"M135 403l14 0 0 218 -14 0 -1 -3 -1 0 0 -1 -2 -1 0 -2 -2 -1 -1 -4 -2 -1 0 -2 -1 0 0 -2 -1 0 0 -2 -1 0 0 -2 -1 0 0 -2 -1 0 0 -2 -1 0 0 -3 -1 0 0 -2 -1 0 0 -3 -1 0 0 -2 -1 0 0 -2 -1 0 0 -2 -1 0 0 -2 -1 0 0 -2 -1 0 0 -2 -1 0 0 -4 -1 0 0 -4 -1 0 0 -4 -1 0 0 -4 -1 0 0 -4 -1 0 0 -4 -1 0 -1 -11 -1 0 0 -4 -1 0 0 -14 -1 0 1 -36 1 0 0 -4 1 0 0 -6 1 0 0 -5 1 0 0 -4 1 0 0 -4 1 0 0 -4 1 0 2 -12 1 0 0 -2 1 0 0 -2 1 0 0 -2 1 0 0 -2 1 0 0 -2 1 0 0 -2 1 0 0 -3 1 0 0 -2 1 0 0 -3 1 0 0 -2 1 0 0 -2 1 0 0 -2 1 0 2 -6 2 -1 1 -4 2 -1 0 -2 3 -2z","glass2":"M160 422l50 0 0 180 -50 0 0 -4 -1 0 0 -13 -1 0 0 -12 -1 0 0 -20 -1 0 0 -82 1 0 0 -19 1 0 0 -13 1 0 0 -13 1 0z","glass3":"M221 424l71 0 0 2 1 0 0 2 1 0 0 2 1 0 0 2 1 0 0 2 1 0 0 2 1 0 0 2 1 0 0 2 1 0 0 2 1 0 0 2 1 0 0 4 1 0 0 3 1 0 0 3 1 0 0 3 1 0 0 3 1 0 0 3 1 0 0 4 1 0 0 3 1 0 0 3 1 0 1 11 1 0 0 6 1 0 0 19 1 0 0 6 -1 0 0 19 -1 0 0 6 -1 0 0 6 -1 0 -1 9 -1 0 0 3 -1 0 0 3 -1 0 0 3 -1 0 0 3 -1 0 0 3 -1 0 0 3 -1 0 0 3 -1 0 0 4 -1 0 0 2 -1 0 0 2 -1 0 0 2 -1 0 0 2 -1 0 0 2 -1 0 0 2 -1 0 0 3 -1 0 -2 6 -71 0z","glass4":"M319 413l12 0 1 9 1 0 0 4 1 0 1 7 1 0 0 5 1 0 1 12 1 0 1 9 1 0 0 14 1 0 1 21 1 0 0 36 -1 0 0 14 -1 0 0 7 -1 0 0 14 -1 0 0 5 -1 0 0 4 -1 0 -1 12 -1 0 0 5 -1 0 0 4 -1 0 -1 7 -1 0 -1 9 -12 0 -1 -25 -1 0 0 -7 -1 0 -2 -78 1 0 1 -56 1 0 0 -7 1 0z","iris":"M197 380l9 0 0 264 -9 0zM213 384l10 0 0 257 -10 0zM210 404l1 0 0 37 1 0 0 82 -1 0 0 57 -1 0 0 3 -1 0 0 37 -1 0 -1 -179 1 0 0 3 2 0z","mbox":"M320 315l11 0 0 393 -11 0zM332 336l65 0 0 13 -65 0zM333 348l63 0 0 -11 -63 0zM394 350l19 0 0 14 -19 0zM591 422l6 6 -184 182 -4 -5 91 -90 0 -2zM332 686l256 0 0 13 -256 0zM333 698l254 0 0 -11 -254 0z","throat":"M316 331l41 0 0 362 -41 0z","mirror":"M581 419l4 3 0 2 3 3 -176 175 -6 -7 88 -87 0 -2z","link":"M591 410l5 0 5 6 -2 5 -2 0 0 2 -6 0 -1 -2 -2 0 -1 -6zM556 515l3 1 0 2 1 0 0 2 1 0 3 8 2 1 0 2 1 0 0 2 1 0 3 7 -2 0 0 1 -4 1 -1 2 -10 4 -1 2 -12 5 -1 2 -10 4 -1 2 -12 5 -1 2 -10 4 -1 2 -12 5 -1 2 -10 4 -1 2 -12 5 -1 2 -10 4 -1 2 -4 1 -1 2 -3 -1 0 -2 -1 0 0 -2 -1 0 -3 -8 -2 -1 0 -2 -1 0 0 -2 -1 0 -3 -7 2 0 0 -1 4 -1 1 -2 10 -4 1 -2 12 -5 1 -2 10 -4 1 -2 12 -5 1 -2 10 -4 1 -2 12 -5 1 -2 10 -4 1 -2 12 -5 1 -2 10 -4 1 -2 4 -1zM388 596l25 0 0 97 -25 0zM434 612l77 0 0 25 -77 0zM361 632l8 0 0 41 -8 0z","screen":"M387 336l223 0 0 15 -223 0z","prism":"M407 59l8 4 3 0 4 3 3 0 2 2 3 0 4 3 8 2 4 3 8 2 4 3 8 2 4 3 8 2 4 3 8 2 11 6 8 2 4 3 8 2 4 3 8 2 4 3 8 2 4 3 8 2 4 3 8 2 4 3 8 2 4 3 10 3 0 198 -183 0 -3 -6 0 -3 -2 -2 0 -3 -3 -4 0 -3 -2 -2 0 -3 -3 -4 0 -3 -3 -4 -2 -8 -6 -11 -2 -8 -3 -4 -2 -8 -6 -11 -2 -8 -6 -11 -2 -8 -3 -4 -2 -8 -3 -4 -2 -8 -3 -4 -2 -8 -3 -4 0 -3 -7 -14 -2 -8 -3 -4 -2 -8 -5 -9 0 -2 7 -7 2 0 14 -15 2 0 13 -14 2 0 14 -15 2 0z","rollers":"M586 351l51 0 1 16 -62 0 0 -7 10 0zM587 368l49 0 0 7 -6 0 0 274 6 0 0 8 -49 0 0 -8 5 0 0 -274 -5 0zM632 392l5 0 0 241 -5 0zM576 658l62 0 0 17 -54 0 0 -11 -8 0z","cloth":"M626 380l3 0 0 18 3 0 0 -18 3 0 0 18 1 0 0 228 -1 0 0 18 -3 0 0 -18 -3 0 0 18 -3 0 0 -18 -39 0 0 -228 39 0z","casting":"M438 296l236 0 0 14 -12 0 0 425 12 0 0 13 -236 0 0 -13 213 0 0 -425 -213 0z","shafts":"M468 216l20 0 0 69 51 0 0 8 -51 0 0 388 -20 0zM547 216l26 0 0 8 3 0 0 4 10 0 0 36 24 0 -1 17 -23 0 0 16 -10 0 0 24 -3 0 0 39 84 0 0 28 6 0 0 3 9 0 0 16 -9 0 0 3 -6 0 0 204 6 0 0 3 9 0 0 16 -9 0 0 3 -6 0 0 29 -84 0 0 64 -26 0 0 -408 -2 0 0 -40 -15 0 0 -5 -20 0 0 -12 35 0 0 -40 2 0zM612 285l66 0 0 8 -66 0z","spool":"M476 360l169 0 0 7 -33 0 0 290 33 0 0 8 -169 0 0 -8 32 0 0 -290 -32 0z","wind":"M536 258l75 0 0 10 -75 0zM497 278l126 0 0 4 4 0 0 10 -107 0 0 -2 -23 0z","gears":"M443 752l22 0 0 4 15 0 0 -4 202 0 0 11 -9 0 0 2 -80 0 0 4 -128 0 0 2 -22 0z","gov":"M468 751l105 0 0 8 -105 0zM489 760l80 0 0 9 -80 0z","rods":"M523 266l10 0 0 485 -10 0zM546 266l9 0 0 485 -9 0zM480 761l38 0 0 8 -21 0 0 8 -27 0 0 -8 10 0z","film":"M662 372l1 0 0 281 -1 0z","coil":"M493 372l170 0 0 281 -170 0z","cassette":"M528 331l65 0 0 8 66 0 2 1 0 17 8 0 0 321 -8 0 0 17 -57 0 0 27 -87 0 0 -27 -57 0 0 -355 2 -1 66 0z","plate":"M663 380l7 0 0 38 3 0 0 60 -3 0 0 68 3 0 0 60 -3 0 0 39 -7 0z","bush":"M488 755l113 0 0 9 -16 0 0 22 -81 0 0 -22 -16 0z"},"ray":[[12.0,512.0],[498.4,512.0],[498.4,97.5],[367.9,228.0],[732.0,228.0]],"film":[[498.4,512.0],[662.4,512.0]],"mm10":80.0}/*XRAY-END*/;
const VX = { el: null, on: false, w: 0 };
const vxf = v => (+v).toFixed(2);
function buildCamXray(host) {
  const D = XCAM, P = D.parts; if (!P) return;
  const k = D.K / 4;   // (the outlines' grid is finer than a screen pixel: line widths by it)
  const lay = (name, cls) => P[name] ? `<path d="${P[name]}" fill-rule="evenodd" class="${cls}"/>` : '';
  const line = pts => 'M' + pts.map(p => p[0] + ' ' + p[1]).join('L');
  const el = document.createElement('div'); el.className = 'vc-xray';
  el.innerHTML = `<style>
    .vc-xray { position: absolute; right: 18px; top: 50%; transform: translateY(-50%) rotate(-.3deg); opacity: 0; transition: opacity .5s ease .25s; pointer-events: none; box-sizing: border-box; padding: 9px 10px 8px;
      background: #efe6d2; border: 1px solid #b7a785; border-radius: 9px; box-shadow: 0 12px 26px rgba(0, 0, 0, .5); }
    .vc-xray.is-on { opacity: 1; pointer-events: auto; }
    .vc-xray::before { content: ""; position: absolute; inset: 5px; border: 1px dashed #cbbd9e; border-radius: 6px; pointer-events: none; }
    .vc-xray svg { display: block; width: 100%; height: auto; border-radius: 5px; background: #e6dbc2; box-shadow: inset 0 0 0 1px #cdbf9f; }
    .vc-xray .xr-row { display: flex; justify-content: space-between; align-items: baseline; margin: 0 4px; font: 600 8.6px/1 var(--font, system-ui); letter-spacing: .14em; text-transform: uppercase; color: #5d4f38; }
    .vc-xray .xr-row.top { margin-bottom: 7px; padding-top: 3px; } .vc-xray .xr-row.foot { margin-top: 7px; padding-bottom: 2px; letter-spacing: .08em; } .vc-xray .xr-row b { font: 600 9.4px/1 ui-monospace, Menlo, monospace; letter-spacing: 0; color: #4a3d2a; white-space: nowrap; }
    /* the plate: paper pieces a little see-through, in ink; on the lens's axis darker and bolder, off it paler and finer; washes add up where pieces overlap */
    .xs-a { fill: rgba(150, 118, 70, .09); stroke: rgba(110, 88, 54, .42); stroke-width: ${vxf(0.5 * k)}; }
    .xs-b { fill: rgba(150, 118, 70, .12); stroke: rgba(96, 76, 46, .62); stroke-width: ${vxf(0.6 * k)}; }
    .xs-k { fill: rgba(70, 56, 40, .13); stroke: rgba(70, 54, 34, .66); stroke-width: ${vxf(0.55 * k)}; }
    .xs-o { fill: rgba(112, 126, 124, .13); stroke: rgba(70, 80, 78, .5); stroke-width: ${vxf(0.45 * k)}; }
    .xs-s { fill: rgba(112, 126, 124, .36); stroke: rgba(52, 62, 60, .95); stroke-width: ${vxf(0.7 * k)}; }
    .xs-w { fill: rgba(196, 150, 62, .30); stroke: rgba(104, 76, 26, .92); stroke-width: ${vxf(0.65 * k)}; }
    .xs-g { fill: rgba(126, 160, 178, .36); stroke: rgba(40, 62, 74, .95); stroke-width: ${vxf(0.8 * k)}; }
    .xs-p { fill: rgba(126, 160, 178, .24); stroke: rgba(40, 62, 74, .95); stroke-width: ${vxf(0.9 * k)}; }
    .xs-c { fill: rgba(246, 240, 224, .78); stroke: rgba(78, 60, 36, .9); stroke-width: ${vxf(0.7 * k)}; }
    .xs-l { fill: rgba(40, 32, 24, .3); stroke: rgba(30, 24, 18, .8); stroke-width: ${vxf(0.5 * k)}; }
    .xs-h { fill: #2f2a26; stroke: #14110e; stroke-width: ${vxf(0.5 * k)}; } .xs-hs { fill: rgba(42, 28, 12, .22); }
    .xs-f { fill: #c8452d; stroke: #7e2414; stroke-width: ${vxf(0.6 * k)}; }
    .xs-ray { fill: none; stroke: #b0672a; stroke-width: ${vxf(1.1 * k)}; stroke-linecap: round; stroke-linejoin: round; stroke-dasharray: ${vxf(5 * k)} ${vxf(4 * k)}; animation: xs-go 1.5s linear infinite; }
    .xs-ray2 { fill: none; stroke: #b0672a; stroke-width: ${vxf(1.1 * k)}; stroke-linecap: round; stroke-dasharray: ${vxf(0.4 * k)} ${vxf(3 * k)}; opacity: .8; }
    .xs-reg { fill: none; stroke: #a89877; stroke-width: ${vxf(0.6 * k)}; } .xs-mm { fill: none; stroke: #5d4f38; stroke-width: ${vxf(0.6 * k)}; } .xs-t { fill: #5d4f38; font: 600 ${vxf(8.4 * k)}px/1 ui-monospace, Menlo, monospace; }
    @keyframes xs-go { from { stroke-dashoffset: ${vxf(9 * k)}; } to { stroke-dashoffset: 0; } }
    @media (prefers-reduced-motion: reduce) { .xs-ray { animation: none; } }
    @media (max-width: 1179px) { .vc-xray { display: none; } }
    </style>
    <div class="xr-row top"><span>Fig. 2</span><span class="en">Seen through, from its side</span><span class="vi">Nhìn xuyên, từ bên hông</span></div>
    <svg viewBox="0 0 ${D.W} ${D.H}" role="img" aria-label="The camera seen through from its side: the lens's glass, the mirror, the screen, the prism, the shutter and the film, and the way of the light">
    <path d="M${vxf(12 * k)} ${vxf(12 * k)}h${vxf(10 * k)}M${vxf(12 * k)} ${vxf(12 * k)}v${vxf(10 * k)}M${vxf(D.W - 12 * k)} ${vxf(D.H - 12 * k)}h${vxf(-10 * k)}M${vxf(D.W - 12 * k)} ${vxf(D.H - 12 * k)}v${vxf(-10 * k)}" class="xs-reg"/>
    ${lay('body', 'xs-a')}${lay('top', 'xs-b')}${lay('bottom', 'xs-b')}${lay('knobs', 'xs-b')}${lay('barrel', 'xs-b')}
    ${lay('casting', 'xs-k')}${lay('coil', 'xs-o')}${lay('spool', 'xs-o')}${lay('cassette', 'xs-o')}${lay('shafts', 'xs-o')}${lay('wind', 'xs-w')}${lay('gears', 'xs-w')}${lay('gov', 'xs-w')}${lay('bush', 'xs-w')}${lay('rods', 'xs-s')}
    ${lay('mbox', 'xs-k')}${lay('throat', 'xs-s')}${lay('link', 'xs-o')}${lay('rollers', 'xs-s')}${lay('plate', 'xs-k')}${lay('cloth', 'xs-l')}${lay('film', 'xs-f')}
    ${[0, 1, 2, 3, 4].map(i => lay('glass' + i, 'xs-g')).join('')}${lay('iris', 'xs-w')}${lay('eye', 'xs-g')}${lay('screen', 'xs-c')}${lay('prism', 'xs-p')}
    <g transform="translate(${vxf(1.2 * k)} ${vxf(1.9 * k)})">${lay('mirror', 'xs-hs')}</g>${lay('mirror', 'xs-h')}
    <path d="${line(D.film)}" class="xs-ray2"/><path d="${line(D.ray)}" class="xs-ray"/>
    <path d="M${vxf(14 * k)} ${vxf(D.H - 15 * k)}h${D.mm10}M${vxf(14 * k)} ${vxf(D.H - 17.5 * k)}v${vxf(5 * k)}M${vxf(14 * k + D.mm10)} ${vxf(D.H - 17.5 * k)}v${vxf(5 * k)}" class="xs-mm"/><text x="${vxf(18 * k + D.mm10)}" y="${vxf(D.H - 12 * k)}" class="xs-t">10 mm</text>
    </svg>
    <div class="xr-row foot"><span class="en">the way of the light</span><span class="vi">đường đi của ánh sáng</span><b>55 mm · 1:2</b></div>`;
  host.appendChild(el); VX.el = el;
  for (const e of ['pointerdown', 'pointerup', 'click']) el.addEventListener(e, ev => ev.stopPropagation());
}
function camXrayRoom() {   // the width it takes at the screen's right (0: no room for it)
  if (!VX.el || innerWidth < 1180) return 0;   // (the sidebar is away while it shows: body.ck-out)
  const w = Math.round(Math.min(340, Math.max(260, innerWidth * 0.215), (innerHeight - 130) * XCAM.W / XCAM.H + 22));
  if (w !== VX.w) { VX.w = w; VX.el.style.width = w + 'px'; }
  return w + 26;
}
function stepCamXray(show) {   // while the camera is out: shown; nothing in it moves but the light's dashes (the stylesheet's)
  const el = VX.el; if (!el) return;
  const on = show && camXrayRoom() > 0; if (on !== VX.on) { VX.on = on; el.classList.toggle('is-on', on); }
}
VCAM.xray = { build: buildCamXray, step: stepCamXray, room: camXrayRoom, X: VX };

export { VX };
