import type { DesktopOpenThreadRequest } from "@t3tools/contracts";

/** The hash location of the thread route, which is how desktop routes. */
function desktopThreadDeepLinkHash(request: DesktopOpenThreadRequest): string {
  return `#/${encodeURIComponent(request.environmentId)}/${encodeURIComponent(request.threadId)}`;
}

/**
 * Consumes the `t3code://thread/...` deep link the desktop shell buffered for
 * this window and makes it the window's initial location.
 *
 * This has to happen before the router exists rather than from a component:
 * the index route replaces `/` with a fresh draft as soon as the environment
 * finishes bootstrapping, which lands after any navigation a mount effect
 * could perform.
 */
export async function applyPendingDesktopThreadDeepLink(): Promise<void> {
  const takePending = window.desktopBridge?.takePendingOpenThread;
  if (takePending === undefined) return;
  const pending = await takePending().catch(() => null);
  if (pending === null) return;
  window.location.hash = desktopThreadDeepLinkHash(pending);
}
