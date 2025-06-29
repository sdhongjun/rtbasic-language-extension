const fs = require('fs');
const path = require('path');

class SimpleFormatter {
    constructor() {
        this.indentStack = [];
        this.indentSize = 4;
    }

    format(text) {
        // 重置缩进栈
        this.indentStack = [];
        
        // 按行分割
        const lines = text.split('\n');
        const formattedLines = [];
        
        for (let line of lines) {
            const trimmedLine = line.trim();
            if (trimmedLine === '') {
                formattedLines.push('');
                continue;
            }
            
            // 计算缩进级别
            const indentLevel = this.calculateIndentLevel(line);
            
            // 应用缩进
            const indentedLine = ' '.repeat(indentLevel * this.indentSize) + trimmedLine;
            formattedLines.push(indentedLine);
        }
        
        return formattedLines.join('\n');
    }

    // 计算缩进级别
    calculateIndentLevel(line) {
        const trimmedLine = line.trim().toLowerCase();
        
        // 减少缩进的关键字
        if (trimmedLine.match(/^(end\s+|wend|next)/i)) {
            // 如果是 end if，我们需要确保它与对应的 if 在同一级
            const currentIndent = this.indentStack.pop() || 0;
            return currentIndent - 1; // 减去1，因为 end if 应该与 if 在同一级
        }

        // 增加缩进的关键字
        if (trimmedLine.match(/^(if.*then|sub|function|while|for|structure)/i) && 
            !trimmedLine.includes("'") && // 不在注释中
            !trimmedLine.match(/^if.*then.*end\s*if/i)) { // 不是单行if
            const currentIndent = this.indentStack[this.indentStack.length - 1] || 0;
            this.indentStack.push(currentIndent + 1);
            return currentIndent;
        }

        // Else 和 ElseIf 保持与 If 相同的缩进
        if (trimmedLine.match(/^(else|elseif)/i)) {
            return (this.indentStack[this.indentStack.length - 1] || 1) - 1;
        }

        // 处理 return 和 exit sub 等语句，它们不应该改变缩进栈
        if (trimmedLine.match(/^(return|exit\s+sub|exit\s+function)/i)) {
            // 保持当前缩进级别不变
            return this.indentStack[this.indentStack.length - 1] || 0;
        }

        return this.indentStack[this.indentStack.length - 1] || 0;
    }
}

// 读取测试文件
const testCode = fs.readFileSync(path.join(__dirname, 'test.rtb'), 'utf8');

// 创建格式化器实例
const formatter = new SimpleFormatter();

// 格式化代码
const formattedCode = formatter.format(testCode);

// 输出格式化结果
console.log('Formatted code:');
console.log('-------------------');
console.log(formattedCode);
console.log('-------------------');