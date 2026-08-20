// Resolves the invoice template config for whoever is looking at the invoice.
//
// The same invoice is rendered for two very different viewers: an operator inside the
// ERP, and a customer on /invoice/:token who is signed out and can only reach the
// public resolver. This hook picks the right endpoint from the presence of a token, so
// no caller has to know which side it is on.
//
// It never returns null and never renders empty: the first value is the normalized
// defaults, which reproduce the invoice exactly as it looked before any of this
// existed. A tenant with no template configured therefore never fetches a second time
// and never repaints.

import { useEffect, useState } from "react";

import { getToken } from "../auth/authStorage";
import { getPublicInvoiceTemplateConfig, resolveInvoiceTemplate } from "../api/invoiceTemplates";
import { normalizeInvoiceTemplateConfig } from "../../../shared/invoiceTemplate.js";

const DEFAULT_CONFIG = normalizeInvoiceTemplateConfig({});

// One in-flight promise per scope, shared by every renderer on the page. An order page
// showing the invoice card beside a PDF preview must not fetch the config twice.
const cache = new Map();
const inFlight = new Map();

const scopeKey = ({ channel = "all", branchId = null, templateId = null, isPublic = false }) =>
  `${isPublic ? "public" : "private"}:${channel}:${branchId ?? ""}:${templateId ?? ""}`;

export const getInvoiceTemplateConfig = async (options = {}) => {
  const isPublic = !getToken();
  const key = scopeKey({ ...options, isPublic });
  if (cache.has(key)) return cache.get(key);
  if (inFlight.has(key)) return inFlight.get(key);

  const params = {
    channel: options.channel || undefined,
    branch_id: options.branchId || undefined,
    template_id: options.templateId || undefined,
  };

  const request = (isPublic
    ? getPublicInvoiceTemplateConfig(params)
    : resolveInvoiceTemplate(params).then((response) => normalizeInvoiceTemplateConfig(response?.config || {}))
  )
    // A config that fails to load must never blank an invoice the customer is reading.
    .catch(() => DEFAULT_CONFIG)
    .then((config) => {
      cache.set(key, config);
      return config;
    })
    .finally(() => {
      inFlight.delete(key);
    });

  inFlight.set(key, request);
  return request;
};

export const useInvoiceTemplate = (options = {}) => {
  const { channel = "all", branchId = null, templateId = null, enabled = true } = options;
  const [config, setConfig] = useState(DEFAULT_CONFIG);

  useEffect(() => {
    if (!enabled) return undefined;
    let active = true;
    getInvoiceTemplateConfig({ channel, branchId, templateId }).then((next) => {
      if (active && next) setConfig(next);
    });
    return () => {
      active = false;
    };
  }, [channel, branchId, templateId, enabled]);

  return config;
};

export const resetInvoiceTemplateCache = () => {
  cache.clear();
  inFlight.clear();
};

export { DEFAULT_CONFIG as defaultInvoiceTemplateConfig };
