function Button({
  children,
  className = "",
  variant = "primary",
  type = "button",
  ...props
}) {
  const variantClass =
    variant === "soft"
      ? "theme-button-soft"
      : "theme-button-primary";

  return (
    <button
      type={type}
      className={`${variantClass} px-4 py-3 ${className}`.trim()}
      {...props}
    >
      {children}
    </button>
  );
}

export default Button;
