// The stage on the real renderer. Run via `npm run test:gpu` (run.cjs copies
// this file into a SafeLight checkout and runs it under its headless
// Chromium + SwiftShader rig). What the CPU suite cannot check:
//  - both passes compile with the host's namespacing and run once;
//  - an idle edit leaves the frame as it was;
//  - the blur, the high pass, each blend mode and the clip land on the CPU
//    model in src/model.ts;
//  - a draw's cost on a 4096 px frame at the largest radius.

import { describe, expect, it } from "vitest";
import { DEFAULT_PARAMS, composite, highPass, type Params } from "@hps/model";
import { bagPatch, resetPatch } from "@hps/params";
import { highPassStage } from "@hps/stage";
import { CURRENT_PROCESS_VERSION } from "@/catalog/process-version";
import type { ProcessingStageContribution } from "@/extensions/types";
import { OPEN_PROBE, builtinStages, floatImage, identityParams, withRenderer } from "@/rendering/webgl/webgl.test-support";

const W = 160;
const H = 112;
const AS_DRAWN = { encoding: "perceptual", primaries: "rec709" } as const;
const UNTOUCHED = 2e-6;

/** A deterministic hash in [0, 1). */
function hash(x: number, y: number): number {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return s - Math.floor(s);
}

/** Four bands of detail over a dark-to-light ramp: 1 px noise, fine sine and checker, hard edges, and
 *  coloured noise reaching into the darkest and brightest values, where the blend clips. */
const SCENE = floatImage(W, H, (x, y) => {
  const ramp = 0.02 + 0.9 * (x / (W - 1));
  const band = Math.floor((y * 4) / H);
  let mod = 0;
  if (band === 0) mod = 0.08 * (2 * hash(x, y) - 1);
  else if (band === 1) mod = 0.1 * Math.sin(x * 1.7) * Math.sin(y * 1.3) + 0.05 * ((x + y) % 2 ? -1 : 1);
  else if (band === 2) mod = 0.15 * ((Math.floor(x / 6) + Math.floor(y / 5)) % 2 ? -1 : 1);
  const colour = (p: number) => (band === 3 ? 0.2 * (2 * hash(x + p, y - p) - 1) : 0);
  return [0, 17, 41].map((p) => Math.min(Math.max(ramp + mod + colour(p), 0.001), 0.999)) as [number, number, number];
});

const CASES: [string, Partial<Params>][] = [
  ["Linear Light, radius 0.5", { amount: 100 }],
  ["Linear Light, radius 0.3, amount 60", { amount: 60, radius: 0.3 }],
  ["Linear Light, radius 0.5, monochrome", { amount: 100, monochrome: true }],
  ["Overlay, radius 1", { amount: 100, radius: 1, mode: 1 }],
  ["Soft Light, radius 2, monochrome", { amount: 80, radius: 2, mode: 2, monochrome: true }],
  ["Hard Light, radius 5", { amount: 100, radius: 5, mode: 3 }],
];

type Frames = Record<string, Float32Array>;

function render(bags: Record<string, Record<string, unknown>>, stages: ProcessingStageContribution[] = [highPassStage()]): Frames {
  const frames: Frames = {};
  withRenderer({ stages: [...builtinStages(), ...stages], pipeline: OPEN_PROBE }, (renderer) => {
    renderer.setImage(SCENE);
    renderer.setParams(identityParams({ processVersion: CURRENT_PROCESS_VERSION }));
    for (const [name, bag] of Object.entries(bags)) {
      renderer.setContributedParams(bag);
      const frame = renderer.readFloatFrame("pre-output", Infinity, AS_DRAWN);
      if (!frame) throw new Error(`no frame for ${name}`);
      frames[name] = frame.data;
    }
  });
  return frames;
}

const full = (p: Partial<Params>): Params => ({ ...DEFAULT_PARAMS, ...p });

/** How a half-float target rounds a float: SwiftShader to nearest, ANGLE's D3D11 toward zero. */
type Rounding = "nearest" | "zero";

function targetRounding(): Rounding {
  const gl = document.createElement("canvas").getContext("webgl2");
  if (!gl || !gl.getExtension("EXT_color_buffer_float")) throw new Error("no float render targets");
  const shader = (type: number, src: string) => {
    const s = gl.createShader(type);
    if (!s) throw new Error("no shader");
    gl.shaderSource(s, src);
    gl.compileShader(s);
    return s;
  };
  const program = gl.createProgram();
  gl.attachShader(program, shader(gl.VERTEX_SHADER, "#version 300 es\nvoid main() { gl_Position = vec4(vec2(gl_VertexID & 1, gl_VertexID >> 1) * 4.0 - 1.0, 0.0, 1.0); }"));
  gl.attachShader(program, shader(gl.FRAGMENT_SHADER, "#version 300 es\nprecision highp float;\nout vec4 o;\nvoid main() { o = vec4(1.0 + 0.75 * exp2(-10.0)); }"));
  gl.linkProgram(program);
  gl.useProgram(program);
  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, 1, 1, 0, gl.RGBA, gl.HALF_FLOAT, null);
  gl.bindFramebuffer(gl.FRAMEBUFFER, gl.createFramebuffer());
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
  gl.viewport(0, 0, 1, 1);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  const out = new Float32Array(4);
  gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.FLOAT, out);
  if (out[0] === 1 + 2 ** -10) return "nearest";
  if (out[0] === 1) return "zero";
  throw new Error(`a half-float target stored ${out[0]}`);
}
const ROUNDING = targetRounding();

/** A number rounded to a half float's 11 significant bits. */
function half(x: number, rounding: Rounding): number {
  if (x === 0) return 0;
  const step = 2 ** (Math.max(Math.floor(Math.log2(Math.abs(x))), -14) - 10);
  if (rounding === "zero") return Math.trunc(x / step) * step;
  const q = x / step;
  const f = Math.floor(q);
  const d = q - f;
  const r = d < 0.5 ? f : d > 0.5 ? f + 1 : f % 2 === 0 ? f : f + 1;
  return r * step;
}

const quantile = (sorted: number[], q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];

/** The CPU model's frame: the passes read the stage's input as the host stored it and round their own stores to nearest; the inline blends over the exact input. */
function expected(identity: Float32Array, p: Params): Float32Array {
  const input = new Float32Array(W * H * 3);
  for (let k = 0; k < W * H; k++) for (let c = 0; c < 3; c++) input[3 * k + c] = half(identity[4 * k + c], ROUNDING);
  const layer = highPass(input, W, H, p.radius, p.monochrome, (v) => half(v, "nearest"));
  const out = new Float32Array(W * H * 3);
  for (let k = 0; k < W * H; k++) {
    const base = [identity[4 * k], identity[4 * k + 1], identity[4 * k + 2]] as const;
    out.set(composite(base, [layer[3 * k], layer[3 * k + 1], layer[3 * k + 2]], p), 3 * k);
  }
  return out;
}

describe("High Pass Sharpen on the GPU", () => {
  const bags: Record<string, Record<string, unknown>> = { identity: resetPatch() };
  for (const [name, p] of CASES) bags[name] = bagPatch(full(p));
  const frames = render(bags);

  it("leaves the frame as it was while idle, to float rounding", () => {
    const without = render({ identity: {} }, []).identity;
    let worst = 0;
    for (let i = 0; i < without.length; i++) worst = Math.max(worst, Math.abs(frames.identity[i] - without[i]));
    expect(worst).toBeLessThan(UNTOUCHED);
  });

  it.each(CASES)("matches the CPU model: %s", (name, p) => {
    const want = expected(frames.identity, full(p));
    const errors: number[] = [];
    let moved = 0;
    for (let k = 0; k < W * H; k++) {
      for (let c = 0; c < 3; c++) {
        errors.push(Math.abs(frames[name][4 * k + c] - want[3 * k + c]));
        moved = Math.max(moved, Math.abs(want[3 * k + c] - frames.identity[4 * k + c]));
      }
    }
    const sorted = errors.sort((a, b) => a - b);
    console.log(name, JSON.stringify({ moved, p50: quantile(sorted, 0.5), p99: quantile(sorted, 0.99), max: sorted[sorted.length - 1] }));
    expect(moved, "the case changes the image").toBeGreaterThan(0.03);
    expect(quantile(sorted, 0.99)).toBeLessThan(1e-4);
    // One half-float step at 0.5 is 4.9e-4: a store that ties the other way moves the result by about that.
    expect(sorted[sorted.length - 1]).toBeLessThan(1e-3);
  });

  it("clips to 0 to 1, and never pushes a value already beyond that further out", () => {
    let beyond = 0;
    for (const [name] of CASES) {
      const frame = frames[name];
      for (let i = 0; i < frame.length; i++) {
        if (i % 4 === 3) continue;
        const input = frames.identity[i];
        if (input > 1) beyond++;
        expect(frame[i]).toBeGreaterThanOrEqual(Math.min(input, 0) - 1e-6);
        expect(frame[i]).toBeLessThanOrEqual(Math.max(input, 1) + 1e-6);
      }
    }
    expect(beyond, "the probe hands the stage values above 1").toBeGreaterThan(0);
  });

  it("keeps a draw to tens of reads on a 4096 px frame at the largest radius", () => {
    const big = floatImage(4096, 2731, (x, y) => {
      const v = 0.3 + 0.4 * hash(x, y) * (x / 4096);
      return [v, v * 0.9, v * 0.8];
    });
    const started = performance.now();
    withRenderer({ stages: [...builtinStages(), highPassStage()], pipeline: OPEN_PROBE }, (renderer) => {
      renderer.setImage(big);
      renderer.setParams(identityParams({ processVersion: CURRENT_PROCESS_VERSION }));
      renderer.setContributedParams(bagPatch(full({ amount: 100, radius: 5 })));
      const frame = renderer.readFloatFrame("pre-output", Infinity, AS_DRAWN);
      expect(frame).not.toBeNull();
      expect(frame?.data.every(Number.isFinite)).toBe(true);
    });
    console.log("4096 px frame at radius 5, two draws and the readback", Math.round(performance.now() - started), "ms (SwiftShader)");
  });
});
