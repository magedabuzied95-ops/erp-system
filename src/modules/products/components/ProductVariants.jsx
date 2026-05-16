import {
  useEffect,
  useState
} from "react";

/* ======================================================
   PRODUCT VARIANTS
====================================================== */

export default function ProductVariants({

  selectedSizes = [],

  productName = ""

}) {

  /* =========================
     VARIANTS
  ========================= */

  const [variants,
    setVariants] =
    useState([]);

  /* =========================
     GENERATE VARIANTS
  ========================= */

  useEffect(() => {

    const generated =

      selectedSizes.map((size, index) => ({

        id:
          `${productName || "product"}-${size}-${index}-${Date.now()}`,

        size,

        color: "",

        default_purchase_qty: 0,

        price: 0,

        sku:
          generateSKU(size),

        barcode:
          generateBarcode()
      }));

    setVariants(generated);

  }, [selectedSizes]);

  /* =========================
     SKU
  ========================= */

  const generateSKU = (size) => {

    const prefix =

      productName
      ?.substring(0, 3)
      ?.toUpperCase()

      || "PRD";

    return `${prefix}-${size}`;
  };

  /* =========================
     BARCODE
  ========================= */

  const generateBarcode = () => {

    return Math.floor(

      100000000000 +

      Math.random() * 900000000000

    ).toString();
  };

  /* =========================
     UPDATE FIELD
  ========================= */

  const updateVariant = (

    index,

    field,

    value

  ) => {

    const updated =
      [...variants];

    updated[index][field] =
      value;

    setVariants(updated);
  };

  /* =========================
     DELETE
  ========================= */

  const removeVariant = (index) => {

    const updated =
      variants.filter(

        (_, i) => i !== index
      );

    setVariants(updated);
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
        >

          Product Variants

        </h2>

        <p className="text-gray-400 mt-2">

          Auto generated from selected sizes

        </p>

      </div>

      {/* EMPTY */}

      {

        variants.length === 0 && (

          <div
            className="
            bg-[#1e293b]
            border
            border-white/10
            rounded-2xl
            p-10
            text-center
            "
          >

            <p className="text-gray-400 text-lg">

              Select sizes first

            </p>

          </div>
        )
      }

      {/* TABLE */}

      {

        variants.length > 0 && (

          <div className="overflow-x-auto">

            <table
              className="
              w-full
              border-separate
              border-spacing-y-3
              "
            >

              <thead>

                <tr>

                  <th className="text-left text-gray-400 pb-3">

                    Size

                  </th>

                  <th className="text-left text-gray-400 pb-3">

                    Color

                  </th>

                  <th className="text-left text-gray-400 pb-3">

                    Default purchase quantity

                  </th>

                  <th className="text-left text-gray-400 pb-3">

                    Price

                  </th>

                  <th className="text-left text-gray-400 pb-3">

                    SKU

                  </th>

                  <th className="text-left text-gray-400 pb-3">

                    Barcode

                  </th>

                  <th className="text-left text-gray-400 pb-3">

                    Action

                  </th>

                </tr>

              </thead>

              <tbody>

                {variants.map((variant, index) => (

                  <tr
                    key={`${variant.id || productName || "product"}-${variant.size || "size"}-${variant.color || "color"}-${index}`}
                    className="
                    bg-[#1e293b]
                    "
                  >

                    {/* SIZE */}

                    <td className="p-4 rounded-l-2xl">

                      <div
                        className="
                        bg-blue-500/20
                        text-blue-400
                        px-4
                        py-2
                        rounded-xl
                        font-black
                        w-fit
                        "
                      >

                        {variant.size}

                      </div>

                    </td>

                    {/* COLOR */}

                    <td className="p-4">

                      <input

                        type="text"

                        placeholder="Black"

                        value={variant.color}

                        onChange={(e) =>
                          updateVariant(
                            index,
                            "color",
                            e.target.value
                          )
                        }

                        className="
                        bg-[#0f172a]
                        border
                        border-white/10
                        rounded-xl
                        px-4
                        py-3
                        text-white
                        w-full
                        focus:outline-none
                        "
                      />

                    </td>

                    {/* STOCK */}

                    <td className="p-4">

                      <input

                        type="number"

                        value={variant.default_purchase_qty}

                        onChange={(e) =>
                          updateVariant(
                            index,
                            "default_purchase_qty",
                            e.target.value
                          )
                        }

                        className="
                        bg-[#0f172a]
                        border
                        border-white/10
                        rounded-xl
                        px-4
                        py-3
                        text-white
                        w-[100px]
                        focus:outline-none
                        "
                      />
                      <p className="mt-2 text-xs text-gray-400">
                        لا تؤثر على المخزون — المخزون يضاف من فاتورة المشتريات
                      </p>

                    </td>

                    {/* PRICE */}

                    <td className="p-4">

                      <input

                        type="number"

                        value={variant.price}

                        onChange={(e) =>
                          updateVariant(
                            index,
                            "price",
                            e.target.value
                          )
                        }

                        className="
                        bg-[#0f172a]
                        border
                        border-white/10
                        rounded-xl
                        px-4
                        py-3
                        text-white
                        w-[130px]
                        focus:outline-none
                        "
                      />

                    </td>

                    {/* SKU */}

                    <td className="p-4">

                      <div
                        className="
                        text-green-400
                        font-bold
                        "
                      >

                        {variant.sku}

                      </div>

                    </td>

                    {/* BARCODE */}

                    <td className="p-4">

                      <div
                        className="
                        text-yellow-400
                        font-bold
                        text-sm
                        "
                      >

                        {variant.barcode}

                      </div>

                    </td>

                    {/* DELETE */}

                    <td className="p-4 rounded-r-2xl">

                      <button

                        onClick={() =>
                          removeVariant(index)
                        }

                        className="
                        bg-red-500/20
                        hover:bg-red-500
                        text-red-400
                        hover:text-white
                        px-4
                        py-3
                        rounded-xl
                        transition-all
                        font-bold
                        "

                      >

                        Delete

                      </button>

                    </td>

                  </tr>
                ))}

              </tbody>

            </table>

          </div>
        )
      }

    </div>
  );
}
