import {
  useEffect,
  useState
} from "react";

import toast
from "react-hot-toast";

import { api }
from "../shared/api/api";

function CreateOrder() {

  /* =========================
     STATES
  ========================= */

  const [products, setProducts] =
    useState([]);

  const [selectedVariant,
    setSelectedVariant] =
    useState("");

  const [quantity,
    setQuantity] =
    useState(1);

  const [customerName,
    setCustomerName] =
    useState("");

  const [cart, setCart] =
    useState([]);

  const [loading,
    setLoading] =
    useState(false);

  /* =========================
     FETCH PRODUCTS
  ========================= */

  useEffect(() => {

    fetchProducts();

  }, []);

  const fetchProducts = async () => {

    try {

      const data =
        await api.get(
          "/products/with-variants"
        );

      const filtered =
        Array.isArray(data)

        ? data.filter(
            (item) =>
              item.variant_id &&
              Number(item.stock) > 0
          )

        : [];

      setProducts(filtered);

    } catch (error) {

      console.log(error);

      toast.error(
        "Failed to load products"
      );
    }
  };

  /* =========================
     ADD TO CART
  ========================= */

  const addToCart = () => {

    if (!selectedVariant) {

      toast.error(
        "Select product first"
      );

      return;
    }

    const product =
      products.find(

        (p) =>
          p.variant_id ==
          selectedVariant
      );

    if (!product) return;

    /* CHECK STOCK */

    if (
      Number(quantity) >
      Number(product.stock)
    ) {

      toast.error(
        "Not enough stock"
      );

      return;
    }

    /* EXISTING ITEM */

    const existing =
      cart.find(
        (item) =>
          item.variant_id ===
          product.variant_id
      );

    if (existing) {

      const updated =
        cart.map((item) =>

          item.variant_id ===
          product.variant_id

            ? {
                ...item,

                quantity:
                  item.quantity +
                  Number(quantity),
              }

            : item
        );

      setCart(updated);

      toast.success(
        "Cart updated"
      );

    } else {

      setCart([
        ...cart,
        {
          variant_id:
            product.variant_id,

          name:
            product.name,

          color:
            product.color,

          size:
            product.size,

          quantity:
            Number(quantity),

          stock:
            product.stock,

          price:
            Number(product.price),
        }
      ]);

      toast.success(
        "Added to cart"
      );
    }

    setSelectedVariant("");

    setQuantity(1);
  };

  /* =========================
     REMOVE ITEM
  ========================= */

  const removeItem = (
    variantId
  ) => {

    setCart(

      cart.filter(

        (item) =>
          item.variant_id !==
          variantId
      )
    );

    toast.success(
      "Removed from cart"
    );
  };

  /* =========================
     TOTAL
  ========================= */

  const totalPrice =
    cart.reduce(

      (acc, item) =>
        acc +
        item.price *
        item.quantity,

      0
    );

  /* =========================
     CREATE ORDER
  ========================= */

  const createOrder =
    async () => {

      try {

        if (
          cart.length === 0
        ) {

          toast.error(
            "Cart is empty"
          );

          return;
        }

        setLoading(true);

        const data =
          await api.post(

            "/orders",

            {
              customer_name:
                customerName ||
                "Walk-in Customer",

              customer_id:
                null,

              items: cart,

              status:
                "Pending",
            }
          );

        toast.success(
          data.message ||
          "Order Created"
        );

        setCart([]);

        setCustomerName("");

      } catch (error) {

        console.log(error);

        toast.error(
          "Failed to create order"
        );

      } finally {

        setLoading(false);
      }
    };

  /* =========================
     UI
  ========================= */

  return (

    <div className="space-y-8">

      {/* HEADER */}

      <div>

        <h1 className="m1-display text-gray-800 dark:text-white">

          Create Order 🛒

        </h1>

        <p className="text-gray-500 mt-3 text-lg">

          Enterprise order management

        </p>

      </div>

      {/* FORM */}

      <div className="bg-white dark:bg-gray-800 p-8 rounded-3xl shadow-xl space-y-6">

        <input
          type="text"

          placeholder="Customer Name"

          value={customerName}

          onChange={(e) =>
            setCustomerName(
              e.target.value
            )
          }

          className="w-full border p-5 rounded-[var(--radius-control)] dark:bg-gray-900 dark:text-white"
        />

        <select
          value={selectedVariant}

          onChange={(e) =>
            setSelectedVariant(
              e.target.value
            )
          }

          className="w-full border p-5 rounded-[var(--radius-control)] dark:bg-gray-900 dark:text-white"
        >

          <option value="">
            Select Product
          </option>

          {products.map(
            (product) => (

              <option
                key={product.variant_id}
                value={product.variant_id}
              >

                {product.name}
                {" - "}
                {product.color}
                {" - "}
                {product.size}
                {" | Stock: "}
                {product.stock}

              </option>
            )
          )}

        </select>

        <input
          type="number"
          min="1"

          value={quantity}

          onChange={(e) =>
            setQuantity(
              e.target.value
            )
          }

          className="w-full border p-5 rounded-[var(--radius-control)] dark:bg-gray-900 dark:text-white"
        />

        <button
          onClick={addToCart}

          className="bg-black text-white px-8 py-5 rounded-[var(--radius-control)] font-black w-full"
        >

          Add To Cart

        </button>

      </div>

      {/* CART */}

      <div className="bg-white dark:bg-gray-800 p-8 rounded-3xl shadow-xl">

        <h2 className="m1-section-title dark:text-white">

          Cart Items

        </h2>

        <div className="space-y-5 mt-6">

          {cart.length > 0

            ? cart.map((item) => (

                <div
                  key={item.variant_id}
                  className="flex justify-between bg-gray-50 dark:bg-gray-700 p-5 rounded-2xl"
                >

                  <div>

                    <h3 className="m1-section-title dark:text-white">

                      {item.name}

                    </h3>

                    <p className="text-gray-500">

                      {item.color}
                      {" / "}
                      {item.size}

                    </p>

                  </div>

                  <div className="flex gap-5 items-center">

                    <div className="font-black text-green-500">

                      $
                      {item.price *
                        item.quantity}

                    </div>

                    <div className="font-black">

                      x{item.quantity}

                    </div>

                    <button
                      onClick={() =>
                        removeItem(
                          item.variant_id
                        )
                      }

                      className="bg-red-500 text-white px-4 py-2 rounded-[var(--radius-control)]"
                    >

                      Remove

                    </button>

                  </div>

                </div>
              ))

            : (

              <p className="text-center text-gray-500 py-10">

                Cart Is Empty

              </p>
            )}

        </div>

        {/* TOTAL */}

        <div className="flex justify-between mt-10">

          <h2 className="m1-section-title dark:text-white">

            Total

          </h2>

          <h2 className="m1-section-title text-green-500">

            ${totalPrice.toFixed(2)}

          </h2>

        </div>

        {/* BUTTON */}

        <button
          onClick={createOrder}
          disabled={loading}
          className="mt-10 w-full bg-primary text-[var(--primary-contrast)] py-5 rounded-[var(--radius-control)] font-black text-xl"
        >

          {loading
            ? "Creating..."
            : "Create Order 🚀"}

        </button>

      </div>

    </div>
  );
}

export default CreateOrder;
