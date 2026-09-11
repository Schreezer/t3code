import { EnvironmentId, ThreadId, type DesktopOpenThreadRequest } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Scope from "effect/Scope";

import * as Electron from "electron";

import * as ElectronApp from "../electron/ElectronApp.ts";
import * as ElectronProtocol from "../electron/ElectronProtocol.ts";
import * as DesktopWindow from "../window/DesktopWindow.ts";
import * as DesktopEnvironment from "./DesktopEnvironment.ts";
import { makeComponentLogger } from "./DesktopObservability.ts";

// The desktop scheme is also the renderer's own origin (`t3code://app/`), so
// deep links are namespaced by host: `app` stays internal and is served by
// `protocol.handle`, while `thread` is only ever produced by the OS handing us
// a URL somebody opened. Clerk's OAuth callbacks use the `app` host too, and
// its `open-url` listener ignores everything that is not its redirect URL.
const THREAD_DEEP_LINK_HOST = "thread";

// Both ids go straight into the renderer's router. Threads are UUIDs, but
// environment ids are not: local ones are stable labels like "primary" and
// "wsl:ubuntu". Accept that shape and nothing else, so an encoded slash or a
// traversal segment can never reach the route params.
const DEEP_LINK_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:+-]{0,127}$/;

const { logInfo, logWarning } = makeComponentLogger("desktop-deep-link");

function decodeSegment(segment: string): string | null {
  try {
    return decodeURIComponent(segment);
  } catch {
    return null;
  }
}

/**
 * Parses `<scheme>://thread/<environmentId>/<threadId>`. Returns `null` for
 * anything else, including the app's own internal URLs.
 */
export function parseThreadDeepLink(
  rawUrl: string,
  scheme: string,
): DesktopOpenThreadRequest | null {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }

  if (url.protocol !== `${scheme}:`) return null;
  // Non-special schemes keep an opaque host, so it is neither lowercased nor
  // stripped of credentials by the URL parser.
  if (url.hostname.toLowerCase() !== THREAD_DEEP_LINK_HOST) return null;
  if (url.username !== "" || url.password !== "" || url.port !== "") return null;

  const segments = url.pathname.split("/").filter((segment) => segment.length > 0);
  if (segments.length !== 2) return null;

  const environmentId = decodeSegment(segments[0] ?? "");
  const threadId = decodeSegment(segments[1] ?? "");
  if (environmentId === null || threadId === null) return null;
  if (!DEEP_LINK_ID_PATTERN.test(environmentId)) return null;
  if (!DEEP_LINK_ID_PATTERN.test(threadId)) return null;

  return {
    environmentId: EnvironmentId.make(environmentId),
    threadId: ThreadId.make(threadId),
  };
}

/** Windows and Linux deliver deep links as a command-line argument. */
export function findThreadDeepLink(
  argv: readonly string[],
  scheme: string,
): DesktopOpenThreadRequest | null {
  for (const argument of argv) {
    const link = parseThreadDeepLink(argument, scheme);
    if (link !== null) return link;
  }
  return null;
}

const DEEP_LINK_SCHEMES = ["t3code", "t3code-dev"] as const;

function isThreadDeepLink(rawUrl: string): boolean {
  return DEEP_LINK_SCHEMES.some((scheme) => parseThreadDeepLink(rawUrl, scheme) !== null);
}

const bufferedLaunchUrls: string[] = [];
let deliverDeepLinkUrl: ((rawUrl: string) => void) | null = null;

function acceptDeepLinkUrl(rawUrl: string): void {
  if (deliverDeepLinkUrl === null) {
    bufferedLaunchUrls.push(rawUrl);
    return;
  }
  deliverDeepLinkUrl(rawUrl);
}

/**
 * Must run synchronously during process bootstrap. macOS delivers a launch deep
 * link as an `open-url` event within milliseconds of the process starting, and
 * Electron drops it when nothing is listening — startup does not reach
 * {@link DesktopDeepLink} until it has spawned a login shell, a second later.
 * Both schemes are matched because the service that knows which one this build
 * uses does not exist yet; it filters the buffer when it drains it.
 */
export function captureLaunchDeepLinksSync(): void {
  Electron.app.on("open-url", (event, url) => {
    // Everything else on these schemes belongs to another handler, Clerk's
    // OAuth callbacks in particular, so leave those events untouched.
    if (!isThreadDeepLink(url)) return;
    event.preventDefault();
    acceptDeepLinkUrl(url);
  });
}

export class DesktopDeepLink extends Context.Service<
  DesktopDeepLink,
  {
    /**
     * Claims the OS URL scheme and starts listening. Must run before Electron
     * emits `ready`, which is when a launch-time `open-url` arrives.
     */
    readonly register: Effect.Effect<void, never, Scope.Scope>;
    /**
     * Hands the buffered link to the renderer and clears it. The renderer pulls
     * once while it boots, because a link that opened a window always lands
     * before that window has anything listening.
     */
    readonly takePending: Effect.Effect<Option.Option<DesktopOpenThreadRequest>>;
  }
>()("@t3tools/desktop/app/DesktopDeepLink") {}

/** @public Service construction is part of the canonical Effect module API. */
export const make = Effect.gen(function* () {
  const environment = yield* DesktopEnvironment.DesktopEnvironment;
  const desktopWindow = yield* DesktopWindow.DesktopWindow;
  const electronApp = yield* ElectronApp.ElectronApp;
  const scheme = ElectronProtocol.getDesktopScheme(environment.isDevelopment);
  const pending = yield* Ref.make(Option.none<DesktopOpenThreadRequest>());
  const runPromise = Effect.runPromiseWith(yield* Effect.context<never>());

  const handleLink = Effect.fn("desktop.deepLink.handleLink")(function* (
    link: DesktopOpenThreadRequest,
  ) {
    yield* Ref.set(pending, Option.some(link));
    yield* logInfo("received thread deep link", {
      environmentId: link.environmentId,
      threadId: link.threadId,
    });
    // Best effort: the renderer drains the buffer while it boots, so a window
    // that cannot exist yet (cold launch, backend still booting) is not a lost
    // link.
    yield* desktopWindow
      .dispatchOpenThread(link)
      .pipe(
        Effect.catchCause((cause) =>
          logWarning("failed to reveal the deep-linked thread", { cause }),
        ),
      );
  });

  // macOS ignores the path and arguments, and Linux registers by desktop entry;
  // only Windows writes them into the registry command. Development there runs
  // Electron against a script, so the launch arguments must ride along or the
  // OS would start a bare Electron with no app.
  const claimProtocolClient = Effect.gen(function* () {
    if (yield* electronApp.isDefaultProtocolClient(scheme)) return;
    const claimed = environment.isPackaged
      ? yield* electronApp.setAsDefaultProtocolClient(scheme)
      : yield* electronApp.setAsDefaultProtocolClient(
          scheme,
          process.execPath,
          process.argv.slice(1).filter((argument) => !argument.startsWith(`${scheme}:`)),
        );
    if (!claimed) {
      yield* logWarning("could not claim the URL scheme", { scheme });
      return;
    }
    yield* logInfo("claimed the URL scheme", { scheme });
  });

  const register = Effect.gen(function* () {
    yield* claimProtocolClient;

    yield* Effect.acquireRelease(
      Effect.sync(() => {
        deliverDeepLinkUrl = (rawUrl) => {
          const link = parseThreadDeepLink(rawUrl, scheme);
          if (link === null) return;
          void runPromise(handleLink(link));
        };
      }),
      () =>
        Effect.sync(() => {
          deliverDeepLinkUrl = null;
        }),
    );

    yield* electronApp.on("second-instance", (_event: Electron.Event, argv: string[]) => {
      const link = findThreadDeepLink(argv, scheme);
      if (link === null) return;
      void runPromise(handleLink(link));
    });

    // Windows and Linux put a launch deep link on the command line; macOS
    // delivered it to the pre-ready capture above.
    const launchLink = findThreadDeepLink(
      [...process.argv, ...bufferedLaunchUrls.splice(0)],
      scheme,
    );
    if (launchLink !== null) yield* handleLink(launchLink);
  }).pipe(Effect.withSpan("desktop.deepLink.register"));

  return DesktopDeepLink.of({
    register,
    takePending: Ref.getAndSet(pending, Option.none()),
  });
});

export const layer = Layer.effect(DesktopDeepLink, make);
