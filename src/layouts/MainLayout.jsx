import Sidebar from "../components/Sidebar";
import Navbar from "../components/Navbar";

function MainLayout({
  children,
}) {
  return (
    <div
      style={{
        display: "flex",
      }}
    >
      <Sidebar />

      <div
        style={{
          flex: 1,
          background: "#f5f5f5",
          minHeight: "100vh",
        }}
      >
        <Navbar />

        <div
          style={{
            padding: "20px",
          }}
        >
          {children}
        </div>
      </div>
    </div>
  );
}

export default MainLayout;