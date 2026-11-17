// ALL wording for the Together link's UI is PROVISIONAL (Esme rewords; the Design session shows
// options). Kept in one place so it is easy to list and change.

export const TOGETHER_WORDS = {
  heading: "Together",
  intro:
    "Logs your Mental health exercise and Daily check-in in your “Mental Health Work” challenge in Together, one entry a day, back to your first journal day. To-dos never go. One way only: nothing comes back from Together.",
  notEncrypted:
    "Together isn't end-to-end encrypted: Oliver, Supabase and anyone with Together's admin key can read what's copied there.",
  /** Sending is manual (Esme, 2026-11-09). */
  howItSends: "Press Send now to copy your Mental health exercise and Daily check-in to Together. Days you tick private send only titles and questions.",
  /** A press as it goes ("Sent 12 of 30 days"). */
  progress: (done: number, total: number) => `Sent ${done} of ${total} ${total === 1 ? "day" : "days"}`,
  /** The brief's plain warning: shown in the Together box and beside every private tick. */
  privateWarning:
    "Ticking a day private after its answers went replaces that day's entry in Together straight away; an edit replaces it on your next Send now. A day you remove is only marked deleted there: it isn't wiped.",
  /** Her challenge isn't in Together (nothing is copied until it is). */
  challengeMissing: "Couldn't find your “BPD research” challenge in Together.",
  /** Hiding many days at once (private ticks, removals) goes a little at a time. */
  backlog: "Still updating days in Together. The rest follow shortly.",
  /** Days she had already logged by hand, or deleted, in Together (left as they are, review I3). */
  byHand: (n: number) =>
    n === 1
      ? "1 day you'd already logged or deleted in Together was left as it is there."
      : `${n} days you'd already logged or deleted in Together were left as they are there.`,
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
  // ---- the daily log's challenges (only while SEND_ROUTINE_CHALLENGES is on; review I5) ----
  /** In the box: what goes, when, and that it stays. */
  routineHowItSends:
    "Your daily log goes too, into its two challenges: each answered question (Yes, Partly or No) and its note, 24 hours after the day ends at 3am. After that, changes here don't reach Together. Ticking the day private or stopping with removing hides it there, but Oliver's database still keeps the text.",
  /** Beside the private ticks and the box's private warning. */
  routinePrivateCaveat: "Your daily log: if a day of it has already gone, ticking it private hides it in Together, but Oliver's database still keeps the text.",
  /** Beside "mark everything already copied as deleted". */
  routineStopCaveat: "(Your daily log's days are hidden too, but Oliver's database keeps their text.)",
  /** Its challenges aren't ready in Together: nothing of the daily log goes. */
  routineWaiting: {
    missing: "Your daily log isn't going to Together yet: its two challenges aren't there.",
    "not-hers": "Your daily log isn't going to Together yet: its challenges there aren't set up for you.",
    "not-accepted": "Your daily log isn't going to Together yet: accept its two challenges in Together first.",
    "not-goal": "Your daily log isn't going to Together yet: its challenges there aren't the kind that keeps a log.",
  } as Record<"missing" | "not-hers" | "not-accepted" | "not-goal", string>,
  /** Days of her daily log held until she settles them. */
  routineVersions: (n: number) =>
    n === 1
      ? "1 day of your daily log has two versions, so it won't go. Today's and yesterday's can be settled on the Daily check-in tab."
      : `${n} days of your daily log have two versions, so they won't go. Today's and yesterday's can be settled on the Daily check-in tab.`,
  routineUnreadable: (n: number) =>
    n === 1 ? "1 day of your daily log can't be opened on this device, so it won't go from here." : `${n} days of your daily log can't be opened on this device, so they won't go from here.`,
  routineProblems: (n: number) =>
    n === 1 ? "1 daily log answer couldn't be copied. Send now tries it again." : `${n} daily log answers couldn't be copied. Send now tries them again.`,
  /** Under a day's log box: whether and when that day goes, and why not. */
  routineDay: {
    sent: "This day is in Together. Changes here won't reach it; ticking it private hides it there (Oliver's database keeps the text).",
    next: "This day goes to Together on your next Send now. After that, changes here won't reach it.",
    "not-done": "This day goes to Together once you press Done, 24 hours after it ends (3am).",
    versions: "This day won't go to Together until you choose one version.",
    unreadable: "Part of this day can't be opened here, so it won't go to Together from this device.",
    private: "This day is private: your daily log won't go to Together.",
    "not-final": "Your answers and notes go to Together 24 hours after this day ends (3am). After that, changes here won't reach Together.",
  } as Record<"sent" | "next" | "not-done" | "versions" | "unreadable" | "private" | "not-final", string>,
  stopConfirm: "Stop copying",
  cancel: "Cancel",
  stopped: "Stopped copying to Together on this device.",
  /** After a "Stop copying" with removing that didn't finish (bug #53). */
  paused: "Copying is paused: removing what was copied to Together didn't finish. Nothing new goes until you finish removing, or keep copying instead.",
  finishRemoving: "Finish removing",
  cancelRemoving: "Keep copying",
  privateHeading: "Keep a day's answers private",
  privateDay: "Day",
  privateExercise: "Mental health exercise: keep that day's answers private",
  privateCheckin: "Daily check-in: keep that day's answers private",
  /** Design pick A (2026-11-05): a tick under the answers. */
  privateTick: "Keep today's answers private",
  /** Under yesterday's daily log: that day's own tick (fix round 2; PROVISIONAL). */
  privateTickYesterday: "Keep yesterday's answers private",
  oliverSeesExercise: "Oliver still sees that you did the exercise, the card's title and its questions.",
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
