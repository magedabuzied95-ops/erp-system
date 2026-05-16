import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";

import {
  AlertTriangle,
  Barcode,
  Boxes,
  Building2,
  ChevronDown,
  ChevronUp,
  Minus,
  PackagePlus,
  Plus,
  ReceiptText,
  Save,
  Search,
  Send,
  ShoppingCart,
  Trash2,
  Truck,
  Upload,
  X,
} from "lucide-react";

import toast from "react-hot-toast";
import { api } from "../../../shared/api/api";
import { resolveProductImageUrl } from "../../../shared/lib/imageUrls";
import FlowShell from "../components/FlowShell";
import StatusBadge from "../components/StatusBadge";
import {
  formatCurrency,
  generateCode,
  getLocalPurchases,
  normalizePurchase,
  normalizeSupplier,
  normalizeWarehouse,
  saveLocalPurchases,
} from "../lib/flowStore";

const toArray = (value) => (Array.isArray(value) ? value : []);
const money = (value) => (Number.isFinite(Number(value)) ? Number(value) : 0);
const text = (value) => String(value || "").trim();
const normalizeKey = (value) => text(value).toLowerCase();

const normalizePurchaseItem = (item = {}) => {
  const cost = Number(
    item.unit_cost ??
      item.cost_price ??
      item.purchase_price ??
      item.last_cost ??
      item.purchase_cost ??
      item.cost ??
      0
  );
  const quantity = Number(item.quantity || item.qty || 1);
  const salePrice =
    item.selling_price ??
    item.sale_price ??
    item.price ??
    item.retail_price ??
    "";

  return {
    ...item,
    unit_cost: cost,
    cost_price: cost,
    purchase_price: cost,
    ...(salePrice !== "" && salePrice !== null && salePrice !== undefined
      ? {
          selling_price: money(salePrice),
          sale_price: money(salePrice),
          price: money(salePrice),
        }
      : {}),
    quantity,
    subtotal: quantity * cost,
  };
};

const normalizeProductsResponse = (data) => {
  const products = Array.isArray(data) ? data : data?.data || data?.products || data?.rows || [];
  if (Array.isArray(products)) return products;
  if (Array.isArray(products?.data)) return products.data;
  if (Array.isArray(products?.products)) return products.products;
  return [];
};

const normalizeBranchesResponse = (data) => {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.data)) return data.data;
  if (Array.isArray(data?.branches)) return data.branches;
  return [];
};

const normalizeReorderResponse = (data) => {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.data)) return data.data;
  if (Array.isArray(data?.suggestions)) return data.suggestions;
  return [];
};

const normalizeVariantOption = (product, variant = null) => {
  const productId = product?.id ?? product?.product_id ?? variant?.product_id ?? null;
  const variantId = variant?.variant_id ?? variant?.id ?? product?.variant_id ?? null;
  const color = variant?.color ?? product?.color ?? "";
  const size = variant?.size ?? product?.size ?? "";
  const sku = variant?.sku ?? product?.sku ?? `${product?.name || product?.product_name || "product"}-${variantId || productId}`;
  const barcode = variant?.barcode ?? product?.barcode ?? "";
  const stock = money(variant?.current_stock ?? variant?.stock ?? variant?.stock_quantity ?? product?.current_stock ?? product?.stock ?? product?.total_stock ?? 0);
  const lowStockThreshold = money(variant?.low_stock_threshold ?? variant?.low_stock_alert ?? product?.low_stock_threshold ?? product?.low_stock_alert ?? 5);
  const costPrice = money(
    variant?.unit_cost ??
      variant?.cost_price ??
      variant?.last_cost ??
      variant?.purchase_cost ??
      variant?.purchase_price ??
      variant?.last_purchase_cost ??
      variant?.cost ??
      product?.unit_cost ??
      product?.cost_price ??
      product?.last_cost ??
      product?.purchase_cost ??
      product?.purchase_price ??
      product?.last_purchase_cost ??
      product?.cost ??
      0
  );
  const salePrice = money(
    variant?.selling_price ??
      variant?.sale_price ??
      variant?.price ??
      product?.selling_price ??
      product?.sale_price ??
      product?.price ??
      0
  );

  return {
    line_id: `${productId || "product"}-${variantId || "base"}-${sku}-${barcode}-${color}-${size}`,
    product_id: productId,
    variant_id: variantId,
    product_name: product?.name || product?.product_name || "Unnamed product",
    sku,
    barcode,
    color,
    size,
    stock,
    low_stock_threshold: lowStockThreshold,
    image_url:
      variant?.image_url ||
      variant?.variant_image_url ||
      variant?.color_image_url ||
      variant?.thumbnail_url ||
      product?.image_url ||
      product?.product_image_url ||
      product?.thumbnail_url ||
      "",
    unit_cost: costPrice,
    cost_price: costPrice,
    purchase_price: costPrice,
    last_cost: costPrice,
    purchase_cost: costPrice,
    selling_price: salePrice,
    sale_price: salePrice,
    price: salePrice,
    last_purchase_cost: costPrice,
    last_purchase_date: variant?.last_purchase_date || variant?.last_purchased_at || product?.last_purchase_date || "",
    supplier_id: variant?.supplier_id || product?.supplier_id || null,
    supplier_name: variant?.supplier_name || product?.supplier_name || product?.supplier || "",
    purchase_pack_qty: Math.max(1, money(variant?.purchase_pack_qty || product?.purchase_pack_qty || 1)),
    quantity: 1,
    received_quantity: 0,
    tax: 0,
    discount: 0,
    reorder: null,
  };
};

const flattenProductsWithVariants = (rows = []) =>
  toArray(rows)
    .flatMap((product) => {
      const variants = toArray(product?.variants);
      if (variants.length) return variants.map((variant) => normalizeVariantOption(product, variant));
      return [normalizeVariantOption(product)];
    })
    .filter((item) => item.product_id);

const mergeReorderFlags = (products, reorderRows) => {
  const byVariant = new Map();
  const byProduct = new Map();
  reorderRows.forEach((row) => {
    if (row?.variant_id) byVariant.set(String(row.variant_id), row);
    if (row?.product_id) byProduct.set(String(row.product_id), row);
  });

  return products.map((product) => {
    const reorder = byVariant.get(String(product.variant_id || "")) || byProduct.get(String(product.product_id || "")) || null;
    return {
      ...product,
      reorder,
      supplier_name: product.supplier_name || reorder?.supplier_name || "",
      low_stock_threshold: money(reorder?.reorder_point ?? reorder?.min_stock ?? product.low_stock_threshold),
    };
  });
};

const groupByProduct = (products = []) => {
  const groups = new Map();
  products.forEach((item) => {
    const key = String(item.product_id || item.line_id);
    const current = groups.get(key) || {
      product_id: item.product_id,
      product_name: item.product_name,
      image_url: item.image_url,
      supplier_name: item.supplier_name,
      variants: [],
    };
    current.variants.push(item);
    if (!current.image_url && item.image_url) current.image_url = item.image_url;
    if (!current.supplier_name && item.supplier_name) current.supplier_name = item.supplier_name;
    groups.set(key, current);
  });
  return Array.from(groups.values());
};

const searchMatches = (item, query) => {
  if (!query) return true;
  return `${item.product_name} ${item.sku} ${item.barcode} ${item.color} ${item.size} ${item.supplier_name}`.toLowerCase().includes(query);
};

function PurchaseOrder() {
  const navigate = useNavigate();
  const location = useLocation();
  const searchRef = useRef(null);
  const [suppliers, setSuppliers] = useState([]);
  const [warehouses, setWarehouses] = useState([]);
  const [branches, setBranches] = useState([]);
  const [products, setProducts] = useState([]);
  const [productsLoading, setProductsLoading] = useState(false);
  const [productPickerOpen, setProductPickerOpen] = useState(false);
  const [supplierId, setSupplierId] = useState("");
  const [warehouseId, setWarehouseId] = useState("");
  const [branchId, setBranchId] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("draft");
  const [discount, setDiscount] = useState(0);
  const [shipping, setShipping] = useState(0);
  const [transport, setTransport] = useState(0);
  const [customs, setCustoms] = useState(0);
  const [additionalExpenses, setAdditionalExpenses] = useState(0);
  const [paymentStatus, setPaymentStatus] = useState("pending");
  const [supplierInvoiceNumber, setSupplierInvoiceNumber] = useState("");
  const [deliveryNotes, setDeliveryNotes] = useState("");
  const [internalNotes, setInternalNotes] = useState("");
  const [attachments, setAttachments] = useState([]);
  const [items, setItems] = useState([]);
  const [bulkPriceModal, setBulkPriceModal] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [postError, setPostError] = useState("");
  const [cartCostErrors, setCartCostErrors] = useState(new Set());
  const [posting, setPosting] = useState(false);
  const [supplierModalOpen, setSupplierModalOpen] = useState(false);
  const [productModalOpen, setProductModalOpen] = useState(false);
  const [cartOpen, setCartOpen] = useState(false);
  const [variantSelector, setVariantSelector] = useState(null);
  const [runModal, setRunModal] = useState(null);
  const [supplierSaving, setSupplierSaving] = useState(false);
  const [supplierError, setSupplierError] = useState("");
  const [supplierForm, setSupplierForm] = useState({
    name: "",
    phone: "",
    whatsapp: "",
    email: "",
    contact_person: "",
    tax_number: "",
    address: "",
    opening_balance: 0,
    notes: "",
    status: "active",
  });
  const [productSaving, setProductSaving] = useState(false);
  const [productError, setProductError] = useState("");
  const [productForm, setProductForm] = useState({
    name: "",
    category: "",
    brand: "",
    colors: "Black",
    sizes: "41,42,43,44",
    sale_price: 0,
    purchase_cost: 0,
    sku: "",
    barcode: "",
    image_url: "",
  });

  const loadData = async () => {
    try {
      setLoading(true);
      setProductsLoading(true);
      setError("");

      const [suppliersRes, warehousesRes, branchesRes, productsRes, reorderRes] = await Promise.allSettled([
        api.get("/suppliers?limit=200&page=1"),
        api.get("/warehouses"),
        api.get("/branches"),
        api.get("/products/with-variants"),
        api.get("/purchases/reorder-suggestions"),
      ]);

      if (suppliersRes.status === "fulfilled") {
        const rows = toArray(suppliersRes.value?.data).length ? suppliersRes.value.data : toArray(suppliersRes.value?.suppliers);
        setSuppliers(rows.map(normalizeSupplier));
      } else {
        setSuppliers([]);
        setError((prev) => `${prev ? `${prev} ` : ""}Suppliers could not be loaded; create one inline or retry.`);
      }

      if (warehousesRes.status === "fulfilled") {
        const rows = toArray(warehousesRes.value?.data).length
          ? warehousesRes.value.data
          : toArray(warehousesRes.value?.warehouses).length
            ? warehousesRes.value.warehouses
            : toArray(warehousesRes.value);
        setWarehouses(rows.map(normalizeWarehouse));
      } else {
        setWarehouses([]);
        setError((prev) => `${prev ? `${prev} ` : ""}Warehouses could not be loaded; the backend will use Main Warehouse when posting.`);
      }

      if (branchesRes.status === "fulfilled") {
        setBranches(normalizeBranchesResponse(branchesRes.value).filter((branch) => branch?.is_active !== false));
      } else {
        setBranches([]);
      }

      const rows = productsRes.status === "fulfilled" ? normalizeProductsResponse(productsRes.value) : [];
      const reorderRows = reorderRes.status === "fulfilled" ? normalizeReorderResponse(reorderRes.value) : [];
      if (productsRes.status === "fulfilled") {
        setProducts(mergeReorderFlags(flattenProductsWithVariants(rows), reorderRows));
      } else {
        setProducts([]);
        setError((prev) => `${prev ? `${prev} ` : ""}Products could not be loaded right now.`);
      }
    } catch (err) {
      console.log(err);
      setSuppliers([]);
      setWarehouses([]);
      setBranches([]);
      setProducts([]);
      setError("Purchase setup data could not be loaded. You can retry or post with backend defaults once products are available.");
      toast.error("Purchase setup data could not be loaded");
    } finally {
      setLoading(false);
      setProductsLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  useEffect(() => {
    const requestedSupplierId = new URLSearchParams(location.search).get("supplier_id");
    if (requestedSupplierId && suppliers.some((supplier) => String(supplier.id) === String(requestedSupplierId))) {
      setSupplierId(String(requestedSupplierId));
      return;
    }
    if (requestedSupplierId && suppliers.length && !suppliers.some((supplier) => String(supplier.id) === String(requestedSupplierId))) {
      setSupplierModalOpen(true);
    }
    if (!supplierId && suppliers.length) setSupplierId(String(suppliers[0].id));
    if (!supplierId && !suppliers.length && !loading) setSupplierModalOpen(true);
    if (!warehouseId && warehouses.length) setWarehouseId(String(warehouses[0].id));
    if (!branchId && branches.length === 1) setBranchId(String(branches[0].id));
  }, [suppliers, warehouses, branches, supplierId, warehouseId, branchId, location.search, loading]);

  const filteredProducts = useMemo(() => {
    const query = search.trim().toLowerCase();
    return products.filter((item) => searchMatches(item, query));
  }, [products, search]);

  const groupedCards = useMemo(() => groupByProduct(filteredProducts).slice(0, 80), [filteredProducts]);

  const variantsByProduct = useMemo(() => {
    return products.reduce((map, item) => {
      const key = String(item.product_id || "");
      if (!key) return map;
      if (!map[key]) map[key] = [];
      map[key].push(item);
      return map;
    }, {});
  }, [products]);

  const subtotal = items.reduce((sum, item) => sum + money(item.subtotal ?? money(item.quantity) * money(item.cost_price)), 0);
  const itemDiscount = items.reduce((sum, item) => sum + money(item.discount), 0);
  const expenses = money(shipping) + money(transport) + money(customs) + money(additionalExpenses);
  const total = Math.max(0, subtotal + expenses - itemDiscount - money(discount));
  const cartQty = items.reduce((sum, item) => sum + money(item.quantity), 0);

  const addProduct = (product, quantity = 1) => {
    if (!product) return;
    const qty = Math.max(1, money(quantity) || 1);
    setItems((prev) => {
      const existing = prev.find((item) => String(item.line_id) === String(product.line_id));
      if (existing) {
        return prev.map((item) =>
          String(item.line_id) === String(product.line_id)
            ? normalizePurchaseItem({ ...item, quantity: money(item.quantity) + qty })
            : item
        );
      }
      return [...prev, normalizePurchaseItem({ ...product, quantity: qty, received_quantity: product.received_quantity || 0 })];
    });
    setCartCostErrors((prev) => {
      const next = new Set(prev);
      next.delete(String(product.line_id));
      return next;
    });
    setProductPickerOpen(false);
    setCartOpen(true);
    window.setTimeout(() => searchRef.current?.focus(), 40);
  };

  const addProductCard = (group) => {
    const variants = toArray(group?.variants);
    if (variants.length > 1) {
      setVariantSelector(group);
      return;
    }
    addProduct(variants[0]);
  };

  const addRunItems = (rows) => {
    rows.filter((row) => money(row.quantity) > 0).forEach((row) => addProduct(row.product, row.quantity));
    setRunModal(null);
  };

  const updateItem = (lineId, patch) => {
    setItems((prev) =>
      prev.map((item) => {
        if (String(item.line_id) !== String(lineId)) return item;
        const next = { ...item, ...patch };
        if (Object.prototype.hasOwnProperty.call(patch, "unit_cost") || Object.prototype.hasOwnProperty.call(patch, "cost_price")) {
          const cost = money(patch.unit_cost ?? patch.cost_price ?? patch.purchase_price);
          return normalizePurchaseItem({ ...next, unit_cost: cost, cost_price: cost, purchase_price: cost });
        }
        if (Object.prototype.hasOwnProperty.call(patch, "selling_price") || Object.prototype.hasOwnProperty.call(patch, "sale_price") || Object.prototype.hasOwnProperty.call(patch, "price")) {
          const price = money(patch.selling_price ?? patch.sale_price ?? patch.price);
          return normalizePurchaseItem({ ...next, selling_price: price, sale_price: price, price });
        }
        return normalizePurchaseItem(next);
      })
    );
    setCartCostErrors((prev) => {
      const next = new Set(prev);
      next.delete(String(lineId));
      return next;
    });
  };

  const applyBulkPrice = ({ type, value }) => {
    const price = money(value);
    if (!Number.isFinite(price) || price < 0) {
      toast.error("Enter a valid price greater than or equal to 0");
      return false;
    }
    if (!items.length) {
      toast.error("Add invoice items first");
      return false;
    }

    setItems((prev) =>
      prev.map((item) => {
        if (type === "purchase") {
          return normalizePurchaseItem({
            ...item,
            unit_cost: price,
            cost_price: price,
            purchase_price: price,
          });
        }
        return normalizePurchaseItem({
          ...item,
          selling_price: price,
          sale_price: price,
          price,
        });
      })
    );
    if (type === "purchase") setCartCostErrors(new Set());
    toast.success(type === "purchase" ? "Bulk purchase price applied" : "Bulk selling price applied");
    setBulkPriceModal(null);
    return true;
  };

  const removeItem = (lineId) => {
    setItems((prev) => prev.filter((item) => String(item.line_id) !== String(lineId)));
    setCartCostErrors((prev) => {
      const next = new Set(prev);
      next.delete(String(lineId));
      return next;
    });
  };

  const changeQty = (lineId, delta) => {
    setItems((prev) =>
      prev.map((item) =>
        String(item.line_id) === String(lineId)
          ? normalizePurchaseItem({ ...item, quantity: Math.max(1, money(item.quantity) + delta) })
          : item
      )
    );
  };

  const changeItemVariant = (lineId, nextVariantId) => {
    setItems((prev) =>
      prev.map((item) => {
        if (String(item.line_id) !== String(lineId)) return item;
        const variants = variantsByProduct[String(item.product_id)] || [];
        const next = variants.find((variant) => String(variant.variant_id || "") === String(nextVariantId || ""));
        return next ? normalizePurchaseItem({ ...next, quantity: item.quantity, received_quantity: item.received_quantity || 0, discount: item.discount || 0 }) : item;
      })
    );
    setCartCostErrors((prev) => {
      const next = new Set(prev);
      next.delete(String(lineId));
      return next;
    });
  };

  const handleBarcodeSubmit = (event) => {
    if (event.key !== "Enter") return;
    const query = search.trim();
    if (!query) return;
    event.preventDefault();
    const exact =
      products.find((item) => normalizeKey(item.barcode) === normalizeKey(query)) ||
      products.find((item) => normalizeKey(item.sku) === normalizeKey(query)) ||
      filteredProducts[0];
    if (exact) {
      addProduct(exact);
      setSearch("");
      toast.success("Product added");
    } else {
      toast.error("No product matched this barcode or SKU");
    }
  };

  const saveSupplierFromOrder = async (event) => {
    event.preventDefault();
    const name = text(supplierForm.name);
    if (!name) {
      setSupplierError("Supplier name is required");
      return;
    }
    try {
      setSupplierSaving(true);
      setSupplierError("");
      const response = await api.post("/suppliers", {
        ...supplierForm,
        name,
        current_balance: money(supplierForm.opening_balance),
      });
      const created = response?.data || response?.supplier;
      if (created) {
        const normalized = normalizeSupplier({ ...created, status: created.status === "inactive" ? "Inactive" : "Active" });
        setSuppliers((prev) => [normalized, ...prev]);
        setSupplierId(String(normalized.id));
      }
      setSupplierModalOpen(false);
      setSupplierForm({
        name: "",
        phone: "",
        whatsapp: "",
        email: "",
        contact_person: "",
        tax_number: "",
        address: "",
        opening_balance: 0,
        notes: "",
        status: "active",
      });
      toast.success("Supplier created");
    } catch (err) {
      console.error(err);
      const message = err?.responseBody?.message || err?.message || "Supplier could not be created";
      setSupplierError(message);
      toast.error(message);
    } finally {
      setSupplierSaving(false);
    }
  };

  const createInlineProduct = async (event) => {
    event.preventDefault();
    const name = text(productForm.name);
    if (!name) {
      setProductError("Product name is required");
      return;
    }

    const colors = productForm.colors.split(",").map(text).filter(Boolean);
    const sizes = productForm.sizes.split(",").map(text).filter(Boolean);
    const variants = colors.flatMap((color) =>
      sizes.map((size, index) => ({
        color,
        size,
        sku: text(productForm.sku) ? `${productForm.sku}-${color}-${size}`.replace(/\s+/g, "-").toUpperCase() : "",
        barcode: index === 0 ? text(productForm.barcode) : "",
        unit_cost: money(productForm.purchase_cost),
        purchase_price: money(productForm.purchase_cost),
        cost_price: money(productForm.purchase_cost),
        purchase_cost: money(productForm.purchase_cost),
        price: money(productForm.sale_price),
        sale_price: money(productForm.sale_price),
        stock: 0,
        image_url: text(productForm.image_url),
      }))
    );

    try {
      setProductSaving(true);
      setProductError("");
      const response = await api.post("/products", {
        name,
        category: productForm.category,
        brand: productForm.brand,
        price: money(productForm.sale_price),
        sale_price: money(productForm.sale_price),
        unit_cost: money(productForm.purchase_cost),
        cost_price: money(productForm.purchase_cost),
        selling_price: money(productForm.sale_price),
        purchase_cost: money(productForm.purchase_cost),
        purchase_price: money(productForm.purchase_cost),
        sku: productForm.sku,
        barcode: productForm.barcode,
        image_url: productForm.image_url,
        variation_mode: variants.length ? "full_variations" : "simple",
        variants,
        variant_groups_count: colors.length,
        variant_rows_count: variants.length,
      });
      const product = response?.data || response?.product;
      const normalized = flattenProductsWithVariants([product]);
      setProducts((prev) => [...normalized, ...prev]);
      normalized.forEach((item) => addProduct(normalizePurchaseItem(item)));
      setProductModalOpen(false);
      toast.success("Product created and added");
    } catch (err) {
      const message = err?.responseBody?.message || err?.message || "Product could not be created";
      setProductError(message);
      toast.error(message);
    } finally {
      setProductSaving(false);
    }
  };

  const buildLocalRecord = (nextStatus) =>
    normalizePurchase({
      id: generateCode("draft"),
      invoice_number: generateCode("DRF"),
      supplier_id: supplierId,
      supplier_name: suppliers.find((supplier) => String(supplier.id) === String(supplierId))?.name || "Unknown",
      warehouse_name: warehouses.find((warehouse) => String(warehouse.id) === String(warehouseId))?.name || "Main Warehouse",
      status: nextStatus,
      payment_status: paymentStatus,
      total,
      subtotal,
      tax: 0,
      discount,
      notes: internalNotes,
      created_at: new Date().toISOString(),
      items: items.map(normalizePurchaseItem),
    });

  const saveDraft = () => {
    const records = [buildLocalRecord("draft"), ...getLocalPurchases().map(normalizePurchase)];
    saveLocalPurchases(records);
    toast.success("Draft saved locally");
  };

  const postPurchase = async (nextStatus = "received") => {
    setPostError("");
    if (items.length === 0) {
      toast.error("Add at least one item");
      return;
    }
    if (!supplierId) {
      const message = "Please create/select a supplier first.";
      setPostError(message);
      toast.error(message);
      return;
    }
    if (!warehouseId) {
      const message = "Please create/select Main Warehouse first.";
      setPostError(message);
      toast.error(message);
      return;
    }
    const normalizedItems = items.map(normalizePurchaseItem);
    const invalidCostIds = normalizedItems
      .filter((item) => !item.unit_cost || item.unit_cost <= 0)
      .map((item) => String(item.line_id));
    if (invalidCostIds.length) {
      const message = "Enter purchase cost";
      setCartCostErrors(new Set(invalidCostIds));
      setPostError(message);
      toast.error(message);
      setCartOpen(true);
      return;
    }
    setItems(normalizedItems);
    setCartCostErrors(new Set());
    setPosting(true);

    const payload = {
      supplier_id: supplierId,
      warehouse_id: warehouseId,
      branch_id: branchId || null,
      purchase_number: supplierInvoiceNumber || undefined,
      items: normalizedItems.map((item) => ({
        product_id: item.product_id,
        variant_id: item.variant_id || null,
        sku: item.sku || "",
        barcode: item.barcode || "",
        color: item.color || "",
        size: item.size || "",
        quantity: Number(item.quantity || 0),
        qty: Number(item.quantity || 0),
        received_quantity: Number(item.received_quantity || 0),
        unit_cost: Number(item.unit_cost || 0),
        cost_price: Number(item.cost_price || 0),
        purchase_price: Number(item.purchase_price ?? item.cost_price ?? item.unit_cost ?? 0),
        selling_price: Number(item.selling_price ?? item.sale_price ?? item.price ?? 0),
        sale_price: Number(item.sale_price ?? item.selling_price ?? item.price ?? 0),
        price: Number(item.price ?? item.sale_price ?? item.selling_price ?? 0),
        subtotal: Number(item.subtotal || 0),
        total: Number(item.subtotal || Number(item.quantity || 0) * Number(item.cost_price || 0)),
        metadata: {
          image_url: item.image_url,
          last_purchase_cost: item.last_purchase_cost,
          last_purchase_date: item.last_purchase_date,
          supplier_name: item.supplier_name,
          selling_price: Number(item.selling_price ?? item.sale_price ?? item.price ?? 0),
          sale_price: Number(item.sale_price ?? item.selling_price ?? item.price ?? 0),
          price: Number(item.price ?? item.sale_price ?? item.selling_price ?? 0),
        },
      })),
      status: nextStatus,
      notes: [internalNotes, deliveryNotes ? `Delivery: ${deliveryNotes}` : "", supplierInvoiceNumber ? `Supplier invoice: ${supplierInvoiceNumber}` : ""].filter(Boolean).join("\n"),
      subtotal,
      tax: 0,
      discount,
      discount_amount: discount,
      shipping,
      transport,
      customs,
      additional_expenses: additionalExpenses,
      total,
      grand_total: total,
      payment_status: paymentStatus,
      metadata: {
        source: "purchase_pos",
        branch_id: branchId || null,
        supplier_invoice_number: supplierInvoiceNumber,
        delivery_notes: deliveryNotes,
        internal_notes: internalNotes,
        expenses: { shipping, transport, customs, additional_expenses: additionalExpenses },
        attachments: attachments.map((file) => ({ name: file.name, size: file.size, type: file.type })),
      },
    };

    try {
      const response = await api.post("/purchases", payload);
      const record = normalizePurchase({
        id: response?.purchase?.id || generateCode("pur"),
        invoice_number: response?.purchase?.purchase_number || (response?.purchase?.id ? `PUR-${String(response.purchase.id).padStart(4, "0")}` : generateCode("PUR")),
        supplier_name: suppliers.find((supplier) => String(supplier.id) === String(supplierId))?.name || "Unknown",
        warehouse_name: warehouses.find((warehouse) => String(warehouse.id) === String(warehouseId))?.name || "Main Warehouse",
        status: nextStatus,
        payment_status: paymentStatus,
        total,
        subtotal,
        tax: 0,
        discount,
        notes: internalNotes,
        created_at: new Date().toISOString(),
        items: normalizedItems,
      });

      saveLocalPurchases([record, ...getLocalPurchases().map(normalizePurchase)]);
      toast.success(nextStatus === "received" ? "Purchase posted and stock received" : "Purchase order saved");
      navigate("/purchases");
    } catch (err) {
      console.log(err);
      const message = err?.responseBody?.error || err?.responseBody?.detail || err?.responseBody?.details || err?.message || "Purchase could not be posted.";
      setPostError(message);
      toast.error(message);
    } finally {
      setPosting(false);
    }
  };

  const activeSupplier = suppliers.find((supplier) => String(supplier.id) === String(supplierId));

  return (
    <FlowShell
      title="Purchase POS"
      subtitle="Procure models, variants, size runs, cartons, and supplier invoices without leaving the purchase flow."
      actions={
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={() => setProductModalOpen(true)} className="inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-white transition hover:bg-white/10">
            <PackagePlus className="h-4 w-4" />
            New Product
          </button>
          <Link to="/purchases" className="inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-white transition hover:bg-white/10">
            Back to dashboard
          </Link>
        </div>
      }
      tabs={[
        { to: "/purchases", label: "Purchases", end: true },
        { to: "/purchases/create", label: "Create PO" },
        { to: "/purchases/reorder-suggestions", label: "Smart Reorder" },
        { to: "/suppliers", label: "Suppliers" },
        { to: "/inventory", label: "Inventory" },
        { to: "/warehouses", label: "Warehouses" },
      ]}
    >
      {error ? <Banner tone="amber" message={error} /> : null}
      {postError ? <Banner tone="rose" message={postError} /> : null}

      <div className="sticky top-0 z-20 rounded-3xl border border-white/10 bg-zinc-950/95 p-3 shadow-2xl shadow-black/20 backdrop-blur">
        <div className="grid gap-3 lg:grid-cols-[1.1fr_1fr_1fr_1fr_1.4fr_auto]">
          <Select label="Supplier" value={supplierId} onChange={setSupplierId} options={suppliers.map((supplier) => ({ value: supplier.id, label: `${supplier.supplier_code ? `${supplier.supplier_code} - ` : ""}${supplier.name}` }))} emptyLabel="Create supplier first" />
          <Select label="Warehouse" value={warehouseId} onChange={setWarehouseId} options={warehouses.map((warehouse) => ({ value: warehouse.id, label: warehouse.name }))} emptyLabel="Main Warehouse" />
          {branches.length > 1 ? <Select label="Branch" value={branchId} onChange={setBranchId} options={branches.map((branch) => ({ value: branch.id, label: branch.name }))} emptyLabel="All branches" /> : null}
          <Select label="Status" value={status} onChange={setStatus} options={["draft", "ordered", "partially_received", "received", "cancelled"].map((value) => ({ value, label: value.replace("_", " ") }))} />
          <div className="relative">
            <div className="mb-2 flex items-center gap-2 text-[10px] uppercase tracking-[0.18em] text-zinc-500">
              <Barcode className="h-3.5 w-3.5" />
              Search / barcode
            </div>
            <Search className="pointer-events-none absolute left-4 top-[2.35rem] h-4 w-4 text-zinc-500" />
            <input
              ref={searchRef}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              onKeyDown={handleBarcodeSubmit}
              onFocus={() => setProductPickerOpen(true)}
              onBlur={() => window.setTimeout(() => setProductPickerOpen(false), 160)}
              placeholder="Scan barcode or search product, SKU, color, size..."
              className="w-full rounded-2xl border border-white/10 bg-white/5 py-3 pl-11 pr-4 text-sm text-white outline-none placeholder:text-zinc-500"
            />
            {productPickerOpen ? <ProductSearchPanel search={search} products={products} results={filteredProducts} loading={productsLoading} onAdd={addProduct} /> : null}
          </div>
          <div className="flex items-end gap-2">
            <button type="button" onClick={() => setSupplierModalOpen(true)} className="rounded-2xl border border-white/10 bg-white/5 px-3 py-3 text-sm font-semibold text-white hover:bg-white/10">
              Supplier
            </button>
            <button type="button" onClick={() => setRunModal({ mode: "size", product: groupedCards[0] || null })} className="rounded-2xl bg-emerald-500 px-3 py-3 text-sm font-black text-black disabled:opacity-40" disabled={!groupedCards.length}>
              Size Run
            </button>
          </div>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_420px]">
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <ActionTile icon={<Boxes className="h-5 w-5" />} label="Add Full Model" onClick={() => setRunModal({ mode: "full", product: groupedCards[0] || null })} disabled={!groupedCards.length} />
            <ActionTile icon={<ReceiptText className="h-5 w-5" />} label="Add Size Run" onClick={() => setRunModal({ mode: "size", product: groupedCards[0] || null })} disabled={!groupedCards.length} />
            <ActionTile icon={<Building2 className="h-5 w-5" />} label="Add Color Run" onClick={() => setRunModal({ mode: "color", product: groupedCards[0] || null })} disabled={!groupedCards.length} />
            <ActionTile icon={<Truck className="h-5 w-5" />} label="Carton Mode" onClick={() => setRunModal({ mode: "carton", product: groupedCards[0] || null })} disabled={!groupedCards.length} />
          </div>

          <section className="rounded-3xl border border-white/10 bg-zinc-950/90 p-4 shadow-2xl shadow-black/10">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">Product cards</div>
                <h3 className="mt-1 text-xl font-black text-white">Variant procurement grid</h3>
              </div>
              <div className="text-sm text-zinc-400">{filteredProducts.length} variants</div>
            </div>
            {productsLoading ? (
              <CardSkeleton />
            ) : groupedCards.length === 0 ? (
              <div className="mt-4 rounded-3xl border border-dashed border-white/10 bg-white/5 p-10 text-center">
                <PackagePlus className="mx-auto h-12 w-12 text-zinc-500" />
                <h3 className="mt-4 text-xl font-black text-white">No products found. Add products first.</h3>
                <button type="button" onClick={() => setProductModalOpen(true)} className="mt-4 rounded-2xl bg-emerald-500 px-4 py-3 text-sm font-black text-black">
                  Add Product
                </button>
              </div>
            ) : (
              <div className="mt-4 grid gap-3 sm:grid-cols-2 2xl:grid-cols-3">
                {groupedCards.map((group) => (
                  <ProductCard
                    key={String(group.product_id)}
                    group={group}
                    onClick={() => addProductCard(group)}
                    onSizeRun={() => setRunModal({ mode: "size", product: group })}
                    onColorRun={() => setRunModal({ mode: "color", product: group })}
                  />
                ))}
              </div>
            )}
          </section>
        </div>

        <PurchaseCart
          items={items}
          variantsByProduct={variantsByProduct}
          subtotal={subtotal}
          itemDiscount={itemDiscount}
          expenses={expenses}
          discount={discount}
          total={total}
          paymentStatus={paymentStatus}
          status={status}
          posting={posting}
          activeSupplier={activeSupplier}
          cartCostErrors={cartCostErrors}
          onChangeVariant={changeItemVariant}
          onUpdate={updateItem}
          onQty={changeQty}
          onRemove={removeItem}
          onDiscount={setDiscount}
          onPaymentStatus={setPaymentStatus}
          onBulkPrice={setBulkPriceModal}
          onSaveDraft={saveDraft}
          onMarkOrdered={() => postPurchase("ordered")}
          onPartial={() => postPurchase("partially_received")}
          onReceive={() => postPurchase("received")}
        />
      </div>

      <section className="rounded-3xl border border-white/10 bg-zinc-950/90 p-4 shadow-2xl shadow-black/10">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <Field label="Supplier invoice no." value={supplierInvoiceNumber} onChange={setSupplierInvoiceNumber} />
          <Field label="Shipping" value={shipping} onChange={setShipping} type="number" />
          <Field label="Transport" value={transport} onChange={setTransport} type="number" />
          <Field label="Customs" value={customs} onChange={setCustoms} type="number" />
          <Field label="Additional expenses" value={additionalExpenses} onChange={setAdditionalExpenses} type="number" />
          <Field label="Delivery notes" value={deliveryNotes} onChange={setDeliveryNotes} placeholder="Delivery conditions..." />
          <Field label="Internal notes" value={internalNotes} onChange={setInternalNotes} placeholder="Internal procurement notes..." />
          <label className="block">
            <div className="mb-2 text-[10px] uppercase tracking-[0.18em] text-zinc-500">Attachments</div>
            <span className="flex cursor-pointer items-center justify-center gap-2 rounded-2xl border border-dashed border-white/10 bg-white/5 px-4 py-3 text-sm font-semibold text-white">
              <Upload className="h-4 w-4" />
              Invoice / PDF
              <input type="file" multiple accept="image/*,.pdf" className="hidden" onChange={(event) => setAttachments(Array.from(event.target.files || []))} />
            </span>
            {attachments.length ? <div className="mt-2 truncate text-xs text-zinc-500">{attachments.map((file) => file.name).join(", ")}</div> : null}
          </label>
        </div>
      </section>

      <button
        type="button"
        onClick={() => setCartOpen(true)}
        className="fixed inset-x-4 bottom-4 z-40 flex items-center justify-between rounded-2xl border border-emerald-400/30 bg-emerald-500 px-4 py-3 text-sm font-black text-black shadow-2xl shadow-black/40 xl:hidden"
      >
        <span className="inline-flex items-center gap-2"><ShoppingCart className="h-4 w-4" /> Cart ({cartQty})</span>
        <span>{formatCurrency(total)}</span>
      </button>

      {cartOpen ? (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm xl:hidden">
          <button type="button" className="absolute inset-0" onClick={() => setCartOpen(false)} aria-label="Close cart" />
          <div className="absolute inset-x-0 bottom-0 max-h-[88vh] overflow-y-auto rounded-t-3xl border border-white/10 bg-zinc-950 p-4">
            <PurchaseCart
              compact
              items={items}
              variantsByProduct={variantsByProduct}
              subtotal={subtotal}
              itemDiscount={itemDiscount}
              expenses={expenses}
              discount={discount}
              total={total}
              paymentStatus={paymentStatus}
              status={status}
              posting={posting}
              activeSupplier={activeSupplier}
              cartCostErrors={cartCostErrors}
              onChangeVariant={changeItemVariant}
              onUpdate={updateItem}
              onQty={changeQty}
              onRemove={removeItem}
              onDiscount={setDiscount}
              onPaymentStatus={setPaymentStatus}
              onBulkPrice={setBulkPriceModal}
              onSaveDraft={saveDraft}
              onMarkOrdered={() => postPurchase("ordered")}
              onPartial={() => postPurchase("partially_received")}
              onReceive={() => postPurchase("received")}
              onClose={() => setCartOpen(false)}
            />
          </div>
        </div>
      ) : null}

      {variantSelector ? <VariantSelector group={variantSelector} onAdd={addProduct} onClose={() => setVariantSelector(null)} /> : null}
      {runModal ? <RunModal mode={runModal.mode} initialProduct={runModal.product} productGroups={groupByProduct(products)} onClose={() => setRunModal(null)} onAdd={addRunItems} /> : null}
      {bulkPriceModal ? <BulkPriceModal mode={bulkPriceModal} onClose={() => setBulkPriceModal(null)} onApply={(value) => applyBulkPrice({ type: bulkPriceModal, value })} /> : null}
      {supplierModalOpen ? <QuickSupplierModal form={supplierForm} setForm={setSupplierForm} saving={supplierSaving} error={supplierError} onClose={() => setSupplierModalOpen(false)} onSubmit={saveSupplierFromOrder} /> : null}
      {productModalOpen ? <QuickProductModal form={productForm} setForm={setProductForm} saving={productSaving} error={productError} onClose={() => setProductModalOpen(false)} onSubmit={createInlineProduct} /> : null}
    </FlowShell>
  );
}

function Banner({ tone, message }) {
  const classes = tone === "rose" ? "border-rose-500/20 bg-rose-500/10 text-rose-100" : "border-amber-500/20 bg-amber-500/10 text-amber-100";
  return (
    <div className={`rounded-3xl border p-4 text-sm ${classes}`}>
      <AlertTriangle className="mr-2 inline h-4 w-4" />
      {message}
    </div>
  );
}

function ActionTile({ icon, label, onClick, disabled }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/5 p-4 text-left transition hover:border-emerald-400/30 hover:bg-emerald-400/10 disabled:opacity-40">
      <span className="rounded-xl bg-emerald-500/10 p-2 text-emerald-300">{icon}</span>
      <span className="text-sm font-black text-white">{label}</span>
    </button>
  );
}

function ProductCard({ group, onClick, onSizeRun, onColorRun }) {
  const variants = toArray(group.variants);
  const first = variants[0] || {};
  const totalStock = variants.reduce((sum, item) => sum + money(item.stock), 0);
  const lowStock = variants.some((item) => money(item.stock) <= money(item.low_stock_threshold));
  const reorder = variants.some((item) => item.reorder);
  const fastMoving = variants.some((item) => money(item.reorder?.average_daily_sales || item.reorder?.sold_qty) > 0);
  const colors = Array.from(new Set(variants.map((item) => item.color).filter(Boolean)));
  const sizes = Array.from(new Set(variants.map((item) => item.size).filter(Boolean)));

  return (
    <div className="group overflow-hidden rounded-2xl border border-white/10 bg-white/[0.04] transition hover:border-emerald-400/30 hover:bg-white/[0.07]">
      <button type="button" onClick={onClick} className="block w-full text-left">
        <div className="relative aspect-[4/3] bg-zinc-900">
          <ProductImage src={group.image_url || first.image_url} name={group.product_name} className="h-full w-full object-cover" />
          <div className="absolute left-3 top-3 flex flex-wrap gap-2">
            {lowStock ? <Badge tone="amber" label="Low stock" /> : null}
            {reorder ? <Badge tone="emerald" label="Reorder" /> : null}
            {fastMoving ? <Badge tone="cyan" label="Fast" /> : null}
          </div>
        </div>
        <div className="p-4">
          <div className="line-clamp-1 text-base font-black text-white">{group.product_name}</div>
          <div className="mt-1 text-xs text-zinc-500">SKU {first.sku || "n/a"} | {variants.length} variants</div>
          <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
            <Metric label="Stock" value={totalStock} />
            <Metric label="Last cost" value={formatCurrency(first.cost_price || 0)} />
            <Metric label="Colors" value={colors.slice(0, 3).join(", ") || "Default"} />
            <Metric label="Sizes" value={sizes.slice(0, 4).join(", ") || "One size"} />
          </div>
          {first.supplier_name ? <div className="mt-3 rounded-xl bg-white/5 px-3 py-2 text-xs font-semibold text-zinc-300">{first.supplier_name}</div> : null}
        </div>
      </button>
      <div className="grid grid-cols-2 border-t border-white/10">
        <button type="button" onClick={onSizeRun} className="px-3 py-2 text-xs font-black text-emerald-300 hover:bg-white/5">Size Run</button>
        <button type="button" onClick={onColorRun} className="border-l border-white/10 px-3 py-2 text-xs font-black text-cyan-300 hover:bg-white/5">Color Run</button>
      </div>
    </div>
  );
}

function ProductImage({ src, name, className = "h-12 w-12 rounded-xl object-cover" }) {
  const imageUrl = resolveProductImageUrl(src);
  if (imageUrl) return <img src={imageUrl} alt="" className={className} loading="lazy" />;
  return <div className={`${className} flex items-center justify-center bg-white/5 text-lg font-black text-zinc-500`}>{String(name || "?").slice(0, 1).toUpperCase()}</div>;
}

function Badge({ tone = "zinc", label }) {
  const classes = {
    amber: "bg-amber-400 text-black",
    emerald: "bg-emerald-400 text-black",
    cyan: "bg-cyan-400 text-black",
    rose: "bg-rose-400 text-black",
    zinc: "bg-white/10 text-white",
  };
  return <span className={`rounded-full px-2 py-1 text-[10px] font-black uppercase ${classes[tone]}`}>{label}</span>;
}

function Metric({ label, value }) {
  return (
    <div className="rounded-xl border border-white/10 bg-black/20 p-2">
      <div className="text-[10px] uppercase text-zinc-500">{label}</div>
      <div className="mt-1 truncate font-bold text-white">{value}</div>
    </div>
  );
}

function PurchaseCart({ compact = false, items, variantsByProduct, subtotal, itemDiscount, expenses, discount, total, paymentStatus, status, posting, activeSupplier, cartCostErrors = new Set(), onChangeVariant, onUpdate, onQty, onRemove, onDiscount, onPaymentStatus, onBulkPrice, onSaveDraft, onMarkOrdered, onPartial, onReceive, onClose }) {
  const hasItems = items.length > 0;

  return (
    <aside className={`${compact ? "" : "sticky top-28 hidden xl:block"} rounded-3xl border border-white/10 bg-zinc-950/90 shadow-2xl shadow-black/10`}>
      <div className="flex items-center justify-between border-b border-white/10 p-4">
        <div>
          <div className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">Purchase cart</div>
          <h3 className="mt-1 text-xl font-black text-white">{formatCurrency(total)}</h3>
          {activeSupplier ? <div className="mt-1 text-xs text-zinc-500">{activeSupplier.name}</div> : null}
        </div>
        <div className="flex items-center gap-2">
          <StatusBadge value={status} />
          {onClose ? <button type="button" onClick={onClose} className="rounded-xl border border-white/10 bg-white/5 p-2 text-white"><X className="h-4 w-4" /></button> : null}
        </div>
      </div>

      <div className="border-b border-white/10 p-3">
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => onBulkPrice?.("purchase")}
            disabled={!hasItems}
            className="group inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl border border-emerald-400/25 bg-emerald-400/10 px-3 py-2 text-xs font-black text-emerald-100 shadow-lg shadow-emerald-950/10 transition hover:-translate-y-0.5 hover:border-emerald-300/60 hover:bg-emerald-400/20 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:translate-y-0"
          >
            <ReceiptText className="h-4 w-4 text-emerald-300" />
            Bulk Purchase Price
          </button>
          <button
            type="button"
            onClick={() => onBulkPrice?.("selling")}
            disabled={!hasItems}
            className="group inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl border border-cyan-400/25 bg-cyan-400/10 px-3 py-2 text-xs font-black text-cyan-100 shadow-lg shadow-cyan-950/10 transition hover:-translate-y-0.5 hover:border-cyan-300/60 hover:bg-cyan-400/20 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:translate-y-0"
          >
            <ShoppingCart className="h-4 w-4 text-cyan-300" />
            Bulk Selling Price
          </button>
        </div>
        <p className="mt-2 text-[11px] leading-5 text-zinc-500">
          Bulk changes update invoice lines only. Stock changes happen only when the purchase invoice is confirmed.
        </p>
      </div>

      <div className="max-h-[52vh] space-y-2 overflow-y-auto p-3">
        {items.length === 0 ? (
          <div className="rounded-3xl border border-dashed border-white/10 bg-white/5 p-8 text-center text-sm text-zinc-400">
            Click product cards, scan barcode, or add a size run.
          </div>
        ) : (
          items.map((item) => (
            <CartLine key={String(item.line_id)} item={item} variants={variantsByProduct[String(item.product_id)] || []} showCostError={cartCostErrors.has(String(item.line_id))} onChangeVariant={onChangeVariant} onUpdate={onUpdate} onQty={onQty} onRemove={onRemove} />
          ))
        )}
      </div>

      <div className="border-t border-white/10 p-4">
        <div className="grid grid-cols-2 gap-2">
          <Summary label="Subtotal" value={formatCurrency(subtotal)} />
          <Summary label="Item discount" value={formatCurrency(itemDiscount)} />
          <Summary label="Expenses" value={formatCurrency(expenses)} />
          <label className="rounded-2xl border border-white/10 bg-white/5 p-3">
            <div className="text-[10px] uppercase tracking-[0.18em] text-zinc-500">Order discount</div>
            <input type="number" min="0" value={discount} onChange={(event) => onDiscount(money(event.target.value))} className="mt-1 w-full bg-transparent text-sm font-semibold text-white outline-none" />
          </label>
        </div>
        <div className="mt-3 flex items-center justify-between rounded-2xl bg-emerald-500 px-4 py-3 text-black">
          <span className="text-sm font-black">Grand total</span>
          <span className="text-lg font-black">{formatCurrency(total)}</span>
        </div>
        <Select label="Payment" value={paymentStatus} onChange={onPaymentStatus} options={["pending", "partially_paid", "paid"].map((value) => ({ value, label: value.replace("_", " ") }))} />
        <div className="mt-3 grid grid-cols-2 gap-2">
          <button type="button" onClick={onSaveDraft} className="inline-flex items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-3 py-3 text-sm font-semibold text-white hover:bg-white/10">
            <Save className="h-4 w-4" /> Draft
          </button>
          <button type="button" onClick={onMarkOrdered} disabled={posting} className="inline-flex items-center justify-center gap-2 rounded-2xl border border-cyan-400/20 bg-cyan-400/10 px-3 py-3 text-sm font-black text-cyan-200 disabled:opacity-40">
            <Send className="h-4 w-4" /> Ordered
          </button>
          <button type="button" onClick={onPartial} disabled={posting} className="inline-flex items-center justify-center gap-2 rounded-2xl border border-amber-400/20 bg-amber-400/10 px-3 py-3 text-sm font-black text-amber-200 disabled:opacity-40">
            Partial
          </button>
          <button type="button" onClick={onReceive} disabled={posting} className="inline-flex items-center justify-center gap-2 rounded-2xl bg-emerald-500 px-3 py-3 text-sm font-black text-black disabled:opacity-40">
            <Truck className="h-4 w-4" /> {posting ? "Posting..." : "Receive"}
          </button>
        </div>
      </div>
    </aside>
  );
}

function CartLine({ item, variants, showCostError = false, onChangeVariant, onUpdate, onQty, onRemove }) {
  const salePrice = item.selling_price ?? item.sale_price ?? item.price ?? 0;

  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.04] p-3">
      <div className="grid grid-cols-[3rem_minmax(0,1fr)_auto] gap-3">
        <ProductImage src={item.image_url} name={item.product_name} />
        <div className="min-w-0">
          <div className="truncate text-sm font-black text-white">{item.product_name}</div>
          <div className="mt-1 text-xs text-zinc-500">{item.color || "Default"} / {item.size || "One size"}</div>
          <div className="mt-1 text-xs text-zinc-500">{item.barcode || item.sku || "No barcode"}</div>
        </div>
        <button type="button" onClick={() => onRemove(item.line_id)} className="h-9 rounded-xl border border-white/10 bg-white/5 p-2 text-white">
          <Trash2 className="h-4 w-4" />
        </button>
      </div>
      {variants.length > 1 ? (
        <select value={item.variant_id || ""} onChange={(event) => onChangeVariant(item.line_id, event.target.value)} className="mt-3 w-full rounded-xl border border-white/10 bg-zinc-950 px-3 py-2 text-sm text-white outline-none">
          {variants.map((variant) => (
            <option key={variant.line_id} value={variant.variant_id || ""}>
              {variant.color || "Default"} / {variant.size || "One size"}
            </option>
          ))}
        </select>
      ) : null}
      <div className="mt-3 grid grid-cols-[auto_1fr_1fr] items-center gap-2">
        <div className="flex items-center rounded-xl border border-white/10 bg-white/5">
          <button type="button" onClick={() => onQty(item.line_id, -1)} className="p-2 text-white"><Minus className="h-4 w-4" /></button>
          <input type="number" min="1" value={item.quantity} onChange={(event) => onUpdate(item.line_id, { quantity: Math.max(1, money(event.target.value)) })} className="w-12 bg-transparent text-center text-sm font-black text-white outline-none" />
          <button type="button" onClick={() => onQty(item.line_id, 1)} className="p-2 text-white"><Plus className="h-4 w-4" /></button>
        </div>
        <div>
          <input type="number" min="0" step="0.01" value={item.cost_price} onChange={(event) => onUpdate(item.line_id, { cost_price: money(event.target.value) })} className={`w-full rounded-xl border px-3 py-2 text-sm text-white outline-none ${showCostError ? "border-rose-400/60 bg-rose-500/10" : "border-white/10 bg-white/5"}`} />
          {showCostError ? <div className="mt-1 text-xs font-semibold text-rose-200">Enter purchase cost</div> : null}
        </div>
        <div className="text-right text-sm font-black text-white">{formatCurrency(money(item.quantity) * money(item.cost_price))}</div>
      </div>
      <div className="mt-2 grid grid-cols-2 gap-2">
        <label className="rounded-xl border border-cyan-400/20 bg-cyan-400/10 px-3 py-2">
          <div className="text-[10px] font-black uppercase tracking-[0.14em] text-cyan-200">Selling</div>
          <input
            type="number"
            min="0"
            step="0.01"
            value={salePrice}
            onChange={(event) => onUpdate(item.line_id, { selling_price: money(event.target.value), sale_price: money(event.target.value), price: money(event.target.value) })}
            className="mt-1 w-full bg-transparent text-xs font-black text-white outline-none"
          />
        </label>
        <input type="number" min="0" value={item.received_quantity || 0} onChange={(event) => onUpdate(item.line_id, { received_quantity: money(event.target.value) })} placeholder="Received" className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-white outline-none" />
      </div>
      <div className="mt-2 grid grid-cols-1 gap-2">
        <input type="number" min="0" value={item.discount || 0} onChange={(event) => onUpdate(item.line_id, { discount: money(event.target.value) })} placeholder="Discount" className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-white outline-none" />
      </div>
      <div className="mt-2 text-xs text-zinc-500">
        Last purchase: {formatCurrency(item.last_purchase_cost || item.cost_price || 0)} {item.last_purchase_date ? `| ${String(item.last_purchase_date).slice(0, 10)}` : ""}
      </div>
    </div>
  );
}

function ProductSearchPanel({ search, products, results, loading, onAdd }) {
  const hasSearch = Boolean(text(search));
  const hasProducts = Array.isArray(products) && products.length > 0;
  const rows = Array.isArray(results) ? results.slice(0, 12) : [];

  return (
    <div className="absolute left-0 right-0 top-[calc(100%+0.5rem)] z-30 overflow-hidden rounded-2xl border border-white/10 bg-zinc-950 shadow-2xl shadow-black/40">
      <div className="border-b border-white/10 px-4 py-3 text-xs font-semibold text-zinc-400">
        {loading ? "Loading products..." : hasSearch ? "Matching products" : "Start typing or choose from recent products"}
      </div>
      {loading ? (
        <div className="px-4 py-5 text-sm text-zinc-400">Loading products...</div>
      ) : !hasProducts ? (
        <div className="px-4 py-5">
          <div className="text-sm font-semibold text-white">No products found. Add products first.</div>
          <Link to="/products/create" className="mt-3 inline-flex items-center gap-2 rounded-xl bg-emerald-500 px-3 py-2 text-xs font-black text-black">
            <Plus className="h-4 w-4" /> Add Product
          </Link>
        </div>
      ) : rows.length === 0 ? (
        <div className="px-4 py-5 text-sm text-zinc-400">No matching products found.</div>
      ) : (
        <div className="max-h-96 overflow-y-auto p-2">
          {rows.map((product) => (
            <button key={product.line_id} type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => onAdd(product)} className="grid w-full grid-cols-[3rem_minmax(0,1fr)_auto] items-center gap-3 rounded-xl px-3 py-3 text-left transition hover:bg-white/10 focus:bg-white/10 focus:outline-none">
              <ProductImage src={product.image_url} name={product.product_name} />
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold text-white">{product.product_name}</div>
                <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-zinc-400">
                  <span>SKU {product.sku || "n/a"}</span>
                  <span>{product.color || "Default"}</span>
                  <span>{product.size || "One size"}</span>
                </div>
              </div>
              <div className="text-right text-xs">
                <div className="font-semibold text-zinc-200">Stock {product.stock}</div>
                <div className="mt-1 text-emerald-300">{formatCurrency(product.cost_price || 0)}</div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function VariantSelector({ group, onAdd, onClose }) {
  return (
    <Modal title={group.product_name} eyebrow="Select variant" onClose={onClose}>
      <div className="grid gap-2 sm:grid-cols-2">
        {toArray(group.variants).map((variant) => (
          <button key={variant.line_id} type="button" onClick={() => { onAdd(variant); onClose(); }} className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/5 p-3 text-left hover:bg-white/10">
            <ProductImage src={variant.image_url} name={variant.product_name} />
            <div className="min-w-0">
              <div className="font-black text-white">{variant.color || "Default"} / {variant.size || "One size"}</div>
              <div className="text-xs text-zinc-500">{variant.sku || "n/a"} | Stock {variant.stock}</div>
              <div className="text-xs text-emerald-300">{formatCurrency(variant.cost_price)}</div>
            </div>
          </button>
        ))}
      </div>
    </Modal>
  );
}

function BulkPriceModal({ mode, onClose, onApply }) {
  const [value, setValue] = useState("");
  const [error, setError] = useState("");
  const isPurchase = mode === "purchase";

  const submit = (event) => {
    event.preventDefault();
    const price = Number(value);
    if (!Number.isFinite(price) || price < 0 || value === "") {
      setError("Enter a valid number greater than or equal to 0");
      return;
    }
    const applied = onApply(price);
    if (!applied) setError("Price could not be applied");
  };

  return (
    <Modal
      eyebrow="Bulk pricing"
      title={isPurchase ? "Bulk Purchase Price" : "Bulk Selling Price"}
      onClose={onClose}
    >
      <form onSubmit={submit} className="space-y-4">
        <div className={`rounded-3xl border p-4 ${isPurchase ? "border-emerald-400/25 bg-emerald-400/10" : "border-cyan-400/25 bg-cyan-400/10"}`}>
          <div className="text-sm font-black text-white">
            {isPurchase ? "Apply one purchase cost to all current invoice lines." : "Apply one selling price to all current invoice lines."}
          </div>
          <p className="mt-2 text-sm leading-6 text-zinc-300">
            {isPurchase
              ? "This updates unit_cost, cost_price, purchase_price, each line subtotal, and the invoice total immediately."
              : "This updates selling_price, sale_price, and price locally. It does not receive stock; it is sent with the invoice when saved or confirmed."}
          </p>
        </div>

        <label className="block">
          <div className="mb-2 text-[10px] uppercase tracking-[0.18em] text-zinc-500">Price</div>
          <input
            autoFocus
            type="number"
            min="0"
            step="0.01"
            value={value}
            onChange={(event) => {
              setValue(event.target.value);
              setError("");
            }}
            placeholder="0.00"
            className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-lg font-black text-white outline-none placeholder:text-zinc-600 focus:border-emerald-400/50"
          />
          {error ? <div className="mt-2 text-sm font-semibold text-rose-200">{error}</div> : null}
        </label>

        <div className="grid gap-3 sm:grid-cols-2">
          <button type="button" onClick={onClose} className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-semibold text-white transition hover:bg-white/10">
            Cancel
          </button>
          <button type="submit" className={`rounded-2xl px-4 py-3 text-sm font-black text-black transition ${isPurchase ? "bg-emerald-500 hover:bg-emerald-400" : "bg-cyan-400 hover:bg-cyan-300"}`}>
            Apply
          </button>
        </div>
      </form>
    </Modal>
  );
}

function RunModal({ mode, initialProduct, productGroups, onClose, onAdd }) {
  const [productId, setProductId] = useState(String(initialProduct?.product_id || productGroups[0]?.product_id || ""));
  const selected = productGroups.find((group) => String(group.product_id) === String(productId)) || productGroups[0] || null;
  const colors = Array.from(new Set(toArray(selected?.variants).map((item) => item.color || "Default")));
  const [color, setColor] = useState(colors[0] || "Default");
  const [expandedColors, setExpandedColors] = useState(() => new Set(colors));
  const [qtyMap, setQtyMap] = useState({});
  const [cartonQty, setCartonQty] = useState(1);

  useEffect(() => {
    const nextColors = Array.from(new Set(toArray(selected?.variants).map((item) => item.color || "Default")));
    setColor(nextColors[0] || "Default");
    setExpandedColors(new Set(nextColors));
    setQtyMap({});
  }, [productId]);

  const visibleColors = mode === "color" || mode === "full" || mode === "carton" ? colors : [color];
  const rows = visibleColors.map((colorName) => ({
    color: colorName,
    variants: toArray(selected?.variants).filter((item) => (item.color || "Default") === colorName),
  }));

  const setAll = (qty) => {
    const next = {};
    rows.forEach((section) => section.variants.forEach((variant) => { next[variant.line_id] = qty; }));
    setQtyMap(next);
  };

  const addRun = () => {
    const lines = [];
    rows.forEach((section) => {
      section.variants.forEach((variant) => {
        const quantity = mode === "carton" ? money(cartonQty) : money(qtyMap[variant.line_id]);
        if (quantity > 0) lines.push({ product: variant, quantity });
      });
    });
    if (!lines.length) {
      toast.error("Enter quantities first");
      return;
    }
    onAdd(lines);
  };

  return (
    <Modal title={mode === "carton" ? "Carton purchasing" : mode === "color" ? "Color run" : mode === "full" ? "Full model entry" : "Size run"} eyebrow="Bulk variants" onClose={onClose}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Select label="Model" value={productId} onChange={setProductId} options={productGroups.map((group) => ({ value: group.product_id, label: group.product_name }))} />
        {mode === "size" ? <Select label="Color" value={color} onChange={setColor} options={colors.map((value) => ({ value, label: value }))} /> : null}
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        <button type="button" onClick={() => setAll(1)} className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs font-black text-white">Fill all = 1</button>
        <button type="button" onClick={() => setAll(2)} className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs font-black text-white">Fill all = 2</button>
        <button type="button" onClick={() => setAll(0)} className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs font-black text-white">Clear all</button>
        {mode === "carton" ? (
          <label className="ml-auto flex items-center gap-2 rounded-xl border border-emerald-400/20 bg-emerald-400/10 px-3 py-2 text-xs font-black text-emerald-200">
            Carton qty
            <input type="number" min="1" value={cartonQty} onChange={(event) => setCartonQty(Math.max(1, money(event.target.value)))} className="w-16 bg-transparent text-white outline-none" />
          </label>
        ) : null}
      </div>
      <div className="mt-4 max-h-[55vh] space-y-3 overflow-y-auto">
        {rows.map((section) => {
          const expanded = expandedColors.has(section.color);
          return (
            <div key={section.color} className="rounded-2xl border border-white/10 bg-white/5">
              <button type="button" onClick={() => setExpandedColors((prev) => {
                const next = new Set(prev);
                if (next.has(section.color)) next.delete(section.color);
                else next.add(section.color);
                return next;
              })} className="flex w-full items-center justify-between px-4 py-3 text-left">
                <span className="font-black text-white">{section.color}</span>
                {expanded ? <ChevronUp className="h-4 w-4 text-zinc-400" /> : <ChevronDown className="h-4 w-4 text-zinc-400" />}
              </button>
              {expanded ? (
                <div className="grid grid-cols-2 gap-2 p-3 sm:grid-cols-4">
                  {section.variants.map((variant) => (
                    <label key={variant.line_id} className="rounded-xl border border-white/10 bg-zinc-950/70 p-3">
                      <div className="text-sm font-black text-white">{variant.size || "One size"}</div>
                      <div className="text-[11px] text-zinc-500">Stock {variant.stock}</div>
                      <div className="mt-2 flex items-center rounded-lg bg-white/5">
                        <button type="button" onClick={() => setQtyMap((prev) => ({ ...prev, [variant.line_id]: Math.max(0, money(prev[variant.line_id]) - 1) }))} className="p-2 text-white"><Minus className="h-3 w-3" /></button>
                        <input value={mode === "carton" ? cartonQty : qtyMap[variant.line_id] || ""} disabled={mode === "carton"} onChange={(event) => setQtyMap((prev) => ({ ...prev, [variant.line_id]: money(event.target.value) }))} className="w-full bg-transparent text-center text-sm font-black text-white outline-none disabled:text-emerald-300" />
                        <button type="button" onClick={() => setQtyMap((prev) => ({ ...prev, [variant.line_id]: money(prev[variant.line_id]) + 1 }))} disabled={mode === "carton"} className="p-2 text-white disabled:opacity-30"><Plus className="h-3 w-3" /></button>
                      </div>
                    </label>
                  ))}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
      <button type="button" onClick={addRun} className="mt-4 w-full rounded-2xl bg-emerald-500 px-4 py-3 text-sm font-black text-black">
        Add Run
      </button>
    </Modal>
  );
}

function Modal({ eyebrow, title, children, onClose }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 backdrop-blur-sm sm:items-center">
      <button type="button" className="absolute inset-0 cursor-default" onClick={onClose} aria-label="Close" />
      <div className="relative w-full max-w-4xl rounded-t-3xl border border-white/10 bg-zinc-950 p-5 shadow-2xl shadow-black sm:rounded-3xl">
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-300">{eyebrow}</div>
            <h3 className="mt-1 text-xl font-black text-white">{title}</h3>
          </div>
          <button type="button" onClick={onClose} className="rounded-xl border border-white/10 bg-white/5 p-2 text-white">
            <X className="h-5 w-5" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function Select({ label, value, onChange, options, emptyLabel = "No options" }) {
  return (
    <label className="block">
      <div className="mb-2 text-[10px] uppercase tracking-[0.18em] text-zinc-500">{label}</div>
      <select value={value} onChange={(event) => onChange(event.target.value)} className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm capitalize text-white outline-none">
        {options.length === 0 ? <option value="" className="bg-zinc-950 text-white">{emptyLabel}</option> : null}
        {options.map((option) => (
          <option key={String(option.value)} value={option.value} className="bg-zinc-950 text-white">
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function Field({ label, value, onChange, type = "text", placeholder }) {
  return (
    <label className="block">
      <div className="mb-2 text-[10px] uppercase tracking-[0.18em] text-zinc-500">{label}</div>
      <input type={type} value={value} onChange={(event) => onChange(type === "number" ? money(event.target.value) : event.target.value)} placeholder={placeholder} className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white outline-none placeholder:text-zinc-500" />
    </label>
  );
}

function Summary({ label, value }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
      <div className="text-[10px] uppercase tracking-[0.18em] text-zinc-500">{label}</div>
      <div className="mt-1 text-sm font-semibold text-white">{value}</div>
    </div>
  );
}

function CardSkeleton() {
  return (
    <div className="mt-4 grid gap-3 sm:grid-cols-2 2xl:grid-cols-3">
      {Array.from({ length: 6 }).map((_, index) => <div key={index} className="h-80 animate-pulse rounded-2xl border border-white/10 bg-white/5" />)}
    </div>
  );
}

function QuickSupplierModal({ form, setForm, saving, error, onClose, onSubmit }) {
  const setField = (field, value) => setForm((prev) => ({ ...prev, [field]: value }));
  return (
    <Modal eyebrow="Supplier" title="Quick-create supplier" onClose={onClose}>
      <form onSubmit={onSubmit}>
        {error ? <div className="mb-4 rounded-2xl border border-rose-500/20 bg-rose-500/10 p-3 text-sm text-rose-100">{error}</div> : null}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Supplier name" value={form.name} onChange={(value) => setField("name", value)} />
          <Field label="Phone" value={form.phone} onChange={(value) => setField("phone", value)} />
          <Field label="WhatsApp" value={form.whatsapp} onChange={(value) => setField("whatsapp", value)} />
          <Field label="Email" value={form.email} onChange={(value) => setField("email", value)} />
          <Field label="Contact person" value={form.contact_person} onChange={(value) => setField("contact_person", value)} />
          <Field label="Opening balance" type="number" value={form.opening_balance} onChange={(value) => setField("opening_balance", money(value))} />
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <button type="button" onClick={onClose} className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-semibold text-white">Cancel</button>
          <button type="submit" disabled={saving} className="rounded-2xl bg-emerald-500 px-4 py-3 text-sm font-black text-black disabled:opacity-40">{saving ? "Saving..." : "Create and select"}</button>
        </div>
      </form>
    </Modal>
  );
}

function QuickProductModal({ form, setForm, saving, error, onClose, onSubmit }) {
  const setField = (field, value) => setForm((prev) => ({ ...prev, [field]: value }));
  return (
    <Modal eyebrow="Product" title="Quick-create product and variants" onClose={onClose}>
      <form onSubmit={onSubmit}>
        {error ? <div className="mb-4 rounded-2xl border border-rose-500/20 bg-rose-500/10 p-3 text-sm text-rose-100">{error}</div> : null}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Product name" value={form.name} onChange={(value) => setField("name", value)} />
          <Field label="Category" value={form.category} onChange={(value) => setField("category", value)} />
          <Field label="Brand" value={form.brand} onChange={(value) => setField("brand", value)} />
          <Field label="Colors" value={form.colors} onChange={(value) => setField("colors", value)} />
          <Field label="Sizes" value={form.sizes} onChange={(value) => setField("sizes", value)} />
          <Field label="Purchase cost" type="number" value={form.purchase_cost} onChange={(value) => setField("purchase_cost", value)} />
          <Field label="Sale price" type="number" value={form.sale_price} onChange={(value) => setField("sale_price", value)} />
          <Field label="Barcode/SKU prefix" value={form.sku} onChange={(value) => setField("sku", value)} />
          <Field label="Barcode" value={form.barcode} onChange={(value) => setField("barcode", value)} />
          <Field label="Image URL" value={form.image_url} onChange={(value) => setField("image_url", value)} />
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <button type="button" onClick={onClose} className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-semibold text-white">Cancel</button>
          <button type="submit" disabled={saving} className="rounded-2xl bg-emerald-500 px-4 py-3 text-sm font-black text-black disabled:opacity-40">{saving ? "Creating..." : "Create and add"}</button>
        </div>
      </form>
    </Modal>
  );
}

export default PurchaseOrder;
