/*
 * Who the shop is, in one place: the footer, the contact page, the about page and the
 * Organization JSON-LD all read it. Google's misrepresentation check compares the site with the
 * Merchant Center and Business Profile records, so the address here must stay the one on the
 * verified Business Profile (owner, 2026-10-21: the El-Bashbishi street branch).
 */
export const STORE_IDENTITY = Object.freeze({
  name: "M1 Store",
  url: "https://m1store-egy.com",
  logo: "https://m1store-egy.com/branding/m-one-logo-dark-fixed.png",
  email: "support@m1store-egy.com",
  phoneDisplay: "01000659301",
  phoneE164: "+201000659301",
  mapUrl: "https://maps.app.goo.gl/w6afynf7M9Wh8K9E7",
  address: Object.freeze({
    ar: "شارع البشبيشي، بجوار الفرنسية جروب، دمياط الجديدة، دمياط 34523",
    en: "El-Bashbishi St., next to El Faransia Group, New Damietta, Damietta 34523, Egypt",
    street: "El-Bashbishi St., next to El Faransia Group",
    locality: "New Damietta",
    region: "Damietta",
    postalCode: "34523",
    country: "EG",
  }),
  // The hours in the storefront.working_hours setting (what the contact page shows).
  hours: Object.freeze({
    ar: "السبت – الخميس من 12 ظهرًا حتى 1 بعد منتصف الليل، والجمعة من 2 ظهرًا حتى 1 بعد منتصف الليل",
    en: "Saturday – Thursday 12 PM – 1 AM, Friday 2 PM – 1 AM",
    schedule: Object.freeze([
      Object.freeze({ days: ["Saturday", "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday"], opens: "12:00", closes: "01:00" }),
      Object.freeze({ days: ["Friday"], opens: "14:00", closes: "01:00" }),
    ]),
  }),
  sameAs: Object.freeze(["https://www.facebook.com/m1store.egy", "https://www.instagram.com/m1store_egy"]),
  foundingCountry: "EG",
});

export const storeAddressFor = (lang = "ar") =>
  String(lang).toLowerCase().startsWith("ar") ? STORE_IDENTITY.address.ar : STORE_IDENTITY.address.en;

/* The schema.org record of the shop itself. Product pages already carry Offer/MerchantReturnPolicy;
   this is the identity those offers belong to. */
export const buildStoreOrganizationJsonLd = () => {
  const { name, url, logo, email, phoneE164, mapUrl, address, hours, sameAs } = STORE_IDENTITY;
  return {
    "@context": "https://schema.org",
    "@type": ["OnlineStore", "ShoeStore"],
    "@id": `${url}/#organization`,
    name,
    url,
    logo,
    image: logo,
    email,
    telephone: phoneE164,
    hasMap: mapUrl,
    address: {
      "@type": "PostalAddress",
      streetAddress: address.street,
      addressLocality: address.locality,
      addressRegion: address.region,
      postalCode: address.postalCode,
      addressCountry: address.country,
    },
    sameAs: [...sameAs],
    // A closing time before the opening time runs past midnight.
    openingHoursSpecification: hours.schedule.map(({ days, opens, closes }) => ({
      "@type": "OpeningHoursSpecification",
      dayOfWeek: [...days],
      opens,
      closes,
    })),
    contactPoint: [{
      "@type": "ContactPoint",
      contactType: "customer service",
      telephone: phoneE164,
      email,
      areaServed: "EG",
      availableLanguage: ["ar", "en"],
    }],
  };
};

export const buildStoreWebsiteJsonLd = () => ({
  "@context": "https://schema.org",
  "@type": "WebSite",
  "@id": `${STORE_IDENTITY.url}/#website`,
  name: STORE_IDENTITY.name,
  url: STORE_IDENTITY.url,
  inLanguage: "ar-EG",
  publisher: { "@id": `${STORE_IDENTITY.url}/#organization` },
  potentialAction: {
    "@type": "SearchAction",
    target: `${STORE_IDENTITY.url}/products?q={search_term_string}`,
    "query-input": "required name=search_term_string",
  },
});
