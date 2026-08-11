import Select from "react-select";
import { useTranslation } from "react-i18next";

/* ======================================================
   SIZES
====================================================== */

const sizeOptions = Array.from(

  { length: 34 },

  (_, i) => ({

    value: String(i + 17),

    label: `Size ${i + 17}`
  })

);

/* ======================================================
   COMPONENT
====================================================== */

export default function ProductSizes({

  selectedSizes,

  setSelectedSizes

}) {
  const { t } = useTranslation();

  /* =========================
     HANDLE SELECT
  ========================= */

  const handleChange = (
    selected
  ) => {

    const values =

      selected
      ? selected.map(
          (item) =>
            item.value
        )

      : [];

    setSelectedSizes(values);
  };

  /* =========================
     SELECTED VALUES
  ========================= */

  const selectedValues =

    sizeOptions.filter(
      (option) =>

        selectedSizes.includes(
          option.value
        )
    );

  return (

    <div
      className="
      bg-[#0f172a]
      border
      border-white/10
      rounded-3xl
      p-6
      shadow-2xl
      "
    >

      {/* HEADER */}

      <div className="mb-6">

        <h2
          className="
          text-3xl
          font-black
          text-white
          "
        >

          {t("products.sizes.selectSizes", "Select Sizes")}

        </h2>

        <p className="text-gray-400 mt-2">

          {t("products.sizes.chooseAvailable", "Choose available shoe sizes")}

        </p>

      </div>

      {/* SELECT */}

      <Select

        isMulti

        closeMenuOnSelect={false}

        hideSelectedOptions={false}

        options={sizeOptions}

        value={selectedValues}

        onChange={handleChange}

        placeholder={t("products.sizes.choosePlaceholder", "Choose sizes...")}

        className="text-black"

        styles={{

          control: (base) => ({

            ...base,

            background:
              "#1e293b",

            border:
              "1px solid rgba(255,255,255,0.1)",

            borderRadius:
              "20px",

            minHeight:
              "65px",

            boxShadow:
              "none",
          }),

          menu: (base) => ({

            ...base,

            background:
              "#0f172a",

            borderRadius:
              "20px",

            overflow:
              "hidden",

            marginTop:
              "10px",
          }),

          menuList: (base) => ({

            ...base,

            maxHeight:
              "300px",

            padding:
              "10px",
          }),

          option: (
            base,
            state
          ) => ({

            ...base,

            background:

              state.isFocused

              ? "#2563eb"

              : state.isSelected

              ? "#1d4ed8"

              : "#0f172a",

            color:
              "white",

            cursor:
              "pointer",

            borderRadius:
              "12px",

            marginBottom:
              "5px",

            padding:
              "12px 16px",

            fontWeight:
              "700",
          }),

          multiValue: (
            base
          ) => ({

            ...base,

            background:
              "#2563eb",

            borderRadius:
              "12px",

            padding:
              "5px",
          }),

          multiValueLabel: (
            base
          ) => ({

            ...base,

            color:
              "white",

            fontWeight:
              "700",
          }),

          multiValueRemove: (
            base
          ) => ({

            ...base,

            color:
              "white",

            ":hover": {

              background:
                "#dc2626",

              color:
                "white",
            },
          }),

          singleValue: (
            base
          ) => ({

            ...base,

            color:
              "white",
          }),

          input: (
            base
          ) => ({

            ...base,

            color:
              "white",
          }),

          placeholder: (
            base
          ) => ({

            ...base,

            color:
              "#94a3b8",
          }),

          dropdownIndicator: (
            base
          ) => ({

            ...base,

            color:
              "#94a3b8",

            ":hover": {

              color:
                "white",
            },
          }),

          clearIndicator: (
            base
          ) => ({

            ...base,

            color:
              "#94a3b8",

            ":hover": {

              color:
                "#ef4444",
            },
          }),
        }}

      />

      {/* COUNT */}

      <div className="mt-5 flex justify-end">

        <div
          className="
          bg-primary/20
          text-primary
          px-4
          py-2
          rounded-xl
          font-black
          "
        >

          {selectedSizes.length} Selected

        </div>

      </div>

    </div>
  );
}
