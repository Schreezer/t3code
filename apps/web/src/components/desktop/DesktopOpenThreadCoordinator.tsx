import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";

import { buildThreadRouteParams } from "../../threadRoutes";

/**
 * Routes `t3code://thread/<environmentId>/<threadId>` deep links that arrive
 * while this window is already running. A link that opened the window is drained
 * before the router exists instead — see `applyPendingDesktopThreadDeepLink`.
 */
export function DesktopOpenThreadCoordinator() {
  const navigate = useNavigate();
  const bridge = window.desktopBridge;

  useEffect(() => {
    const subscribe = bridge?.onOpenThread;
    if (subscribe === undefined) return;

    return subscribe((request) => {
      // The shell also buffers every link it pushes, so drain it here or the
      // next window this renderer opens would replay this one.
      void bridge?.takePendingOpenThread?.().catch(() => undefined);
      void navigate({
        to: "/$environmentId/$threadId",
        params: buildThreadRouteParams(scopeThreadRef(request.environmentId, request.threadId)),
      }).catch(() => undefined);
    });
  }, [bridge, navigate]);

  return null;
}
