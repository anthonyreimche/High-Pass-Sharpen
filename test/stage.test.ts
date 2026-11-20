// The stage contract the host relies on, and what a draw may cost. Unit tests
// can't run GLSL; the GPU spec (test/gpu) renders it.

import { describe, expect, it } from "vitest";
import { INLINE_GLSL, MAX_TAPS_PER_DRAW, PASSES } from "../src/glsl";
import { MAX_REACH } from "../src/model";
import { EDIT_KEYS } from "../src/params";
import { highPassStage } from "../src/stage";

const stage = highPassStage();
const passes = (stage.passes ?? []).map((p, i) => ({ name: PASSES[i].name, src: `${p.helpers ?? ""}\n${p.glsl}` }));

describe("the stage", () => {
  it("reads the edited image display-encoded, as an RGB document holds it", () => {
    expect(stage).toMatchObject({
      phase: "display-adjust",
      reads: "current",
      space: { encoding: "perceptual", primaries: "rec709" },
    });
  });

  it("runs after the other sharpening tools", () => {
    expect(stage.priority).toBe(150);
  });

  it("declares every edit key inline, for presets and paste, and the passes' keys there too", () => {
    expect(new Set(stage.uniforms.map((u) => u.key))).toEqual(new Set([...EDIT_KEYS, "draws"]));
    const inline = new Map(stage.uniforms.map((u) => [u.key, u]));
    for (const pass of stage.passes ?? []) {
      for (const u of pass.uniforms ?? []) expect(inline.get(u.key)).toEqual(u);
    }
  });

  it("gives each pass only the keys its shader reads", () => {
    stage.passes?.forEach((pass, i) => {
      expect(pass.uniforms?.map((u) => u.key)).toEqual(PASSES[i].keys);
      for (const key of EDIT_KEYS) {
        const reads = new RegExp(`\\b${key}\\b`).test(PASSES[i].glsl);
        expect(PASSES[i].keys.includes(key), `${PASSES[i].name} ${key}`).toBe(reads);
      }
    });
  });

  it("blurs along x, then along y and takes the difference, once each while active", () => {
    expect(PASSES.map((p) => p.name)).toEqual(["blur x", "blur y, high pass"]);
    for (const pass of stage.passes ?? []) {
      expect(pass).toMatchObject({ channels: 4, iterations: { key: "draws", max: 1 } });
    }
  });

  it("is dormant while nothing is drawn, and changes nothing until the passes have drawn", () => {
    expect(stage.dormantWhen).toEqual({ draws: 0 });
    expect(INLINE_GLSL.trim().startsWith("if (draws > 0)")).toBe(true);
  });

  it("scales the radius from the photo's pixels to the render's", () => {
    for (const { src } of passes) expect(src).toContain("uSourceSize");
  });

  it("can run inside masks", () => {
    expect(stage.mask).toEqual({ maskable: true });
  });
});

describe("a draw's cost and what ANGLE's D3D11 back end needs", () => {
  const reads = (glsl: string) => (glsl.match(/\b(?:fetchPrev4|fetchInput)\(/g) ?? []).length;

  it("reads at most the kernel's window and the pixel, each tap pair inside one bounded loop", () => {
    expect(MAX_TAPS_PER_DRAW).toBe(2 * MAX_REACH + 2);
    expect(MAX_TAPS_PER_DRAW).toBeLessThanOrEqual(40);
    for (const p of PASSES) expect(p.glsl).toContain(`for (int n = 1; n <= ${MAX_REACH}; n++)`);
    expect(reads(PASSES[0].glsl)).toBe(3);
    expect(reads(PASSES[1].glsl)).toBe(4);
  });

  it("reads texels exactly, never through a filtered read", () => {
    for (const { name, src } of passes) {
      expect([name, src.match(/\b(?:readPrev4|readPrev|texture|textureLod|readSource)\s*\(/g) ?? []]).toEqual([name, []]);
    }
  });

  it("rounds every store to the nearest half itself: D3D11 truncates toward 0 where SwiftShader rounds", () => {
    for (const { name, src } of passes) expect([name, /\bc = hpHalf4\([^;]*\);\s*$/.test(src)]).toEqual([name, true]);
  });

  it("leaves the passes no arrays", () => {
    for (const { name, src } of passes) expect([name, src.match(/\w+\s*\[\s*\d*\s*\]/g) ?? []]).toEqual([name, []]);
  });

  it("names no uniform key as a local variable or function", () => {
    const text = [...passes.map((p) => p.src), stage.helpers ?? "", INLINE_GLSL].join("\n");
    for (const key of [...EDIT_KEYS, "draws"]) {
      expect(text).not.toMatch(new RegExp(`\\b(int|float|vec3|vec4|bool)\\s+${key}\\b`));
    }
  });
});
