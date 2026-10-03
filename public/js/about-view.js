// "Über Adam": which contact/donation elements to show. Values come only from the server
// configuration (environment variables, injected into the page); missing → hidden.

const EMAIL_RE = /^[^@\s<>"']{1,64}@[A-Za-z0-9.-]{1,190}\.[A-Za-z]{2,}$/;
const URL_RE = /^https?:\/\/[^\s<>"']{3,500}$/;

/** Reads the JSON block the server put into the page; never throws. */
export function readAboutConfig(text) {
  try {
    const data = JSON.parse(text ?? "null");
    return data && typeof data === "object" ? data : {};
  } catch {
    return {};
  }
}

/** { contact, website, donate } — each { href, text } or null. */
export function aboutLinks(config = {}) {
  const email = typeof config.contact_email === "string" && EMAIL_RE.test(config.contact_email)
    ? config.contact_email : null;
  const website = typeof config.website_url === "string" && URL_RE.test(config.website_url) ? config.website_url : null;
  const donate = typeof config.donate_url === "string" && URL_RE.test(config.donate_url) ? config.donate_url : null;
  let host = website;
  try {
    host = website && new URL(website).host.replace(/^www\./, "");
  } catch {
    host = website;
  }
  return {
    contact: email ? { href: `mailto:${email}`, text: email } : null,
    website: website ? { href: website, text: host } : null,
    donate: donate ? { href: donate, text: (typeof config.donate_label === "string" && config.donate_label.trim()) || "Spenden" } : null,
  };
}
