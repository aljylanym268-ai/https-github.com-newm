const fs = require('fs');
const c = fs.readFileSync('index.html', 'utf8');
const start = c.lastIndexOf('<script>');
const inner = c.slice(start + 8, c.lastIndexOf('</script>'));
try {
  new Function(inner);
  console.log('inline script parses OK, length:', inner.length);
} catch (e) {
  console.log('INLINE PARSE ERROR:', e.message);
}