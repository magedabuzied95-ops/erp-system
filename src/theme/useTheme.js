import { useContext } from "react";

import { ThemeContext } from "./themeContext";

export const useTheme = () => {
  const value = useContext(ThemeContext);
  if (!value) {
    throw new Error("useTheme must be used within ThemeProvider");
  }
  return value;
};
