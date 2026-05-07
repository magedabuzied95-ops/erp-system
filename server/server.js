import express from "express";
import cors from "cors";

const app = express();

app.use(cors());
app.use(express.json());

app.get("/", (req, res) => {
  res.send("ERP Backend Running");
});

let products = [
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
];

app.get("/products", (req, res) => {
  res.json(products);
});

app.post("/products", (req, res) => {
  const newProduct = {
    id: products.length + 1,
    name: req.body.name,
    description: req.body.description,
  };

  products.push(newProduct);

  res.json(newProduct);
});

app.listen(5000, () => {
  console.log("Server running on port 5000");
});