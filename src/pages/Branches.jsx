import { useState } from "react";

function Branches() {
  const [branches, setBranches] = useState([
    {
      id: 1,
      name: "Nasr City Branch",
      manager: "Ahmed Ali",
      city: "Cairo",
      employees: 12,
    },
    {
      id: 2,
      name: "Mansoura Branch",
      manager: "Mohamed Hassan",
      city: "Mansoura",
      employees: 8,
    },
  ]);

  const [name, setName] = useState("");
  const [manager, setManager] = useState("");
  const [city, setCity] = useState("");
  const [employees, setEmployees] = useState("");

  const addBranch = () => {
    if (!name || !manager || !city || !employees) return;

    const newBranch = {
      id: branches.length + 1,
      name,
      manager,
      city,
      employees,
    };

    setBranches([...branches, newBranch]);

    setName("");
    setManager("");
    setCity("");
    setEmployees("");
  };

  const deleteBranch = (id) => {
    setBranches(branches.filter((branch) => branch.id !== id));
  };

  return (
    <div
      style={{
        padding: "30px",
        background: "#f4f4f4",
        minHeight: "100vh",
      }}
    >
      <h1 style={{ marginBottom: "20px" }}>Branches</h1>

      {/* ADD BRANCH */}
      <div
        style={{
          background: "white",
          padding: "20px",
          borderRadius: "10px",
          marginBottom: "30px",
        }}
      >
        <h2>Add Branch</h2>

        <input
          type="text"
          placeholder="Branch Name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          style={{
            width: "100%",
            padding: "12px",
            marginBottom: "10px",
          }}
        />

        <input
          type="text"
          placeholder="Manager Name"
          value={manager}
          onChange={(e) => setManager(e.target.value)}
          style={{
            width: "100%",
            padding: "12px",
            marginBottom: "10px",
          }}
        />

        <input
          type="text"
          placeholder="City"
          value={city}
          onChange={(e) => setCity(e.target.value)}
          style={{
            width: "100%",
            padding: "12px",
            marginBottom: "10px",
          }}
        />

        <input
          type="number"
          placeholder="Employees Count"
          value={employees}
          onChange={(e) => setEmployees(e.target.value)}
          style={{
            width: "100%",
            padding: "12px",
            marginBottom: "10px",
          }}
        />

        <button
          onClick={addBranch}
          style={{
            background: "black",
            color: "white",
            border: "none",
            padding: "12px 20px",
            cursor: "pointer",
          }}
        >
          Add Branch
        </button>
      </div>

      {/* BRANCHES TABLE */}
      <div
        style={{
          background: "white",
          padding: "20px",
          borderRadius: "10px",
        }}
      >
        <h2>Branches List</h2>

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
              <th>Branch</th>
              <th>Manager</th>
              <th>City</th>
              <th>Employees</th>
              <th>Actions</th>
            </tr>
          </thead>

          <tbody>
            {branches.map((branch) => (
              <tr key={branch.id}>
                <td>{branch.id}</td>
                <td>{branch.name}</td>
                <td>{branch.manager}</td>
                <td>{branch.city}</td>
                <td>{branch.employees}</td>

                <td>
                  <button
                    onClick={() => deleteBranch(branch.id)}
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

export default Branches;