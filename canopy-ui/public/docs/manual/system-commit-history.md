# Commit History & Snapshots

Canopy's Workspace Engine permanently records every committed configuration change in a structured **Commit History**. This history is immutable and provides a complete audit trail of who changed what and when.

## Understanding Commits

A commit represents a mathematical point in time where a "Candidate Configuration" was merged into the active SQLite database. Every time you click **Commit Changes** in the top navigation bar, a new commit is generated.

When you view a commit in the history, Canopy provides a computed diff of all insertions, deletions, and modifications that occurred during that specific merge event. 

## Reverting Workspaces (Time Travel)

Because Canopy tracks all state incrementally, you have the ability to "Time Travel" back to any historical commit. 

If you select a past commit and click **Revert to Commit**, Canopy will instantly overwrite your active workspace with the state of the database exactly as it was at that moment in time.

> [!WARNING]
> Reverting to a past commit will permanently discard all subsequent commits and modifications that occurred after that point. Always ensure you are ready to discard recent work before performing a full workspace revert.

## Viewing Diffs

By clicking on a commit in the history table, you can view the precise object-level diff. Canopy's diffing engine compares the JSON snapshot of the commit against its predecessor to show you exactly which fields were modified in every object.
