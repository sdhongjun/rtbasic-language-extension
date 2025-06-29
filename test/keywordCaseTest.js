// 测试关键字大小写转换和多余空格处理

const fs = require('fs');
const path = require('path');

// 简化版的格式化器，模拟 rtbasicFormatter.ts 中的功能
class SimpleFormatter {
    constructor() {
        this.config = {
            keywords: {
                uppercase: [
                    'IF', 'THEN', 'ELSE', 'END', 'SUB', 'FUNCTION', 
                    'WHILE', 'WEND', 'FOR', 'NEXT', 'RETURN', 'EXIT'
                ],
                lowercase: [
                    'print', 'input'
                ]
            },
            built_in_functions: {
                single_word: ['ABS', 'SIN', 'COS'],
                multi_word: ['GET FILE']
            }
        };
    }

    // 转换关键字大小写
    transformKeywordCase(text) {
        const { uppercase, lowercase } = this.config.keywords;
        
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

        // 首先处理多关键字
        Object.entries(multiWordMap).forEach(([pattern, replacement]) => {
            const regex = new RegExp(`\\b${pattern}\\b`, 'gi');
            text = text.replace(regex, replacement);
        });

        // 按长度排序关键字，确保先处理较长的关键字
        const sortedUppercase = [...uppercase]
            .filter(keyword => !keyword.includes(' ')) // 排除已处理的多关键字
            .sort((a, b) => b.length - a.length);
        
        const sortedLowercase = [...lowercase]
            .filter(keyword => !keyword.includes(' ')) // 排除已处理的多关键字
            .sort((a, b) => b.length - a.length);
        
        // 处理需要大写的单个关键字
        sortedUppercase.forEach(keyword => {
            const regex = new RegExp(`\\b${keyword}\\b`, 'gi');
            text = text.replace(regex, keyword.toUpperCase());
        });
        
        // 处理需要小写的单个关键字
        sortedLowercase.forEach(keyword => {
            const regex = new RegExp(`\\b${keyword}\\b`, 'gi');
            text = text.replace(regex, keyword.toLowerCase());
        });

        // 处理单词内置函数
        this.config.built_in_functions.single_word.forEach(func => {
            const regex = new RegExp(`\\b${func}\\b`, 'gi');
            text = text.replace(regex, func.toUpperCase());
        });

        // 处理多词内置函数
        this.config.built_in_functions.multi_word.forEach(func => {
            const pattern = func.replace(/\s+/g, '\\s+');
            const regex = new RegExp(`\\b${pattern}\\b`, 'gi');
            text = text.replace(regex, func.toUpperCase());
        });
        
        return text;
    }

    // 格式化代码
    format(code) {
        // 按行处理
        const lines = code.split('\n');
        const formattedLines = lines.map(line => {
            // 转换关键字大小写
            return this.transformKeywordCase(line);
        });
        
        return formattedLines.join('\n');
    }
}

// 测试代码
const testCode = `
sub test()
    if x > 0 then
        return
        end    if
    end   sub

function example()
    if condition then
        exit    function
        end if
    else   if another_condition then
        print "test"
        end  if
    end    function

wait    idle
wait   until x > 10

global   struct MyStruct
    x as integer
end   struct

global   structure BigStruct
    y as double
end    structure

global  sub DoSomething()
    print abs(-5)
    get   file "test.txt"
end sub

global    function Calculate()
    return 42
end     function

' 测试不同的空格和制表符组合
end	if
end  	  if
else	if
else  	  if
wait	idle
wait  	  idle
global	struct
global  	  struct
`;

// 创建格式化器实例
const formatter = new SimpleFormatter();

// 格式化代码
const formattedCode = formatter.format(testCode);

// 输出结果
console.log('Original code:');
console.log('-------------------');
console.log(testCode);
console.log('-------------------\n');

console.log('Formatted code:');
console.log('-------------------');
console.log(formattedCode);
console.log('-------------------');