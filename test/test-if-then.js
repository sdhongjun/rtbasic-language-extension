// 测试 if-then 语句的解析和诊断

const fs = require('fs');
const path = require('path');
const { RtBasicParser } = require('../out/rtbasicParser');

// 读取测试文件
const testFilePath = path.join(__dirname, 'if-then-test.bas');
const testFileContent = fs.readFileSync(testFilePath, 'utf8');

// 创建一个模拟的 VS Code 文档对象
const mockDocument = {
    getText: () => testFileContent,
    lineAt: (line) => {
        const lines = testFileContent.split('\n');
        return { text: lines[line] || '' };
    },
    lineCount: testFileContent.split('\n').length,
    uri: { fsPath: testFilePath }
};

// 创建解析器实例
const parser = new RtBasicParser();

// 解析文档
console.log('解析文档...');
const symbols = parser.parse(mockDocument);

// 输出控制块信息
console.log('\n控制块信息:');
symbols.controlBlocks.forEach((block, index) => {
    console.log(`[${index}] 类型: ${block.type}, 单行: ${block.isSingleLine}, 范围: 行 ${block.range.start.line + 1} 到 行 ${block.range.end.line + 1}`);
});

// 模拟诊断检查
console.log('\n诊断信息:');
const diagnostics = [];

// 检查未闭合的控制块
const unclosedBlocks = symbols.controlBlocks.filter(block => {
    // 如果是单行if语句，不应该被标记为未闭合
    if (block.type === 'If' && block.isSingleLine) {
        return false;
    }
    
    // 如果是同一行包含If和End If的情况，不应该被标记为未闭合
    if (block.type === 'If' && block.range.start.line === block.range.end.line) {
        // 获取该行的文本内容
        const lineText = mockDocument.lineAt(block.range.start.line).text;
        // 检查是否包含End If
        if (lineText.match(/\bEnd\s+If\b/i)) {
            return false;
        }
    }
    
    // 对于其他类型的控制块或多行if语句，如果开始行和结束行相同，则认为是未闭合的
    return block.range.start.line === block.range.end.line;
});

for (const block of unclosedBlocks) {
    const matchingEndType = {
        'If': 'End If',
        'For': 'Next',
        'While': 'Wend',
        'Select': 'End Select'
    }[block.type] || '未知';
    
    console.log(`错误: 未闭合的控制块: ${block.type}。需要添加 ${matchingEndType}，在行 ${block.range.start.line + 1}`);
}

// 检查控制块类型匹配
const blockStack = [];

for (const block of symbols.controlBlocks) {
    const isBlockStart = ['If', 'For', 'While', 'Select'].includes(block.type);
    const isBlockEnd = ['End If', 'Next', 'Wend', 'End Select'].includes(block.type);
    
    if (isBlockStart) {
        // 单行if语句不需要匹配的结束标记
        if (block.type === 'If' && block.isSingleLine) {
            continue;
        }
        
        blockStack.push(block);
    } else if (isBlockEnd) {
        const lastBlock = blockStack.pop();
        if (!lastBlock) {
            console.log(`错误: 意外的控制块结束: ${block.type}，没有找到对应的开始块，在行 ${block.range.start.line + 1}`);
        } else {
            const matchingPairs = {
                'If': 'End If',
                'For': 'Next',
                'While': 'Wend',
                'Select': 'End Select'
            };
            
            if (matchingPairs[lastBlock.type] !== block.type) {
                console.log(`错误: 控制块类型不匹配: 期望 ${matchingPairs[lastBlock.type]}, 实际为 ${block.type}，在行 ${block.range.start.line + 1}`);
            }
        }
    }
}

// 检查剩余未闭合的块
for (const block of blockStack) {
    // 单行if语句不需要匹配的结束标记
    if (block.type === 'If' && block.isSingleLine) {
        continue;
    }
    
    const matchingEndType = {
        'If': 'End If',
        'For': 'Next',
        'While': 'Wend',
        'Select': 'End Select'
    }[block.type] || '未知';
    
    console.log(`错误: 控制块未正确闭合: ${block.type} 缺少 ${matchingEndType}，在行 ${block.range.start.line + 1}`);
}

console.log('\n测试完成');