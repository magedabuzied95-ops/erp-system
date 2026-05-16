function Input({ className = "", ...props }) {
  return (
    <input
      {...props}
      className={`theme-input ${className}`.trim()}
    />
  );
}

export default Input;
