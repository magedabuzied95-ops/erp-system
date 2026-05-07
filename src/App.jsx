import {
  Routes,
  Route,
  Navigate,
} from "react-router-dom";

import Dashboard from "./pages/Dashboard";
import Products from "./pages/Products";
import Inventory from "./pages/Inventory";
import Sales from "./pages/Sales";
import POS from "./pages/POS";
import Branches from "./pages/Branches";
import Warehouses from "./pages/Warehouses";
import Login from "./pages/Login";

function App() {
  const token =
    localStorage.getItem("token");

  if (!token) {
    return <Login />;
  }

  return (
    <Routes>
      <Route
        path="/"
        element={<Dashboard />}
      />

      <Route
        path="/products"
        element={<Products />}
      />

      <Route
        path="/inventory"
        element={<Inventory />}
      />

      <Route
        path="/sales"
        element={<Sales />}
      />

      <Route
        path="/pos"
        element={<POS />}
      />

      <Route
        path="/branches"
        element={<Branches />}
      />

      <Route
        path="/warehouses"
        element={<Warehouses />}
      />

      <Route
        path="*"
        element={
          <Navigate to="/" />
        }
      />
    </Routes>
  );
}

export default App;