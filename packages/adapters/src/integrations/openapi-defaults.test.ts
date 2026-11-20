import { describe, expect, it } from "vitest";
import { operationIdFor, withDefaultServer } from "./openapi-defaults.js";

describe("operationIdFor", () => {
  it("keeps a given id and names an unnamed operation from its method and path", () => {
    expect(operationIdFor("get", "/latest", "getLatest")).toBe("getLatest");
    expect(operationIdFor("get", "/v1/{date}..{end}", undefined)).toBe("get_v1_date_end");
    expect(operationIdFor("post", "/", "")).toBe("post");
  });
});

describe("withDefaultServer", () => {
  it("points a document without servers at its own origin and leaves others alone", () => {
    const url = new URL("https://api.example.test/swagger/v1/swagger.json");
    expect(withDefaultServer({ paths: {} }, url)).toEqual({
      paths: {},
      servers: [{ url: "https://api.example.test" }],
    });
    const given = { servers: [{ url: "https://other.test/v2" }], paths: {} };
    expect(withDefaultServer(given, url)).toBe(given);
  });
});
