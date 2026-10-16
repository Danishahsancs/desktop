import { describe, it, expect, vi, afterEach } from "vitest";
import nodeCrypto from "node:crypto";
import * as webSigner from "./wasmSigner";
import * as electronSigner from "../../../electron/crypto";

// the webview signer must produce byte-identical output to the electron one,
// otherwise the api rejects mobile requests
describe("wasmSigner (webview port)", () => {
  afterEach(() => vi.restoreAllMocks());

  it("matches electron cover signatures", async () => {
    expect(await webSigner.signCoverUrl("test-payload")).toBe("9LSBe7mxc1bBjekVK62_YFbxUAxOvphtfgZZK1Wp_FY");
    expect(await webSigner.signCoverUrl("abc.def")).toBe(electronSigner.signCoverUrl("abc.def"));
  });

  it("matches electron request signatures for the same nonce", async () => {
    const res = await webSigner.signRequest({ method: "POST", path: "/v1/likes", body: '{"id":"x"}', timestamp: 1700000000 });
    expect(res.nonce).toMatch(/^[0-9a-f]{16}$/);

    const nonceBytes = Buffer.from(res.nonce, "hex");
    vi.spyOn(nodeCrypto, "randomBytes").mockImplementation((() => nonceBytes) as never);
    const expected = electronSigner.signRequest({ method: "POST", path: "/v1/likes", body: '{"id":"x"}', timestamp: 1700000000 });

    expect(res.signature).toBe(expected.signature);
    expect(res.nonce).toBe(expected.nonce);
  });
});
