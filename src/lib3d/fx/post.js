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
function buildPost() {
  POST.rt = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, samples: 2, depthTexture: new THREE.DepthTexture(4, 4) });
  const exposure = { value: 0.87 }, quad = (uniforms, fragmentShader) => new FullScreenQuad(new THREE.ShaderMaterial({ uniforms, vertexShader: QUAD_VS, fragmentShader, depthTest: false, depthWrite: false }));
  POST.tone = new THREE.WebGLRenderTarget(4, 4, { depthBuffer: false });
  POST.toneQuad = quad({ tColor: { value: null }, exposure }, /* glsl */`
    precision highp float; uniform sampler2D tColor; uniform float exposure; varying vec2 vUv;
    vec3 aces(vec3 x){ const float a=2.51,b=0.03,c=2.43,d=0.59,e=0.14; return clamp((x*(a*x+b))/(x*(c*x+d)+e),0.0,1.0); }
    vec3 toS(vec3 c){ return mix(c*12.92, 1.055*pow(c,vec3(1.0/2.4))-0.055, step(0.0031308,c)); }
    void main(){ vec4 c = texture2D(tColor, vUv); gl_FragColor = vec4(toS(aces(c.rgb*exposure*0.85)), 1.0 - clamp(c.a, 0.0, 1.0)); }`);   // (alpha: the parts painted lightly, see drawLight)
  const nearest = { depthBuffer: false, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter };
  POST.n1 = new THREE.WebGLRenderTarget(4, 4, nearest); POST.n2 = new THREE.WebGLRenderTarget(4, 4, nearest);
  POST.bakeQuad = quad({ res: { value: new THREE.Vector2() }, which: { value: 0 } }, /* glsl */`
    precision highp float; uniform vec2 res; uniform float which; varying vec2 vUv;
    float h21(vec2 p){ p=fract(p*vec2(123.34,456.21)); p+=dot(p,p+45.32); return fract(p.x*p.y); }
    float vn(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f); return mix(mix(h21(i),h21(i+vec2(1,0)),f.x), mix(h21(i+vec2(0,1)),h21(i+vec2(1,1)),f.x), f.y); }
    float fb(vec2 p){ float s=0.0,a=0.5; for(int i=0;i<5;i++){ s+=a*vn(p); p*=2.03; a*=0.5; } return s; }
    void main(){ vec2 px = vUv*res;
      if (which < 0.5) gl_FragColor = vec4(fb(px*0.012+3.1), fb(px*0.012+7.7), fb(px*0.05), fb(px*0.35));                  // wobble x, y · ink · pigment
      else gl_FragColor = vec4(fb(vec2(px.x*0.9, px.y*0.08)), fb(px*0.004+11.0), fb(px*0.6)*0.6 + fb(px*0.08)*0.4, 1.0);   // fibres · blotches · paper
    }`);
  POST.quad = quad({ tTone: { value: POST.tone.texture }, tDepth: { value: null }, tN1: { value: POST.n1.texture }, tN2: { value: POST.n2.texture },
    res: { value: new THREE.Vector2(1, 1) }, near: { value: 0.05 }, far: { value: 400 }, exposure, lift: { value: 0.88 }, veil: { value: 0.06 },
    uInvVP: { value: new THREE.Matrix4() }, uRoom: { value: new THREE.Vector4(R.xL, R.xW, R.zB, R.zF) }, uFloorK: { value: 0.62 }, uLightK: POST.light.k }, /* glsl */`
    precision highp float;
    uniform sampler2D tTone, tDepth, tN1, tN2; uniform vec2 res; uniform float near, far, lift, veil, uFloorK, uLightK; uniform mat4 uInvVP; uniform vec4 uRoom;
    varying vec2 vUv;
    float ld(float d){ float z=d*2.0-1.0; return 2.0*near*far/(far+near-z*(far-near)); }
    vec3 samp(vec2 uv){ return texture2D(tTone, uv).rgb; }
    void main(){
      vec2 tx = 1.0/res; float sc = res.y/1000.0;
      vec4 n1 = texture2D(tN1, vUv), n2 = texture2D(tN2, vUv);
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
      float ink = max(de*0.85*(1.0 - 0.7*busy), smoothstep(0.25,0.65,ce)*0.38*(1.0 - 0.5*busy)) * (0.55 + 0.6*n1.z) * smoothstep(16.0, 8.5, d11) * (1.0 - 0.8*fl);
      col = mix(col, samp(vUv), fl);   // (on the floor: the wood's grain and seams as drawn, under a lighter wash)
      // --- watercolour transparency: lift + slight desaturation, pigment granulation, edge darkening
      float lum = dot(col, vec3(0.299,0.587,0.114));
      col = mix(col, col * 1.25 + vec3(0.03, 0.04, 0.025), busy * (1.0 - smoothstep(0.05, 0.3, lum)) * 0.6);   // a mass of leaves in shade: a dark wash, not a hard black
      lum = dot(col, vec3(0.299,0.587,0.114));
      col = mix(vec3(lum), col, 1.08);
      col *= 1.0 + (n1.w - 0.5)*0.10*(1.0-lum) + (n2.x - 0.5)*0.03;
      col *= 1.0 - smoothstep(0.08,0.5,ce)*0.10;
      col = mix(col, col*col*1.06 + 0.02, 0.10 + 0.1*n2.y);           // wet-in-wet blotches
      col = mix(vec3(dot(col, vec3(0.299,0.587,0.114))), col, 0.9);
      col = 1.0 - (1.0 - col)*lift;                                    // paper shows through (less at night)
      col = mix(col, col*vec3(1.02,1.0,0.95), 0.6);                   // warm paper tint
      col = mix(col, vec3(0.24,0.17,0.11), ink*0.55);                  // brown ink line
      col *= 0.96 + n2.z*0.07;                                         // paper texture
      // a part painted lightly (drawLight's mask): most of it as drawn, under the paper's lift and warmth only
      float lite = texture2D(tTone, vUv).a * uLightK;
      if (lite > 0.001) { vec3 cl = 1.0 - (1.0 - samp(vUv))*lift; cl = mix(cl, cl*vec3(1.02,1.0,0.95), 0.6); col = mix(col, cl, lite); }
      gl_FragColor = vec4(col*(1.0-veil),1.0);
    }`);
  POST.mat = POST.quad.material;
  POST.out = new THREE.WebGLRenderTarget(4, 4, { depthBuffer: false });   // the finished picture, at CSS resolution
  // laid on the canvas through FXAA (T. Lottes): the picture is painted at CSS pixels and shown on a screen twice as
  // fine, and its hard steps (dark leaves against the night) were showing as stairs
  POST.blit = quad({ t: { value: POST.out.texture }, px: { value: new THREE.Vector2(1, 1) } }, `uniform sampler2D t; uniform vec2 px; varying vec2 vUv;
    float L(vec3 c){ return dot(c, vec3(0.299, 0.587, 0.114)); }
    void main(){
      vec3 nw = texture2D(t, vUv + vec2(-1.0, -1.0) * px).rgb, ne = texture2D(t, vUv + vec2(1.0, -1.0) * px).rgb, sw = texture2D(t, vUv + vec2(-1.0, 1.0) * px).rgb, se = texture2D(t, vUv + vec2(1.0, 1.0) * px).rgb, m = texture2D(t, vUv).rgb;
      float lnw = L(nw), lne = L(ne), lsw = L(sw), lse = L(se), lm = L(m), lo = min(lm, min(min(lnw, lne), min(lsw, lse))), hi = max(lm, max(max(lnw, lne), max(lsw, lse)));
      if (hi - lo < max(0.03, hi * 0.12)) { gl_FragColor = vec4(m, 1.0); return; }
      vec2 dir = vec2(-((lnw + lne) - (lsw + lse)), (lnw + lsw) - (lne + lse));
      float red = max((lnw + lne + lsw + lse) * 0.03125, 1.0 / 128.0), rcp = 1.0 / (min(abs(dir.x), abs(dir.y)) + red);
      dir = clamp(dir * rcp, vec2(-8.0), vec2(8.0)) * px;
      vec3 a = 0.5 * (texture2D(t, vUv + dir * (1.0 / 3.0 - 0.5)).rgb + texture2D(t, vUv + dir * (2.0 / 3.0 - 0.5)).rgb);
      vec3 b = a * 0.5 + 0.25 * (texture2D(t, vUv - dir * 0.5).rgb + texture2D(t, vUv + dir * 0.5).rgb);
      float lb = L(b); gl_FragColor = vec4((lb < lo || lb > hi) ? a : b, 1.0); }`);
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
function bakePaper(w, h) {   // the screen-fixed noise of the paint pass, for this window size
  POST.n1.setSize(w, h); POST.n2.setSize(w, h); const U = POST.bakeQuad.material.uniforms; U.res.value.set(w, h); POST.blit.material.uniforms.px.value.set(1 / w, 1 / h);
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
const PAINT_GLSL = `uniform sampler2D tN1, tN2; uniform vec2 uCanvas, uTexel; uniform float uStep; vec4 shadeAt(vec2 uv);
  vec4 paintAt(vec2 uv, out float detail) {
    vec2 sp = gl_FragCoord.xy / uCanvas; vec4 n1 = texture2D(tN1, sp), n2 = texture2D(tN2, sp);
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
    col *= 1.0 + (n1.w - 0.5) * 0.10 * (1.0 - lum) + (n2.x - 0.5) * 0.03;
    col *= 1.0 - smoothstep(0.08, 0.5, ce) * 0.10;
    col *= 1.0 - 0.26 * smoothstep(0.03, 0.22, dog);                                  // pigment gathered at the wash's edge
    col *= 1.0 - 0.14 * (1.0 - n2.z) * (1.0 - lum);                                   // granulation: in the paper's valleys, the darker the more
    col = mix(col, col * col * 1.06 + 0.02, 0.10 + 0.1 * n2.y);   // wet-in-wet blotches
    col = mix(col, vec3(0.24, 0.17, 0.11), ink * 0.55);            // brown ink line
    col *= 0.96 + n2.z * 0.07;                                     // paper texture
    a *= mix(1.0, smoothstep(0.32, 0.62, n2.z + a * 0.45), smoothstep(0.15, 0.6, ae) * (1.0 - smoothstep(0.85, 1.0, a)));   // a dry brush's broken edge
    return vec4(col, max(a, ink * 0.5 * step(0.05, max(max(a1.a, a2.a), max(a3.a, a4.a)))));   // (the ink may run just past the edge)
  }`;
// the uniforms PAINT_GLSL reads, and their values for a target of w x h device pixels on a canvas of W x H
function paintUniforms() { return { tN1: { value: POST.n1.texture }, tN2: { value: POST.n2.texture }, uCanvas: { value: new THREE.Vector2(1, 1) }, uTexel: { value: new THREE.Vector2(1, 1) }, uStep: { value: 1 } }; }
function setPaint(u, rt, W, H) {
  u.uCanvas.value.set(W, H); u.uTexel.value.set(1 / rt.width, 1 / rt.height);
  u.uStep.value = 1.875 * H / 1000;   // the picture's strokes (radius 3 at 1.25 px a step, per 1000 px of height), as radius 2 here, in device pixels
}

export { PAINT_GLSL, POST, QUAD_VS, bakePaper, buildPost, drawLight, paintLightly, paintUniforms, setPaint };
