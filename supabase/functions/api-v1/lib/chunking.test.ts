import { describe, expect, it } from "vitest";
import { chunkText } from "./chunking";

describe("chunkText", () => {
  it("returns empty for blank", () => {
    expect(chunkText("   ", { maxChars: 10, overlapChars: 2 })).toEqual([]);
  });

  it("chunks with overlap", () => {
    const chunks = chunkText("abcdefghij", { maxChars: 4, overlapChars: 1 });
    expect(chunks.map((c) => c.text)).toEqual(["abcd", "defg", "ghij"]);
  });

  it("rejects invalid overlap", () => {
    expect(() => chunkText("abc", { maxChars: 3, overlapChars: 3 })).toThrow();
  });
});
