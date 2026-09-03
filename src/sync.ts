// Cross-device sync rule, isolated from Telegram and the DOM so it can be
// tested: losing a player's progress is not a defect you want to discover in
// production.
//
// The rule is deliberately blunt — the newer revision wins and its state is
// adopted WHOLE. Merging field by field would be worse than useless, because
// bank and inventory are spent: taking the max of each would mint currency on
// every cross-device session.

// Just enough of the Storage interface to be handed a real localStorage or a
// plain fake.
export interface KeyStore {
  setItem: (k: string, v: string) => void;
  removeItem: (k: string) => void;
}

export const SYNCED_KEYS = ["tf.bank", "tf.level", "tf.inv", "tf.best", "tf.skin", "tf.daily"];
export const REV_KEY = "tf.rev";

/**
 * Writes the cloud snapshot into `store` when the cloud is ahead.
 * Returns true when something was adopted, which is the caller's cue to reload
 * so every screen and the renderer agree with what was just written.
 */
export function adoptIfNewer(
  store: KeyStore,
  localRev: number,
  cloudRev: unknown,
  values: (string | null)[],
): boolean {
  const cr = Number(cloudRev);
  // Not a number, or not ahead: this device already holds the latest state, and
  // its next save will push it.
  if (!isFinite(cr) || cr <= localRev) return false;

  try {
    SYNCED_KEYS.forEach((k, i) => {
      const v = values[i];
      // A cleared value means the account was reset on another device. Dropping
      // the key locally falls back to the defaults, which is the same thing.
      if (v === null || v === "") store.removeItem(k);
      else store.setItem(k, v);
    });
    // Written BEFORE the caller reloads, so the next boot compares equal revs
    // and cannot adopt — and therefore cannot reload — again.
    store.setItem(REV_KEY, String(cr));
  } catch {
    return false; // no storage to adopt into
  }
  return true;
}
