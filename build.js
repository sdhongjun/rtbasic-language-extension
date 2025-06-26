const fs = require('fs');
const path = require('path');

// 确保 dist 目录存在
const distDir = path.join(__dirname, 'dist');
if (!fs.existsSync(distDir)) {
  fs.mkdirSync(distDir);
}

// 复制 builtinFunctions.yaml
const srcFile = path.join(__dirname, 'src', 'builtinFunctions.yaml');
const destFile = path.join(distDir, 'builtinFunctions.yaml');

fs.copyFileSync(srcFile, destFile);
console.log(`Copied ${srcFile} to ${destFile}`);