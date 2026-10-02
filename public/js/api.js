// Thin client for the backend API. Errors carry the server's user-facing message.

export class ApiError extends Error {
  constructor(message, code, status) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

async function getJson(url, { signal, fallbackMessage }) {
  let res;
  try {
    res = await fetch(url, { signal, headers: { Accept: "application/json" } });
  } catch (err) {
    if (err.name === "AbortError") throw err;
    throw new ApiError("Keine Verbindung zum Server. Bitte versuche es erneut.", "network", 0);
  }
  let body = null;
  try {
    body = await res.json();
  } catch {
    // Non-JSON error page (e.g. a platform 502): fall back to a generic message.
  }
  if (!res.ok || body === null) {
    throw new ApiError(body?.error?.message ?? fallbackMessage, body?.error?.code ?? "http_error", res.status);
  }
  return body;
}

export async function fetchLocations(q, { signal } = {}) {
  const body = await getJson(`/api/locations?q=${encodeURIComponent(q)}`, {
    signal,
    fallbackMessage: "Die Ortssuche ist im Moment nicht erreichbar. Die Karte kannst du weiter nutzen.",
  });
  return Array.isArray(body.locations) ? body.locations : [];
}
