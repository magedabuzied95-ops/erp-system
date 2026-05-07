import { Link } from "react-router-dom";

function Sidebar() {
  return (
    <div
      style={{
        width: "250px",
        height: "100vh",
        background: "#111827",
        color: "white",
        padding: "20px",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <h2
        style={{
          marginBottom: "30px",
        }}
      >
        ERP System
      </h2>

      <Link to="/" style={linkStyle}>
        Dashboard
      </Link>

      <Link
        to="/products"
        style={linkStyle}
      >
        Products
      </Link>

      <Link
        to="/inventory"
        style={linkStyle}
      >
        Inventory
      </Link>

      <Link to="/sales" style={linkStyle}>
        Sales
      </Link>

      <Link to="/pos" style={linkStyle}>
        POS
      </Link>

      <Link
        to="/branches"
        style={linkStyle}
      >
        Branches
      </Link>

      <Link
        to="/warehouses"
        style={linkStyle}
      >
        Warehouses
      </Link>

      <button
        onClick={() => {
          localStorage.removeItem(
            "token"
          );

          window.location.reload();
        }}
        style={{
          marginTop: "30px",
          padding: "12px",
          background: "red",
          color: "white",
          border: "none",
          cursor: "pointer",
        }}
      >
        Logout
      </button>
    </div>
  );
}

const linkStyle = {
  color: "white",
  textDecoration: "none",
  marginBottom: "15px",
};

export default Sidebar;