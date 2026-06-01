import { useEffect } from "react";
import { useParams } from "react-router-dom";

import EmployeePayrollPortal from "./EmployeePayrollPortal";

export default function EmployeeAppShell() {
  const { token } = useParams();

  useEffect(() => {
    console.debug("[employee-app-route-hit]", token);
  }, [token]);

  return <EmployeePayrollPortal appMode="employee-pwa" />;
}
