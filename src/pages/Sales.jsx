import { useState } from "react";

function Sales() {
  const [sales, setSales] = useState([
    {
      id: 1,
      product: "Nike Air Max",
      quantity: 2,
      price: 3500,
    },
  ]);

  const [product, setProduct] = useState("");
  const [quantity, setQuantity] = useState("");
  const [price, setPrice] = useState("");

  const addSale = () => {
    if (!product || !quantity || !price) return;

    const newSale = {
      id: sales.length + 1,
      product,
      quantity,
      price,
    };

    setSales([...sales, newSale]);

    setProduct("");
    setQuantity("");
    setPrice("");
  };

  const deleteSale = (id) => {
    setSales(sales.filter((sale) => sale.id !== id));
  };

  const totalSales = sales.reduce(
    (total, sale) => total + sale.quantity * sale.price,
    0
  );

  return (
    <div
      style={{
        padding: "30px",
        background: "#f4f4f4",
        minHeight: "100vh",
      }}
    >
      <h1 style={{ marginBottom: "20px" }}>Sales</h1>

      {/* ADD SALE */}
      <div
        style={{
          background: "white",
          padding: "20px",
          borderRadius: "10px",
          marginBottom: "30px",
        }}
      >
        <h2>Create Invoice</h2>

        <input
          type="text"
          placeholder="Product"
          value={product}
          onChange={(e) => setProduct(e.target.value)}
          style={{
            width: "100%",
            padding: "12px",
            marginBottom: "10px",
          }}
        />

        <input
          type="number"
          placeholder="Quantity"
          value={quantity}
          onChange={(e) => setQuantity(e.target.value)}
          style={{
            width: "100%",
            padding: "12px",
            marginBottom: "10px",
          }}
        />

        <input
          type="number"
          placeholder="Price"
          value={price}
          onChange={(e) => setPrice(e.target.value)}
          style={{
            width: "100%",
            padding: "12px",
            marginBottom: "10px",
          }}
        />

        <button
          onClick={addSale}
          style={{
            background: "black",
            color: "white",
            border: "none",
            padding: "12px 20px",
            cursor: "pointer",
          }}
        >
          Add Sale
        </button>
      </div>

      {/* TOTAL */}
      <div
        style={{
          background: "white",
          padding: "20px",
          borderRadius: "10px",
          marginBottom: "30px",
        }}
      >
        <h2>Total Sales</h2>

        <h1>{totalSales} EGP</h1>
      </div>

      {/* SALES TABLE */}
      <div
        style={{
          background: "white",
          padding: "20px",
          borderRadius: "10px",
        }}
      >
        <h2>Invoices</h2>

        <table
          width="100%"
          border="1"
          cellPadding="10"
          style={{
            borderCollapse: "collapse",
            marginTop: "20px",
          }}
        >
          <thead>
            <tr>
              <th>ID</th>
              <th>Product</th>
              <th>Quantity</th>
              <th>Price</th>
              <th>Total</th>
              <th>Actions</th>
            </tr>
          </thead>

          <tbody>
            {sales.map((sale) => (
              <tr key={sale.id}>
                <td>{sale.id}</td>
                <td>{sale.product}</td>
                <td>{sale.quantity}</td>
                <td>{sale.price} EGP</td>
                <td>{sale.quantity * sale.price} EGP</td>

                <td>
                  <button
                    onClick={() => deleteSale(sale.id)}
                    style={{
                      background: "red",
                      color: "white",
                      border: "none",
                      padding: "8px 12px",
                      cursor: "pointer",
                    }}
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default Sales;