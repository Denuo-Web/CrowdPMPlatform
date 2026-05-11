import { APP_ROUTES } from "./appRoutes";

export function buildActivationLink(): string {
  if (typeof window === "undefined") {
    return `https://crowdpmplatform.web.app${APP_ROUTES.activation}`;
  }
  const url = new URL(window.location.href);
  url.pathname = APP_ROUTES.activation;
  url.search = "";
  url.hash = "";
  return url.toString();
}
