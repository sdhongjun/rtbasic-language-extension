const fs = require('fs');
const path = require('path');

// 读取示例文件
const sampleFilePath = path.join(__dirname, 'sample.rtb');
const sampleCode = fs.readFileSync(sampleFilePath, 'utf8');

// 简化版格式化器
class SimpleFormatter {
    constructor() {
        this.config = {
            keywords: {
                uppercase: [
                    'if', 'then', 'else', 'end', 'sub', 'function', 'return', 'dim', 'as',
                    'integer', 'string', 'double', 'boolean', 'for', 'to', 'next', 'while',
                    'wend', 'do', 'loop', 'until', 'exit', 'wait', 'call', 'struct', 'structure',
                    'global'
                ],
                lowercase: ['print']
            },
            builtinFunctions: {
                uppercase: ['abs', 'get file'],
                lowercase: []
            }
        };
    }

    format(text) {
        return this.transformKeywordCase(text);
    }

    // 转换关键字大小写
    transformKeywordCase(text) {
        const { uppercase, lowercase } = this.config.keywords;
        
        // 将文本分割成代码块，保护括号内的内容
        const blocks = [];
        let currentBlock = '';
        let parenCount = 0;
        
        for (let i = 0; i < text.length; i++) {
            const char = text[i];
            if (char === '(') {
                parenCount++;
                if (parenCount === 1) {
                    // 开始新的参数列表块
                    blocks.push({ type: 'code', content: currentBlock });
                    currentBlock = char;
                    continue;
                }
            } else if (char === ')') {
                parenCount--;
                if (parenCount === 0) {
                    // 结束参数列表块
                    currentBlock += char;
                    blocks.push({ type: 'params', content: currentBlock });
                    currentBlock = '';
                    continue;
                }
            }
            currentBlock += char;
        }
        if (currentBlock) {
            blocks.push({ type: 'code', content: currentBlock });
        }

        // 特殊的多关键字映射
        const multiWordMap = {
            'end\\s+if': 'END IF',
            'end\\s+sub': 'END SUB',
            'end\\s+function': 'END FUNCTION',
            'end\\s+struct': 'END STRUCT',
            'end\\s+structure': 'END STRUCTURE',
            'else\\s+if': 'ELSE IF',
            'wait\\s+idle': 'WAIT IDLE',
            'wait\\s+until': 'WAIT UNTIL',
            'exit\\s+sub': 'EXIT SUB',
            'exit\\s+function': 'EXIT FUNCTION',
            'global\\s+struct': 'GLOBAL STRUCT',
            'global\\s+structure': 'GLOBAL STRUCTURE',
            'global\\s+sub': 'GLOBAL SUB',
            'global\\s+function': 'GLOBAL FUNCTION'
        };

        // 处理每个代码块
        return blocks.map(block => {
            if (block.type === 'params') {
                // 在参数列表中，保留逗号和空格，只转换类型关键字和AS关键字的大小写
                const typeKeywords = ['integer', 'string', 'double', 'boolean'];
                let content = block.content;
                
                // 转换AS关键字
                content = content.replace(/\bas\b/gi, 'AS');
                
                // 转换类型关键字
                typeKeywords.forEach(keyword => {
                    const regex = new RegExp(`\\b${keyword}\\b`, 'gi');
                    content = content.replace(regex, keyword.toUpperCase());
                });
                
                // 确保逗号后面有一个空格
                content = content.replace(/,\s*/g, ', ');
                
                return content;
            } else {
                let content = block.content;
                // 首先处理多关键字
                Object.entries(multiWordMap).forEach(([pattern, replacement]) => {
                    const regex = new RegExp(`\\b${pattern}\\b`, 'gi');
                    content = content.replace(regex, replacement);
                });

                // 处理单个关键字
                uppercase.forEach(keyword => {
                    const regex = new RegExp(`\\b${keyword}\\b`, 'gi');
                    content = content.replace(regex, keyword.toUpperCase());
                });

                lowercase.forEach(keyword => {
                    const regex = new RegExp(`\\b${keyword}\\b`, 'gi');
                    content = content.replace(regex, keyword.toLowerCase());
                });

                // 处理内置函数
                this.config.builtinFunctions.uppercase.forEach(func => {
                    const regex = new RegExp(`\\b${func}\\b`, 'gi');
                    content = content.replace(regex, func.toUpperCase());
                });

                this.config.builtinFunctions.lowercase.forEach(func => {
                    const regex = new RegExp(`\\b${func}\\b`, 'gi');
                    content = content.replace(regex, func.toLowerCase());
                });

                return content;
            }
        }).join('');
    }
}

// 创建格式化器实例
const formatter = new SimpleFormatter();

// 格式化代码
const formattedCode = formatter.format(sampleCode);

console.log('Original code:');
console.log('-------------------');
console.log(sampleCode);
console.log('-------------------\n');

console.log('Formatted code:');
console.log('-------------------');
console.log(formattedCode);
console.log('-------------------');

// 将格式化后的代码写回文件
fs.writeFileSync(path.join(__dirname, 'sample.formatted.rtb'), formattedCode);