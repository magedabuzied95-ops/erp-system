import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { activateRuntimeLanguage } from "../../managerPortal/lib/portalLanguage";

// The employee portal is Arabic-only: EmployeePayrollPortal pins its own labels to
// "ar", and every portal page is laid out rtl. Strings read from the i18n dictionary
// followed the PHONE's language instead, so a phone set to English showed a
// "Shipping orders" button between "طلب من المخزن" and "الجرد" and nobody found it
// (2026-09-10). Runtime only — the ERP's own language setting is never written.
export const useEmployeePortalArabic = () => {
  const translation = useTranslation();
  useEffect(() => {
    void activateRuntimeLanguage("ar");
  }, []);
  return translation;
};
