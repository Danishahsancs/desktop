import { describe, it, expect } from "vitest";
import { rewriteServiceHeaders, withBrowserEmptyBody } from "./nativeRequestHeaders";

// must match electron/main.ts onBeforeSendHeaders, which the innertube client relies on
describe("rewriteServiceHeaders", () => {
  it("turns x-liner-user-agent into User-Agent and sets music.youtube.com origin", () => {
    const out = rewriteServiceHeaders(
      "https://music.youtube.com/youtubei/v1/player?prettyPrint=false",
      new Headers({ "x-liner-user-agent": "com.google.ios.youtube/20", "x-origin": "https://music.youtube.com" }),
    )!;
    expect(out.get("user-agent")).toBe("com.google.ios.youtube/20");
    expect(out.has("x-liner-user-agent")).toBe(false);
    expect(out.get("origin")).toBe("https://music.youtube.com");
    expect(out.get("referer")).toBe("https://music.youtube.com/");
    expect(out.get("x-origin")).toBe("https://music.youtube.com");
  });

  it("uses www.youtube.com as origin for www requests and replaces caller origin/referer", () => {
    const out = rewriteServiceHeaders(
      "https://www.youtube.com/sw.js_data",
      new Headers({ origin: "https://localhost", referer: "https://localhost/" }),
    )!;
    expect(out.get("origin")).toBe("https://www.youtube.com");
    expect(out.get("referer")).toBe("https://www.youtube.com/");
  });

  it("covers googlevideo and apple music, leaves other hosts alone", () => {
    expect(rewriteServiceHeaders("https://rr1---sn-abc.googlevideo.com/videoplayback", new Headers())?.get("origin")).toBe(
      "https://music.youtube.com",
    );
    expect(rewriteServiceHeaders("https://amp-api.music.apple.com/v1/catalog", new Headers())?.get("origin")).toBe(
      "https://music.apple.com",
    );
    expect(rewriteServiceHeaders("https://api.tryliner.fun/v1/me", new Headers())).toBeNull();
    expect(rewriteServiceHeaders("https://evil-youtube.com.example/x", new Headers())).toBeNull();
  });
});

describe("withBrowserEmptyBody", () => {
  it("gives a body-less POST an empty text body like a browser would", () => {
    const out = withBrowserEmptyBody({ method: "POST", headers: { authorization: "Bearer x" } })!;
    expect(out.body).toBe("");
    const headers = new Headers(out.headers);
    expect(headers.get("content-type")).toBe("text/plain;charset=UTF-8");
    expect(headers.get("authorization")).toBe("Bearer x");
  });

  it("leaves GETs and requests that already have a body alone", () => {
    expect(withBrowserEmptyBody({ method: "GET" })).toBeNull();
    expect(withBrowserEmptyBody(undefined)).toBeNull();
    expect(withBrowserEmptyBody({ method: "POST", body: "{}" })).toBeNull();
  });
});
