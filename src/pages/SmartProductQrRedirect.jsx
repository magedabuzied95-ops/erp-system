import { useEffect } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";

import { api } from "../shared/api/api";

const text = (value = "") => String(value || "").trim();

const extractEmployeePortalToken = (value = "") => {
  const source = text(value);
  if (!source) return "";
  const match =
    source.match(/\/employee-portal\/([^/?#]+)/i) ||
    source.match(/\/employee-app\/([^/?#]+)/i) ||
    source.match(/\/employee\/portal\/([^/?#]+)/i);
  return match?.[1] ? decodeURIComponent(match[1]) : "";
};

const readEmployeePortalToken = () => {
  if (typeof window === "undefined") return "";
  const candidates = [
    window.location.pathname,
    window.localStorage?.getItem("employee_portal_last_url"),
    window.sessionStorage?.getItem("employee_portal_last_url"),
  ];
  for (const candidate of candidates) {
    const token = extractEmployeePortalToken(candidate);
    if (token) return token;
  }
  return "";
};

const buildQuery = (entries = []) => {
  const params = new URLSearchParams();
  entries.forEach(([key, value]) => {
    const normalized = text(value);
    if (!normalized) return;
    params.set(key, normalized);
  });
  const query = params.toString();
  return query ? `?${query}` : "";
};

export default function SmartProductQrRedirect() {
  const navigate = useNavigate();
  const { productId = "" } = useParams();
  const [searchParams] = useSearchParams();

  useEffect(() => {
    let cancelled = false;

    const variantId = text(searchParams.get("variantId") || searchParams.get("variant"));
    const colorId = text(searchParams.get("colorId") || searchParams.get("color"));
    const action = text(searchParams.get("action")) || "warehouse-request";
    const employeeToken = readEmployeePortalToken();

    if (employeeToken) {
      navigate(
        `/employee-portal/${encodeURIComponent(employeeToken)}/products${buildQuery([
          ["productId", productId],
          ["variantId", variantId],
          ["colorId", colorId],
          ["action", action],
        ])}`,
        { replace: true }
      );
      return undefined;
    }

    (async () => {
      try {
        const response = await api.get(`/storefront/products/resolve/${encodeURIComponent(productId)}`, {
          suppressErrorStatuses: [404],
        });
        if (cancelled) return;
        const product = response?.product || response?.data?.product || null;
        const slug = text(product?.slug || product?.canonical_slug || product?.id || productId);
        navigate(
          `/shop/product/${encodeURIComponent(slug)}${buildQuery([
            ["variant", variantId],
            ["color", colorId],
          ])}`,
          { replace: true }
        );
      } catch {
        if (cancelled) return;
        navigate(
          `/shop/product/${encodeURIComponent(productId)}${buildQuery([
            ["variant", variantId],
            ["color", colorId],
          ])}`,
          { replace: true }
        );
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [navigate, productId, searchParams]);

  return null;
}
