export { COOKIE_NAME, ONE_YEAR_MS } from "@shared/const";

export const startLogin = (returnTo: string = "/") => {
  const apiBaseUrl = import.meta.env.VITE_API_URL ?? "";
  const params = new URLSearchParams({ returnTo });
  window.location.href = `${apiBaseUrl}/api/oauth/start?${params.toString()}`;
};
