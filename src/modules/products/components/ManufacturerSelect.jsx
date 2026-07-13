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
      styles={{
        control: (base, state) => ({
          ...base,
          minHeight: 40,
          height: isMulti ? "auto" : 40,
          borderRadius: 14,
          borderColor: state.isFocused ? "#a38220" : "rgba(255,255,255,.08)",
          backgroundColor: "#09090b",
          boxShadow: state.isFocused ? "0 0 0 2px rgba(218,165,32,.18)" : "none",
          cursor: "pointer",
          ":hover": { borderColor: "#a38220" },
        }),
        valueContainer: (base) => ({ ...base, padding: "0 12px" }),
        singleValue: (base) => ({ ...base, color: "#fff", fontWeight: 700 }),
        multiValue: (base) => ({ ...base, borderRadius: 8, backgroundColor: "rgba(163,130,32,.24)" }),
        multiValueLabel: (base) => ({ ...base, color: "#fff", fontWeight: 700 }),
        multiValueRemove: (base) => ({ ...base, color: "#d4d4d8", ":hover": { color: "#fff", backgroundColor: "#806719" } }),
        placeholder: (base) => ({ ...base, color: "#f4f4f5", fontWeight: 700 }),
        input: (base) => ({ ...base, color: "#fff" }),
        indicatorsContainer: (base) => ({ ...base, minHeight: 38, height: isMulti ? "auto" : 38 }),
        indicatorSeparator: () => ({ display: "none" }),
        dropdownIndicator: (base) => ({ ...base, color: "#d4d4d8", padding: 8 }),
        clearIndicator: (base) => ({ ...base, color: "#a1a1aa", padding: 6 }),
        menuPortal: (base) => ({ ...base, zIndex: 10000 }),
        menu: (base) => ({
          ...base,
          overflow: "hidden",
          marginTop: 6,
          border: "1px solid rgba(255,255,255,.16)",
          borderRadius: 12,
          backgroundColor: "#18181b",
          boxShadow: "0 18px 50px rgba(0,0,0,.55)",
        }),
        menuList: (base) => ({ ...base, padding: 6, backgroundColor: "#18181b" }),
        option: (base, state) => ({
          ...base,
          borderRadius: 8,
          backgroundColor: state.isSelected ? "#a38220" : state.isFocused ? "#3f3f46" : "#18181b",
          color: "#fff",
          fontWeight: 700,
          cursor: "pointer",
          ":active": { backgroundColor: "#806719" },
        }),
        noOptionsMessage: (base) => ({ ...base, color: "#a1a1aa" }),
      }}
    />
  );
}
