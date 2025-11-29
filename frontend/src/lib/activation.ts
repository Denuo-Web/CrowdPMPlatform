export function buildActivationLink(): string {
  if (typeof window === "undefined") {
    return "https://crowdpmplatform.web.app/activate";
  }
  const url = new URL(window.location.href);
  url.pathname = "/activate";
  url.search = "";
  url.hash = "";
  return url.toString();
}
