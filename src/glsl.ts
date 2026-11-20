// The GPU side: two draws of one four-channel target build the high pass
// layer, and the inline blends it over the pixel.
//
//   0  the stage's input blurred along x
//   1  that blurred along y, subtracted from the input: the high pass layer
//      less its grey of 0.5, signed, as the luminance alone in monochrome
//
// The Gaussian's standard deviation is the radius in the photo's pixels,
// scaled to the render's texels, so a preview below the photo's size blurs
// the same part of the scene an export does. Edges repeat outward.
//
// Every draw ends by rounding what it stores to the nearest half float itself:
// a store rounds to nearest on SwiftShader but toward zero through ANGLE's D3D11
// back end, which would bias the blur low and brighten the whole frame a little.

import { LUMA_WEIGHTS, MAX_REACH, MODE, type Params } from "./model";

/** Taps a draw reads, at most: the kernel's window and the input pixel. */
export const MAX_TAPS_PER_DRAW = 2 * MAX_REACH + 2;

const HALF_GLSL = `
float hpUlp(float v) {
  highp int e = ((floatBitsToInt(v) >> 23) & 255) - 127;
  return intBitsToFloat((max(e - 10, -24) + 127) << 23);
}
float hpHalfRound(float v) {
  float x = clamp(v, -65504.0, 65504.0);
  float q = hpUlp(x);
  return roundEven(x / q) * q;
}
vec4 hpHalf4(vec4 v) { return vec4(hpHalfRound(v.x), hpHalfRound(v.y), hpHalfRound(v.z), hpHalfRound(v.w)); }
`;

export const PASS_HELPERS = `
${HALF_GLSL}
float hpSigma(float r, vec2 texel, vec2 sourceSize) {
  float source = max(sourceSize.x, sourceSize.y);
  float render = max(1.0 / texel.x, 1.0 / texel.y);
  return source > 0.0 ? r * render / source : r;
}
int hpReach(float sigma) { return clamp(int(ceil(3.0 * sigma + 0.5)), 1, ${MAX_REACH}); }
float hpErf(float x) {
  float a = abs(x);
  float t = 1.0 / (1.0 + 0.3275911 * a);
  float poly = t * (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429))));
  return sign(x) * (1.0 - poly * exp(-a * a));
}
float hpTap(int n, float scale) {
  return 0.5 * (hpErf((float(n) + 0.5) * scale) - hpErf((float(n) - 0.5) * scale));
}
`;

/** Each tap weighs the Gaussian's mass over its pixel (model.ts gaussianWeights). */
const KERNEL = `
ivec2 q = ivec2(gl_FragCoord.xy);
float sigma = hpSigma(radius, uTexel, uSourceSize);
int reach = hpReach(sigma);
float scale = 1.0 / (max(sigma, 0.001) * 1.4142135624);
float weight = hpErf(0.5 * scale);`;

const BLUR_X = `${KERNEL}
vec3 total = weight * fetchInput(q);
for (int n = 1; n <= ${MAX_REACH}; n++) {
  if (n > reach) break;
  float w = hpTap(n, scale);
  total += w * (fetchInput(q - ivec2(n, 0)) + fetchInput(q + ivec2(n, 0)));
  weight += 2.0 * w;
}
c = hpHalf4(vec4(total / weight, 1.0));
`;

const BLUR_Y = `${KERNEL}
int last = int(floor(1.0 / uTexel.y + 0.5)) - 1;
vec3 total = weight * fetchPrev4(q).rgb;
for (int n = 1; n <= ${MAX_REACH}; n++) {
  if (n > reach) break;
  float w = hpTap(n, scale);
  total += w * (fetchPrev4(ivec2(q.x, max(q.y - n, 0))).rgb + fetchPrev4(ivec2(q.x, min(q.y + n, last))).rgb);
  weight += 2.0 * w;
}
vec3 layer = fetchInput(q) - total / weight;
if (monochrome) layer = vec3(dot(layer, vec3(${LUMA_WEIGHTS.join(", ")})));
c = hpHalf4(vec4(layer, 1.0));
`;

export interface PassSource {
  name: string;
  glsl: string;
  /** The edit keys the shader reads. */
  keys: (keyof Params)[];
}

export const PASSES: PassSource[] = [
  { name: "blur x", glsl: BLUR_X, keys: ["radius"] },
  { name: "blur y, high pass", glsl: BLUR_Y, keys: ["radius", "monochrome"] },
];

/** The W3C blend formulas, one channel at a time; Linear Light is the fallthrough. */
export const INLINE_HELPERS = `
float hpHard(float cb, float cs) {
  return cs <= 0.5 ? cb * 2.0 * cs : cb + (2.0 * cs - 1.0) - cb * (2.0 * cs - 1.0);
}
float hpSoft(float cb, float cs) {
  float d = cb <= 0.25 ? ((16.0 * cb - 12.0) * cb + 4.0) * cb : sqrt(max(cb, 0.0));
  return cs <= 0.5 ? cb - (1.0 - 2.0 * cs) * cb * (1.0 - cb) : cb + (2.0 * cs - 1.0) * (d - cb);
}
float hpBlendOne(int m, float cb, float cs) {
  if (m == ${MODE.overlay}) return hpHard(cs, cb);
  if (m == ${MODE.softLight}) return hpSoft(cb, cs);
  if (m == ${MODE.hardLight}) return hpHard(cb, cs);
  return cb + 2.0 * cs - 1.0;
}
vec3 hpBlend(int m, vec3 cb, vec3 cs) {
  return vec3(hpBlendOne(m, cb.x, cs.x), hpBlendOne(m, cb.y, cs.y), hpBlendOne(m, cb.z, cs.z));
}
`;

/** The layer blended over the pixel, clipped as a document clips it (never pushing headroom further out), at the layer's opacity. */
export const INLINE_GLSL = `
if (draws > 0) {
  vec3 blended = hpBlend(mode, c, 0.5 + stageResult);
  blended = clamp(blended, min(c, vec3(0.0)), max(c, vec3(1.0)));
  c = mix(c, blended, amount / 100.0);
}
`;
