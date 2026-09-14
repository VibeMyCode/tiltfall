// A client whose CloudStorage never answers must not WRITE to it either.
//
// This is the rule that stops progress being destroyed. A desktop client that
// reads nothing concludes it holds the newest state, pushes its fresh level-1
// save over the account's real progress, and the phone adopts that on its next
// boot. Silence has to mean "do not touch", not "you are first".
import { beforeEach, describe, expect, it, vi } from "vitest";

type Cb = (err: string | null, v?: string) => void;

function stubTelegram(getItem: (k: string, cb: Cb) => void): string[] {
  const writes: string[] = [];
  (globalThis as unknown as { window: unknown }).window = {
    Telegram: {
      WebApp: {
        initData: "auth_date=1&hash=00", // inTelegram() checks exactly this
        CloudStorage: {
          getItem,
          setItem: (k: string, _v: string, cb?: Cb) => {
            writes.push(k);
            cb?.(null);
          },
        },
      },
    },
  };
  return writes;
}

// resetModules first, so each test gets a module whose cloudOk starts false.
const fresh = () => import("../src/telegram.js");

beforeEach(() => {
  vi.resetModules();
});

describe("cloud write gate", () => {
  it("a store that answers, even with nothing, is writable", async () => {
    const writes = stubTelegram((_k, cb) => cb(null, undefined)); // key absent: a new player
    const tg = await fresh();
    await tg.cloudLoad("tf.rev");
    expect(tg.cloudStatus()).toBe("ok");
    tg.cloudSave("tf.bank", "1200");
    expect(writes).toEqual(["tf_bank"]);
  });

  it("a store that errors is never written to", async () => {
    const writes = stubTelegram((_k, cb) => cb("WebAppMethodUnsupported"));
    const tg = await fresh();
    await tg.cloudLoad("tf.rev");
    expect(tg.cloudStatus()).toContain("WebAppMethodUnsupported");
    tg.cloudSave("tf.bank", "1200");
    expect(writes).toEqual([]);
  });

  it("a store that never calls back is never written to", async () => {
    vi.useFakeTimers();
    const writes = stubTelegram(() => {
      /* silence, which is what the broken desktop client does */
    });
    const tg = await fresh();
    const pending = tg.cloudLoad("tf.rev");
    await vi.advanceTimersByTimeAsync(4000);
    expect(await pending).toBeNull();
    expect(tg.cloudStatus()).toContain("no answer");
    tg.cloudSave("tf.bank", "1200");
    expect(writes).toEqual([]);
    vi.useRealTimers();
  });
});
