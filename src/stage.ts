// The processing stage. A photo editor builds the High Pass layer from the
// finished image and blends it over that, so the stage reads the image as
// edited up to it, display-encoded as an RGB document holds it, and sits in
// display-adjust after the other sharpening tools.

import { INLINE_GLSL, INLINE_HELPERS, PASSES, PASS_HELPERS } from "./glsl";
import { DEFAULT_PARAMS, RANGES, type NumericKey } from "./model";
import { DRAWS_KEY, EDIT_KEYS, STAGE_ID, type EditKey } from "./params";
import type { ProcessingStageContribution, UniformDeclaration } from "./safelight";

export const LABELS: Record<EditKey, string> = {
  amount: "Amount",
  radius: "Radius",
  mode: "Blend mode",
  monochrome: "Monochrome",
};

function edit(key: EditKey): UniformDeclaration {
  if (key === "monochrome") return { key, glslType: "bool", default: DEFAULT_PARAMS.monochrome, label: LABELS.monochrome };
  const numeric: NumericKey = key;
  return {
    key,
    glslType: numeric === "mode" ? "int" : "float",
    default: DEFAULT_PARAMS[numeric],
    range: RANGES[numeric],
    label: LABELS[numeric],
  };
}

const DRAWS: UniformDeclaration = { key: DRAWS_KEY, glslType: "int", default: 0 };

export function highPassStage(): ProcessingStageContribution {
  return {
    id: STAGE_ID,
    name: "High Pass Sharpen",
    phase: "display-adjust",
    // After Sharpen Edges (120), Sharpen Microcontrast (130) and USM and RL Sharpening (140).
    priority: 150,
    reads: "current",
    space: { encoding: "perceptual", primaries: "rec709" },
    glsl: INLINE_GLSL,
    helpers: INLINE_HELPERS,
    // Presets and paste read their parameters from these; the passes keep their own copies.
    uniforms: [DRAWS, ...EDIT_KEYS.map(edit)],
    passes: PASSES.map((pass) => ({
      channels: 4 as const,
      glsl: pass.glsl,
      helpers: PASS_HELPERS,
      iterations: { key: DRAWS_KEY, max: 1 },
      uniforms: pass.keys.map(edit),
    })),
    dormantWhen: { [DRAWS_KEY]: 0 },
    mask: { maskable: true },
  };
}
