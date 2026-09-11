import { DesktopOpenThreadRequestSchema } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

import * as DesktopDeepLink from "../../app/DesktopDeepLink.ts";
import * as IpcChannels from "../channels.ts";
import * as DesktopIpc from "../DesktopIpc.ts";

export const takePendingOpenThread = DesktopIpc.makeIpcMethod({
  channel: IpcChannels.DESKTOP_TAKE_PENDING_OPEN_THREAD_CHANNEL,
  payload: Schema.Void,
  result: Schema.NullOr(DesktopOpenThreadRequestSchema),
  handler: Effect.fn("desktop.ipc.deepLink.takePendingOpenThread")(function* () {
    const deepLink = yield* DesktopDeepLink.DesktopDeepLink;
    return Option.getOrNull(yield* deepLink.takePending);
  }),
});
