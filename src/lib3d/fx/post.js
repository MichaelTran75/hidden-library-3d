import './dust.js';   // build order: the module before this one runs first
import * as THREE from 'three';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { renderer } from '../core/renderer.js';
import { R } from '../core/base.js';

/* ---------------------------------------------------------------- post: watercolour */
// (light: the parts of the room painted lightly, drawLight below)
const POST = { light: { scene: new THREE.Scene(), parts: [], mats: new Map(), k: { value: 1 }, close: { value: 0 } } };   // (k: all of each part's own share; close: 0 in the room's view, 1 in a close view of the shelves)
/* The watercolour picture is made in three passes:
   1. tone: the scene's colours through the tone curve, once per pixel (the paint pass reads each one ~50 times);
   2. paper: the noise fields that only depend on the screen position (wobble, pigment, fibres, blotches, paper grain),
      baked when the window size changes instead of being recomputed every frame;
   3. paint: Kuwahara smoothing, ink edges and the paper, reading the two above.
   The Kuwahara is the generalized one (Papari, Petkov & Campisi 2007): the four sectors' means blended by how even each
   is (weights 1/(1 + (k·variance)^4)) instead of the evenest taken outright, which left stair-steps on busy, high-contrast
   detail (leaves against the night). And where the depth is busy all round (foliage), the ink keeps off the single
   leaves and the strokes run into each other (wet-in-wet): a painter washes a mass of leaves as one soft shape ("lost"
   edges) and keeps the line for the big forms.  */
const QUAD_VS = 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy,0.0,1.0); }';
/* ---- ambient occlusion: the light a nook keeps out (G, 06/11/2026: "do research n study and improve blur, shadow, texture
   effect"). Most of the room is lit by the sky through the glass, a light from everywhere that casts no shadow map: books
   stood in their cells as if pasted on, the sofa's cushions and the floor's edges were as bright as an open floor. A book
   between two others, the back of a cell under its board, the floor under a seat see less of that sky.
   Ground-truth AO (J. Jimenez, X. Wu, A. Pesce, A. Jarabo, "Practical Realtime Strategies for Accurate Indirect
   Occlusion", Activision 2016; as in Intel's XeGTAO): for each pixel of the room's picture at half size, from its depth
   alone (its normal made from the depth round it, the nearer of each side's steps: J. Turánszki 2019), two slices of the
   view hemisphere turned by a 4 x 4 pattern; along each, both ways, the highest horizon in 6 steps within AO.radius
   metres (fading out from 40 % of it, so a far wall does not hide a near cup), and the cosine-weighted sky between the
   two horizons integrated exactly. A 4 x 4 blur that keeps to its own depth takes the pattern out; the tone pass and
   the sharp twins of the room's things (world/gardenbook.js) darken by it. Only in the room (its box, R): the garden is
   lit by the open sky, and its leaves took a speckle of it through the glass; nor past 12 m, nor on the sky. */
const AO = { k: { value: 1 }, power: { value: 1.6 }, radius: 0.36, maxPx: 48, rt: null, out: null, q: null, bq: null, tex: { value: null } };
function buildAO() {
  const o = { depthBuffer: false };
  AO.rt = new THREE.WebGLRenderTarget(4, 4, o); AO.out = new THREE.WebGLRenderTarget(4, 4, o); AO.tex.value = AO.out.texture;
  const depthGLSL = /* glsl */`uniform sampler2D tDepth; uniform mat4 uProjInv; uniform vec2 uFull;
    vec3 viewAt(vec2 uv){ vec4 p = uProjInv * vec4(uv * 2.0 - 1.0, texture2D(tDepth, uv).r * 2.0 - 1.0, 1.0); return p.xyz / p.w; }
    vec2 fullUv(vec2 fc){ return (floor(fc) * 2.0 + 0.5) / uFull; }`;   // (a half-size pixel's own pixel of the full-size depth)
  const common = () => ({ tDepth: { value: null }, uProjInv: { value: new THREE.Matrix4() }, uFull: { value: new THREE.Vector2(1, 1) } });
  const f = v => v.toFixed(3);
  AO.q = new FullScreenQuad(new THREE.ShaderMaterial({ uniforms: { ...common(), uProjScale: { value: 1 }, uRadius: { value: AO.radius }, uMaxPx: { value: AO.maxPx }, uPower: AO.power, uCamWorld: { value: new THREE.Matrix4() } },
    vertexShader: QUAD_VS, depthTest: false, depthWrite: false, fragmentShader: /* glsl */`
    precision highp float; ${depthGLSL} uniform float uProjScale, uRadius, uMaxPx, uPower; uniform mat4 uCamWorld; varying vec2 vUv;
    const float HALF_PI = 1.5707963; const vec3 ROOM0 = vec3(${f(R.xL)}, -0.5, ${f(R.zB)}), ROOM1 = vec3(${f(R.xW)}, ${f(R.H)}, ${f(R.zF)});
    void main(){
      vec2 tx = 1.0 / uFull, uv = fullUv(gl_FragCoord.xy); float d = texture2D(tDepth, uv).r;
      if (d >= 0.99999) { gl_FragColor = vec4(1.0); return; }   // (the sky)
      vec3 P = viewAt(uv); float z = -P.z;
      vec3 W = (uCamWorld * vec4(P, 1.0)).xyz, o = max(ROOM0 - W, W - ROOM1);
      float far = max(smoothstep(9.0, 14.0, z), smoothstep(0.05, 0.4, max(max(o.x, o.y), o.z)));   // (far off, or out of the room)
      if (far >= 1.0) { gl_FragColor = vec4(1.0); return; }
      vec3 pr = viewAt(uv + vec2(tx.x, 0.0)), pl = viewAt(uv - vec2(tx.x, 0.0)), pu = viewAt(uv + vec2(0.0, tx.y)), pd = viewAt(uv - vec2(0.0, tx.y));
      vec3 dx = abs(pr.z - P.z) < abs(P.z - pl.z) ? pr - P : P - pl, dy = abs(pu.z - P.z) < abs(P.z - pd.z) ? pu - P : P - pd;
      vec3 N = normalize(cross(dx, dy)), V = normalize(-P);
      float rPx = min(uRadius * uProjScale / z, uMaxPx);   // (the radius on the half-size picture, in its pixels)
      if (rPx < 1.0) { gl_FragColor = vec4(1.0); return; }
      // the 4 x 4 pattern (Bayer's: each 2 x 2 step of it spread over the next) turns the slices and moves the steps along
      vec2 c = mod(floor(gl_FragCoord.xy), 4.0), c1 = mod(c, 2.0), c2 = floor(c / 2.0);
      float n0 = (4.0 * mod(2.0 * c1.x + 3.0 * c1.y, 4.0) + mod(2.0 * c2.x + 3.0 * c2.y, 4.0) + 0.5) / 16.0, jit = fract(n0 * 5.0 + 0.1875);
      float fRange = 0.6 * uRadius, fMul = -1.0 / fRange, fAdd = (uRadius - fRange) / fRange + 1.0;
      vec2 tHalf = 2.0 * tx; float vis = 0.0;
      for (int s = 0; s < 2; s++) {
        float phi = (float(s) + n0) * HALF_PI; vec2 om = vec2(cos(phi), sin(phi));
        vec3 dir = vec3(om, 0.0), ortho = dir - dot(dir, V) * V, axis = normalize(cross(ortho, V)), pn = N - axis * dot(N, axis);
        float pnl = length(pn), cosN = clamp(dot(pn, V) / max(pnl, 1e-4), 0.0, 1.0), n = sign(dot(ortho, pn)) * acos(cosN);
        float lo0 = cos(n + HALF_PI), lo1 = cos(n - HALF_PI), h0 = lo0, h1 = lo1;
        for (int j = 0; j < 6; j++) {
          float t = (float(j) + jit) / 6.0; vec2 off = om * (t * t * rPx + 1.0) * tHalf;
          vec3 s0 = viewAt(uv + off) - P, s1 = viewAt(uv - off) - P; float l0 = length(s0), l1 = length(s1);
          h0 = max(h0, mix(lo0, dot(s0, V) / max(l0, 1e-5), clamp(l0 * fMul + fAdd, 0.0, 1.0)));
          h1 = max(h1, mix(lo1, dot(s1, V) / max(l1, 1e-5), clamp(l1 * fMul + fAdd, 0.0, 1.0)));
        }
        float a0 = -acos(clamp(h1, -1.0, 1.0)), a1 = acos(clamp(h0, -1.0, 1.0));
        a0 = n + clamp(a0 - n, -HALF_PI, HALF_PI); a1 = n + clamp(a1 - n, -HALF_PI, HALF_PI);
        float sn = sin(n);
        vis += mix(pnl, 1.0, 0.05) * ((cosN + 2.0 * a0 * sn - cos(2.0 * a0 - n)) + (cosN + 2.0 * a1 * sn - cos(2.0 * a1 - n))) * 0.25;
      }
      vis = pow(clamp(vis * 0.5, 0.03, 1.0), uPower);   // (a little deeper than the integral: XeGTAO's final power, 2.2 there)
      gl_FragColor = vec4(mix(vis, 1.0, far), 1.0, 1.0, 1.0);
    }` }));
  // the 4 x 4 blur: each of the pattern's turns once, weighted by how near its depth is to this pixel's (an edge is kept)
  AO.bq = new FullScreenQuad(new THREE.ShaderMaterial({ uniforms: { ...common(), tAOraw: { value: AO.rt.texture }, uHalf: { value: new THREE.Vector2(1, 1) } },
    vertexShader: QUAD_VS, depthTest: false, depthWrite: false, fragmentShader: /* glsl */`
    precision highp float; ${depthGLSL} uniform sampler2D tAOraw; uniform vec2 uHalf; varying vec2 vUv;
    float zAt(vec2 fc){ return -viewAt(fullUv(fc)).z; }
    void main(){
      float zc = zAt(gl_FragCoord.xy), s = 0.0, w = 0.0;
      for (int j = -2; j <= 1; j++) for (int i = -2; i <= 1; i++) {
        vec2 fc = gl_FragCoord.xy + vec2(float(i), float(j)); float zs = zAt(fc);
        float k = exp(-abs(zs - zc) / max(zc, 0.05) * 30.0); s += texture2D(tAOraw, fc / uHalf).r * k; w += k; }
      gl_FragColor = vec4(s / max(w, 1e-4), 1.0, 1.0, 1.0);
    }` }));
}
function drawAO(camera, depth) {   // (after the room is drawn: core/loop.js draw)
  if (!AO.k.value) return;
  const fw = POST.rt.width, fh = POST.rt.height, w = Math.max(1, Math.round(fw / 2)), h = Math.max(1, Math.round(fh / 2));
  if (AO.rt.width !== w || AO.rt.height !== h) { AO.rt.setSize(w, h); AO.out.setSize(w, h); }
  for (const q of [AO.q, AO.bq]) { const U = q.material.uniforms; U.tDepth.value = depth; U.uProjInv.value.copy(camera.projectionMatrixInverse); U.uFull.value.set(fw, fh); }
  AO.q.material.uniforms.uProjScale.value = camera.projectionMatrix.elements[5] * h / 2;   // (a metre at 1 m off, in pixels of the half-size picture)
  AO.q.material.uniforms.uCamWorld.value.copy(camera.matrixWorld);
  AO.bq.material.uniforms.uHalf.value.set(w, h);
  renderer.setRenderTarget(AO.rt); AO.q.render(renderer); renderer.setRenderTarget(AO.out); AO.bq.render(renderer);
}
/* ---- depth of field: the lens on what is looked at (G, 06/11/2026, as AO above). A book shown or opened in front of the
   camera, or the clock, the camera, the 747 or the ISS out of its shelf, stood against a room as sharp as itself: one flat
   picture. A lens set on a near thing blurs what lies behind it by a circle (1 - focus / depth) times its widest (the
   thin lens: Potmesil & Chakravarty 1981): the nearer the thing, the softer the room behind (a book read at half a metre
   more than one shown at 1.2 m). Made as D. Gustafsson's single-pass bokeh (2018), a scatter-as-gather (J. Jimenez,
   "Next generation post processing in Call of Duty: Advanced Warfare", SIGGRAPH 2014): for each pixel of the room's
   picture at half size, 32 taps on a golden-angle spiral out to the widest circle there is; a tap counts where its own
   circle reaches this pixel, and one behind this pixel no further than twice its circle (a sharper thing behind does not
   spread over a blurrier one). The AO goes in with each tap (its crisp nooks would stay on a blurred room). The tone pass
   takes the blurred picture where the circle is wider than about a pixel; the paint's ink lets go there; the shelves'
   titles fade, the fireflies open into soft discs, and the sharp layers over the picture blur as far as they are
   (world/pets.js crispPass). Off in the room's own views (G wants its sofa and shelves crisp there): core/loop.js stepFocus.
   focus: x the depth in focus (m), y the circle's radius far off (CSS px), z CSS px to the room's picture's px. */
const DOF = { far: 12, focus: { value: new THREE.Vector4(1, 0, 1, 0) }, nf: { value: new THREE.Vector2(0.05, 400) }, on: { value: 0 }, rt: null, q: null, tex: { value: null }, used: 0 };
const DOF_GLSL = 'uniform vec4 uFocus; float dofCoc(float z){ return uFocus.y * max(0.0, 1.0 - uFocus.x / max(z, 1e-3)); }';   // (the circle's radius at z metres, CSS px)
const dofPx = z => DOF.focus.value.y * Math.max(0, 1 - DOF.focus.value.x / Math.max(z, 1e-3));   // (the same in JS: pets.js crispPass)
function buildDof() {
  DOF.rt = new THREE.WebGLRenderTarget(4, 4, { depthBuffer: false, type: THREE.HalfFloatType }); DOF.tex.value = DOF.rt.texture;
  DOF.q = new FullScreenQuad(new THREE.ShaderMaterial({ uniforms: { tColor: { value: null }, tDepth: { value: null }, tAO: AO.tex, uAOk: AO.k, uHalf: { value: new THREE.Vector2(1, 1) }, uFocus: DOF.focus, uNF: DOF.nf },
    vertexShader: QUAD_VS, depthTest: false, depthWrite: false, fragmentShader: /* glsl */`
    precision highp float; uniform sampler2D tColor, tDepth, tAO; uniform float uAOk; uniform vec2 uHalf, uNF; varying vec2 vUv; ${DOF_GLSL}
    float zAt(vec2 uv){ return uNF.x * uNF.y / (uNF.y - texture2D(tDepth, uv).r * (uNF.y - uNF.x)); }
    vec3 tap(vec2 uv){ return texture2D(tColor, uv).rgb * mix(1.0, texture2D(tAO, uv).r, uAOk); }
    void main(){
      float px = uFocus.z * 0.5, zc = zAt(vUv), cc = dofCoc(zc) * px, R = uFocus.y * px;   // (circles in this picture's pixels)
      vec3 sum = tap(vUv); float n = 1.0, turn = 6.2831853 * fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
      for (int i = 0; i < 32; i++) {
        float r = R * sqrt((float(i) + 0.5) / 32.0), a = float(i) * 2.39996323 + turn; vec2 uv = vUv + vec2(cos(a), sin(a)) * r / uHalf;
        float zs = zAt(uv), cs = dofCoc(zs) * px;
        if (zs > zc) cs = min(cs, cc * 2.0);
        sum += mix(sum / n, tap(uv), smoothstep(r - 0.5, r + 0.5, cs)); n += 1.0;
      }
      gl_FragColor = vec4(sum / n, cc);   // (alpha: this pixel's circle, for the tone pass)
    }` }));
}
function drawDof(camera, depth) {   // (after the AO, while a focus is on: core/loop.js draw)
  if (!DOF.on.value) return;
  const w = Math.max(1, Math.round(POST.rt.width / 2)), h = Math.max(1, Math.round(POST.rt.height / 2));
  if (DOF.rt.width !== w || DOF.rt.height !== h) DOF.rt.setSize(w, h);
  const U = DOF.q.material.uniforms; U.tColor.value = POST.rt.texture; U.tDepth.value = depth; U.uHalf.value.set(w, h);
  renderer.setRenderTarget(DOF.rt); DOF.q.render(renderer); DOF.used = performance.now();
}
// the lens eased to a focus (zf metres) and a far circle (CSS px; 0: off); true while it changes. Its half-size picture
// let go 5 s after it was last used (~1.8 MB)
function setFocus(zf, far, dt, camera) {
  const F = DOF.focus.value, k = 1 - Math.exp(-dt * 10), y = F.y;
  if (zf > 0) F.x = F.y < 0.05 ? zf : F.x + (zf - F.x) * k;
  F.y += (far - F.y) * k; if (Math.abs(F.y - far) < 0.02) F.y = far;
  F.z = POST.rt.height / Math.max(1, innerHeight); DOF.nf.value.set(camera.near, camera.far);
  DOF.on.value = F.y > 0.02 ? 1 : 0;
  if (!DOF.on.value && DOF.rt.width > 4 && performance.now() - DOF.used > 5000) DOF.rt.setSize(4, 4);
  return F.y !== y;
}
function buildPost() {
  POST.rt = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, samples: 2, depthTexture: new THREE.DepthTexture(4, 4) });   // (2 samples: let go on 21/10/2026 for ~19 MB, back on 24/10/2026: with the books' watercolour mostly gone their edges crawled as the view moved, G "glitching ở tủ sách và sofa"; measured, crawl ÷2–4)
  const exposure = { value: 0.87 }, quad = (uniforms, fragmentShader) => new FullScreenQuad(new THREE.ShaderMaterial({ uniforms, vertexShader: QUAD_VS, fragmentShader, depthTest: false, depthWrite: false }));
  POST.tone = new THREE.WebGLRenderTarget(4, 4, { depthBuffer: false });
  // toned through FXAA (as POST.blit is): the room is drawn without multisampling (G, 21/10/2026: its 14 MB), and the paint's
  // ink had taken up the stairs left on thin slanted edges (the coffee table's legs)
  buildAO(); buildDof();
  POST.toneQuad = quad({ tColor: { value: null }, exposure, px: { value: new THREE.Vector2(1, 1) }, tAO: AO.tex, uAOk: AO.k, tDof: DOF.tex, uDof: DOF.on }, /* glsl */`
    precision highp float; uniform sampler2D tColor, tAO, tDof; uniform float exposure, uAOk, uDof; uniform vec2 px; varying vec2 vUv;
    vec3 aces(vec3 x){ const float a=2.51,b=0.03,c=2.43,d=0.59,e=0.14; return clamp((x*(a*x+b))/(x*(c*x+d)+e),0.0,1.0); }
    vec3 toS(vec3 c){ return mix(c*12.92, 1.055*pow(c,vec3(1.0/2.4))-0.055, step(0.0031308,c)); }
    vec3 tm(vec2 uv){ vec3 c = texture2D(tColor, uv).rgb*mix(1.0, texture2D(tAO, uv).r, uAOk);   // (the light the room's own nooks keep out: AO above)
      if (uDof > 0.5) { vec4 b = texture2D(tDof, uv); c = mix(c, b.rgb, smoothstep(0.25, 1.0, b.a)); }   // (out of focus: DOF above)
      return toS(aces(c*exposure*0.85)); }
    float L(vec3 c){ return dot(c, vec3(0.299, 0.587, 0.114)); }
    vec3 fxaa(){
      vec3 nw = tm(vUv + vec2(-1.0, -1.0) * px), ne = tm(vUv + vec2(1.0, -1.0) * px), sw = tm(vUv + vec2(-1.0, 1.0) * px), se = tm(vUv + vec2(1.0, 1.0) * px), m = tm(vUv);
      float lnw = L(nw), lne = L(ne), lsw = L(sw), lse = L(se), lm = L(m), lo = min(lm, min(min(lnw, lne), min(lsw, lse))), hi = max(lm, max(max(lnw, lne), max(lsw, lse)));
      if (hi - lo < max(0.03, hi * 0.12)) return m;
      vec2 dir = vec2(-((lnw + lne) - (lsw + lse)), (lnw + lsw) - (lne + lse));
      float red = max((lnw + lne + lsw + lse) * 0.03125, 1.0 / 128.0), rcp = 1.0 / (min(abs(dir.x), abs(dir.y)) + red);
      dir = clamp(dir * rcp, vec2(-8.0), vec2(8.0)) * px;
      vec3 a = 0.5 * (tm(vUv + dir * (1.0 / 3.0 - 0.5)) + tm(vUv + dir * (2.0 / 3.0 - 0.5)));
      vec3 b = a * 0.5 + 0.25 * (tm(vUv - dir * 0.5) + tm(vUv + dir * 0.5));
      float lb = L(b); return (lb < lo || lb > hi) ? a : b; }
    void main(){ gl_FragColor = vec4(fxaa(), 1.0 - clamp(texture2D(tColor, vUv).a, 0.0, 1.0)); }`);   // (alpha: the parts painted lightly, see drawLight)
  const nearest = { depthBuffer: false, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter };
  // the paper as two tiles laid over the screen, its noise made to repeat seamlessly (whole periods across a tile): the slow
  // noises over 1024 CSS px at half size, the grain over 256 px, both baked once (G, 22/10/2026: they had been baked at
  // the window's size, ~11 MB; now ~1.3)
  POST.n1 = new THREE.WebGLRenderTarget(512, 512, { ...nearest, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, wrapS: THREE.RepeatWrapping, wrapT: THREE.RepeatWrapping });
  POST.n2 = new THREE.WebGLRenderTarget(256, 256, { ...nearest, wrapS: THREE.RepeatWrapping, wrapT: THREE.RepeatWrapping });
  POST.paper = { value: new THREE.Vector4(1, 1, 1, 1) };   // (the tiles across the screen: x, y for the slow one, z, w for the grain)   // (n1: the paper's slow noises at half size, read smooth; n2: its grain, at full size)
  POST.bakeQuad = quad({ which: { value: 0 } }, /* glsl */`
    precision highp float; uniform float which; varying vec2 vUv;
    float h21(vec2 p){ p=fract(p*vec2(123.34,456.21)); p+=dot(p,p+45.32); return fract(p.x*p.y); }
    float vn(vec2 p, vec2 P){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f); vec2 j=mod(i+1.0,P); i=mod(i,P);
      return mix(mix(h21(i),h21(vec2(j.x,i.y)),f.x), mix(h21(vec2(i.x,j.y)),h21(j),f.x), f.y); }
    float fb(vec2 p, vec2 P){ float s=0.0,a=0.5; for(int k=0;k<5;k++){ s+=a*vn(p,P); p*=2.0; P*=2.0; a*=0.5; } return s; }   // (each octave a whole number of periods across the tile)
    void main(){
      if (which < 0.5) { vec2 px = vUv*1024.0;   // wobble x, y · ink · blotches, over a 1024 px tile (at half size)
        gl_FragColor = vec4(fb(px*(12.0/1024.0)+3.1, vec2(12.0)), fb(px*(12.0/1024.0)+7.7, vec2(12.0)), fb(px*(51.0/1024.0), vec2(51.0)), fb(px*(4.0/1024.0)+11.0, vec2(4.0))); }
      else { vec2 px = vUv*256.0;   // fibres · pigment · paper, over a 256 px tile
        gl_FragColor = vec4(fb(vec2(px.x*(230.0/256.0), px.y*(20.0/256.0)), vec2(230.0, 20.0)), fb(px*(90.0/256.0), vec2(90.0)), fb(px*(154.0/256.0), vec2(154.0))*0.6 + fb(px*(20.0/256.0), vec2(20.0))*0.4, 1.0); }
    }`);
  POST.quad = quad({ tTone: { value: POST.tone.texture }, tDepth: { value: null }, tN1: { value: POST.n1.texture }, tN2: { value: POST.n2.texture }, uPaper: POST.paper,
    res: { value: new THREE.Vector2(1, 1) }, near: { value: 0.05 }, far: { value: 400 }, exposure, lift: { value: 0.88 }, veil: { value: 0.06 },
    uInvVP: { value: new THREE.Matrix4() }, uRoom: { value: new THREE.Vector4(R.xL, R.xW, R.zB, R.zF) }, uFloorK: { value: 0.62 }, uLightK: POST.light.k,
    uInkMin: { value: [0, 1, 2, 3].map(() => new THREE.Vector3(1e9, 1e9, 1e9)) }, uInkMax: { value: [0, 1, 2, 3].map(() => new THREE.Vector3(-1e9, -1e9, -1e9)) }, uFocus: DOF.focus }, /* glsl */`
    precision highp float; ${DOF_GLSL}
    uniform sampler2D tTone, tDepth, tN1, tN2; uniform vec4 uPaper; uniform vec2 res; uniform float near, far, lift, veil, uFloorK, uLightK; uniform mat4 uInvVP; uniform vec4 uRoom; uniform vec3 uInkMin[4], uInkMax[4];
    varying vec2 vUv;
    float ld(float d){ float z=d*2.0-1.0; return 2.0*near*far/(far+near-z*(far-near)); }
    vec3 samp(vec2 uv){ return texture2D(tTone, uv).rgb; }
    void main(){
      vec2 tx = 1.0/res; float sc = res.y/1000.0;
      vec4 n1 = texture2D(tN1, vUv * uPaper.xy), n2 = texture2D(tN2, vUv * uPaper.zw);
      // the room's wooden floor is painted more lightly (G, 15/10/2026: "wooden floor less water color"): where this pixel
      // lies on it (its depth back to the room: y = 0 inside the walls), the painted strokes give way to the wood as drawn
      vec4 wp = uInvVP * vec4(vUv * 2.0 - 1.0, texture2D(tDepth, vUv).r * 2.0 - 1.0, 1.0); wp.xyz /= wp.w;
      float fl = uFloorK * (1.0 - smoothstep(0.003, 0.008, abs(wp.y))) * step(uRoom.x, wp.x) * step(wp.x, uRoom.y) * step(uRoom.z, wp.z) * step(wp.z, uRoom.w);
      // --- wobble (pigment pushed by paper)
      vec2 uvw = vUv + (n1.xy - 0.5)*tx*3.5*sc*(1.0 - 0.8*fl);
      // --- 4-sector Kuwahara (radius 3)
      vec3 m[4]; vec3 s2[4]; for(int k=0;k<4;k++){ m[k]=vec3(0.0); s2[k]=vec3(0.0); }
      for(int j=-3;j<=3;j++) for(int i=-3;i<=3;i++){
        vec3 c = samp(uvw + vec2(float(i),float(j))*tx*1.25*sc);
        if(i<=0&&j<=0){ m[0]+=c; s2[0]+=c*c; } if(i>=0&&j<=0){ m[1]+=c; s2[1]+=c*c; }
        if(i<=0&&j>=0){ m[2]+=c; s2[2]+=c*c; } if(i>=0&&j>=0){ m[3]+=c; s2[3]+=c*c; } }
      vec3 col = vec3(0.0); float wsum = 0.0;
      for(int k=0;k<4;k++){ vec3 mu = m[k]/16.0; vec3 v = abs(s2[k]/16.0 - mu*mu); float sv = v.r+v.g+v.b, w = 1.0/(1.0 + pow(sv*300.0, 4.0)); col += mu*w; wsum += w; }
      col /= max(wsum, 1e-6);
      // --- edges: depth + colour sobel
      float d00=ld(texture2D(tDepth,uvw+vec2(-1,-1)*tx*sc).r), d10=ld(texture2D(tDepth,uvw+vec2(0,-1)*tx*sc).r), d20=ld(texture2D(tDepth,uvw+vec2(1,-1)*tx*sc).r);
      float d01=ld(texture2D(tDepth,uvw+vec2(-1,0)*tx*sc).r), d11=ld(texture2D(tDepth,uvw).r), d21=ld(texture2D(tDepth,uvw+vec2(1,0)*tx*sc).r);
      float d02=ld(texture2D(tDepth,uvw+vec2(-1,1)*tx*sc).r), d12=ld(texture2D(tDepth,uvw+vec2(0,1)*tx*sc).r), d22=ld(texture2D(tDepth,uvw+vec2(1,1)*tx*sc).r);
      float gx = (d20+2.0*d21+d22)-(d00+2.0*d01+d02), gy = (d02+2.0*d12+d22)-(d00+2.0*d10+d20);
      float de = clamp(length(vec2(gx,gy))/max(d11,0.3)*6.0 - 0.25, 0.0, 1.0);
      vec3 a1 = samp(uvw+vec2(1.5,0)*tx*sc), a2 = samp(uvw-vec2(1.5,0)*tx*sc), a3 = samp(uvw+vec2(0,1.5)*tx*sc), a4 = samp(uvw-vec2(0,1.5)*tx*sc);
      float ce = length(a1-a2)+length(a3-a4);
      // how busy the depth is a little further round (foliage: many small steps in depth on every side)
      float busy = 0.0; for(int k=0;k<6;k++){ float a = float(k)*1.0472 + n1.x*2.0; float dk = ld(texture2D(tDepth, uvw + vec2(cos(a), sin(a))*tx*sc*4.0).r); busy += step(0.06*d11, abs(dk - d11)); }
      float leafy = smoothstep(3.5, 5.5, busy);   // (most of the way round: a mass of leaves, not the one edge of a form)
      busy = smoothstep(2.0, 5.0, busy);
      // wet-in-wet: in a mass of leaves the strokes run into each other, no cut-out edges (the four quarters' plain mean:
      // a soft 7×7 wash)
      col = mix(col, (m[0] + m[1] + m[2] + m[3]) / 64.0, leafy * 0.6);
      float sharp = 1.0 - smoothstep(1.0, 3.0, dofCoc(min(d11, min(min(d01, d21), min(d10, d12)))));   // (out of focus: no line; the nearest side's)
      float ink = max(de*0.85*(1.0 - 0.7*busy), smoothstep(0.25,0.65,ce)*0.38*(1.0 - 0.5*busy)) * (0.55 + 0.6*n1.z) * smoothstep(16.0, 8.5, d11) * (1.0 - 0.8*fl) * sharp;
      col = mix(col, samp(vUv), fl);   // (on the floor: the wood's grain and seams as drawn, under a lighter wash)
      // --- watercolour transparency: lift + slight desaturation, pigment granulation, edge darkening
      float lum = dot(col, vec3(0.299,0.587,0.114));
      col = mix(col, col * 1.25 + vec3(0.03, 0.04, 0.025), busy * (1.0 - smoothstep(0.05, 0.3, lum)) * 0.6);   // a mass of leaves in shade: a dark wash, not a hard black
      lum = dot(col, vec3(0.299,0.587,0.114));
      col = mix(vec3(lum), col, 1.08);
      col *= 1.0 + (n2.y - 0.5)*0.10*(1.0-lum) + (n2.x - 0.5)*0.03;
      col *= 1.0 - smoothstep(0.08,0.5,ce)*0.10;
      col = mix(col, col*col*1.06 + 0.02, 0.10 + 0.1*n1.w);           // wet-in-wet blotches
      col = mix(vec3(dot(col, vec3(0.299,0.587,0.114))), col, 0.9);
      col = 1.0 - (1.0 - col)*lift;                                    // paper shows through (less at night)
      col = mix(col, col*vec3(1.02,1.0,0.95), 0.6);                   // warm paper tint
      col = mix(col, vec3(0.24,0.17,0.11), ink*0.55);                  // brown ink line
      col *= 0.96 + n2.z*0.07;                                         // paper texture
      // a part painted lightly (drawLight's mask): most of it as drawn, under the paper's lift and warmth only
      float lite = texture2D(tTone, vUv).a * uLightK;
      if (lite > 0.001) { vec3 cl = 1.0 - (1.0 - samp(vUv))*lift; cl = mix(cl, cl*vec3(1.02,1.0,0.95), 0.6); col = mix(col, cl, lite); }
      // ink lines where G marked them (24/10/2026: the sofa's right arm, its chaise's foot; POST.inkBox): inside those boxes only,
      // a crisp dark line where the depth steps, at the pixel (not wobbled); passed on in alpha for POST.blit's unpainted parts
      float inkL = 0.0; bool inBox = false;
      for (int k = 0; k < 4; k++) if (all(greaterThanEqual(wp.xyz, uInkMin[k])) && all(lessThanEqual(wp.xyz, uInkMax[k]))) inBox = true;
      if (inBox) {
        float e00=ld(texture2D(tDepth,vUv+vec2(-1,-1)*tx).r), e10=ld(texture2D(tDepth,vUv+vec2(0,-1)*tx).r), e20=ld(texture2D(tDepth,vUv+vec2(1,-1)*tx).r);
        float e01=ld(texture2D(tDepth,vUv+vec2(-1,0)*tx).r), e11=ld(texture2D(tDepth,vUv).r), e21=ld(texture2D(tDepth,vUv+vec2(1,0)*tx).r);
        float e02=ld(texture2D(tDepth,vUv+vec2(-1,1)*tx).r), e12=ld(texture2D(tDepth,vUv+vec2(0,1)*tx).r), e22=ld(texture2D(tDepth,vUv+vec2(1,1)*tx).r);
        float hx = (e20+2.0*e21+e22)-(e00+2.0*e01+e02), hy = (e02+2.0*e12+e22)-(e00+2.0*e10+e20);
        inkL = smoothstep(0.03, 0.12, length(vec2(hx,hy))/max(e11,0.3)) * 0.9 * sharp;   // (a softer ramp than the watercolour's: its steps showed: G, 24/10/2026, "mờ nhẹ viền răng cưa")
        col = mix(col, col*vec3(0.3,0.26,0.22), inkL*0.85);
      }
      gl_FragColor = vec4(col*(1.0-veil), 1.0 - inkL);
    }`);
  POST.mat = POST.quad.material;
  POST.out = new THREE.WebGLRenderTarget(4, 4, { depthBuffer: false });   // the finished picture, at CSS resolution
  // laid on the canvas through FXAA (T. Lottes): the picture is painted at CSS pixels and shown on a screen twice as
  // fine, and its hard steps (dark leaves against the night) were showing as stairs
  // a part with no watercolour at all (drawLight's mask full: the sofa, its pillows, the pouf, the rug) is taken from the room's
  // picture itself, not from the painted one drawn smaller still, under the same lift, warmth and veil (G, 24/10/2026: "Cho phần
  // không màu nước lấy thẳng từ hình 3D, bỏ qua bước thu nhỏ ở lớp màu nước")
  POST.blit = quad({ t: { value: POST.out.texture }, px: { value: new THREE.Vector2(1, 1) }, tPrev: { value: POST.out.texture }, uFade: { value: 1 },
    tTone: { value: POST.tone.texture }, lift: POST.mat.uniforms.lift, veil: POST.mat.uniforms.veil, uLightK: POST.light.k }, `uniform sampler2D t, tPrev, tTone; uniform vec2 px; uniform float uFade, lift, veil, uLightK; varying vec2 vUv;
    float L(vec3 c){ return dot(c, vec3(0.299, 0.587, 0.114)); }
    vec3 fxaa(){
      vec3 nw = texture2D(t, vUv + vec2(-1.0, -1.0) * px).rgb, ne = texture2D(t, vUv + vec2(1.0, -1.0) * px).rgb, sw = texture2D(t, vUv + vec2(-1.0, 1.0) * px).rgb, se = texture2D(t, vUv + vec2(1.0, 1.0) * px).rgb, m = texture2D(t, vUv).rgb;
      float lnw = L(nw), lne = L(ne), lsw = L(sw), lse = L(se), lm = L(m), lo = min(lm, min(min(lnw, lne), min(lsw, lse))), hi = max(lm, max(max(lnw, lne), max(lsw, lse)));
      if (hi - lo < max(0.03, hi * 0.12)) return m;
      vec2 dir = vec2(-((lnw + lne) - (lsw + lse)), (lnw + lsw) - (lne + lse));
      float red = max((lnw + lne + lsw + lse) * 0.03125, 1.0 / 128.0), rcp = 1.0 / (min(abs(dir.x), abs(dir.y)) + red);
      dir = clamp(dir * rcp, vec2(-8.0), vec2(8.0)) * px;
      vec3 a = 0.5 * (texture2D(t, vUv + dir * (1.0 / 3.0 - 0.5)).rgb + texture2D(t, vUv + dir * (2.0 / 3.0 - 0.5)).rgb);
      vec3 b = a * 0.5 + 0.25 * (texture2D(t, vUv - dir * 0.5).rgb + texture2D(t, vUv + dir * 0.5).rgb);
      float lb = L(b); return (lb < lo || lb > hi) ? a : b; }
    void main(){ vec3 c = fxaa();
      vec4 tn = texture2D(tTone, vUv); float raw = smoothstep(0.985, 0.999, tn.a * uLightK);
      if (raw > 0.0) { vec3 cl = 1.0 - (1.0 - tn.rgb) * lift; cl = mix(cl, cl * vec3(1.02, 1.0, 0.95), 0.6); float ia = 0.0; for (int q = 0; q < 4; q++) { vec2 o = vec2(q < 2 ? -0.75 : 0.75, mod(float(q), 2.0) < 0.5 ? -0.75 : 0.75) * px; ia += texture2D(t, vUv + o).a; }
      ia = 0.5 * texture2D(t, vUv).a + 0.125 * ia;   // (its ink a little soft: five taps)
      cl = mix(cl, cl * vec3(0.3, 0.26, 0.22), (1.0 - ia) * 0.85); c = mix(c, cl * (1.0 - veil), raw); }   // (its ink line: POST.quad's alpha)
      gl_FragColor = vec4(uFade < 0.999 ? mix(texture2D(tPrev, vUv).rgb, c, uFade) : c, 1.0); }`);   // (uFade: from the last picture shown: fadePicture)
}
/* ---- parts of the room painted lightly: stand-ins for their meshes, in a scene of their own.
   - Asked for: the floor lamp behind the sofa "75% less" watercolour (G, 16/10/2026); 17/10: the table lamp by the
     sofa too, then the potted plant by the glass 50 % less and every book 10 % less.
   - They are drawn into the picture's target after the room, through the room's own depth, so what stands in front of
     them still hides them.
   - They write nothing but the target's alpha: 1 − k where they show (k: how much less paint), 1 everywhere else (set
     first: the leaves' alpha-to-coverage leaves less than 1 in it).
   - The tone pass hands 1 − alpha on, and the paint pass lets that share of the paint go, the part as drawn under the
     paper's lift and warmth.
   - The parts stay in the room: lit, shadowed, in its depth. An instanced mesh's stand-in shares its instances. */
// kClose: its share in a close view of the shelves instead (G, 18/10/2026: "render close up Research và Books làm cho kệ sách
// và sách realistic"): the shelves and their books, seen near, painted far more lightly, so their wood and cloth show
/* a new part of the room faded in: the picture as it is shown now kept (two targets in turn, so a fade begun while another
   runs starts from what is on the screen), and each picture after it laid over it more and more for dur seconds */
const FADE = { k: 1, dur: 0.5, a: null, b: null, q: null };
function fadePicture(dur = 0.5) {
  const w = POST.out.width, h = POST.out.height, U = POST.blit.material.uniforms;
  if (!FADE.a) { const o = { depthBuffer: false }; FADE.a = new THREE.WebGLRenderTarget(w, h, o); FADE.b = new THREE.WebGLRenderTarget(w, h, o);
    FADE.q = new FullScreenQuad(new THREE.ShaderMaterial({ uniforms: { tA: { value: null }, tB: { value: null }, k: { value: 1 } }, vertexShader: QUAD_VS, depthTest: false, depthWrite: false,
      fragmentShader: 'uniform sampler2D tA, tB; uniform float k; varying vec2 vUv; void main(){ gl_FragColor = vec4(mix(texture2D(tA, vUv).rgb, texture2D(tB, vUv).rgb, k), 1.0); }' })); }
  if (FADE.b.width !== w || FADE.b.height !== h) { FADE.a.setSize(w, h); FADE.b.setSize(w, h); FADE.k = 1; }
  const Q = FADE.q.material.uniforms; Q.tA.value = FADE.k < 1 ? FADE.a.texture : POST.out.texture; Q.tB.value = POST.out.texture; Q.k.value = FADE.k < 1 ? U.uFade.value : 1;
  renderer.setRenderTarget(FADE.b); FADE.q.render(renderer); renderer.setRenderTarget(null);
  [FADE.a, FADE.b] = [FADE.b, FADE.a]; U.tPrev.value = FADE.a.texture; FADE.k = 0; FADE.dur = dur; U.uFade.value = 0;
}
function endFades() {   // (the opening over: its two pictures let go, ~11 MB)
  if (!FADE.a) return true; if (FADE.k < 1) return false; FADE.a.dispose(); FADE.b.dispose(); FADE.a = FADE.b = null; const U = POST.blit.material.uniforms; U.tPrev.value = POST.out.texture; U.uFade.value = 1; return true;
}
function stepFade(dt) {   // (true while it fades: every frame drawn)
  if (FADE.k >= 1) return false;
  FADE.k = Math.min(1, FADE.k + dt / FADE.dur); const k = FADE.k; POST.blit.material.uniforms.uFade.value = k * k * (3 - 2 * k); return true;
}
function paintLightly(obj, k = 0.75, kClose = null) {
  const L = POST.light, key = kClose === null ? k : `${k}|${kClose}`; let mat = L.mats.get(key);
  if (!mat) L.mats.set(key, mat = new THREE.ShaderMaterial({ uniforms: { uClose: L.close }, vertexShader: 'void main(){ vec4 p = vec4(position, 1.0);\n#ifdef USE_INSTANCING\n  p = instanceMatrix * p;\n#endif\n  gl_Position = projectionMatrix * modelViewMatrix * p; }',
    fragmentShader: kClose === null ? `void main(){ gl_FragColor = vec4(0.0, 0.0, 0.0, ${(1 - k).toFixed(3)}); }` : `uniform float uClose; void main(){ gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0 - mix(${k.toFixed(3)}, ${kClose.toFixed(3)}, uClose)); }`, side: THREE.DoubleSide, depthTest: true, depthWrite: false,
    polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -4,   // (its own surface, drawn twice, always passes the depth test)
    blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.ZeroFactor, blendDst: THREE.OneFactor, blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.ZeroFactor }));
  if (!L.reset) L.reset = new FullScreenQuad(new THREE.ShaderMaterial({ vertexShader: QUAD_VS, fragmentShader: 'void main(){ gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0); }',
    depthTest: false, depthWrite: false, blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.ZeroFactor, blendDst: THREE.OneFactor, blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.ZeroFactor }));
  obj.traverse(o => {
    if (!o.isMesh) return; const c = o.isInstancedMesh ? new THREE.InstancedMesh(o.geometry, mat, o.count) : new THREE.Mesh(o.geometry, mat);
    if (o.isInstancedMesh) c.instanceMatrix = o.instanceMatrix;   // (the same instances, as they move)
    c.matrixAutoUpdate = false; c.frustumCulled = false; L.scene.add(c); L.parts.push([c, o]);
  });
}
function drawLight(camera) {   // (into the picture's target, right after the room)
  const L = POST.light; if (!L.parts.length) return;
  for (const [c, o] of L.parts) { c.matrix.copy(o.matrixWorld); c.matrixWorldNeedsUpdate = true; if (o.isInstancedMesh) c.count = o.count; let v = o.visible; for (let p = o.parent; v && p; p = p.parent) v = p.visible; c.visible = v; }
  const ac = renderer.autoClear; renderer.autoClear = false; L.reset.render(renderer); renderer.render(L.scene, camera); renderer.autoClear = ac;
}
function bakePaper(w, h, ow = w, oh = h) {   // the paint pass's paper for this window (w x h CSS px; the picture ow x oh): the tiles baked once, laid over it
  POST.paper.value.set(w / 1024, h / 1024, w / 256, h / 256); POST.blit.material.uniforms.px.value.set(1 / ow, 1 / oh);
  if (POST.baked) return; POST.baked = true; const U = POST.bakeQuad.material.uniforms;
  for (const [rt, which] of [[POST.n1, 0], [POST.n2, 1]]) { U.which.value = which; renderer.setRenderTarget(rt); POST.bakeQuad.render(renderer); }
  renderer.setRenderTarget(null);
}

/* ---- the paint pass's own steps for a layer drawn sharp over the picture (the deck, the chicken), so some of it can
   be watercolour: its colours wobbled by the paper, Kuwahara-smoothed (radius 2, the strokes as wide as the picture's),
   brown ink on its colour and cover edges, pigment granulation, wet-in-wet blotches and the paper's grain, all from the
   same baked paper noise at the same screen place as the picture's. The user defines vec4 shadeAt(vec2 uv) after it: the
   layer as shown (display colour, cover) at a point of its target. uStep: the stroke step, in the target's pixels.
   From watercolour rendering research (Montesdeoca et al., "Art-directed watercolor rendered animation", 2016, and
   "Edge- and substrate-based effects for watercolor stylization", NPAR 2017): pigment gathers at the edges of a wash
   (edge darkening, from a difference of the wash and its blur), settles in the paper's valleys the more the darker it
   is (granulation), and a dry brush leaves the paper's tops bare along a wash's edge. And from painters: "lost and found"
   edges, the busiest detail kept crisper and the plain washes let go (paintAt's detail: how busy the place is). */
const PAINT_GLSL = `uniform sampler2D tN1, tN2; uniform vec4 uPaper; uniform vec2 uCanvas, uTexel; uniform float uStep, uBlur; vec4 shadeAt(vec2 uv);
  vec4 blurAt(vec2 uv) {   // out of focus (DOF): a disc's mean, uBlur the target's pixels across its radius (pets.js crispPass)
    vec4 s = vec4(0.0); for (int i = 0; i < 24; i++) { float r = uBlur * sqrt((float(i) + 0.5) / 24.0), a = float(i) * 2.39996323; vec4 c = shadeAt(uv + vec2(cos(a), sin(a)) * r * uTexel); s += vec4(c.rgb * c.a, c.a); }
    s /= 24.0; return s.a > 0.002 ? vec4(s.rgb / s.a, s.a) : vec4(0.0);
  }
  vec4 paintAt(vec2 uv, out float detail) {
    vec2 sp = gl_FragCoord.xy / uCanvas; vec4 n1 = texture2D(tN1, sp * uPaper.xy), n2 = texture2D(tN2, sp * uPaper.zw);
    vec2 d = uTexel * uStep, uvw = uv + (n1.xy - 0.5) * d * 2.8;
    vec4 m0 = vec4(0.0), m1 = vec4(0.0), m2 = vec4(0.0), m3 = vec4(0.0), blr = vec4(0.0), mid = vec4(0.0); vec3 s0 = vec3(0.0), s1 = vec3(0.0), s2 = vec3(0.0), s3 = vec3(0.0);
    for (int j = -2; j <= 2; j++) for (int i = -2; i <= 2; i++) {
      vec4 c = shadeAt(uvw + vec2(float(i), float(j)) * d); vec3 pc = c.rgb * c.a; vec4 q = vec4(pc, c.a); vec3 qq = pc * pc;
      blr += q; if (i == 0 && j == 0) mid = q;
      if (i <= 0 && j <= 0) { m0 += q; s0 += qq; } if (i >= 0 && j <= 0) { m1 += q; s1 += qq; }
      if (i <= 0 && j >= 0) { m2 += q; s2 += qq; } if (i >= 0 && j >= 0) { m3 += q; s3 += qq; } }
    vec4 best = m0 / 9.0; vec3 v = abs(s0 / 9.0 - best.rgb * best.rgb); float bv = v.r + v.g + v.b, sv;
    vec4 mu = m1 / 9.0; v = abs(s1 / 9.0 - mu.rgb * mu.rgb); sv = v.r + v.g + v.b; if (sv < bv) { bv = sv; best = mu; }
    mu = m2 / 9.0; v = abs(s2 / 9.0 - mu.rgb * mu.rgb); sv = v.r + v.g + v.b; if (sv < bv) { bv = sv; best = mu; }
    mu = m3 / 9.0; v = abs(s3 / 9.0 - mu.rgb * mu.rgb); sv = v.r + v.g + v.b; if (sv < bv) { bv = sv; best = mu; }
    float a = best.a; vec3 col = a > 0.002 ? best.rgb / a : vec3(0.0);
    detail = bv;   // the calmest quarter's spread: high only where the place is busy all round (a label, small parts)
    blr /= 25.0; float dog = length(mid.rgb - blr.rgb) + abs(mid.a - blr.a) * 0.5;   // the wash against its blur
    vec4 a1 = shadeAt(uvw + vec2(1.5, 0.0) * d), a2 = shadeAt(uvw - vec2(1.5, 0.0) * d), a3 = shadeAt(uvw + vec2(0.0, 1.5) * d), a4 = shadeAt(uvw - vec2(0.0, 1.5) * d);
    float ce = length(a1.rgb * a1.a - a2.rgb * a2.a) + length(a3.rgb * a3.a - a4.rgb * a4.a), ae = abs(a1.a - a2.a) + abs(a3.a - a4.a);
    float ink = max(smoothstep(0.25, 0.65, ce) * 0.38, smoothstep(0.35, 1.0, ae) * 0.6) * (0.55 + 0.6 * n1.z);
    float lum = dot(col, vec3(0.299, 0.587, 0.114));
    col = mix(vec3(lum), col, 1.08);
    col *= 1.0 + (n2.y - 0.5) * 0.10 * (1.0 - lum) + (n2.x - 0.5) * 0.03;
    col *= 1.0 - smoothstep(0.08, 0.5, ce) * 0.10;
    col *= 1.0 - 0.26 * smoothstep(0.03, 0.22, dog);                                  // pigment gathered at the wash's edge
    col *= 1.0 - 0.14 * (1.0 - n2.z) * (1.0 - lum);                                   // granulation: in the paper's valleys, the darker the more
    col = mix(col, col * col * 1.06 + 0.02, 0.10 + 0.1 * n1.w);   // wet-in-wet blotches
    col = mix(col, vec3(0.24, 0.17, 0.11), ink * 0.55);            // brown ink line
    col *= 0.96 + n2.z * 0.07;                                     // paper texture
    a *= mix(1.0, smoothstep(0.32, 0.62, n2.z + a * 0.45), smoothstep(0.15, 0.6, ae) * (1.0 - smoothstep(0.85, 1.0, a)));   // a dry brush's broken edge
    return vec4(col, max(a, ink * 0.5 * step(0.05, max(max(a1.a, a2.a), max(a3.a, a4.a)))));   // (the ink may run just past the edge)
  }`;
// the uniforms PAINT_GLSL reads, and their values for a target of w x h device pixels on a canvas of W x H
function paintUniforms() { return { tN1: { value: POST.n1.texture }, tN2: { value: POST.n2.texture }, uPaper: POST.paper, uCanvas: { value: new THREE.Vector2(1, 1) }, uTexel: { value: new THREE.Vector2(1, 1) }, uStep: { value: 1 }, uBlur: { value: 0 } }; }
function setPaint(u, rt, W, H, k = 1) {   // (k: the target's pixels per device pixel, when it is drawn smaller)
  u.uCanvas.value.set(W, H); u.uTexel.value.set(1 / rt.width, 1 / rt.height);
  u.uStep.value = 1.875 * H / 1000 * k;   // the picture's strokes (radius 3 at 1.25 px a step, per 1000 px of height), as radius 2 here, in device pixels
}

// a box (world, min and max) the ink lines are drawn in (up to four: POST.quad)
function inkBox(i, min, max) { const U = POST.mat.uniforms; U.uInkMin.value[i].copy(min); U.uInkMax.value[i].copy(max); }
POST.ao = AO; POST.dof = DOF;   // (for tests: __lib3d.POST.ao, .dof)
export { AO, DOF, DOF_GLSL, dofPx, inkBox, bakePaper, buildPost, drawAO, drawDof, drawLight, endFades, fadePicture, PAINT_GLSL, paintLightly, paintUniforms, POST, QUAD_VS, setFocus, setPaint, stepFade };
