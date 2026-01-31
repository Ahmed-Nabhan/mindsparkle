import { describe, expect, it } from "vitest";
import { chooseTool } from "./toolRouter";

describe("chooseTool", () => {
  it("prefers hinted tool", () => {
    const route = chooseTool([{ role: "user", content: "hello" }], "web_search");
    expect(route.tool).toBe("web_search");
    expect(route.reason).toBe("client_hint");
  });

  it("routes image intent", () => {
    const route = chooseTool([{ role: "user", content: "Please generate an image of a cat" }]);
    expect(route.tool).toBe("image_generate");
  });

  it("routes web intent", () => {
    const route = chooseTool([{ role: "user", content: "Find sources and citations about this" }]);
    expect(route.tool).toBe("web_search");
  });

  it("defaults to none", () => {
    const route = chooseTool([{ role: "user", content: "Explain recursion" }]);
    expect(route.tool).toBe("none");
  });
});
