import { ProxyAgent, setGlobalDispatcher } from "undici";

type Environment = Record<string, string | undefined>;

// Node's global fetch (undici) ignores HTTPS_PROXY/HTTP_PROXY. Behind an egress
// proxy (e.g. the OneCLI gateway) every request must be routed through a
// ProxyAgent explicitly, or it bypasses the proxy and gets blocked.
// ponytail: NO_PROXY is not honored — this server only talks to provider hosts,
// all of which go through the gateway. Parse NO_PROXY if that ever changes.
export function proxyUrl(env: Environment): string | undefined {
  return (
    env.HTTPS_PROXY ??
    env.https_proxy ??
    env.HTTP_PROXY ??
    env.http_proxy ??
    undefined
  );
}

// Installs a global proxy dispatcher when a proxy is configured. Returns the
// proxy URL that was applied, or undefined when none is set.
export function configureProxy(
  env: Environment = process.env,
): string | undefined {
  const url = proxyUrl(env);
  if (url) {
    setGlobalDispatcher(new ProxyAgent(url));
  }
  return url;
}
