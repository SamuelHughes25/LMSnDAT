// One shared curated palette, reused by every color picker in the course
// builder (text color, background fill, shape fill/border, the paint
// bucket's armed color) — see color-picker.tsx. Previously each picker
// would have needed its own list; a single source of truth here means
// "add a swatch" or "the blue preset should be a bit darker" is one edit,
// not N drifting copies. Deliberately doesn't include a "Default/none"
// entry — that's a per-field concern (some fields have a meaningful
// "unset" state, some don't), handled by ColorPicker's own `allowNone`/
// `noneLabel` props instead of baking it into the palette itself.
export type ColorPreset = { label: string; value: string };

export const COLOR_PRESETS: ColorPreset[] = [
  { label: "Black", value: "#000000" },
  { label: "White", value: "#ffffff" },
  { label: "Red", value: "#dc2626" },
  { label: "Orange", value: "#ea580c" },
  { label: "Green", value: "#16a34a" },
  { label: "Blue", value: "#2563eb" },
  { label: "Purple", value: "#9333ea" },
  { label: "Gray", value: "#6b7280" },
];
