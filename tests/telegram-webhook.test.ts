import { describe, expect, it } from "vitest";
import { isLaunchCommand } from "../api/telegram";

describe("bot launch commands", () => {
  it("matches the commands that should open the game", () => {
    for (const t of ["/start", "/play", "/start@tiltfall_bot", "/play@tiltfall_bot", "/start ref123"]) {
      expect(isLaunchCommand(t)).toBe(true);
    }
  });

  it("ignores everything else", () => {
    // "/started" must not match — a prefix test would have let it through.
    for (const t of ["", "hello", "/started", "/playlist", "play", " /start", "/help"]) {
      expect(isLaunchCommand(t)).toBe(false);
    }
  });
});
