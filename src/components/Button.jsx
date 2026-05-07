function Button({
  children,
}) {
  return (
    <button
      style={{
        padding: "10px 20px",
        background: "black",
        color: "white",
        border: "none",
      }}
    >
      {children}
    </button>
  );
}

export default Button;