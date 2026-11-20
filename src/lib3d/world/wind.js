import './assets.js';   // build order: the module before this one runs first
import { reduceMotion } from '../core/base.js';

const WIND = { t: { value: 0 }, amp: reduceMotion ? 0 : 0.1 };   // tree sway at 10 % of the original amplitude
function windify(mat, leaf, opt = {}) {
  mat.onBeforeCompile = sh => {
    sh.uniforms.uWind = WIND.t;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nuniform float uWind;\nvarying float vTint;').replace('#include <begin_vertex>', `#include <begin_vertex>
      #ifdef USE_INSTANCING
        vec3 ip = instanceMatrix[3].xyz;
      #else
        vec3 ip = vec3(0.0);
      #endif
      vTint = fract(sin(dot(ip.xz, vec2(12.9898, 78.233))) * 43758.5453);
      float hh = max(0.0, transformed.y);
      float k = ${leaf ? '1.0' : '0.25'} * ${(opt.windScale ?? 1).toFixed(3)} * ${WIND.amp.toFixed(3)};
      float ph = ip.x * 0.37 + ip.z * 0.21;
      transformed.x += k * hh * hh * 0.00045 * (sin(uWind * 0.9 + ph) + 0.4 * sin(uWind * 2.3 + ph * 3.0 + transformed.y * 0.02));
      transformed.z += k * hh * hh * 0.00035 * sin(uWind * 1.1 + ph + 1.7);
      ${leaf ? 'transformed += ' + (0.002 * WIND.amp).toFixed(5) + ' * hh * vec3(sin(uWind*3.0 + position.x*0.9 + position.z*1.3), 0.0, cos(uWind*2.6 + position.y*0.7));' : ''}`);
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vTint;');
    if (leaf) sh.fragmentShader = sh.fragmentShader.replace('#include <map_fragment>', `#include <map_fragment>
      float lum = pow(clamp(dot(diffuseColor.rgb, vec3(0.3, 0.59, 0.11)) * ${(opt.lumGain ?? 1.6).toFixed(3)}, 0.0, 1.0), 0.6);
      vec3 g1 = vec3(0.035, 0.07, 0.02), g2 = vec3(0.16, 0.30, 0.07), g3 = vec3(0.50, 0.62, 0.25);
      vec3 gc = lum < 0.5 ? mix(g1, g2, lum * 2.0) : mix(g2, g3, (lum - 0.5) * 2.0);
      gc *= mix(vec3(0.85, 0.95, 0.8), vec3(1.15, 1.08, 0.95), vTint);
      diffuseColor.rgb = gc;`);
  };
}

export { WIND, windify };
