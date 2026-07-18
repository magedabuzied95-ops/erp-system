const hasSameBranch = (employee, branchId) => {
  if (!branchId || employee?.branch_id == null || employee?.branch_id === "") return true;
  return String(employee.branch_id) === String(branchId);
};

export const buildPosOpeningCandidateFallback = (employees = [], branchId = "") => {
  if (!Array.isArray(employees)) return [];

  return employees
    .filter((employee) => {
      if (!employee || !hasSameBranch(employee, branchId)) return false;
      if (employee.is_active === false || employee.is_deleted === true) return false;
      if (employee.can_open_branch === false) return false;
      return Boolean(employee.employee_id || employee.id);
    })
    .map((employee, index) => {
      const employeeId = employee.employee_id || employee.id;
      const fullName =
        employee.full_name ||
        employee.employee_name ||
        employee.name ||
        employee.pos_alias ||
        employee.employee_code ||
        `Employee #${employeeId}`;

      return {
        ...employee,
        id: employeeId,
        employee_id: employeeId,
        full_name: fullName,
        employee_name: employee.employee_name || fullName,
        eligible: true,
        is_recommended: employee.is_recommended === true || index === 0,
        fallback_source: employee.fallback_source || "branch_employees",
      };
    });
};

export const readPosOpeningCandidates = (payload) => {
  const candidates = payload?.candidates ?? payload?.data?.candidates;
  return Array.isArray(candidates) ? candidates : [];
};
