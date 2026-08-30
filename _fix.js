const fs = require('fs');
let s = fs.readFileSync('js/misar-ai.js', 'utf8');
const lines = s.split('\n');
// السطر 247 (index 246) غير مغلق و248 هو بقايا - نستبدل الاثنين
lines.splice(246, 2, "    return 'Misar AI helper ready';");
fs.writeFileSync('js/misar-ai.js', lines.join('\n'));
console.log('replaced');
