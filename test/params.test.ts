import { describe, expect, it } from "vitest";
import { DEFAULT_PARAMS } from "../src/model";
import { bagPatch, qualified, readParams, rederivePatch, resetPatch } from "../src/params";

describe("the bag", () => {
  it("reads an idle edit from an empty bag: amount 0, radius 0.5, Linear Light, in colour", () => {
    expect(readParams({})).toEqual({ amount: 0, radius: 0.5, mode: 0, monochrome: false });
    expect(readParams({})).toEqual(DEFAULT_PARAMS);
  });

  it("clamps each number to its range and skips values of the wrong type", () => {
    const p = readParams({
      [qualified("amount")]: 140,
      [qualified("radius")]: 0,
      [qualified("mode")]: "2",
      [qualified("monochrome")]: 1,
    });
    expect(p).toEqual({ amount: 100, radius: 0.1, mode: 0, monochrome: false });
    expect(readParams({ [qualified("radius")]: 99 }).radius).toBe(5);
  });

  it("reads the blend mode as a whole index into the modes", () => {
    expect(readParams({ [qualified("mode")]: 2.4 }).mode).toBe(2);
    expect(readParams({ [qualified("mode")]: 9 }).mode).toBe(3);
    expect(readParams({ [qualified("mode")]: Number.NaN }).mode).toBe(0);
    expect(readParams({ [qualified("monochrome")]: true }).monochrome).toBe(true);
  });

  it("writes the edit with its draw count", () => {
    expect(bagPatch({ ...DEFAULT_PARAMS, amount: 60 })).toEqual({
      [qualified("amount")]: 60,
      [qualified("radius")]: 0.5,
      [qualified("mode")]: 0,
      [qualified("monochrome")]: false,
      [qualified("draws")]: 1,
    });
  });

  it("resets to an idle edit", () => {
    expect(resetPatch()).toMatchObject({ [qualified("amount")]: 0, [qualified("draws")]: 0 });
  });
});

describe("re-deriving", () => {
  it("leaves a bag without the edit alone", () => {
    expect(rederivePatch({ "other.stage.key": 1 })).toBeNull();
  });

  it("leaves a consistent bag alone", () => {
    expect(rederivePatch(bagPatch({ ...DEFAULT_PARAMS, amount: 30 }))).toBeNull();
  });

  it("fixes the draw count of a bag that carried only some of the edit", () => {
    expect(rederivePatch({ [qualified("amount")]: 30 })).toEqual({ [qualified("draws")]: 1 });
    expect(rederivePatch({ [qualified("amount")]: 0, [qualified("draws")]: 1 })).toEqual({ [qualified("draws")]: 0 });
    expect(rederivePatch({ [qualified("draws")]: 1 })).toEqual({ [qualified("draws")]: 0 });
  });
});
