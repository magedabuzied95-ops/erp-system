function Table({ className = "" }) {
  return (
    <table
      className={`theme-table ${className}`.trim()}
    >
      <thead>
        <tr>
          <th>ID</th>
          <th>Name</th>
        </tr>
      </thead>

      <tbody>
        <tr>
          <td>1</td>
          <td>Product</td>
        </tr>
      </tbody>
    </table>
  );
}

export default Table;
