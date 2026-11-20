// The panel, in the order the technique is set up: the layer's opacity and
// the High Pass radius, then the layer's blend mode and whether it is grey.
//
// It edits whatever useParamScope hands it: the photo's bag in the dock, a
// mask's in the Masking panel. A drag writes the value and the draw count
// live and commits on release, so one gesture is one undo step; each change
// reads the bag the scope holds now, as drags outrun renders.

import { BLEND_MODES, DEFAULT_PARAMS, RANGES, drawCount } from "./model";
import { DRAWS_KEY, qualified, readParams } from "./params";
import { React, api } from "./rt";
import { LABELS } from "./stage";

const SLIDERS = ["amount", "radius"] as const;
const TITLE = "High Pass Sharpen";
const undo = (key: keyof typeof LABELS): string => `${TITLE}: ${LABELS[key]}`;
const MODE_OPTIONS = BLEND_MODES.map((m, i) => ({ value: String(i), label: m.label }));

export function HighPassPanel() {
  const { Slider } = api.components;
  const { Field, Select, Stack, Toggle } = api.ui;
  const scope = api.develop.useParamScope();
  const params = readParams(scope.getParams());

  return (
    <Stack gap={6} style={{ padding: 8 }}>
      {SLIDERS.map((key) => (
        <Slider
          key={key}
          label={LABELS[key]}
          value={params[key]}
          min={RANGES[key].min}
          max={RANGES[key].max}
          step={RANGES[key].step}
          defaultValue={DEFAULT_PARAMS[key]}
          onChange={(value) => {
            const next = { ...readParams(scope.getParams()), [key]: value };
            scope.setParams({ [qualified(key)]: value, [qualified(DRAWS_KEY)]: drawCount(next) });
          }}
          onCommit={() => scope.commit(undo(key))}
        />
      ))}
      <Field label={LABELS.mode}>
        <Select
          ariaLabel={LABELS.mode}
          value={String(params.mode)}
          options={MODE_OPTIONS}
          onChange={(value) => {
            scope.setParams({ [qualified("mode")]: Number(value) });
            scope.commit(undo("mode"));
          }}
        />
      </Field>
      <Toggle
        label={LABELS.monochrome}
        checked={params.monochrome}
        onChange={(checked) => {
          scope.setParams({ [qualified("monochrome")]: checked });
          scope.commit(undo("monochrome"));
        }}
      />
    </Stack>
  );
}
