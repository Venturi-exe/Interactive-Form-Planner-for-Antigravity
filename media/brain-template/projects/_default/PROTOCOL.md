# Topic-Based Memory Protocol (v3.0)

This project organizes memories by specific topics (features, components, tasks, or bug fixes) rather than by conversation session.

## 1. The Topic Format
Every topic should have its own dedicated markdown file in `memories/features/` or `memories/tasks/`.
Append new updates to existing topic files using a chronological timeline format.

Example Timeline Entry:
```markdown
### [YYYY-MM-DD HH:MM] [Summary of Changes]
- **What was changed**: Specific summary of files edited and code modifications.
- **Why the changes were made**: Rationale and user intent.
- **Project state**: Context or version at the time.
- **Relation to prior changes**: How these changes relate to previous work.
```

## 2. Memory Lifecycle
1. **Capture**: Consolidate session work into topic files in `memories/features/` (for long-lived capabilities) or `memories/tasks/` (for specific fixes/issues).
2. **Append**: If a file for the topic exists, append the new changes chronologically; do not create duplicate files.
3. **Index**: Update `memories/INDEX.md`'s Active Topics section to link the modified files.
4. **Facts**: Discoveries or immutable truths go into `memories/facts/`.

## 3. Storage Hierarchy
- `features/`: Topic files for features, components, UI layouts, and styling.
- `tasks/`: Topic files for specific tasks, issues, and bug fixes.
- `facts/`: Atomic, immutable truths about the project.
