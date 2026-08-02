import { describe, expect, it } from "vitest";
import { normalizePocketBaseUrl } from "@/lib/pocketbase";

describe("PocketBase URL configuration", () => {
  it("trims whitespace and trailing slashes", () => {
    expect(normalizePocketBaseUrl("  https://pace.example.com/// ")).toBe("https://pace.example.com");
  });

  it("accepts local development servers", () => {
    expect(normalizePocketBaseUrl("http://127.0.0.1:8090")).toBe("http://127.0.0.1:8090");
  });

  it("rejects incomplete or unsafe URLs", () => {
    expect(() => normalizePocketBaseUrl("pace.example.com")).toThrow("complete server URL");
    expect(() => normalizePocketBaseUrl("ftp://pace.example.com")).toThrow("http:// or https://");
    expect(() => normalizePocketBaseUrl(" ")).toThrow("Enter a PocketBase server URL");
  });
});
