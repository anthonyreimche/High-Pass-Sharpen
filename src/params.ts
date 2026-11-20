// The param-bag contract. The edit is the module's own params under the stage's
// qualified keys. One derived key, `draws`, is the passes' draw count: 0 while
// the amount is 0, so an untouched photo never runs them.

import { DEFAULT_PARAMS, RANGES, drawCount, type NumericKey, type Params } from "./model";

export const EXT_ID = "high-pass-sharpen";
export const STAGE_ID = `${EXT_ID}.layer`;

export type EditKey = keyof Params;
export const EDIT_KEYS: readonly EditKey[] = ["amount", "radius", "mode", "monochrome"];
export const DRAWS_KEY = "draws" as const;

export const qualified = (key: EditKey | typeof DRAWS_KEY): string => `${STAGE_ID}.${key}`;

type Bag = Readonly<Record<string, unknown>>;
type Patch = Record<string, number | boolean>;

const clamp = (v: number, key: NumericKey) => Math.min(Math.max(v, RANGES[key].min), RANGES[key].max);

/** `bag` is the host's untyped per-photo bag; a missing or mistyped value reads as the default. */
export function readParams(bag: Bag): Params {
  const out = { ...DEFAULT_PARAMS };
  for (const key of ["amount", "radius", "mode"] as const) {
    const v = bag[qualified(key)];
    if (typeof v === "number" && Number.isFinite(v)) out[key] = clamp(key === "mode" ? Math.round(v) : v, key);
  }
  const monochrome = bag[qualified("monochrome")];
  if (typeof monochrome === "boolean") out.monochrome = monochrome;
  return out;
}

/** The edit and its draw count. */
export function bagPatch(p: Params): Patch {
  const out: Patch = {};
  for (const key of EDIT_KEYS) out[qualified(key)] = p[key];
  out[qualified(DRAWS_KEY)] = drawCount(p);
  return out;
}

/** The draw count the bag's edit needs, when the bag holds a different one. */
export function rederivePatch(bag: Bag): Patch | null {
  if (!EDIT_KEYS.some((key) => qualified(key) in bag) && !(qualified(DRAWS_KEY) in bag)) return null;
  const draws = drawCount(readParams(bag));
  return bag[qualified(DRAWS_KEY)] === draws ? null : { [qualified(DRAWS_KEY)]: draws };
}

export const resetPatch = (): Patch => bagPatch(DEFAULT_PARAMS);
