---
name: Recovering deleted files mid-session
description: How to recover a file deleted earlier in the same agent session before it's committed
---

When a file was deleted with `bash rm` (or via edit tools) earlier in the same session but the session hasn't committed yet, it is still present in `git show HEAD:<path>` — no need to search parent commits or `~1` refs. Check `git --no-optional-locks status --short` first: a `D` entry means HEAD still has the content.

**Why:** Wasted a lookup attempting `git show <commit>~1:<path>` on a commit that never contained the deletion — the delete was an uncommitted working-tree change, so HEAD itself still had the full content.

**How to apply:** Before assuming content is unrecoverable, run `git --no-optional-locks status --short` to check for uncommitted `D` (deleted) entries, then `git show HEAD:<path>` to recover.
