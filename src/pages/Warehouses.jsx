import { useState } from "react";

function Warehouses() {
  const [warehouses, setWarehouses] = useState([
    {
      id: 1,
      name: "Main Warehouse",
      branch: "Nasr City",
      capacity: 500,
    },
    {
      id: 2,
      name: "Mansoura Warehouse",
      branch: "Mansoura",
      capacity: 300,
    },
  ]);

  const [name, setName] = useState("");
  const [branch, setBranch] = useState("");
  const [capacity, setCapacity] = useState("");

  const addWarehouse = () => {
    if (!name || !branch || !capacity) return;

    const newWarehouse = {
      id: warehouses.length + 1,
      name,
      branch,
      capacity,
    };

    setWarehouses([...warehouses, newWarehouse]);

    setName("");
    setBranch("");
    setCapacity("");
  };

  const deleteWarehouse = (id) => {
    setWarehouses(
      warehouses.filter(
        (warehouse) => warehouse.id !== id
      )
    );
  };

  return (
    <div
      style={{
        padding: "30px",
        background: "#f4f4f4",
        minHeight: "100vh",
      }}
    >
      <h1 style={{ marginBottom: "20px" }}>
        Warehouses
      </h1>

      {/* ADD WAREHOUSE */}
      <div
        style={{
          background: "white",
          padding: "20px",
          borderRadius: "10px",
          marginBottom: "30px",
        }}
      >
        <h2>Add Warehouse</h2>

        <input
          type="text"
          placeholder="Warehouse Name"
          value={name}
          onChange={(e) =>
            setName(e.target.value)
          }
          style={inputStyle}
        />

        <input
          type="text"
          placeholder="Branch"
          value={branch}
          onChange={(e) =>
            setBranch(e.target.value)
          }
          style={inputStyle}
        />

        <input
          type="number"
          placeholder="Capacity"
          value={capacity}
          onChange={(e) =>
            setCapacity(e.target.value)
          }
          style={inputStyle}
        />

        <button
          onClick={addWarehouse}
          style={buttonStyle}
        >
          Add Warehouse
        </button>
      </div>

      {/* TABLE */}
      <div
        style={{
          background: "white",
          padding: "20px",
          borderRadius: "10px",
        }}
      >
        <h2>Warehouses List</h2>

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
              <th>Name</th>
              <th>Branch</th>
              <th>Capacity</th>
              <th>Actions</th>
            </tr>
          </thead>

          <tbody>
            {warehouses.map((warehouse) => (
              <tr key={warehouse.id}>
                <td>{warehouse.id}</td>

                <td>{warehouse.name}</td>

                <td>{warehouse.branch}</td>

                <td>
                  {warehouse.capacity}
                </td>

                <td>
                  <button
                    onClick={() =>
                      deleteWarehouse(
                        warehouse.id
                      )
                    }
                    style={{
                      background: "red",
                      color: "white",
                      border: "none",
                      padding:
                        "8px 12px",
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

const inputStyle = {
  width: "100%",
  padding: "12px",
  marginBottom: "10px",
};

const buttonStyle = {
  background: "black",
  color: "white",
  border: "none",
  padding: "12px 20px",
  cursor: "pointer",
};

export default Warehouses;