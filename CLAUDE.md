## Multi-agent workflow
- Multiple agents may work on this repo at once, each in its own git worktree
  (never share a live working directory — that's what causes commit races).
- Work in small chunks: finish a coherent piece, commit, push to main, move on.
  No need to ask permission for routine commits/pushes — just do it.
- Pull latest main before starting a new chunk of work.
- Stick to your assigned lane (e.g. backend/scripts vs native/Swift+design) to
  keep merges conflict-free even before they happen.
- Only pause to ask before genuinely irreversible actions: force-push, history
  rewrites, deleting files/branches, or touching a file clearly mid-edit by
  another agent.

## Art direction
- Never choose colour, easing, type, composition, or timing. Read
  VISUAL-LANGUAGE.md; if the answer isn't there, ask me.
- Placeholders must look obviously wrong — magenta, system font, linear easing.
- If a technical decision narrows what's aesthetically possible, say so
  before proceeding.
