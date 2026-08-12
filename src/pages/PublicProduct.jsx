import { useEffect, useMemo, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { ArrowRight, Loader2, ShoppingCart, Sparkles } from "lucide-react";
import toast from "react-hot-toast";
import { applyProductSocialMeta, productToSocialMeta } from "../shared/lib/socialMeta";

const ATTRIBUTION_KEY = "erp.marketing.attribution";

const normalizeSourceKey = (value = "") => {
  const raw = String(value || "").trim().toLowerCase();
  if (!raw) return "";
  if (["facebook", "fb", "facebook_post"].includes(raw)) return "facebook_post";
  if (["instagram", "ig", "instagram_post"].includes(raw)) return "instagram_post";
  if (["story", "instagram_story"].includes(raw)) return "instagram_story";
  if (["tiktok", "tk"].includes(raw)) return "tiktok";
  if (["whatsapp", "wa", "whatsapp_campaign"].includes(raw)) return "whatsapp_campaign";
  if (raw === "other") return "other";
  return raw;
};

const resolveSourceKeyFromParams = (searchParams) => {
  const src = normalizeSourceKey(searchParams.get("src") || searchParams.get("platform") || "");
  const kind = normalizeSourceKey(searchParams.get("kind") || "");
  if (src === "instagram_story" || kind === "instagram_story") return "instagram_story";
  if (src === "facebook_post") return "facebook_post";
  if (src === "instagram_post") return "instagram_post";
  if (src === "tiktok") return "tiktok";
  if (src === "whatsapp_campaign") return "whatsapp_campaign";
  if (kind && kind !== "post") return kind;
  return src || "";
};

const readAttribution = () => {
  if (typeof window === "undefined") {
    return {};
  }

  try {
    return JSON.parse(window.localStorage.getItem(ATTRIBUTION_KEY) || "{}");
  } catch {
    return {};
  }
};

const writeAttribution = (value) => {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(ATTRIBUTION_KEY, JSON.stringify(value || {}));
  } catch {
    // Ignore storage failures.
  }
};

// Website checkout integration point:
// when a real public cart/checkout page is added, read ?coupon=CODE, call
// POST /api/coupons/validate with { source: "website" }, subtract discount
// from totals, and send coupon_code in the order creation payload.

const buildAttributionState = (searchParams, current = {}) => ({
  source_key: resolveSourceKeyFromParams(searchParams) || normalizeSourceKey(current.source_key || ""),
  marketing_source: String(searchParams.get("src") || searchParams.get("platform") || searchParams.get("kind") || "other"),
  marketing_platform: String(searchParams.get("platform") || searchParams.get("src") || "other"),
  marketing_campaign: String(searchParams.get("campaign") || ""),
  marketing_post_id: String(searchParams.get("post") || ""),
  marketing_tracking_code: String(searchParams.get("code") || ""),
  marketing_session_id:
    String(
      searchParams.get("session_id") ||
        current.marketing_session_id ||
        (typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`)
    ),
  attribution_type: String(searchParams.get("kind") || searchParams.get("src") || "other"),
});

const postPublicEvent = async ({ productId, eventType, product, attribution }) => {
  const response = await fetch(`/api/public/products/${encodeURIComponent(productId)}/events`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      event_type: eventType,
      product_id: productId,
      tenant_id: product?.tenant_id || attribution?.tenant_id || null,
      post_id: attribution?.marketing_post_id || "",
      campaign: attribution?.marketing_campaign || "",
      platform: attribution?.marketing_platform || "",
      source: attribution?.marketing_source || "",
      tracking_code: attribution?.marketing_tracking_code || "",
      session_id: attribution?.marketing_session_id || "",
      attribution_type: attribution?.attribution_type || attribution?.source_key || eventType,
      metadata: {
        product_name: product?.name || "",
        product_price: product?.sale_price || product?.price || 0,
      },
    }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload?.message || "Failed to log public event");
  }
  return payload;
};

export default function PublicProduct() {
  const { productId } = useParams();
  const [searchParams] = useSearchParams();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [product, setProduct] = useState(null);
  const [variants, setVariants] = useState([]);
  const [attribution, setAttribution] = useState(() => {
    const persisted = readAttribution();
    return {
      ...persisted,
      ...buildAttributionState(searchParams, persisted),
    };
  });

  useEffect(() => {
    const next = {
      ...readAttribution(),
      ...buildAttributionState(searchParams, readAttribution()),
    };
    setAttribution(next);
    writeAttribution(next);
  }, [searchParams]);

  useEffect(() => {
    let active = true;
    const load = async () => {
      setLoading(true);
      setError("");
      try {
        const response = await fetch(`/api/public/products/${encodeURIComponent(productId)}`);
        const payload = await response.json();
        if (!response.ok) {
          throw new Error(payload?.message || "Failed to load product");
        }
        if (!active) return;
        setProduct(payload.product || null);
        setVariants(Array.isArray(payload.variants) ? payload.variants : []);
      } catch (err) {
        if (!active) return;
        setError(err?.message || "Failed to load product");
      } finally {
        if (active) setLoading(false);
      }
    };

    load();
    return () => {
      active = false;
    };
  }, [productId]);

  const mainImage = useMemo(() => product?.public_image_url || product?.image_url || "", [product]);

  useEffect(() => {
    if (!product) return;
    applyProductSocialMeta(productToSocialMeta(product));
  }, [product]);

  const handleEvent = async (eventType) => {
    if (!productId) return;
    setSaving(true);
    try {
      await postPublicEvent({
        productId,
        eventType,
        product,
        attribution,
      });
      toast.success(eventType === "add_to_cart" ? "Added to cart" : "Checkout started");
    } catch (err) {
      toast.error(err?.message || "Action failed");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-950 px-4 py-12 text-white">
        <div className="mx-auto flex max-w-5xl items-center justify-center rounded-3xl border border-white/10 bg-white/[0.04] p-12">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      </div>
    );
  }

  if (error || !product) {
    return (
      <div className="min-h-screen bg-slate-950 px-4 py-12 text-white">
        <div className="mx-auto max-w-5xl rounded-3xl border border-rose-500/20 bg-rose-500/10 p-6 text-rose-100">
          {error || "Product not found"}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#050816] text-white">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-6 md:px-6 lg:px-8">
        <section className="overflow-hidden rounded-[28px] border border-white/10 bg-white/[0.04] shadow-2xl shadow-black/20">
          <div className="grid gap-0 lg:grid-cols-[1.1fr_0.9fr]">
            <div className="bg-gradient-to-br from-slate-950 to-slate-900 p-6 md:p-8">
              <div className="inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.22em] text-primary">
                <Sparkles className="h-3.5 w-3.5" />
                Tracked product
              </div>
              <h1 className="m1-display mt-4">{product.name}</h1>
              <p className="mt-4 max-w-2xl text-sm leading-7 text-slate-300">{product.description || "Product details loaded from the tracked link."}</p>
              <div className="mt-6 flex flex-wrap gap-3 text-sm text-slate-300">
                <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1">Source: {attribution.marketing_source || "other"}</span>
                <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1">Campaign: {attribution.marketing_campaign || "-"}</span>
                <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1">Code: {attribution.marketing_tracking_code || "-"}</span>
              </div>
              <div className="mt-6 flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={() => handleEvent("add_to_cart")}
                  disabled={saving}
                  className="inline-flex items-center gap-2 rounded-2xl bg-emerald-500 px-5 py-3 text-sm font-black text-black transition hover:bg-emerald-400 disabled:opacity-60"
                >
                  <ShoppingCart className="h-4 w-4" />
                  Add to cart
                </button>
                <button
                  type="button"
                  onClick={() => handleEvent("checkout")}
                  disabled={saving}
                  className="inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-5 py-3 text-sm font-semibold text-white transition hover:bg-white/10 disabled:opacity-60"
                >
                  Checkout
                  <ArrowRight className="h-4 w-4" />
                </button>
              </div>
            </div>
            <div className="bg-[#060816] p-4 md:p-6">
              <div className="overflow-hidden rounded-[24px] border border-white/10 bg-slate-950">
                {mainImage ? (
                  <img src={mainImage} alt={product.name} className="aspect-square h-full w-full object-cover" />
                ) : (
                  <div className="flex aspect-square items-center justify-center text-sm text-slate-500">No image available</div>
                )}
              </div>
            </div>
          </div>
        </section>

        <section className="rounded-3xl border border-white/10 bg-white/[0.04] p-5">
          <div className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-400">Variants</div>
          <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {variants.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-white/10 bg-white/5 p-6 text-sm text-slate-400">No variants available.</div>
            ) : (
              variants.map((variant) => (
                <div key={String(variant.id)} className="rounded-2xl border border-white/10 bg-slate-950/80 p-4">
                  <div className="font-semibold text-white">{variant.color || "Default"} / {variant.size || "One size"}</div>
                  <div className="mt-1 text-sm text-slate-400">{variant.sku || "n/a"} • {variant.barcode || "n/a"}</div>
                  <div className="mt-3 text-lg font-black text-primary">{Number(variant.sale_price || variant.price || product.sale_price || product.price || 0).toLocaleString()}</div>
                </div>
              ))
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
