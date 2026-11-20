import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { activate, deactivate } from "../src/index";
import { HighPassPanel } from "../src/Panel";
import { qualified } from "../src/params";
import { React } from "../src/rt";
import { fakeApi } from "./support/fake-api";

function setup(params: Record<string, unknown> = {}) {
  const rig = fakeApi(params);
  activate(rig.api);
  const view = render(<HighPassPanel />);
  const slider = (label: string) => {
    const found = rig.sliders(view.container).find((s) => s.label === label);
    if (!found) throw new Error(`no slider ${label}`);
    return found;
  };
  return { rig, view, slider };
}

afterEach(() => {
  cleanup();
  deactivate();
});

describe("the panel", () => {
  it("lists Amount and Radius, then the blend mode and the monochrome switch", () => {
    const { rig, view } = setup();
    expect(rig.sliders(view.container).map((s) => s.label)).toEqual(["Amount", "Radius"]);
    const select = view.getByRole("combobox", { name: "Blend mode" }) as HTMLSelectElement;
    expect([...select.options].map((o) => o.text)).toEqual(["Linear Light", "Overlay", "Soft Light", "Hard Light"]);
    expect(select.value).toBe("0");
    expect(view.getByRole("switch", { name: "Monochrome" })).toBeTruthy();
  });

  it("starts idle with a half-pixel radius", () => {
    const { slider } = setup();
    expect(slider("Amount")).toMatchObject({ value: 0, min: 0, max: 100, step: 1, defaultValue: 0 });
    expect(slider("Radius")).toMatchObject({ value: 0.5, min: 0.1, max: 5, step: 0.05, defaultValue: 0.5 });
  });

  it("writes the value and the draw count as a slider moves, and one undo step on release", () => {
    const { rig, slider } = setup();
    act(() => slider("Amount").onChange(40));
    expect(rig.params()).toEqual({ [qualified("amount")]: 40, [qualified("draws")]: 1 });
    act(() => slider("Amount").onCommit?.());
    expect(rig.commits).toEqual(["High Pass Sharpen: Amount"]);
    act(() => slider("Amount").onChange(0));
    expect(rig.params()[qualified("draws")]).toBe(0);
  });

  it("writes the radius without changing whether the passes draw", () => {
    const { rig, slider } = setup({ [qualified("amount")]: 30, [qualified("draws")]: 1 });
    act(() => slider("Radius").onChange(0.3));
    expect(rig.params()).toMatchObject({ [qualified("radius")]: 0.3, [qualified("draws")]: 1 });
  });

  it("sets the blend mode and commits it", () => {
    const { rig, view } = setup({ [qualified("amount")]: 30 });
    fireEvent.change(view.getByRole("combobox", { name: "Blend mode" }), { target: { value: "2" } });
    expect(rig.params()[qualified("mode")]).toBe(2);
    expect(rig.commits).toEqual(["High Pass Sharpen: Blend mode"]);
  });

  it("switches monochrome and commits it", () => {
    const { rig, view } = setup({ [qualified("amount")]: 30 });
    fireEvent.click(view.getByRole("switch", { name: "Monochrome" }));
    expect(rig.params()[qualified("monochrome")]).toBe(true);
    expect(rig.commits).toEqual(["High Pass Sharpen: Monochrome"]);
  });
});
