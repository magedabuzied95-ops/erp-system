export const SCHOOL_BAG_SIZE_OPTIONS = Array.from({ length: 11 }, (_, index) => {
  const inches = index + 12;
  return {
    value: `${inches}-inch`,
    label: `${inches} بوصة`,
    inches,
  };
});

export const isSchoolBagType = (value) =>
  ["school-bag", "school_bag"].includes(String(value || "").trim().toLowerCase());

