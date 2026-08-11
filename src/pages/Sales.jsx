import {
  useMemo,
  useState
} from "react";

function Sales() {

  /* =========================
     STATES
  ========================= */

  const [sales, setSales] =
    useState([
      {
        id: 1,
        product: "Nike Air Max",
        quantity: 2,
        price: 3500,
        customer: "Ahmed Ali",
        status: "Paid",
      },
    ]);

  const [product, setProduct] =
    useState("");

  const [quantity, setQuantity] =
    useState("");

  const [price, setPrice] =
    useState("");

  const [customer, setCustomer] =
    useState("");

  const [search, setSearch] =
    useState("");

  /* =========================
     ADD SALE
  ========================= */

  const addSale = () => {

    if (
      !product ||
      !quantity ||
      !price ||
      !customer
    ) {

      return alert(
        "Fill all fields"
      );
    }

    const newSale = {

      id:
        sales.length + 1,

      product,

      quantity:
        Number(quantity),

      price:
        Number(price),

      customer,

      status: "Paid",
    };

    setSales([
      newSale,
      ...sales
    ]);

    /* RESET */

    setProduct("");

    setQuantity("");

    setPrice("");

    setCustomer("");
  };

  /* =========================
     DELETE
  ========================= */

  const deleteSale =
    (id) => {

      const confirmDelete =
        window.confirm(
          "Delete Invoice?"
        );

      if (!confirmDelete)
        return;

      setSales(

        sales.filter(

          (sale) =>

            sale.id !== id
        )
      );
    };

  /* =========================
     FILTER
  ========================= */

  const filteredSales =
    sales.filter((sale) => {

      const text =
        `
        ${sale.product}
        ${sale.customer}
        ${sale.status}
        `
          .toLowerCase();

      return text.includes(
        search.toLowerCase()
      );
    });

  /* =========================
     ANALYTICS
  ========================= */

  const totalSales =
    useMemo(() => {

      return sales.reduce(

        (total, sale) =>

          total +

          sale.quantity *
          sale.price,

        0
      );

    }, [sales]);

  const totalInvoices =
    sales.length;

  const totalProducts =
    sales.reduce(

      (acc, sale) =>

        acc +
        sale.quantity,

      0
    );

  /* =========================
     UI
  ========================= */

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
            Sales PRO 💰
          </h1>

          <p
            className="
            text-gray-500
            mt-3
            text-lg
            "
          >
            Enterprise sales & invoice management
          </p>

        </div>

        <div
          className="
          bg-gradient-to-r
          from-green-500
          to-emerald-600
          text-white
          px-8
          py-5
          rounded-3xl
          shadow-2xl
          font-black
          "
        >
          Smart Sales
        </div>

      </div>

      {/* KPI */}

      <div
        className="
        grid
        grid-cols-1
        md:grid-cols-3
        gap-6
        "
      >

        {/* TOTAL */}

        <div
          className="
          bg-white
          dark:bg-gray-800
          p-7
          rounded-3xl
          shadow-xl
          "
        >

          <p className="text-gray-500">
            Total Revenue
          </p>

          <h2
            className="
            text-5xl
            font-black
            mt-4
            text-green-500
            "
          >
            {totalSales}
            {" "}
            EGP
          </h2>

        </div>

        {/* INVOICES */}

        <div
          className="
          bg-white
          dark:bg-gray-800
          p-7
          rounded-3xl
          shadow-xl
          "
        >

          <p className="text-gray-500">
            Total Invoices
          </p>

          <h2
            className="
            text-5xl
            font-black
            mt-4
            text-primary
            "
          >
            {totalInvoices}
          </h2>

        </div>

        {/* PRODUCTS */}

        <div
          className="
          bg-gradient-to-r
          from-purple-500
          to-primary
          text-white
          p-7
          rounded-3xl
          shadow-2xl
          "
        >

          <p className="opacity-90">
            Sold Products
          </p>

          <h2
            className="
            text-5xl
            font-black
            mt-4
            "
          >
            {totalProducts}
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
        shadow-xl
        "
      >

        <input
          type="text"

          placeholder="Search invoices..."

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
          p-5
          rounded-2xl
          outline-none
          "
        />

      </div>

      {/* CREATE */}

      <div
        className="
        bg-white
        dark:bg-gray-800
        p-8
        rounded-3xl
        shadow-2xl
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
          Create Invoice
        </h2>

        <div
          className="
          grid
          md:grid-cols-2
          xl:grid-cols-4
          gap-5
          "
        >

          <input
            type="text"

            placeholder="Product"

            value={product}

            onChange={(e) =>
              setProduct(
                e.target.value
              )
            }

            className="
            border
            border-gray-200
            dark:border-gray-700
            dark:bg-gray-900
            dark:text-white
            p-4
            rounded-2xl
            "
          />

          <input
            type="text"

            placeholder="Customer"

            value={customer}

            onChange={(e) =>
              setCustomer(
                e.target.value
              )
            }

            className="
            border
            border-gray-200
            dark:border-gray-700
            dark:bg-gray-900
            dark:text-white
            p-4
            rounded-2xl
            "
          />

          <input
            type="number"

            placeholder="Quantity"

            value={quantity}

            onChange={(e) =>
              setQuantity(
                e.target.value
              )
            }

            className="
            border
            border-gray-200
            dark:border-gray-700
            dark:bg-gray-900
            dark:text-white
            p-4
            rounded-2xl
            "
          />

          <input
            type="number"

            placeholder="Price"

            value={price}

            onChange={(e) =>
              setPrice(
                e.target.value
              )
            }

            className="
            border
            border-gray-200
            dark:border-gray-700
            dark:bg-gray-900
            dark:text-white
            p-4
            rounded-2xl
            "
          />

        </div>

        <button
          onClick={addSale}

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
          Add Invoice
        </button>

      </div>

      {/* TABLE */}

      <div
        className="
        bg-white
        dark:bg-gray-800
        rounded-3xl
        shadow-2xl
        overflow-hidden
        "
      >

        <div className="overflow-x-auto">

          <table className="w-full">

            <thead
              className="
              bg-black
              text-white
              "
            >

              <tr>

                <th className="p-5 text-left">
                  Invoice
                </th>

                <th className="p-5 text-left">
                  Customer
                </th>

                <th className="p-5 text-left">
                  Quantity
                </th>

                <th className="p-5 text-left">
                  Price
                </th>

                <th className="p-5 text-left">
                  Total
                </th>

                <th className="p-5 text-left">
                  Status
                </th>

                <th className="p-5 text-left">
                  Actions
                </th>

              </tr>

            </thead>

            <tbody>

              {
                filteredSales.length > 0

                ? (

                  filteredSales.map(
                    (sale) => (

                      <tr
                        key={sale.id}

                        className="
                        border-b
                        border-gray-100
                        dark:border-gray-700
                        hover:bg-gray-50
                        dark:hover:bg-gray-700
                        transition
                        "
                      >

                        {/* PRODUCT */}

                        <td className="p-5">

                          <div className="table-cell-stack">

                            <h3
                              className="
                              font-black
                              text-lg
                              dark:text-white
                              "
                            >
                              {sale.product}
                            </h3>

                            <p
                              className="
                              text-gray-400
                              text-sm
                              mt-1
                              "
                            >
                              Invoice #
                              {sale.id}
                            </p>

                          </div>

                        </td>

                        {/* CUSTOMER */}

                        <td
                          className="
                          p-5
                          dark:text-white
                          "
                        >
                          {sale.customer}
                        </td>

                        {/* QTY */}

                        <td
                          className="
                          p-5
                          dark:text-white
                          "
                        >
                          {sale.quantity}
                        </td>

                        {/* PRICE */}

                        <td
                          className="
                          p-5
                          text-primary
                          font-black
                          "
                        >
                          {sale.price}
                          {" "}
                          EGP
                        </td>

                        {/* TOTAL */}

                        <td
                          className="
                          p-5
                          text-green-500
                          font-black
                          "
                        >
                          {
                            sale.quantity *
                            sale.price
                          }
                          {" "}
                          EGP
                        </td>

                        {/* STATUS */}

                        <td className="p-5">

                          <span
                            className="
                            bg-green-100
                            text-green-600
                            px-5
                            py-3
                            rounded-full
                            text-sm
                            font-black
                            "
                          >
                            {sale.status}
                          </span>

                        </td>

                        {/* DELETE */}

                        <td className="p-5">

                          <button
                            onClick={() =>
                              deleteSale(
                                sale.id
                              )
                            }

                            className="
                            bg-red-500
                            hover:bg-red-600
                            text-white
                            px-5
                            py-3
                            rounded-2xl
                            font-black
                            transition
                            "
                          >
                            Delete
                          </button>

                        </td>

                      </tr>

                    )
                  )

                ) : (

                  <tr>

                    <td
                      colSpan="7"

                      className="
                      text-center
                      p-14
                      text-gray-500
                      font-black
                      text-xl
                      "
                    >

                      No Sales Found

                    </td>

                  </tr>

                )
              }

            </tbody>

          </table>

        </div>

      </div>

    </div>
  );
}

export default Sales;
