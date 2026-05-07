import { useState } from "react";

function POS() {
  const [products] = useState([
    {
      id: 1,
      name: "Nike Air Max",
      price: 2500,
    },

    {
      id: 2,
      name: "Adidas Samba",
      price: 2200,
    },

    {
      id: 3,
      name: "New Balance",
      price: 2100,
    },
  ]);

  const [cart, setCart] = useState([]);

  const addToCart = (product) => {
    const existing = cart.find(
      (item) => item.id === product.id
    );

    if (existing) {
      const updatedCart = cart.map(
        (item) =>
          item.id === product.id
            ? {
                ...item,
                quantity:
                  item.quantity + 1,
              }
            : item
      );

      setCart(updatedCart);
    } else {
      setCart([
        ...cart,
        {
          ...product,
          quantity: 1,
        },
      ]);
    }
  };

  const removeFromCart = (id) => {
    const updated = cart.filter(
      (item) => item.id !== id
    );

    setCart(updated);
  };

  const total = cart.reduce(
    (acc, item) =>
      acc +
      item.price * item.quantity,
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
      <h1 style={{ marginBottom: "20px" }}>
        POS System
      </h1>

      <div
        style={{
          display: "grid",
          gridTemplateColumns:
            "1fr 1fr",
          gap: "20px",
        }}
      >
        {/* PRODUCTS */}

        <div
          style={{
            background: "white",
            padding: "20px",
            borderRadius: "10px",
          }}
        >
          <h2>Products</h2>

          {products.map((product) => (
            <div
              key={product.id}
              style={{
                border:
                  "1px solid #ddd",
                padding: "15px",
                marginTop: "15px",
                borderRadius: "10px",
              }}
            >
              <h3>{product.name}</h3>

              <p>
                {product.price} EGP
              </p>

              <button
                onClick={() =>
                  addToCart(product)
                }
                style={{
                  background:
                    "black",
                  color: "white",
                  border: "none",
                  padding:
                    "10px 15px",
                  cursor: "pointer",
                }}
              >
                Add To Cart
              </button>
            </div>
          ))}
        </div>

        {/* CART */}

        <div
          style={{
            background: "white",
            padding: "20px",
            borderRadius: "10px",
          }}
        >
          <h2>Cart</h2>

          {cart.length === 0 && (
            <p>
              No products added.
            </p>
          )}

          {cart.map((item) => (
            <div
              key={item.id}
              style={{
                borderBottom:
                  "1px solid #ddd",
                padding:
                  "10px 0",
              }}
            >
              <h3>{item.name}</h3>

              <p>
                Qty:
                {item.quantity}
              </p>

              <p>
                Price:
                {item.price} EGP
              </p>

              <button
                onClick={() =>
                  removeFromCart(
                    item.id
                  )
                }
                style={{
                  background:
                    "red",
                  color: "white",
                  border: "none",
                  padding:
                    "8px 12px",
                  cursor: "pointer",
                }}
              >
                Remove
              </button>
            </div>
          ))}

          <h2
            style={{
              marginTop: "20px",
            }}
          >
            Total: {total} EGP
          </h2>

          <button
            style={{
              width: "100%",
              padding: "15px",
              marginTop: "20px",
              background: "green",
              color: "white",
              border: "none",
              cursor: "pointer",
              fontSize: "18px",
            }}
          >
            Checkout
          </button>
        </div>
      </div>
    </div>
  );
}

export default POS;