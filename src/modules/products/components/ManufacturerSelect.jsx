import Select from "react-select";

const getManufacturerId = (manufacturer = {}) =>
  String(manufacturer.id || manufacturer.manufacturer_id || manufacturer.manufacturerId || "").trim();

const getManufacturerName = (manufacturer = {}) =>
  String(
    manufacturer.name ||
      manufacturer.manufacturer_name ||
      manufacturer.manufacturerName ||
      manufacturer.label ||
      getManufacturerId(manufacturer)
  ).trim();

export default function ManufacturerSelect({ manufacturers = [], value = "", onChange, placeholder, isMulti = false }) {
  const options = manufacturers
    .map((manufacturer) => ({
      value: getManufacturerId(manufacturer),
      label: getManufacturerName(manufacturer),
    }))
    .filter((option) => option.value && option.label);
  const selectedValues = new Set(
    (Array.isArray(value) ? value : value ? [value] : []).map((item) => String(item || ""))
  );
  const selectedOption = isMulti
    ? options.filter((option) => selectedValues.has(option.value))
    : options.find((option) => option.value === String(value || "")) || null;

  return (
    <Select
      value={selectedOption}
      options={options}
      onChange={(option) => onChange?.(
        isMulti ? (Array.isArray(option) ? option.map((item) => item.value) : []) : option?.value || ""
      )}
      placeholder={placeholder}
      noOptionsMessage={() => "لا توجد مصانع متاحة"}
      isClearable
      isMulti={isMulti}
      isRtl
      menuPosition="fixed"
      menuPortalTarget={typeof document !== "undefined" ? document.body : null}
      className="text-sm"
      /* react-select cannot be styled by Tailwind utilities, so its palette is
         supplied here. It used to be a hardcoded dark ramp — a near-black
         control, a charcoal menu and white text — which rendered as a black
         select on the light theme whatever mode was active. Every value is a
         token now, so
         this control follows the theme like the native ones beside it. */
      styles={{
        control: (base, state) => ({
          ...base,
          minHeight: "var(--control-height-md, 40px)",
          height: isMulti ? "auto" : "var(--control-height-md, 40px)",
          borderRadius: "var(--radius-control)",
          borderColor: state.isFocused ? "var(--primary)" : "var(--border)",
          backgroundColor: "var(--surface)",
          boxShadow: state.isFocused ? "0 0 0 3px var(--primary-soft)" : "none",
          cursor: "pointer",
          ":hover": { borderColor: "var(--border-strong)" },
        }),
        valueContainer: (base) => ({ ...base, padding: "0 12px" }),
        singleValue: (base) => ({ ...base, color: "var(--text)", fontWeight: 700 }),
        multiValue: (base) => ({ ...base, borderRadius: 8, backgroundColor: "var(--primary-soft)" }),
        multiValueLabel: (base) => ({ ...base, color: "var(--primary)", fontWeight: 700 }),
        multiValueRemove: (base) => ({
          ...base,
          color: "var(--muted)",
          ":hover": { color: "var(--primary-contrast)", backgroundColor: "var(--primary)" },
        }),
        placeholder: (base) => ({ ...base, color: "var(--muted)", fontWeight: 700 }),
        input: (base) => ({ ...base, color: "var(--text)" }),
        indicatorsContainer: (base) => ({ ...base, minHeight: 38, height: isMulti ? "auto" : 38 }),
        indicatorSeparator: () => ({ display: "none" }),
        dropdownIndicator: (base) => ({ ...base, color: "var(--muted)", padding: 8 }),
        clearIndicator: (base) => ({ ...base, color: "var(--muted)", padding: 6 }),
        menuPortal: (base) => ({ ...base, zIndex: 10000 }),
        menu: (base) => ({
          ...base,
          overflow: "hidden",
          marginTop: 6,
          border: "1px solid var(--border)",
          borderRadius: "var(--radius-card)",
          backgroundColor: "var(--card)",
          boxShadow: "var(--shadow-overlay)",
        }),
        menuList: (base) => ({ ...base, padding: 6, backgroundColor: "var(--card)" }),
        option: (base, state) => ({
          ...base,
          borderRadius: 8,
          backgroundColor: state.isSelected
            ? "var(--primary)"
            : state.isFocused
              ? "var(--surface-hover)"
              : "transparent",
          color: state.isSelected ? "var(--primary-contrast)" : "var(--text)",
          fontWeight: 700,
          cursor: "pointer",
          ":active": { backgroundColor: "var(--primary-hover)" },
        }),
        noOptionsMessage: (base) => ({ ...base, color: "var(--muted)" }),
      }}
    />
  );
}
