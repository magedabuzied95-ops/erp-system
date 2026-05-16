export const APP_NAME = "ERP System";

export const API_BASE_URL =
  import.meta.env.VITE_API_URL ||
  import.meta.env.VITE_API_BASE_URL ||
  (import.meta.env.DEV ? "/api" : "http://localhost:8000/api");

export const SOCKET_URL =
  import.meta.env.VITE_SOCKET_URL ||
  window.location.origin;
