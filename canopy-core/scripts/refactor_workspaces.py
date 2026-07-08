import sys

filepath = 'main.go'
with open(filepath, 'r') as f:
    lines = f.readlines()

start_idx = -1
end_idx = -1

for i, line in enumerate(lines):
    if line.startswith('\tmux.HandleFunc("/api/workspaces/heal", func(w http.ResponseWriter, r *http.Request) {'):
        start_idx = i
        break

if start_idx != -1:
    for i in range(start_idx, len(lines)):
        if line.startswith('\t// Secrets Vault: List'):
            end_idx = i - 1
            break
        line = lines[i]

if start_idx != -1 and end_idx != -1:
    new_content = lines[:start_idx] + [
        '\tmux.HandleFunc("/api/workspaces/heal", handleWorkspacesHeal)\n',
        '\tmux.HandleFunc("/api/workspaces", handleWorkspacesList)\n',
        '\tmux.HandleFunc("/api/workspaces/create", handleWorkspacesCreate)\n',
        '\tmux.HandleFunc("/api/workspaces/switch", handleWorkspacesSwitch)\n',
        '\tmux.HandleFunc("/api/workspaces/update", handleWorkspacesUpdate)\n',
        '\tmux.HandleFunc("/api/workspaces/export", handleWorkspacesExport)\n',
        '\tmux.HandleFunc("/api/workspaces/import", handleWorkspacesImport)\n',
        '\tmux.HandleFunc("/api/workspaces/delete", handleWorkspacesDelete)\n',
    ] + lines[end_idx:]

    with open(filepath, 'w') as f:
        f.writelines(new_content)
    print("Successfully replaced workspace handlers in main.go")
else:
    print(f"Could not find bounds: start={start_idx}, end={end_idx}")
