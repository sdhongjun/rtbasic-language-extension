const fs = require('fs');
const path = require('path');
const { RTBasicFormatter } = require('../dist/rtbasicFormatter');

// 读取测试文件
const testCode = fs.readFileSync(path.join(__dirname, 'test.rtb'), 'utf8');

// 创建格式化器实例
const formatter = new RTBasicFormatter();

// 格式化代码
const formattedCode = formatter.format(testCode);

// 输出格式化结果
console.log('Formatted code:');
console.log('-------------------');
console.log(formattedCode);
console.log('-------------------');