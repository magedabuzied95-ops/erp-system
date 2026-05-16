import {
  Navigate
}
from "react-router-dom";

import { getToken }
from "./authStorage";
import {
  hasAnyPermission,
  hasPermission,
} from "../../modules/permissions/lib/rbacStore";
import { isAdminUser } from "./authStorage";

export default function ProtectedRoute({
  children,
  requiredPermissions = [],
  anyOf = true,
  redirectTo = "/login",
  adminOnly = false,
}) {

  const token =
    getToken();

  if (!token) {

    return (
      <Navigate
        to={redirectTo}
      replace
      />
    );
  }

  const userAllowed = adminOnly
    ? isAdminUser()
    : isAdminUser()
    ? true
    : requiredPermissions.length
      ? anyOf
        ? hasAnyPermission(requiredPermissions)
        : requiredPermissions.every((permission) => hasPermission(permission))
      : true;

  if (!userAllowed) {
    return (
      <Navigate
        to="/403"
        replace
      />
    );
  }

  return children;
}
