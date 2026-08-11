import toast from "react-hot-toast";
import { useTranslation } from "react-i18next";

import Select from "react-select";

import {
  Trash2,
  Image as ImageIcon
} from "lucide-react";

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
   PRESET COLORS
====================================================== */

const PRESET_COLORS = [

  {
    name: "Black",
    hex: "#000000"
  },

  {
    name: "White",
    hex: "#ffffff"
  },

  {
    name: "Blue",
    hex: "#2563eb"
  },

  {
    name: "Red",
    hex: "#dc2626"
  },

  {
    name: "Green",
    hex: "#16a34a"
  },

  {
    name: "Gray",
    hex: "#6b7280"
  },

  {
    name: "Brown",
    hex: "#92400e"
  },

  {
    name: "Yellow",
    hex: "#eab308"
  },

  {
    name: "Pink",
    hex: "#ec4899"
  },

  {
    name: "Orange",
    hex: "#f97316"
  }
];

/* ======================================================
   PRODUCT COLORS
====================================================== */

export default function ProductColors({

  colors,
  setColors

}) {
  const { t } = useTranslation();

  /* =========================
     ADD COLOR
  ========================= */

  const handleAddColor =
    (preset) => {

      const exists =
        colors.find(
          (c) =>
            c.name === preset.name
        );

      if (exists)
        return;

      const newColor = {

        id: Date.now(),

        name: preset.name,

        hex: preset.hex,

        images: [],

        sizes: []
      };

      setColors([
        ...colors,
        newColor
      ]);
    };

  /* =========================
     DELETE COLOR
  ========================= */

  const removeColor =
    (id) => {

      setColors(

        colors.filter(
          (c) => c.id !== id
        )
      );
    };

  /* =========================
     ADD IMAGES
  ========================= */

  const handleImages =
    (e, colorId) => {

      const files =
        Array.from(
          e.target.files
        );

      const updated =
        colors.map((color) => {

          if (
            color.id === colorId
          ) {

            const previews =

              files.map(
                (file) => ({

                  file,

                  preview:
                    URL.createObjectURL(
                      file
                    )
                })
              );

            return {

              ...color,

              images: [

                ...color.images,

                ...previews
              ]
            };
          }

          return color;
        });

      setColors(updated);
    };

  /* =========================
     REMOVE IMAGE
  ========================= */

  const removeImage = (

    colorId,

    index

  ) => {

    const updated =
      colors.map((color) => {

        if (
          color.id === colorId
        ) {

          return {

            ...color,

            images:

              color.images.filter(

                (_, i) =>
                  i !== index
              )
          };
        }

        return color;
      });

    setColors(updated);
    toast.success(t("products.images.removed", "Image removed"));
  };

  /* =========================
     UPDATE SIZES
  ========================= */

  const updateSizes = (

    colorId,

    selected

  ) => {

    const values =

      selected
      ? selected.map(
          (item) =>
            item.value
        )

      : [];

    const updated =
      colors.map((color) => {

        if (
          color.id === colorId
        ) {

          return {

            ...color,

            sizes: values
          };
        }

        return color;
      });

    setColors(updated);
  };

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

      <div className="mb-8">

        <h2
          className="
          text-3xl
          font-black
          text-white
          "
        >{t("products.colors.title", "Product Colors")}</h2>

        <p className="text-gray-400 mt-2">{t("products.colors.description", "Add colors, images and sizes")}</p>

      </div>

      {/* QUICK COLORS */}

      <div className="mb-10">

        <h3
          className="
          text-white
          text-xl
          font-black
          mb-5
          "
        >{t("products.colors.quickColors", "Quick Colors")}</h3>

        <div
          className="
          flex
          flex-wrap
          gap-4
          "
        >

          {PRESET_COLORS.map(
            (preset) => {

              const active =
                colors.find(
                  (c) =>
                    c.name === preset.name
                );

              return (

                <button

                  key={preset.name}

                  onClick={() =>
                    handleAddColor(
                      preset
                    )
                  }

                  className={`
                    flex
                    items-center
                    gap-3
                    px-5
                    py-4
                    rounded-2xl
                    border
                    transition-all
                    font-black

                    ${
                      active

                      ? `
                        bg-primary
                        border-primary
                        text-white
                        scale-105
                      `

                      : `
                        bg-[#1e293b]
                        border-white/10
                        text-white
                        hover:border-primary
                        hover:bg-[#263247]
                      `
                    }
                  `}
                >

                  <div

                    style={{
                      background:
                        preset.hex
                    }}

                    className="
                    w-6
                    h-6
                    rounded-full
                    border
                    border-white/20
                    "

                  />

                  {preset.name}

                </button>
              );
            }
          )}

        </div>

      </div>

      {/* COLORS */}

      <div className="space-y-8">

        {colors.map((color) => (

          <div

            key={color.id}

            className="
            bg-gradient-to-br
            from-[#1e293b]
            to-[#172033]
            border
            border-white/10
            rounded-3xl
            p-7
            shadow-xl
            "

          >

            {/* TOP */}

            <div
              className="
              flex
              items-center
              justify-between
              flex-wrap
              gap-5
              "
            >

              <div
                className="
                flex
                items-center
                gap-5
                "
              >

                <div

                  style={{
                    background:
                      color.hex
                  }}

                  className="
                  w-16
                  h-16
                  rounded-3xl
                  border-4
                  border-white/10
                  shadow-lg
                  "

                />

                <div>

                  <h3
                    className="
                    text-3xl
                    font-black
                    text-white
                    "
                  >

                    {color.name}

                  </h3>

                  <div
                    className="
                    flex
                    items-center
                    gap-4
                    mt-2
                    "
                  >

                    <span
                      className="
                      text-gray-400
                      text-sm
                      "
                    >

                      {color.hex}

                    </span>

                    <span
                      className="
                      bg-primary/20
                      text-primary
                      px-3
                      py-1
                      rounded-xl
                      text-xs
                      font-black
                      "
                    >

                      {t("products.colors.sizeCount", "{{count}} Sizes", { count: color.sizes.length })}

                    </span>

                    <span
                      className="
                      bg-green-500/20
                      text-green-400
                      px-3
                      py-1
                      rounded-xl
                      text-xs
                      font-black
                      "
                    >

                      {t("products.colors.imageCount", "{{count}} Images", { count: color.images.length })}

                    </span>

                  </div>

                </div>

              </div>

              {/* DELETE */}

              <button

                onClick={() =>
                  removeColor(
                    color.id
                  )
                }

                className="
                bg-red-500/20
                hover:bg-red-500
                text-red-400
                hover:text-white
                w-14
                h-14
                rounded-2xl
                flex
                items-center
                justify-center
                transition-all
                "

              >

                <Trash2 size={22} />

              </button>

            </div>

            {/* SIZES */}

            <div className="mt-8">

              <h4
                className="
                text-white
                font-black
                mb-4
                text-lg
                "
              >

                {t("products.colors.sizesFor", "Sizes for {{name}}", { name: color.name })}

              </h4>

              <Select

                isMulti

                closeMenuOnSelect={false}

                hideSelectedOptions={false}

                options={sizeOptions}

                value={

                  sizeOptions.filter(
                    (option) =>

                      color.sizes.includes(
                        option.value
                      )
                  )
                }

                onChange={(selected) =>
                  updateSizes(
                    color.id,
                    selected
                  )
                }

                placeholder={t("products.sizes.choosePlaceholder", "Choose sizes...")}

                className="text-black"

                styles={{

                  control: (base) => ({

                    ...base,

                    background:
                      "#0f172a",

                    border:
                      "1px solid rgba(255,255,255,0.08)",

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
                  }),

                  option: (
                    base,
                    state
                  ) => ({

                    ...base,

                    background:

                      state.isFocused

                      ? "#2563eb"

                      : "#0f172a",

                    color:
                      "white",

                    cursor:
                      "pointer",
                  }),

                  multiValue: (
                    base
                  ) => ({

                    ...base,

                    background:
                      "#2563eb",

                    borderRadius:
                      "12px",
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
                }}

              />

            </div>

            {/* UPLOAD */}

            <div className="mt-8">

              <label
                className="
                bg-[#0f172a]
                border-2
                border-dashed
                border-white/10
                rounded-3xl
                p-10
                flex
                flex-col
                items-center
                justify-center
                cursor-pointer
                hover:border-primary
                transition-all
                "
              >

                <ImageIcon
                  size={45}
                  className="text-primary"
                />

                <p
                  className="
                  text-white
                  font-black
                  mt-5
                  text-lg
                  "
                >{t("products.images.uploadImages", "Upload Images")}</p>

                <p className="text-gray-400 mt-2">{t("products.images.multipleSupported", "Multiple images supported")}</p>

                <input

                  type="file"

                  multiple

                  hidden

                  onChange={(e) =>
                    handleImages(
                      e,
                      color.id
                    )
                  }

                />

              </label>

            </div>

            {/* IMAGES */}

            {

              color.images.length > 0 && (

                <div
                  className="
                  grid
                  grid-cols-2
                  md:grid-cols-4
                  xl:grid-cols-6
                  gap-5
                  mt-8
                  "
                >

                  {color.images.map(

                    (img, index) => (

                      <div

                        key={index}

                        className="
                        relative
                        group
                        overflow-visible
                        "

                      >

                        <div className="relative h-44 w-full overflow-hidden rounded-2xl border border-white/10 shadow-lg">
                          <img
                            src={img.preview}
                            alt=""
                            className="h-full w-full object-cover transition duration-200 group-hover:scale-[1.04]"
                          />
                          <div className="pointer-events-none absolute inset-0 bg-black/0 transition duration-200 group-hover:bg-black/40" />
                        </div>

                        <button

                          onClick={() =>
                            removeImage(
                              color.id,
                              index
                            )
                          }

                          className="
                          absolute
                          top-2
                          right-2
                          z-50
                          w-8
                          h-8
                          rounded-full
                          border
                          border-red-200/40
                          bg-red-500/90
                          text-white
                          opacity-100
                          transition-all
                          flex
                          items-center
                          justify-center
                          shadow-xl
                          shadow-black/40
                          backdrop-blur-md
                          hover:scale-110
                          hover:bg-red-500
                          "

                        >

                          <Trash2 size={18} />

                        </button>

                      </div>
                    )
                  )}

                </div>
              )
            }

          </div>
        ))}

      </div>

    </div>
  );
}
