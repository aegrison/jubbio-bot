const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, '../node_modules/@jubbio/core/dist/Client.js');

if (fs.existsSync(filePath)) {
    let content = fs.readFileSync(filePath, 'utf8');
    content = content.replace(/selfDeaf:\s*true/g, 'selfDeaf: false');
    fs.writeFileSync(filePath, content);
    console.log('Jubbio voice patch applied successfully!');
} else {
    console.log('Voice file not found, skipping patch.');
}
