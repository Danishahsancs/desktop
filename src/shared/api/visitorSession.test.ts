import { describe, it, expect } from "vitest";
import { parseVisitorData } from "./visitorSession";

// shape of youtube's sw.js_data: xssi prefix, then nested json arrays with the
// client ip, device info and the visitorData token
function swJsData(token: string): string {
  return `)]}'\n\n[["yt.sw.adr",null,[[["en","US",null,"2600:1003:b07f:ad8f::1",null,null,null,null,null,null,null,"Samsung","SM-S948U1","${token}",null,1]]]]]`;
}

describe("parseVisitorData", () => {
  it("accepts tokens whose third character isn't 't' (seen on a Galaxy S26)", () => {
    const token = "Cgs5eFJKaF92Y1lZWSjn2sbWBjIKCgJVUxIEGgAgG2K1AgqyAkN1SUJDQ%3D%3D";
    expect(parseVisitorData(swJsData(token))).toBe("Cgs5eFJKaF92Y1lZWSjn2sbWBjIKCgJVUxIEGgAgG2K1AgqyAkN1SUJDQ==");
  });

  it("still accepts the common Cgt prefix", () => {
    expect(parseVisitorData(swJsData("CgtuX1VBMUFsZ2tSbyiR-8TEBjIKCgJVUxIEGgAgEg=="))).toBe(
      "CgtuX1VBMUFsZ2tSbyiR-8TEBjIKCgJVUxIEGgAgEg==",
    );
  });

  it("ignores other strings such as the ip, locale and device model", () => {
    expect(parseVisitorData(swJsData("not-a-token"))).toBeNull();
  });

  it("falls back to a text scan if the payload isn't json", () => {
    expect(parseVisitorData("garbage CgvAbCdEfGhIjKlMnOpQrStUv%3D trailing")).toBe("CgvAbCdEfGhIjKlMnOpQrStUv=");
  });
});
