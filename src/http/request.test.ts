import { describe, expect, test } from "bun:test";

import { parseRequestArgs } from "./request.ts";

describe("parseRequestArgs", () => {
  test("parses url-only request as GET", () => {
    const result = parseRequestArgs({ args: ["https://example.com"] });

    expect(result.url).toBe("https://example.com");
    expect(result.options.method).toBe("GET");
    expect(result.options.headers).toEqual({});
    expect(result.options.body).toBeUndefined();
  });

  test("parses method, headers, body, and include headers", () => {
    const result = parseRequestArgs({
      args: [
        "-X",
        "patch",
        "-H",
        "Authorization: Bearer token",
        "-d",
        "hello",
        "-i",
        "https://example.com/api",
      ],
    });

    expect(result.options.method).toBe("PATCH");
    expect(result.options.headers.Authorization).toBe("Bearer token");
    expect(result.options.body).toBe("hello");
    expect(result.options.includeHeaders).toBe(true);
  });

  test("sets JSON body and content-type and defaults to POST", () => {
    const result = parseRequestArgs({
      args: ["--json", '{"ok":true}', "https://example.com/json"],
    });

    expect(result.options.method).toBe("POST");
    expect(result.options.body).toBe('{"ok":true}');
    expect(result.options.headers["Content-Type"]).toBe("application/json");
  });

  test("parses timeout in seconds to milliseconds", () => {
    const result = parseRequestArgs({
      args: ["-m", "1.5", "https://example.com/slow"],
    });

    expect(result.options.timeoutMs).toBe(1500);
  });

  test("throws if URL is missing", () => {
    expect(() => parseRequestArgs({ args: ["-H", "x:y"] })).toThrow("Missing request URL");
  });

  test("throws if header format is invalid", () => {
    expect(() =>
      parseRequestArgs({
        args: ["-H", "bad-header", "https://example.com"],
      }),
    ).toThrow("Invalid header format");
  });
});
