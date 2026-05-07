import { useState } from "react";

function Products() {
  const [products, setProducts] = useState([
    {
      id: 1,
      name: "Nike Air Max",
      description: "Running Shoes",
    },
    {
      id: 2,
      name: "Adidas Samba",
      description: "Classic Shoes",
    },
  ]);

  const [variants, setVariants] = useState([
    {
      id: 1,
      product: "Nike Air Max",
      size: 42,
      color: "Black",
      sku: "NK-42-BLK",
      quantity: 5,
    },
    {
      id: 2,
      product: "Adidas Samba",
      size: 43,
      color: "White",
      sku: "AD-43-WHT",
      quantity: 3,
    },
  ]);

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");

  const [variantProduct, setVariantProduct] = useState("");
  const [variantSize, setVariantSize] = useState("");
  const [variantColor, setVariantColor] = useState("");
  const [variantSku, setVariantSku] = useState("");
  const [variantQuantity, setVariantQuantity] = useState("");

  const handleAddProduct = () => {
    if (!name || !description) return;

    const newProduct = {
      id: products.length + 1,
      name,
      description,
    };

    setProducts([...products, newProduct]);

    setName("");
    setDescription("");
  };

  const handleDeleteProduct = (id) => {
    const filtered = products.filter((product) => product.id !== id);
    setProducts(filtered);
  };

  const handleAddVariant = () => {
    if (
      !variantProduct ||
      !variantSize ||
      !variantColor ||
      !variantSku ||
      !variantQuantity
    )
      return;

    const newVariant = {
      id: variants.length + 1,
      product: variantProduct,
      size: variantSize,
      color: variantColor,
      sku: variantSku,
      quantity: variantQuantity,
    };

    setVariants([...variants, newVariant]);

    setVariantProduct("");
    setVariantSize("");
    setVariantColor("");
    setVariantSku("");
    setVariantQuantity("");
  };

  const handleDeleteVariant = (id) => {
    const filtered = variants.filter((variant) => variant.id !== id);
    setVariants(filtered);
  };

  return (
    <div
      style={{
        padding: "30px",
        background: "#f4f4f4",
        minHeight: "100vh",
      }}
    >
      <h1 style={{ marginBottom: "20px" }}>Products</h1>

      {/* ADD PRODUCT */}
      <div
        style={{
          background: "white",
          padding: "20px",
          borderRadius: "10px",
          marginBottom: "30px",
        }}
      >
        <h2>Add Product</h2>

        <input
          type="text"
          placeholder="Product Name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          style={{
            width: "100%",
            padding: "12px",
            marginTop: "10px",
            marginBottom: "10px",
          }}
        />

        <input
          type="text"
          placeholder="Description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          style={{
            width: "100%",
            padding: "12px",
            marginBottom: "10px",
          }}
        />

        <button
          onClick={handleAddProduct}
          style={{
            background: "black",
            color: "white",
            border: "none",
            padding: "12px 20px",
            cursor: "pointer",
          }}
        >
          Add Product
        </button>
      </div>

      {/* PRODUCTS TABLE */}
      <div
        style={{
          background: "white",
          padding: "20px",
          borderRadius: "10px",
          marginBottom: "30px",
        }}
      >
        <h2>Products List</h2>

        <table
          border="1"
          width="100%"
          cellPadding="10"
          style={{
            borderCollapse: "collapse",
            marginTop: "20px",
          }}
        >
          <thead>
            <tr>
              <th>ID</th>
              <th>Product Name</th>
              <th>Description</th>
              <th>Actions</th>
            </tr>
          </thead>

          <tbody>
            {products.map((product) => (
              <tr key={product.id}>
                <td>{product.id}</td>
                <td>{product.name}</td>
                <td>{product.description}</td>

                <td>
                  <button
                    onClick={() => handleDeleteProduct(product.id)}
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

      {/* ADD VARIANT */}
      <div
        style={{
          background: "white",
          padding: "20px",
          borderRadius: "10px",
          marginBottom: "30px",
        }}
      >
        <h2>Add Variant</h2>

        <input
          type="text"
          placeholder="Product"
          value={variantProduct}
          onChange={(e) => setVariantProduct(e.target.value)}
          style={{
            width: "100%",
            padding: "12px",
            marginTop: "10px",
            marginBottom: "10px",
          }}
        />

        <input
          type="number"
          placeholder="Size"
          value={variantSize}
          onChange={(e) => setVariantSize(e.target.value)}
          style={{
            width: "100%",
            padding: "12px",
            marginBottom: "10px",
          }}
        />

        <input
          type="text"
          placeholder="Color"
          value={variantColor}
          onChange={(e) => setVariantColor(e.target.value)}
          style={{
            width: "100%",
            padding: "12px",
            marginBottom: "10px",
          }}
        />

        <input
          type="text"
          placeholder="SKU"
          value={variantSku}
          onChange={(e) => setVariantSku(e.target.value)}
          style={{
            width: "100%",
            padding: "12px",
            marginBottom: "10px",
          }}
        />

        <input
          type="number"
          placeholder="Quantity"
          value={variantQuantity}
          onChange={(e) => setVariantQuantity(e.target.value)}
          style={{
            width: "100%",
            padding: "12px",
            marginBottom: "10px",
          }}
        />

        <button
          onClick={handleAddVariant}
          style={{
            background: "black",
            color: "white",
            border: "none",
            padding: "12px 20px",
            cursor: "pointer",
          }}
        >
          Add Variant
        </button>
      </div>

      {/* VARIANTS TABLE */}
      <div
        style={{
          background: "white",
          padding: "20px",
          borderRadius: "10px",
        }}
      >
        <h2>Product Variants</h2>

        <table
          border="1"
          width="100%"
          cellPadding="10"
          style={{
            borderCollapse: "collapse",
            marginTop: "20px",
          }}
        >
          <thead>
            <tr>
              <th>Product</th>
              <th>Size</th>
              <th>Color</th>
              <th>SKU</th>
              <th>Quantity</th>
              <th>Actions</th>
            </tr>
          </thead>

          <tbody>
            {variants.map((variant) => (
              <tr key={variant.id}>
                <td>{variant.product}</td>
                <td>{variant.size}</td>
                <td>{variant.color}</td>
                <td>{variant.sku}</td>
                <td>{variant.quantity}</td>

                <td>
                  <button
                    onClick={() => handleDeleteVariant(variant.id)}
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

export default Products;