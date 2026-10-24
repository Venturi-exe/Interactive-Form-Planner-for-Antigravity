<!--
[ORBIT MEMORY SYSTEM]
This file documents the structure of the Orbit Memory System (Layout v3).
The agent uses this to navigate project context, architectural decisions, and persistent memory.

COHERENCE & MAINTENANCE PROTOCOL (Use when running "update memory system"):
1. Summarize Session: Aggregate all conversation context from the active session.
2. Project Directory Sync: Ensure a directory exists under projects/<project_key>/ for each project worked on.
3. Capture & Index Memories: Write topic updates to projects/<project_key>/memories/ and update INDEX.md.
4. Archive Historical Data: Move deprecated notes to projects/<project_key>/archive/.
5. Context Sync: Update BRAIN_ARCHITECTURE.md and global_context_summary.md.
-->

# Orbit Memory System (Layout v3)

## Directory Structure

```
~/.orbit-brain/
├── BRAIN_ARCHITECTURE.md
├── global_context_summary.md
├── .trash/                  (14-day TTL retention)
├── .locks/                  (Cross-process advisory file locks)
└── projects/
    └── _default/            (Fallback unassigned tasks)
        ├── cartograph/      (Impact reports)
        ├── memories/
        │   ├── INDEX.md
        │   ├── PROTOCOL.md
        │   ├── features/
        │   └── tasks/
        └── archive/
```
