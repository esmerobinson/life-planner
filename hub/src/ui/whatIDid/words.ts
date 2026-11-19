// "What I did" wording. ALL PROVISIONAL (for Esme / Design): the brief gave "What did you do?",
// "Attach files", "Save", "Skip", "Attach files on your Mac", "What I did" and "Completed this
// week"; the rest is the builder's, plain and kind, never a nag.

export const DID_WORDS = {
  /** The sheet after a tick (from the brief). */
  sheetTitle: "What did you do?",
  /** The text box's name for screen readers in the sheet. */
  sheetBox: "What did you do?",
  save: "Save",
  skip: "Skip",
  attach: "Attach files",
  attaching: "Choosing files…",
  /** Phone and browsers (no Mac bridge). From the brief. */
  attachOnMac: "Attach files on your Mac",
  /** The first time on the Mac, before macOS asks about the folder. */
  firstTime: "The first time, your Mac asks if Esmeworld may use the folder. Choose Allow.",
  permission:
    "Your Mac didn't let Esmeworld save files there. You can allow it in System Settings, Privacy & Security, Files and Folders, Esmeworld. Your words are saved.",
  attachFailed: "Those files couldn't be copied. Your words are saved.",
  someFailed: (n: number) => (n === 1 ? "1 file couldn't be copied." : `${n} files couldn't be copied.`),
  savedTo: (folder: string) => `Copied to ${folder}`,
  revealHint: "Show in Finder",
  missing: "That file isn't there any more.",
  /** The side panel's section and its box. */
  panelHeading: "What I did",
  panelBox: "What I did",
  /** The log page. */
  page: "What I did",
  pageLine: "What you did when you ticked things off, week by week.",
  empty: "Nothing here yet. When you tick a to-do off, you can write what you did.",
  emptyFiltered: "Nothing in this area yet.",
  allAreas: "All",
  filter: "Area",
  week: (from: string, to: string) => `${from} – ${to}`,
  project: (title: string) => `Project: ${title}`,
  files: "Files",
  /** The folder setting (Mac only), on the log page: there is no Settings page yet. */
  settingHeading: "Where files go",
  settingLine: (root: string) => `Files you attach are copied (never moved) into ${root}, in a folder for each area and project.`,
  chooseFolder: "Choose folder…",
  useDesktop: "Use the Desktop",
  /** The weekly review's read-only list (from the brief). */
  completedHeading: "Completed this week",
  completedLine: "Just for you: this list stays here and never goes to Together.",
  completedEmpty: "Nothing ticked off yet this week.",
  /** ⌘K search's group. */
  searchGroup: "What I did",
} as const;
