import { test, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { state, reset } from "./fixtures/provider-store.mjs";
const hooks = registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "@/lib/energy-store")
      return {
        url: new URL("./fixtures/provider-store.mjs", import.meta.url).href,
        shortCircuit: true,
      };
    if (specifier === "@/lib/atlantic-auth")
      return {
        url: new URL("../lib/atlantic-auth.ts", import.meta.url).href,
        shortCircuit: true,
      };
    return next(specifier, context);
  },
});
const { getProviderToken } = await import("../lib/provider-auth.ts");
const actualFetch = globalThis.fetch;
beforeEach(() => {
  reset();
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify({
        access_token: "renewed",
        refresh_token: "rotated",
        expires_in: 3600,
      }),
      { status: 200 },
    );
});
after(() => {
  globalThis.fetch = actualFetch;
  hooks.deregister();
});
const old = () => ({
  accessToken: "expired",
  refreshToken: "refresh",
  expiresAt: Date.now() - 1,
  connectedAt: 123,
});
test("valid legacy browser token works without database credentials", async () =>
  assert.equal(
    await getProviderToken({
      accessToken: "valid",
      expiresAt: Date.now() + 60000,
      connectedAt: 123,
    }),
    "valid",
  ));
test("expired browser without refresh asks for reconnect", async () =>
  assert.rejects(
    () =>
      getProviderToken({
        accessToken: "expired",
        expiresAt: 1,
        connectedAt: 123,
      }),
    /COZYTOUCH_SESSION_EXPIRED/,
  ));
test("shared fresh token is used after browser token expires", async () => {
  state.credentials = {
    ...old(),
    accessToken: "shared",
    expiresAt: Date.now() + 60000,
  };
  assert.equal(await getProviderToken({ connectedAt: 123 }), "shared");
  assert.equal(state.saves.length, 0);
});
test("old browser cannot control subsequently connected account", async () => {
  state.credentials = old();
  await assert.rejects(
    () => getProviderToken({ connectedAt: 124 }),
    /COZYTOUCH_SESSION_EXPIRED/,
  );
  assert.equal(state.saves.length, 0);
});
test("refresh rotates token, persists before use and releases lease", async () => {
  state.credentials = old();
  assert.equal(await getProviderToken({ connectedAt: 123 }), "renewed");
  assert.equal(state.saves[0].next.refreshToken, "rotated");
  assert.equal(state.saves[0].next.connectedAt, 123);
  assert.equal(state.locked, false);
});
test("concurrent refresh does not reuse rotating token", async () => {
  state.credentials = old();
  state.locked = true;
  await assert.rejects(
    () => getProviderToken({ connectedAt: 123 }),
    /COZYTOUCH_REFRESH_BUSY/,
  );
  assert.equal(state.saves.length, 0);
});
test("revoked refresh remains an explicit reconnect", async () => {
  state.credentials = old();
  globalThis.fetch = async () =>
    new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 });
  await assert.rejects(
    () => getProviderToken({ connectedAt: 123 }),
    /COZYTOUCH_SESSION_EXPIRED/,
  );
  assert.equal(state.locked, false);
});
test("failed compare-and-swap never returns unpersisted token", async () => {
  state.credentials = old();
  state.saveResult = false;
  await assert.rejects(
    () => getProviderToken({ connectedAt: 123 }),
    /COZYTOUCH_REFRESH_STORE_FAILED/,
  );
  assert.equal(state.locked, false);
});
