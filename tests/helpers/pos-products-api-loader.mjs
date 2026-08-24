// Test-only module loader: lets Node import src/modules/pos/services/posProductsApi.js
// directly. Two gaps it bridges: the HTTP-client-backed productsApi module is replaced
// with an inert stub, and the src tree's extensionless relative imports get their .js.
const STUB = "data:text/javascript,export const getProductsWithVariants = async () => [];";

export const resolve = async (specifier, context, next) => {
  if (specifier.endsWith("products/services/productsApi")) {
    return { shortCircuit: true, url: STUB };
  }
  if ((specifier.startsWith("./") || specifier.startsWith("../")) && !/\.[a-z]+$/i.test(specifier)) {
    return next(`${specifier}.js`, context);
  }
  return next(specifier, context);
};
