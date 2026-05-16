import {
  useEffect,
  useState
} from "react";

import { api }
from "../../../shared/api/api";

import ProductColors
from "../components/ProductColors";

import {
  createVariant,
  normalizeVariantPayload,
} from "../services/productsApi";

function Products() {

  /* ======================================================
     STATES
  ====================================================== */

  const [products, setProducts] =
    useState([]);

  const [variants, setVariants] =
    useState([]);

  const [loading, setLoading] =
    useState(true);

  /* PRODUCT */

  const [name, setName] =
    useState("");

  const [description,
    setDescription] =
    useState("");

  /* COLORS */

  const [colors,
    setColors] =
    useState([]);

  /* VARIANT */

  const [variantProduct,
    setVariantProduct] =
    useState("");

  const [variantSku,
    setVariantSku] =
    useState("");

  const [variantQuantity,
    setVariantQuantity] =
    useState("");

  const [variantPrice,
    setVariantPrice] =
    useState("");

  /* SEARCH */

  const [search, setSearch] =
    useState("");

  /* EDIT */

  const [editingVariant,
    setEditingVariant] =
    useState(null);

  const [editColor,
    setEditColor] =
    useState("");

  const [editSize,
    setEditSize] =
    useState("");

  const [editStock,
    setEditStock] =
    useState("");

  const [editPrice,
    setEditPrice] =
    useState("");

  const [editSku,
    setEditSku] =
    useState("");

  /* ======================================================
     FETCH DATA
  ====================================================== */

  useEffect(() => {

    fetchData();

  }, []);

  const fetchData =
    async () => {

      try {

        setLoading(true);

        const [
          productsData,
          variantsData
        ] = await Promise.all([

          api.get("/products"),

          api.get(
            "/products/with-variants"
          )
        ]);

        setProducts(

          Array.isArray(
            productsData
          )

          ? productsData

          : []
        );

        setVariants(

          Array.isArray(
            variantsData
          )

          ? variantsData.filter(
              (item) =>
                item.variant_id
            )

          : []
        );

      } catch (error) {

        console.log(error);

      } finally {

        setLoading(false);
      }
    };

  /* ======================================================
     ADD PRODUCT
  ====================================================== */

  const handleAddProduct =
    async () => {

      if (
        !name ||
        !description
      ) {

        return alert(
          "Fill all fields"
        );
      }

      try {

        await api.post(
          "/products",
          {
            name,
            description
          }
        );

        setName("");

        setDescription("");

        fetchData();

      } catch (error) {

        console.log(error);
      }
    };

  /* ======================================================
     DELETE VARIANT
  ====================================================== */

  const handleDeleteVariant =
    async (variantId) => {

      const confirmDelete =
        window.confirm(
          "Delete Variant?"
        );

      if (!confirmDelete)
        return;

      try {

        await api.delete(
          `/products/variants/${variantId}`
        );

        fetchData();

      } catch (error) {

        console.log(error);
      }
    };

  /* ======================================================
     OPEN EDIT
  ====================================================== */

  const handleOpenEdit =
    (variant) => {

      setEditingVariant(
        variant.id
      );

      setEditColor(
        variant.color || ""
      );

      setEditSize(
        variant.size || ""
      );

      setEditStock(
        variant.stock || ""
      );

      setEditPrice(
        variant.price || ""
      );

      setEditSku(
        variant.sku || ""
      );
    };

  /* ======================================================
     UPDATE VARIANT
  ====================================================== */

  const handleUpdateVariant =
    async () => {

      try {

        await api.put(

          `/products/variants/${editingVariant}`,

          {
            color: editColor,
            size: editSize,
            stock: editStock,
            price: editPrice,
            sku: editSku,
          }
        );

        setEditingVariant(null);

        fetchData();

      } catch (error) {

        console.log(error);
      }
    };

  /* ======================================================
     CREATE VARIANTS
  ====================================================== */

  const handleAddVariant =
    async () => {

      if (

        !variantProduct ||

        !variantSku ||

        !variantQuantity ||

        !variantPrice

      ) {

        return alert(
          "Fill all fields"
        );
      }

      try {

        /* CREATE FROM COLORS */

        const variantErrors = [];

        for (const color of colors) {

          for (
            const size of color.sizes
          ) {

            try {
              await createVariant(
                variantProduct,
                normalizeVariantPayload({
                  color: color.name,
                  size,
                  stock: variantQuantity,
                  price: variantPrice,
                  sku: `${variantSku}-${color.name}-${size}`,
                  image_url: color.images?.[0]?.preview || "",
                })
              );
            } catch (error) {
              variantErrors.push(error?.message || "Variant creation failed");
            }
          }
        }

        /* RESET */

        setVariantProduct("");

        setVariantSku("");

        setVariantQuantity("");

        setVariantPrice("");

        setColors([]);

        fetchData();

        if (variantErrors.length > 0) {
          alert(
            `${variantErrors.length} variant(s) failed. The remaining variants were saved.\n\n${variantErrors[0]}`
          );
        } else {
          alert(
            "Variants created successfully"
          );
        }

      } catch (error) {

        console.log(error);

        alert(
          "Error creating variants"
        );
      }
    };

  /* ======================================================
     ANALYTICS
  ====================================================== */

  const totalProducts =
    products.length;

  const totalVariants =
    variants.length;

  const lowStock =
    variants.filter(
      (variant) =>
        Number(
          variant.stock
        ) <= 5
    ).length;

  const inStock =
    variants.filter(
      (variant) =>
        Number(
          variant.stock
        ) > 5
    ).length;

  /* ======================================================
     LOADING
  ====================================================== */

  if (loading) {

    return (

      <div
        className="
        flex
        items-center
        justify-center
        h-[70vh]
        "
      >

        <div
          className="
          text-4xl
          font-black
          text-green-500
          animate-pulse
          "
        >
          Loading Products...
        </div>

      </div>
    );
  }

  return (

    <div className="space-y-8">

      {/* HEADER */}

      <div
        className="
        flex
        items-center
        justify-between
        flex-wrap
        gap-5
        "
      >

        <div>

          <h1
            className="
            text-5xl
            font-black
            text-gray-800
            dark:text-white
            "
          >
            Products PRO 👟
          </h1>

          <p
            className="
            text-gray-500
            mt-3
            text-lg
            "
          >
            Enterprise product & variants management
          </p>

        </div>

      </div>

      {/* KPI */}

      <div
        className="
        grid
        grid-cols-1
        md:grid-cols-2
        xl:grid-cols-4
        gap-6
        "
      >

        <KPI
          title="Products"
          value={totalProducts}
        />

        <KPI
          title="Variants"
          value={totalVariants}
          color="text-blue-500"
        />

        <KPI
          title="Low Stock"
          value={lowStock}
          color="text-red-500"
        />

        <div
          className="
          bg-gradient-to-r
          from-green-500
          to-emerald-600
          text-white
          p-7
          rounded-3xl
          shadow-2xl
          "
        >

          <p className="opacity-90">
            In Stock
          </p>

          <h2
            className="
            text-5xl
            font-black
            mt-4
            "
          >
            {inStock}
          </h2>

        </div>

      </div>

      {/* SEARCH */}

      <div
        className="
        bg-white
        dark:bg-gray-800
        p-6
        rounded-3xl
        shadow-lg
        "
      >

        <input
          type="text"

          placeholder="Search by product / sku / color / size"

          value={search}

          onChange={(e) =>
            setSearch(
              e.target.value
            )
          }

          className="
          w-full
          border
          border-gray-200
          dark:border-gray-700
          dark:bg-gray-900
          dark:text-white
          rounded-2xl
          p-5
          outline-none
          "
        />

      </div>

      {/* CREATE PRODUCT */}

      <div
        className="
        bg-white
        dark:bg-gray-800
        p-8
        rounded-3xl
        shadow-xl
        "
      >

        <h2
          className="
          text-3xl
          font-black
          mb-6
          dark:text-white
          "
        >
          Create Product
        </h2>

        <div
          className="
          grid
          md:grid-cols-2
          gap-5
          "
        >

          <input
            type="text"

            placeholder="Product Name"

            value={name}

            onChange={(e) =>
              setName(
                e.target.value
              )
            }

            className="
            border
            border-gray-200
            dark:border-gray-700
            dark:bg-gray-900
            dark:text-white
            rounded-2xl
            p-4
            "
          />

          <input
            type="text"

            placeholder="Description"

            value={description}

            onChange={(e) =>
              setDescription(
                e.target.value
              )
            }

            className="
            border
            border-gray-200
            dark:border-gray-700
            dark:bg-gray-900
            dark:text-white
            rounded-2xl
            p-4
            "
          />

        </div>

        <button
          onClick={handleAddProduct}

          className="
          mt-6
          bg-black
          hover:bg-gray-800
          text-white
          px-8
          py-4
          rounded-2xl
          font-black
          transition
          "
        >
          Add Product
        </button>

      </div>

      {/* CREATE VARIANT */}

      <div
        className="
        bg-white
        dark:bg-gray-800
        p-8
        rounded-3xl
        shadow-xl
        "
      >

        <h2
          className="
          text-3xl
          font-black
          mb-6
          dark:text-white
          "
        >
          Create Variant
        </h2>

        {/* PRODUCT COLORS */}

        <ProductColors

          colors={colors}

          setColors={setColors}

        />

        {/* FORM */}

        <div
          className="
          grid
          md:grid-cols-2
          xl:grid-cols-4
          gap-5
          mt-8
          "
        >

          <select
            value={variantProduct}

            onChange={(e) =>
              setVariantProduct(
                e.target.value
              )
            }

            className="
            border
            border-gray-200
            dark:border-gray-700
            dark:bg-gray-900
            dark:text-white
            rounded-2xl
            p-4
            "
          >

            <option value="">
              Select Product
            </option>

            {products.map(
              (product) => (

                <option
                  key={product.id}
                  value={product.id}
                >
                  {product.name}
                </option>
              )
            )}

          </select>

          <input
            type="text"

            placeholder="SKU PREFIX"

            value={variantSku}

            onChange={(e) =>
              setVariantSku(
                e.target.value
              )
            }

            className="
            border
            border-gray-200
            dark:border-gray-700
            dark:bg-gray-900
            dark:text-white
            rounded-2xl
            p-4
            "
          />

          <input
            type="number"

            placeholder="Stock"

            value={variantQuantity}

            onChange={(e) =>
              setVariantQuantity(
                e.target.value
              )
            }

            className="
            border
            border-gray-200
            dark:border-gray-700
            dark:bg-gray-900
            dark:text-white
            rounded-2xl
            p-4
            "
          />

          <input
            type="number"

            placeholder="Price"

            value={variantPrice}

            onChange={(e) =>
              setVariantPrice(
                e.target.value
              )
            }

            className="
            border
            border-gray-200
            dark:border-gray-700
            dark:bg-gray-900
            dark:text-white
            rounded-2xl
            p-4
            "
          />

        </div>

        <button
          onClick={handleAddVariant}

          className="
          mt-6
          bg-green-500
          hover:bg-green-600
          text-white
          px-8
          py-4
          rounded-2xl
          font-black
          transition
          "
        >
          Create Variants
        </button>

      </div>

    </div>
  );
}

/* ======================================================
   KPI CARD
====================================================== */

function KPI({

  title,
  value,
  color = ""

}) {

  return (

    <div
      className="
      bg-white
      dark:bg-gray-800
      p-7
      rounded-3xl
      shadow-lg
      "
    >

      <p className="text-gray-500">
        {title}
      </p>

      <h2
        className={`
        text-5xl
        font-black
        mt-4
        dark:text-white
        ${color}
        `}
      >
        {value}
      </h2>

    </div>
  );
}

export default Products;
