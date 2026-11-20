import { describe, expect, it } from "vitest";
import {
  BLEND_MODES,
  DEFAULT_PARAMS,
  MAX_REACH,
  MODE,
  blendChannel,
  composite,
  drawCount,
  erf,
  gaussianReach,
  gaussianWeights,
  highPass,
  sigmaTexels,
  type Params,
} from "../src/model";

const params = (p: Partial<Params>): Params => ({ ...DEFAULT_PARAMS, ...p });

describe("the blend modes", () => {
  it("offers Linear Light first, then the other modes used for high pass sharpening", () => {
    expect(BLEND_MODES.map((m) => m.label)).toEqual(["Linear Light", "Overlay", "Soft Light", "Hard Light"]);
    expect(MODE.linearLight).toBe(0);
  });

  it("leaves the base as it is under the high pass layer's neutral grey, in every mode", () => {
    for (const { id } of BLEND_MODES) {
      for (const base of [0, 0.1, 0.25, 0.5, 0.73, 1]) expect(blendChannel(MODE[id], base, 0.5)).toBeCloseTo(base, 12);
    }
  });

  it("adds twice the layer's distance from grey in Linear Light", () => {
    expect(blendChannel(MODE.linearLight, 0.4, 0.53)).toBeCloseTo(0.46, 12);
    expect(blendChannel(MODE.linearLight, 0.4, 0.45)).toBeCloseTo(0.3, 12);
  });

  it("matches the W3C compositing formulas for the other modes", () => {
    expect(blendChannel(MODE.overlay, 0.25, 0.75)).toBeCloseTo(0.375, 12);
    expect(blendChannel(MODE.overlay, 0.75, 0.75)).toBeCloseTo(0.875, 12);
    expect(blendChannel(MODE.hardLight, 0.25, 0.75)).toBeCloseTo(0.625, 12);
    expect(blendChannel(MODE.hardLight, 0.25, 0.25)).toBeCloseTo(0.125, 12);
    expect(blendChannel(MODE.softLight, 0.25, 0.75)).toBeCloseTo(0.375, 12);
    expect(blendChannel(MODE.softLight, 0.5, 0.25)).toBeCloseTo(0.375, 12);
    expect(blendChannel(MODE.softLight, 0.64, 0.75)).toBeCloseTo(0.64 + 0.5 * (0.8 - 0.64), 12);
  });
});

describe("compositing the layer", () => {
  it("mixes the blend in by the amount, as a layer's opacity does", () => {
    const base = [0.4, 0.4, 0.4] as const;
    expect(composite(base, [0.05, 0, -0.05], params({ amount: 100 }))).toEqual([
      expect.closeTo(0.5, 12),
      expect.closeTo(0.4, 12),
      expect.closeTo(0.3, 12),
    ]);
    expect(composite(base, [0.05, 0, -0.05], params({ amount: 50 }))[0]).toBeCloseTo(0.45, 12);
  });

  it("clips the blend to the frame's 0 to 1 before the opacity, as an RGB document does", () => {
    const out = composite([0.98, 0.02, 0.5], [0.05, -0.05, 0], params({ amount: 50 }));
    expect(out[0]).toBeCloseTo(0.99, 12);
    expect(out[1]).toBeCloseTo(0.01, 12);
  });

  it("never pushes a value beyond 1 further out, and never pulls one below 0 further down", () => {
    expect(composite([1.3, -0.1, 0.5], [0.1, -0.1, 0], params({ amount: 100 }))).toEqual([1.3, -0.1, 0.5]);
    expect(composite([1.3, 0.5, 0.5], [-0.1, 0, 0], params({ amount: 100 }))[0]).toBeCloseTo(1.1, 12);
  });

  it("draws while the amount is above 0", () => {
    expect(drawCount(params({ amount: 0 }))).toBe(0);
    expect(drawCount(params({ amount: 1 }))).toBe(1);
  });
});

describe("the Gaussian", () => {
  it("reads the radius as the blur's standard deviation in the photo's pixels, scaled to the render", () => {
    expect(sigmaTexels(0.5, 6000, 6000)).toBeCloseTo(0.5, 12);
    expect(sigmaTexels(0.5, 4096, 6000)).toBeCloseTo((0.5 * 4096) / 6000, 12);
    expect(sigmaTexels(0.5, 960, 0)).toBeCloseTo(0.5, 12);
  });

  it("reaches three standard deviations past the centre pixel, at most MAX_REACH taps either side", () => {
    expect(gaussianReach(0.5)).toBe(2);
    expect(gaussianReach(0.05)).toBe(1);
    expect(gaussianReach(5)).toBe(MAX_REACH);
    expect(gaussianReach(40)).toBe(MAX_REACH);
  });

  it("weighs each tap by the Gaussian's mass over its pixel, centre first, summing to 1", () => {
    const w = gaussianWeights(0.5);
    expect(w).toHaveLength(3);
    expect(w[0] + 2 * (w[1] + w[2])).toBeCloseTo(1, 12);
    // Within ±0.5 px of the centre at sigma 0.5 lies ±1 sigma; the next pixel holds 1 to 3 sigma.
    expect(w[0]).toBeCloseTo(0.6827, 3);
    expect(w[1]).toBeCloseTo(0.1573, 3);
  });

  it("still blurs into the neighbours below half a pixel", () => {
    expect(gaussianWeights(0.3)[1]).toBeCloseTo(0.0478, 3);
    expect(gaussianWeights(0.1)[1]).toBeLessThan(1e-5);
  });

  it("approximates erf to 1.5e-7", () => {
    expect(erf(0)).toBe(0);
    expect(erf(0.5)).toBeCloseTo(0.5204998778, 6);
    expect(erf(-1)).toBeCloseTo(-0.8427007929, 6);
    expect(erf(3)).toBeCloseTo(0.9999779095, 6);
  });
});

describe("the high pass layer", () => {
  const W = 8;
  const H = 6;
  const image = (f: (x: number, y: number) => [number, number, number]) => {
    const out = new Float32Array(W * H * 3);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) out.set(f(x, y), 3 * (y * W + x));
    return out;
  };

  it("is 0 over a flat area, so it leaves it as it is", () => {
    const hp = highPass(image(() => [0.3, 0.5, 0.7]), W, H, 0.5, false);
    for (const v of hp) expect(v).toBeCloseTo(0, 6);
  });

  it("is positive on the bright side of an edge and negative on the dark side, by the same amount", () => {
    const hp = highPass(image((x) => (x < 4 ? [0.2, 0.2, 0.2] : [0.6, 0.6, 0.6])), W, H, 0.5, false);
    const at = (x: number) => hp[3 * (2 * W + x)];
    expect(at(4)).toBeGreaterThan(0.02);
    expect(at(3)).toBeCloseTo(-at(4), 6);
    expect(at(1)).toBeCloseTo(0, 3);
  });

  it("repeats the frame's edge pixels outward, as a clamped read does", () => {
    const hp = highPass(image((x) => [x / W, 0, 0]), W, H, 1, false);
    expect(hp[3 * (2 * W + 0)]).toBeLessThan(0);
    expect(hp[3 * (2 * W + W - 1)]).toBeGreaterThan(0);
  });

  it("gives every channel the luminance of the colour layer in monochrome", () => {
    const f = (x: number): [number, number, number] => (x < 4 ? [0.2, 0.5, 0.1] : [0.6, 0.3, 0.4]);
    const colour = highPass(image(f), W, H, 0.5, false);
    const mono = highPass(image(f), W, H, 0.5, true);
    const k = 3 * (2 * W + 4);
    const luma = 0.2126 * colour[k] + 0.7152 * colour[k + 1] + 0.0722 * colour[k + 2];
    expect([mono[k], mono[k + 1], mono[k + 2]]).toEqual([expect.closeTo(luma, 6), expect.closeTo(luma, 6), expect.closeTo(luma, 6)]);
  });
});
