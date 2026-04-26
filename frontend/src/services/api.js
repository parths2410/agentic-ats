const BASE_URL = import.meta.env.VITE_API_BASE_URL || "/api";

async function request(path, options = {}) {
  const init = { ...options };
  init.headers = { ...(options.headers || {}) };
  if (init.body && !(init.body instanceof FormData) && !init.headers["Content-Type"]) {
    init.headers["Content-Type"] = "application/json";
  }
  const res = await fetch(`${BASE_URL}${path}`, init);
  if (res.status === 204) return null;
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const detail = (data && (data.detail || data.message)) || text || `HTTP ${res.status}`;
    const err = new Error(typeof detail === "string" ? detail : JSON.stringify(detail));
    err.status = res.status;
    throw err;
  }
  return data;
}

export const api = {
  health: () => request("/health"),

  roles: {
    list: () => request("/roles"),
    get: (id) => request(`/roles/${id}`),
    create: (payload) => request("/roles", { method: "POST", body: JSON.stringify(payload) }),
    update: (id, payload) =>
      request(`/roles/${id}`, { method: "PUT", body: JSON.stringify(payload) }),
    delete: (id) => request(`/roles/${id}`, { method: "DELETE" }),
  },

  criteria: {
    list: (roleId) => request(`/roles/${roleId}/criteria`),
    create: (roleId, payload) =>
      request(`/roles/${roleId}/criteria`, { method: "POST", body: JSON.stringify(payload) }),
    update: (roleId, id, payload) =>
      request(`/roles/${roleId}/criteria/${id}`, {
        method: "PUT",
        body: JSON.stringify(payload),
      }),
    delete: (roleId, id) =>
      request(`/roles/${roleId}/criteria/${id}`, { method: "DELETE" }),
    extract: (roleId) =>
      request(`/roles/${roleId}/criteria/extract`, { method: "POST" }),
  },
};
