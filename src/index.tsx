// High Pass Sharpen, a Safelight extension (GPL-3.0-or-later).
//
// The photo editor's High Pass sharpen: the image minus a fine Gaussian blur
// of itself, blended back over the image in Linear Light, Overlay, Soft Light
// or Hard Light at the layer's opacity. Registers the display-adjust stage
// (stage.ts) and the Develop panel (Panel.tsx), which also edits a mask's in
// the Masking panel.

import { HighPassPanel } from "./Panel";
import { DRAWS_KEY, EDIT_KEYS, EXT_ID, qualified, rederivePatch, resetPatch } from "./params";
import { api, initRuntime } from "./rt";
import type { DevelopState, SafelightAPI } from "./safelight";
import { highPassStage } from "./stage";

export const PANEL_ID = `${EXT_ID}.panel`;

let unsubscribe: (() => void) | null = null;

function reset(): void {
  const dev = api.stores.useDevelopStore.getState();
  dev.setDynParams(resetPatch());
  void dev.commitEdit("High Pass Sharpen reset");
}

export function activate(host: SafelightAPI): void {
  initRuntime(host);
  host.registerProcessingStage(highPassStage());
  host.registerPanel({
    id: PANEL_ID,
    title: "High Pass Sharpen",
    component: HighPassPanel,
    defaultDock: { module: "develop", direction: "right", width: 280 },
    onReset: reset,
    mask: { component: HighPassPanel, owns: [...EDIT_KEYS, DRAWS_KEY].map(qualified) },
  });

  unsubscribe?.();
  // A bag whose draw count disagrees with its edit (a preset or paste that
  // carried only some keys) is re-derived live, the photo's and each mask's.
  unsubscribe = host.stores.useDevelopStore.subscribe((state: DevelopState, prev: DevelopState) => {
    if (state.params.masks !== prev.params.masks) {
      for (const mask of state.params.masks) {
        if (prev.params.masks.some((m) => m.id === mask.id && m.bag === mask.bag)) continue;
        const patch = mask.bag ? rederivePatch(mask.bag) : null;
        if (patch) state.updateMaskBag(mask.id, patch);
      }
    }
    if (state.paramBag === prev.paramBag) return;
    const patch = rederivePatch(state.paramBag);
    if (patch) state.setDynParams(patch);
  });
}

/** The host sweeps the stage and the panel after every deactivate. */
export function deactivate(): void {
  unsubscribe?.();
  unsubscribe = null;
}
