// ALL wording for the Together link's UI is PROVISIONAL (Esme rewords; the Design session shows
// options). Kept in one place so it is easy to list and change.

import { ANSWERS_DELAY_MS } from "../../together/sender";

const delay = `${Math.round(ANSWERS_DELAY_MS / 3_600_000)} hours`;

export const TOGETHER_WORDS = {
  heading: "Together",
  intro:
    "Copies the days you did a Mental health exercise or the Daily check-in to Together, as two habits. To-dos never go. One way only: nothing comes back from Together.",
  notEncrypted:
    "Together isn't end-to-end encrypted: Oliver, Supabase and anyone with Together's admin key can read what's copied there.",
  afterDayEnds: `When a day ends (3am), only the card titles and the questions you answered go. Your answers follow ${delay} later, unless you tick that day's answers private.`,
  /** The brief's plain warning: shown in the Together box and beside every private tick. */
  privateWarning:
    "Once a day's answers have gone to Together, ticking private, editing or removing them only hides the earlier version in Together: it isn't wiped.",
  /** After a backup was restored here, until sync has caught up (bug #65). */
  restoreWaiting: "Waiting for sync to catch up after restoring a backup. Your answers go once it has (or after 24 hours, if sync stays off).",
  onlyThisDevice: "Sign in on one device only. Only this device copies to Together. Your password isn't kept.",
  address: "Together address",
  anonKey: "Together anon key",
  email: "Together email",
  password: "Together password",
  signIn: "Sign in",
  signingIn: "Signing in…",
  signInAgain: "Sign in to Together again",
  copying: "Copying to Together from this device.",
  lastSent: (when: string) => `Last copied ${when}`,
  notSentYet: "Nothing copied yet.",
  offline: "Couldn't reach Together. It will try again after the next sync.",
  setAside: (n: number) => (n === 1 ? "1 day couldn't be copied. It's set aside; Send now tries it again." : `${n} days couldn't be copied. They're set aside; Send now tries them again.`),
  notHidden: (n: number) =>
    n === 1 ? "1 day's answers couldn't be hidden in Together yet. Send now tries again." : `${n} days' answers couldn't be hidden in Together yet. Send now tries again.`,
  sendNow: "Send now",
  sending: "Sending…",
  stop: "Stop copying to Together",
  stopMarkDeleted: "Also mark everything already copied as deleted in Together",
  stopConfirm: "Stop copying",
  cancel: "Cancel",
  stopped: "Stopped copying to Together on this device.",
  /** After a "Stop copying" with removing that didn't finish (bug #53). */
  paused: "Copying is paused: removing what was copied to Together didn't finish. Nothing new goes until you finish removing, or keep copying instead.",
  finishRemoving: "Finish removing",
  cancelRemoving: "Keep copying",
  /** While a refused clean-up holds new days back. */
  daysWaiting: "New days are waiting and will be copied once that's sorted.",
  privateHeading: "Keep a day's answers private",
  privateDay: "Day",
  privateExercise: "Mental health exercise: keep that day's answers private",
  privateCheckin: "Daily check-in: keep that day's answers private",
  /** Design pick A (2026-11-05): a tick under the answers. */
  privateTick: "Keep today's answers private",
  oliverSeesExercise: "Oliver still sees that you did the exercise, and the card's title.",
  oliverSeesCheckin: "Oliver still sees that you checked in, and the questions you answered.",
  notSyncedYet: "Not saved to your other devices yet.",
  privateLocked: "Unlock the journal on this device to change a day's private ticks.",
  learnedSection: "What I learned",
  learnedLabel: "What I learned about BPD or mental health today (optional)",
  learnedEarlier: "What I learned, earlier days",
  /** In Read back, inside the day's Mental health exercise (bug #45). */
  learnedReadBack: "What I learned that day",
  /** Beside the box when the words in it were written on another device. */
  learnedOther: "Also written on another device",
  /** Over a version from this device that the box doesn't hold (bug #41: kept, never lost). */
  learnedEarlierHere: "Your earlier words on this device",
  /** Over a version from another device that the box doesn't hold. */
  learnedOtherDevice: "Other words from another device",
  /** Under a version the box doesn't hold: put its words into the box (then it's replaced). */
  learnedMerge: "Add to my words",
  learnedRemove: "Remove",
  learnedRemoveAsk: "Remove these words from every device? They won't be in the box or Read back.",
  learnedRemoveYes: "Remove them",
  learnedRemoveNo: "Keep them",
};
