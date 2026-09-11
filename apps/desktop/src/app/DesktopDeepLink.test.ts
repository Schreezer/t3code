import { assert, describe, it } from "@effect/vitest";

import { findThreadDeepLink, parseThreadDeepLink } from "./DesktopDeepLink.ts";

const SCHEME = "t3code-dev";
const ENVIRONMENT_ID = "1d6cfb6c-6b2e-4e0d-9f5a-5c3dbf0f4a11";
const THREAD_ID = "8f0d2a1e-2c4b-4c0a-8d1f-6b9a2e5c7d33";

describe("parseThreadDeepLink", () => {
  it("accepts a thread link for the configured scheme", () => {
    assert.deepStrictEqual(
      parseThreadDeepLink(`${SCHEME}://thread/${ENVIRONMENT_ID}/${THREAD_ID}`, SCHEME),
      { environmentId: ENVIRONMENT_ID, threadId: THREAD_ID },
    );
  });

  it("accepts the non-uuid ids local environments use", () => {
    assert.deepStrictEqual(parseThreadDeepLink(`${SCHEME}://thread/primary/${THREAD_ID}`, SCHEME), {
      environmentId: "primary",
      threadId: THREAD_ID,
    });
    assert.deepStrictEqual(
      parseThreadDeepLink(`${SCHEME}://THREAD/wsl:ubuntu/${THREAD_ID}`, SCHEME),
      { environmentId: "wsl:ubuntu", threadId: THREAD_ID },
    );
  });

  it("rejects another scheme, including the production one", () => {
    assert.isNull(parseThreadDeepLink(`t3code://thread/${ENVIRONMENT_ID}/${THREAD_ID}`, SCHEME));
    assert.isNull(parseThreadDeepLink(`https://thread/${ENVIRONMENT_ID}/${THREAD_ID}`, SCHEME));
  });

  it("rejects the renderer's own internal origin", () => {
    assert.isNull(parseThreadDeepLink(`${SCHEME}://app/#/settings/connections`, SCHEME));
    assert.isNull(parseThreadDeepLink(`${SCHEME}://app/oauth/callback`, SCHEME));
  });

  it("rejects links that are not exactly two path segments", () => {
    assert.isNull(parseThreadDeepLink(`${SCHEME}://thread/${ENVIRONMENT_ID}`, SCHEME));
    assert.isNull(
      parseThreadDeepLink(`${SCHEME}://thread/${ENVIRONMENT_ID}/${THREAD_ID}/extra`, SCHEME),
    );
    assert.isNull(parseThreadDeepLink(`${SCHEME}://thread/`, SCHEME));
  });

  it("rejects ids that would not survive being handed to the router", () => {
    assert.isNull(parseThreadDeepLink(`${SCHEME}://thread/../${THREAD_ID}`, SCHEME));
    assert.isNull(parseThreadDeepLink(`${SCHEME}://thread/a%2Fb/${THREAD_ID}`, SCHEME));
    assert.isNull(parseThreadDeepLink(`${SCHEME}://thread/${ENVIRONMENT_ID}/a b`, SCHEME));
    assert.isNull(parseThreadDeepLink(`${SCHEME}://thread/${ENVIRONMENT_ID}/%zz`, SCHEME));
    assert.isNull(
      parseThreadDeepLink(`${SCHEME}://thread/${"a".repeat(129)}/${THREAD_ID}`, SCHEME),
    );
  });

  it("rejects a link carrying credentials or a port", () => {
    assert.isNull(
      parseThreadDeepLink(`${SCHEME}://evil@thread/${ENVIRONMENT_ID}/${THREAD_ID}`, SCHEME),
    );
    assert.isNull(parseThreadDeepLink(`${SCHEME}://thread:8080/${ENVIRONMENT_ID}/1`, SCHEME));
  });

  it("rejects values that are not URLs", () => {
    assert.isNull(parseThreadDeepLink("", SCHEME));
    assert.isNull(parseThreadDeepLink("not a url", SCHEME));
  });
});

describe("findThreadDeepLink", () => {
  it("picks the deep link out of a command line", () => {
    assert.deepStrictEqual(
      findThreadDeepLink(
        [
          "/opt/T3Code/t3code",
          "--t3code-dev-root=/repo/apps/desktop",
          `${SCHEME}://thread/${ENVIRONMENT_ID}/${THREAD_ID}`,
        ],
        SCHEME,
      ),
      { environmentId: ENVIRONMENT_ID, threadId: THREAD_ID },
    );
  });

  it("returns null for a command line without one", () => {
    assert.isNull(
      findThreadDeepLink(["/opt/T3Code/t3code", `${SCHEME}://app/oauth/callback`], SCHEME),
    );
  });
});
