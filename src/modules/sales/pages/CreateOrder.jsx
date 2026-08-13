import {
  useEffect,
  useState
} from "react";

import { useTranslation } from "react-i18next";
import toast
from "react-hot-toast";

import { api }
from "../../../shared/api/api";
import { formatCurrency } from "../../../shared/lib/currency";

function CreateOrder() {
  const { t } = useTranslation();

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
        t("sales.createOrder.loadProductsFailed")
      );
    }
  };

  /* =========================
     ADD TO CART
  ========================= */

  const addToCart = () => {

    if (!selectedVariant) {

      toast.error(
        t("sales.createOrder.selectProductFirst")
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
        t("sales.createOrder.notEnoughStock")
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
        t("sales.createOrder.cartUpdated")
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
        t("sales.createOrder.addedToCart")
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
      t("sales.createOrder.removedFromCart")
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
            t("sales.createOrder.cartEmpty")
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
          t("sales.createOrder.orderCreated")
        );

        setCart([]);

        setCustomerName("");

      } catch (error) {

        console.log(error);

        toast.error(
          t("sales.createOrder.createFailed")
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

        <h1 className="m1-display text-[var(--text)]">

          Create Order 🛒

        </h1>

        <p className="text-[var(--muted)] mt-3 text-lg">

          Enterprise order management

        </p>

      </div>

      {/* FORM */}

      <div className="bg-[var(--card)] p-8 rounded-[var(--radius-card)] shadow-xl space-y-6">

        <input
          type="text"

          placeholder={t("sales.createOrder.customerNamePlaceholder")}

          value={customerName}

          onChange={(e) =>
            setCustomerName(
              e.target.value
            )
          }

          className="w-full border p-5 rounded-[var(--radius-control)]"
        />

        <select
          value={selectedVariant}

          onChange={(e) =>
            setSelectedVariant(
              e.target.value
            )
          }

          className="w-full border p-5 rounded-[var(--radius-control)]"
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

          className="w-full border p-5 rounded-[var(--radius-control)]"
        />

        <button
          onClick={addToCart}

          className="bg-[var(--primary)] text-[var(--primary-contrast)] px-8 py-5 rounded-[var(--radius-control)] font-black w-full"
        >

          Add To Cart

        </button>

      </div>

      {/* CART */}

      <div className="bg-[var(--card)] p-8 rounded-[var(--radius-card)] shadow-xl">

        <h2 className="m1-section-title">

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

                    <h3 className="m1-section-title">

                      {item.name}

                    </h3>

                    <p className="text-[var(--muted)]">

                      {item.color}
                      {" / "}
                      {item.size}

                    </p>

                  </div>

                  <div className="flex gap-5 items-center">

                    <div className="font-black text-green-500">

                      {formatCurrency(item.price * item.quantity)}

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

              <p className="text-center text-[var(--muted)] py-10">

                Cart Is Empty

              </p>
            )}

        </div>

        {/* TOTAL */}

        <div className="flex justify-between mt-10">

          <h2 className="m1-section-title">

            Total

          </h2>

          <h2 className="m1-section-title text-green-500">

            {formatCurrency(totalPrice)}

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
