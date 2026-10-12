// Public display data only; VITE_* values are included in the frontend bundle.
function phone(value: string | undefined): string {
  const configured = value?.trim() || "";
  return /^[+\d][\d\s()-]*$/.test(configured) ? configured : "";
}

export const publicContact = {
  businessMobile: phone(import.meta.env.VITE_CONTACT_BUSINESS_MOBILE),
  technicalMobile: phone(import.meta.env.VITE_CONTACT_TECHNICAL_MOBILE),
  landline: phone(import.meta.env.VITE_CONTACT_LANDLINE)
};
