import { useState } from "react";

function Inventory() {
  const [inventory, setInventory] = useState([
    {
      id: 1,
      product: "Nike Air Max",
      size: 42,
      color: "Black",
      quantity: 5,
    },
    {
      id: 2,
      product: "Adidas Samba",
      size: 43,
      color: "White",
      quantity: 2,
    },
    {
      id: 3,
      product: "New Balance",
      size: 41,
      color: "Gray",
      quantity: 10,
    },
  ]);

  const [search, setSearch] = useState("");

  const increaseQty = (id) => {
    setInventory(
      inventory.map((item) =>
        item.id === id
          ? { ...item, quantity: item.quantity + 1 }
          : item
      )
    );
  };

  const decreaseQty = (id) => {
    setInventory(
      inventory.map((item) =>
        item.id === id && item.quantity > 0
          ? { ...item, quantity: item.quantity - 1 }
          : item
      )
    );
  };

  const filteredInventory = inventory.filter((item) =>
    item.product.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div
      style={{
        padding: "30px",
        background: "#f4f4f4",
        minHeight: "100vh",
      }}
    >
      <h1 style={{ marginBottom: "20px" }}>Inventory</h1>

      <div
        style={{
          background: "white",
          padding: "20px",
          borderRadius: "10px",
          marginBottom: "20px",
        }}
      >
        <input
          type="text"
          placeholder="Search Product..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{
            width: "100%",
            padding: "12px",
          }}
        />
      </div>

      <div
        style={{
          background: "white",
          padding: "20px",
          borderRadius: "10px",
        }}
      >
        <table
          width="100%"
          border="1"
          cellPadding="10"
          style={{
            borderCollapse: "collapse",
          }}
        >
          <thead>
            <tr>
              <th>ID</th>
              <th>Product</th>
              <th>Size</th>
              <th>Color</th>
              <th>Quantity</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>

          <tbody>
            {filteredInventory.map((item) => (
              <tr key={item.id}>
                <td>{item.id}</td>
                <td>{item.product}</td>
                <td>{item.size}</td>
                <td>{item.color}</td>
                <td>{item.quantity}</td>

                <td>
                  {item.quantity <= 3 ? (
                    <span style={{ color: "red", fontWeight: "bold" }}>
                      Low Stock
                    </span>
                  ) : (
                    <span style={{ color: "green", fontWeight: "bold" }}>
                      In Stock
                    </span>
                  )}
                </td>

                <td>
                  <button
                    onClick={() => increaseQty(item.id)}
                    style={{
                      background: "green",
                      color: "white",
                      border: "none",
                      padding: "6px 10px",
                      marginRight: "5px",
                      cursor: "pointer",
                    }}
                  >
                    +
                  </button>

                  <button
                    onClick={() => decreaseQty(item.id)}
                    style={{
                      background: "red",
                      color: "white",
                      border: "none",
                      padding: "6px 10px",
                      cursor: "pointer",
                    }}
                  >
                    -
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

export default Inventory;