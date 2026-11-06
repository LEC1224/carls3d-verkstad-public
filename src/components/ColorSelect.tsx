import { useId } from "react";
import type { ColorOption } from "../lib/colors";
import { ALL_COLORS } from "../lib/colors";

type Props = {
  id?: string;
  value?: string;
  onChange: (value: string) => void;
  label?: string;
  options?: ColorOption[];
  disabled?: boolean;
};

export default function ColorSelect({ id, value, onChange, label = "Färg", options, disabled }: Props) {
  const generatedId = useId();
  const selectId = id || generatedId;
  // An empty inventory is different from an omitted inventory.
  const colors = options ?? ALL_COLORS;
  const current = colors.find((color) => color.value === value);

  return (
    <div className="w-full">
      <label htmlFor={selectId} className="mb-1 block text-sm font-medium">{label}</label>
      <div className="relative">
        {current && (
          <span aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 rounded-full border border-gray-300" style={{ backgroundColor: current.hex }} />
        )}
        <select
          id={selectId}
          value={current?.value || ""}
          onChange={(event) => onChange(event.target.value)}
          disabled={disabled || colors.length === 0}
          required
          className={`w-full rounded-xl border bg-white py-2 pr-3 disabled:bg-gray-50 disabled:text-gray-500 ${current ? "pl-10" : "pl-3"}`}
        >
          {!current && <option value="" disabled>{colors.length ? "Välj färg" : "Inga färger tillgängliga"}</option>}
          {colors.map((color) => <option key={color.value} value={color.value}>{color.label}</option>)}
        </select>
      </div>
    </div>
  );
}
