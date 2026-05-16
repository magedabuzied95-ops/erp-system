import { useMemo } from "react";

import { getCurrentUser } from "../../../shared/auth/authStorage";
import { getEffectivePermissions, hasAnyPermission, hasPermission } from "../lib/rbacStore";

export default function usePermission(permission, options = {}) {
  const user = options.user || getCurrentUser();

  return useMemo(() => {
    if (Array.isArray(permission)) {
      return options.mode === "all"
        ? permission.every((item) => hasPermission(item, user))
        : hasAnyPermission(permission, user);
    }

    if (options.anyOf) {
      return hasAnyPermission(options.anyOf, user);
    }

    if (options.allOf) {
      return options.allOf.every((item) => hasPermission(item, user));
    }

    return hasPermission(permission, user);
  }, [permission, options.anyOf, options.allOf, options.mode, user]);
}

export const usePermissions = (user) => getEffectivePermissions(user);
