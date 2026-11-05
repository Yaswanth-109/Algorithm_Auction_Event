export function getApiBase() {
  if (process.env.NEXT_PUBLIC_DYNAMIC_API_HOST === "true" && typeof window !== "undefined") {
    const apiUrl = new URL(window.location.origin);
    apiUrl.port = "4000";
    return apiUrl.origin;
  }
  return process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
}
