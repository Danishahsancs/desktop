import { describe, it, expect, vi, afterEach } from "vitest";
import { api, ApiError } from "./api";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

// a brief 502/503/504 from the origin should not surface as an error on reads
describe("gateway error retry", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("retries a GET once after a 503 and returns the second response", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(503, { message: "unavailable" }))
      .mockResolvedValueOnce(jsonResponse(200, { id: "abc", title: "Song" }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const pending = api.getTrack("abc");

    await expect(pending).resolves.toMatchObject({ id: "abc" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not retry non-idempotent requests", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(503, { message: "unavailable" }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const pending = api.login("a@example.com", "x").catch((e) => e);

    expect(await pending).toBeInstanceOf(ApiError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
