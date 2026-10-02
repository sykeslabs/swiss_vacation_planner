// Thin client for the backend API. Errors carry the server's user-facing message.

export class ApiError extends Error {
  constructor(message, code, status) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

async function requestJson(url, { signal, fallbackMessage, payload }) {
  let res;
  try {
    res = await fetch(url, payload === undefined
      ? { signal, headers: { Accept: "application/json" } }
      : { method: "POST", signal, body: JSON.stringify(payload),
          headers: { Accept: "application/json", "Content-Type": "application/json" } });
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
    // Only our own errors carry snake_case codes and German messages. Platform errors
    // (e.g. Vercel's {"error":{"code":"500","message":"A server error has occurred"}})
    // look similar but must not reach the user.
    const ours = typeof body?.error?.code === "string" && /^[a-z_]+$/.test(body.error.code);
    throw new ApiError(ours ? body.error.message : fallbackMessage, ours ? body.error.code : "http_error", res.status);
  }
  return body;
}

export async function fetchLocations(q, { signal } = {}) {
  const body = await requestJson(`/api/locations?q=${encodeURIComponent(q)}`, {
    signal,
    fallbackMessage: "Die Ortssuche ist im Moment nicht erreichbar. Die Karte kannst du weiter nutzen.",
  });
  return Array.isArray(body.locations) ? body.locations : [];
}

export async function postOptimize(payload, { signal } = {}) {
  return requestJson("/api/optimize", {
    signal,
    payload,
    fallbackMessage: "Der Kalender konnte nicht berechnet werden. Bitte versuche es erneut.",
  });
}
