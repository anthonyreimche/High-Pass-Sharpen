// The numbers of a High Pass sharpen, shared by the shaders (glsl.ts) and the
// panel, and the CPU model the tests hold the shaders to.
//
// A photo editor's recipe: duplicate the layer, run High Pass on the copy
// (the image minus a Gaussian blur of itself, around a neutral grey of 0.5),
// set the copy's blend mode to Linear Light and its opacity to taste. Linear
// Light adds twice the layer's distance from grey, so the result is the photo
// plus twice its own fine detail, clipped to the document's 0 to 1. The blend
// modes are the W3C Compositing and Blending Level 1 formulas, which match
// the photo editors', on display-encoded values as an RGB document holds them.

export const BLEND_MODES = [
  { id: "linearLight", label: "Linear Light" },
  { id: "overlay", label: "Overlay" },
  { id: "softLight", label: "Soft Light" },
  { id: "hardLight", label: "Hard Light" },
] as const;

export type BlendModeId = (typeof BLEND_MODES)[number]["id"];

/** Each mode's uniform value: its index in BLEND_MODES. */
export const MODE = Object.fromEntries(BLEND_MODES.map((m, i) => [m.id, i])) as Record<BlendModeId, number>;

export interface Params {
  /** The layer's opacity, 0 to 100. */
  amount: number;
  /** The Gaussian's standard deviation in the full-size photo's pixels. */
  radius: number;
  /** An index into BLEND_MODES. */
  mode: number;
  /** The layer desaturated to its luminance, so the sharpening adds no colour. */
  monochrome: boolean;
}

export type NumericKey = Exclude<keyof Params, "monochrome">;

/** Idle until the amount moves; then a half-pixel Linear Light layer, as the technique is usually set up. */
export const DEFAULT_PARAMS: Params = { amount: 0, radius: 0.5, mode: MODE.linearLight, monochrome: false };

export const RANGES: Record<NumericKey, { min: number; max: number; step: number }> = {
  amount: { min: 0, max: 100, step: 1 },
  radius: { min: 0.1, max: 5, step: 0.05 },
  mode: { min: 0, max: BLEND_MODES.length - 1, step: 1 },
};

/** The most taps either side of the centre: three standard deviations of the largest radius, past the centre pixel's half. */
export const MAX_REACH = 16;

/** Rec. 709 luma, on the encoded values as a photo editor's desaturate weighs them. */
export const LUMA_WEIGHTS = [0.2126, 0.7152, 0.0722] as const;

export const drawCount = (p: Params): number => (p.amount > 0 ? 1 : 0);

export type Rgb = readonly [number, number, number];

const hardLight = (cb: number, cs: number): number => (cs <= 0.5 ? cb * 2 * cs : cb + (2 * cs - 1) - cb * (2 * cs - 1));

const softLightD = (cb: number): number => (cb <= 0.25 ? ((16 * cb - 12) * cb + 4) * cb : Math.sqrt(Math.max(cb, 0)));

const softLight = (cb: number, cs: number): number =>
  cs <= 0.5 ? cb - (1 - 2 * cs) * cb * (1 - cb) : cb + (2 * cs - 1) * (softLightD(cb) - cb);

/** One channel of the layer `cs` blended over the base `cb`. */
export function blendChannel(mode: number, cb: number, cs: number): number {
  switch (mode) {
    case MODE.overlay:
      return hardLight(cs, cb);
    case MODE.softLight:
      return softLight(cb, cs);
    case MODE.hardLight:
      return hardLight(cb, cs);
    default:
      return cb + 2 * cs - 1;
  }
}

/** The pixel with its high pass layer blended over it. A document clips the blend to 0 to 1; a value
 *  already outside that range is kept from moving further out, so the stage never clips headroom. */
export function composite(base: Rgb, highPass: Rgb, p: Params): Rgb {
  const t = p.amount / 100;
  const one = (cb: number, hp: number): number => {
    const blended = Math.min(Math.max(blendChannel(p.mode, cb, 0.5 + hp), Math.min(cb, 0)), Math.max(cb, 1));
    return cb + (blended - cb) * t;
  };
  return [one(base[0], highPass[0]), one(base[1], highPass[1]), one(base[2], highPass[2])];
}

/** The radius in the render's texels: the passes run at the render size, which can be smaller than the photo's. */
export function sigmaTexels(radius: number, renderLongEdge: number, sourceLongEdge: number): number {
  return sourceLongEdge > 0 ? (radius * renderLongEdge) / sourceLongEdge : radius;
}

/** The taps either side reach three standard deviations past the centre pixel's own half. */
export const gaussianReach = (sigma: number): number => Math.min(Math.max(Math.ceil(3 * sigma + 0.5), 1), MAX_REACH);

/** Abramowitz and Stegun 7.1.26, within 1.5e-7; the shader runs the same formula. */
export function erf(x: number): number {
  const a = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * a);
  const poly = t * (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429))));
  return Math.sign(x) * (1 - poly * Math.exp(-a * a));
}

/** The blur's taps from the centre out, normalized so the centre and both sides sum to 1. Each tap is
 *  the Gaussian's mass over that pixel's area, not its value at the pixel's centre: a point-sampled
 *  Gaussian puts almost nothing on the neighbours below a radius of about 0.4, where this still blurs. */
export function gaussianWeights(sigma: number): number[] {
  const scale = 1 / (Math.max(sigma, 1e-3) * Math.SQRT2);
  const raw = Array.from({ length: gaussianReach(sigma) + 1 }, (_, n) =>
    n === 0 ? erf(0.5 * scale) : 0.5 * (erf((n + 0.5) * scale) - erf((n - 0.5) * scale)),
  );
  const total = raw[0] + 2 * raw.slice(1).reduce((a, b) => a + b, 0);
  return raw.map((w) => w / total);
}

/** The high pass layer less its grey: the image minus its separable Gaussian blur, edges repeated
 *  outward. `store` rounds what each draw stores, as the GPU's half-float targets do. */
export function highPass(
  image: Float32Array,
  width: number,
  height: number,
  sigma: number,
  monochrome: boolean,
  store: (v: number) => number = (v) => v,
): Float32Array {
  const w = gaussianWeights(sigma);
  const at = (x: number, y: number, c: number, from: Float32Array) =>
    from[3 * (Math.min(Math.max(y, 0), height - 1) * width + Math.min(Math.max(x, 0), width - 1)) + c];
  const blurX = new Float32Array(image.length);
  const out = new Float32Array(image.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      for (let c = 0; c < 3; c++) {
        let total = w[0] * at(x, y, c, image);
        for (let n = 1; n < w.length; n++) total += w[n] * (at(x - n, y, c, image) + at(x + n, y, c, image));
        blurX[3 * (y * width + x) + c] = store(total);
      }
    }
  }
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const hp = [0, 1, 2].map((c) => {
        let total = w[0] * at(x, y, c, blurX);
        for (let n = 1; n < w.length; n++) total += w[n] * (at(x, y - n, c, blurX) + at(x, y + n, c, blurX));
        return at(x, y, c, image) - total;
      });
      const luma = LUMA_WEIGHTS[0] * hp[0] + LUMA_WEIGHTS[1] * hp[1] + LUMA_WEIGHTS[2] * hp[2];
      for (let c = 0; c < 3; c++) out[3 * (y * width + x) + c] = store(monochrome ? luma : hp[c]);
    }
  }
  return out;
}
