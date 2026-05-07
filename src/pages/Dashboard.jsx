function Dashboard() {
  const stats = [
    {
      title: "Total Sales",
      value: "125,000 EGP",
    },
    {
      title: "Products",
      value: "320",
    },
    {
      title: "Branches",
      value: "4",
    },
    {
      title: "Warehouses",
      value: "4",
    },
  ];

  return (
    <div
      style={{
        padding: "30px",
        background: "#f4f4f4",
        minHeight: "100vh",
      }}
    >
      <h1
        style={{
          marginBottom: "30px",
        }}
      >
        ERP Dashboard
      </h1>

      <div
        style={{
          display: "grid",
          gridTemplateColumns:
            "repeat(4, 1fr)",
          gap: "20px",
        }}
      >
        {stats.map((item, index) => (
          <div
            key={index}
            style={{
              background: "white",
              padding: "25px",
              borderRadius: "12px",
              boxShadow:
                "0 2px 10px rgba(0,0,0,0.1)",
            }}
          >
            <h3
              style={{
                color: "#777",
                marginBottom: "10px",
              }}
            >
              {item.title}
            </h3>

            <h1>{item.value}</h1>
          </div>
        ))}
      </div>

      {/* Recent Activity */}

      <div
        style={{
          background: "white",
          marginTop: "30px",
          padding: "20px",
          borderRadius: "12px",
        }}
      >
        <h2
          style={{
            marginBottom: "20px",
          }}
        >
          Recent Sales
        </h2>

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
              <th>Invoice</th>
              <th>Customer</th>
              <th>Total</th>
              <th>Status</th>
            </tr>
          </thead>

          <tbody>
            <tr>
              <td>#INV-1001</td>
              <td>Ahmed Ali</td>
              <td>3500 EGP</td>
              <td>Paid</td>
            </tr>

            <tr>
              <td>#INV-1002</td>
              <td>Mohamed</td>
              <td>2200 EGP</td>
              <td>Pending</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default Dashboard;