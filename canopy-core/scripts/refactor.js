const fs = require('fs');
const filepath = 'main.go';

const lines = fs.readFileSync(filepath, 'utf8').split('\n');

let startIdx = -1;
let endIdx = -1;

for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith('\tmux.HandleFunc("/api/workspaces/heal", func(w http.ResponseWriter, r *http.Request) {')) {
        startIdx = i;
        break;
    }
}

if (startIdx !== -1) {
    for (let i = startIdx; i < lines.length; i++) {
        if (lines[i].startsWith('\t// Secrets Vault: List')) {
            endIdx = i - 1;
            break;
        }
    }
}

if (startIdx !== -1 && endIdx !== -1) {
    const newContent = [
        ...lines.slice(0, startIdx),
        '\tmux.HandleFunc("/api/workspaces/heal", handleWorkspacesHeal)',
        '\tmux.HandleFunc("/api/workspaces", handleWorkspacesList)',
        '\tmux.HandleFunc("/api/workspaces/create", handleWorkspacesCreate)',
        '\tmux.HandleFunc("/api/workspaces/switch", handleWorkspacesSwitch)',
        '\tmux.HandleFunc("/api/workspaces/update", handleWorkspacesUpdate)',
        '\tmux.HandleFunc("/api/workspaces/export", handleWorkspacesExport)',
        '\tmux.HandleFunc("/api/workspaces/import", handleWorkspacesImport)',
        '\tmux.HandleFunc("/api/workspaces/delete", handleWorkspacesDelete)',
        '',
        ...lines.slice(endIdx + 1)
    ];

    fs.writeFileSync(filepath, newContent.join('\n'));
    console.log("Successfully replaced workspace handlers in main.go");
} else {
    console.log(`Could not find bounds: start=${startIdx}, end=${endIdx}`);
}
