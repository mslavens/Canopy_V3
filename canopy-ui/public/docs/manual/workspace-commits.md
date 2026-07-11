# Workspace Commits (Candidate Configurations)

Canopy uses a powerful **Candidate Configuration** engine. 

When you modify objects, device groups, or policies in your active workspace, your changes are not immediately applied to the active database. Instead, they are safely staged as "Pending Changes" (also known as a candidate configuration).

## The Commit Lifecycle

1. **Stage**: You make modifications to the system (e.g., creating a new Address Object, updating a Device Group). These changes are staged locally in your workspace.
2. **Review**: Click the **Pending Changes** button in the top navigation bar to open the Commit Details modal. Here, you can review a syntax-highlighted diff of all your uncommitted modifications.
3. **Commit**: Once you are satisfied with the changes, click **Commit Changes**. This mathematically merges your candidate configuration into the active SQLite state, generating a permanent snapshot that can be rolled back to at any time.

## Reverting Changes

If you make a mistake, Canopy provides two granular ways to roll back:

- **Single Change Revert (Undo)**: Inside the Pending Changes modal, you can hover over any individual modification and click **Undo**. This will gracefully revert that specific change without affecting the rest of your uncommitted workspace. Canopy's engine strictly validates dependencies, preventing you from reverting parent objects if their child members remain deleted.
- **Revert Workspace**: If you want to wipe the slate clean, click **Revert Workspace** from the pending changes dropdown. This instantly discards all uncommitted modifications, mathematically resetting your workspace to match the last committed snapshot.

## Safety & Validation

Canopy enforces strict relational safety guardrails. When working with Candidate Configs, the system tracks foreign-key dependencies. For example, if you attempt to delete an Address Object that is actively used in a Security Rule, Canopy will intercept the deletion and display an "Object in Use" warning, listing all dependent relationships.
