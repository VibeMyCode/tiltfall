import { describe, expect, it } from "vitest";
import { sourceTag } from "../src/board.js";

describe("sourceTag", () => {
  it("telegram: payload wins, ids collapse, bare open is tg", () => {
    expect(sourceTag("ads1", "", "", true)).toBe("ads1");
    expect(sourceTag("r_123456", "", "", true)).toBe("r");
    expect(sourceTag("g_09659fafcfc9e27b", "", "", true)).toBe("g");
    expect(sourceTag(null, "?src=ignored", "https://itch.io/x", true)).toBe("tg");
  });

  it("web: ?src= wins, then referrer host, else web", () => {
    expect(sourceTag(null, "?src=forum", "https://reddit.com/r/x", false)).toBe("forum");
    expect(sourceTag(null, "", "https://www.reddit.com/r/playmygame/x", false)).toBe("reddit_com");
    expect(sourceTag(null, "", "not a url", false)).toBe("web");
    expect(sourceTag(null, "", "", false)).toBe("web");
  });

  it("tags are safe for a redis key: lowercase, [a-z0-9_-], max 32", () => {
    expect(sourceTag("A/B C", "", "", true)).toBe("a_b_c");
    expect(sourceTag(null, `?src=${"x".repeat(50)}`, "", false)).toHaveLength(32);
  });
});
