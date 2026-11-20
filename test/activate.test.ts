import { describe, expect, it } from "vitest";
import { PANEL_ID, activate, deactivate } from "../src/index";
import { STAGE_ID, qualified } from "../src/params";
import { fakeApi } from "./support/fake-api";

describe("activate", () => {
  it("registers the stage and a panel that also edits masks", () => {
    const rig = fakeApi();
    activate(rig.api);
    expect(rig.stages.map((s) => s.id)).toEqual([STAGE_ID]);
    expect(rig.panels.map((p) => p.id)).toEqual([PANEL_ID]);
    expect(rig.panels[0].title).toBe("High Pass Sharpen");
    expect(rig.panels[0].mask?.owns).toEqual(
      (["amount", "radius", "mode", "monochrome", "draws"] as const).map((key) => qualified(key)),
    );
    deactivate();
  });

  it("resets the photo's edit to an idle one", () => {
    const rig = fakeApi({ [qualified("amount")]: 40, [qualified("radius")]: 0.3, [qualified("draws")]: 1 });
    activate(rig.api);
    rig.panels[0].onReset?.();
    expect(rig.params()).toMatchObject({ [qualified("amount")]: 0, [qualified("radius")]: 0.5, [qualified("draws")]: 0 });
    expect(rig.commits).toEqual(["High Pass Sharpen reset"]);
    deactivate();
  });

  it("re-derives the draw count of a pasted edit, and a mask's", () => {
    const rig = fakeApi();
    activate(rig.api);
    rig.replace({ [qualified("amount")]: 25 });
    expect(rig.params()[qualified("draws")]).toBe(1);
    rig.setMasks([{ id: "m1", bag: { [qualified("amount")]: 25 } }]);
    expect(rig.maskBag("m1")?.[qualified("draws")]).toBe(1);
    deactivate();
  });

  it("stops re-deriving once deactivated", () => {
    const rig = fakeApi();
    activate(rig.api);
    deactivate();
    rig.replace({ [qualified("amount")]: 25 });
    expect(rig.params()[qualified("draws")]).toBeUndefined();
  });
});
