import usePermission from "../hooks/usePermission";

export default function Can({ permission, permissions, mode = "any", fallback = null, children }) {
  const allowed = usePermission(permission || permissions || [], {
    anyOf: permissions,
    mode,
    allOf: mode === "all" ? permissions : undefined,
  });

  return allowed ? children : fallback;
}
