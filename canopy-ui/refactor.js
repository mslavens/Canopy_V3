const fs = require('fs');
const path = require('path');

const filepath = path.join(__dirname, 'src', 'pages', 'DeviceManagementPage.tsx');
let content = fs.readFileSync(filepath, 'utf8');

const parts = content.split('<button\n');
let new_content = parts[0];

for (let i = 1; i < parts.length; i++) {
    const part = parts[i];
    if (part.trim().startsWith('className="context-menu-item"')) {
        const closingTagIdx = part.indexOf('>');
        const openingTagContent = part.substring(0, closingTagIdx);
        
        const onClickMatch = openingTagContent.match(/onClick=\{(.*?)\}\n/);
        const onclick = onClickMatch ? onClickMatch[1] : '';
        
        const endBtnIdx = part.indexOf('</button>', closingTagIdx);
        const innerHtml = part.substring(closingTagIdx + 1, endBtnIdx).trim();
        
        const iconMatch = innerHtml.match(/<([A-Za-z0-9]+)\s+.*?\/>/);
        let iconTag = '';
        let label = innerHtml;
        if (iconMatch) {
            iconTag = iconMatch[0];
            label = innerHtml.replace(iconTag, '').trim();
        }
        
        const danger = openingTagContent.includes('var(--status-red)') || iconTag.includes('var(--status-red)');
        const dangerProp = danger ? '\n                                  danger' : '';
        
        let iconClean = iconTag;
        if (!danger && iconClean) {
            iconClean = iconClean.replace(/style=\{\{.*?\}\}/g, '').replace(/  /g, ' ');
        }
        
        const newTag = `<ContextMenuItem
                                  icon={${iconClean || 'null'}}
                                  label="${label}"
                                  onClick={${onclick}}${dangerProp}
                                />`;
                                
        new_content += newTag + part.substring(endBtnIdx + '</button>'.length);
    } else {
        new_content += '<button\n' + part;
    }
}

fs.writeFileSync(filepath, new_content);
console.log("Refactored DeviceManagementPage.tsx");
