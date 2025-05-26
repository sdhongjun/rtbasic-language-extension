import * as vscode from 'vscode';
import { RtBasicParser } from './rtbasicParser';

export class RtBasicDocumentFormatter implements vscode.DocumentFormattingEditProvider {
    private parser: RtBasicParser;
    
    // 需要大写的关键字
    private readonly uppercaseKeywords = [
        'Global', 'Dim', 'Sub', 'End', 'Structure', 
        'Then', 'Else', 'For', 'To', 'Next', 'While', 'Wend',
        'Select', 'Case', 'Default', 'Return',
        // 组合关键字
        'End Sub', 'End If', 'End Structure'
    ];
    
    // 需要小写的关键字
    private readonly lowercaseKeywords = [
        'if', 'and', 'or', 'not', 'as', 'in'
    ];

    constructor(parser: RtBasicParser) {
        this.parser = parser;
    }
    
    // 转换关键字大小写
    private transformKeywordCase(text: string): string {
        // 按长度排序关键字，确保先处理较长的组合关键字
        const sortedUppercaseKeywords = [...this.uppercaseKeywords].sort((a, b) => b.length - a.length);
        const sortedLowercaseKeywords = [...this.lowercaseKeywords].sort((a, b) => b.length - a.length);
        
        // 处理需要大写的关键字
        sortedUppercaseKeywords.forEach(keyword => {
            const regex = new RegExp(`\\b${keyword.toLowerCase()}\\b`, 'gi');
            text = text.replace(regex, keyword);
        });
        
        // 处理需要小写的关键字
        sortedLowercaseKeywords.forEach(keyword => {
            const regex = new RegExp(`\\b${keyword.toLowerCase()}\\b`, 'gi');
            text = text.replace(regex, keyword);
        });
        
        return text;
    }

    public provideDocumentFormattingEdits(
        document: vscode.TextDocument,
        options: vscode.FormattingOptions,
        token: vscode.CancellationToken
    ): vscode.ProviderResult<vscode.TextEdit[]> {
        const edits: vscode.TextEdit[] = [];
        const tabSize = options.tabSize || 4;
        const insertSpaces = options.insertSpaces;
        const indent = insertSpaces ? ' '.repeat(tabSize) : '\t';

        for (let i = 0; i < document.lineCount; i++) {
            const line = document.lineAt(i);
            let text = this.transformKeywordCase(line.text);

            // 处理If-Then在同一行的情况
            if (text.trim().toLowerCase().startsWith('if') && text.toLowerCase().includes('then')) {
                const thenIndex = text.toLowerCase().indexOf('then');
                const afterThen = text.substring(thenIndex + 4).trim();
                
                if (afterThen && !afterThen.startsWith("'")) {
                    // 格式化为多行If语句
                    const ifCondition = text.substring(0, thenIndex + 4).trim();
                    const statement = afterThen.split("'")[0].trim();
                    const comment = afterThen.includes("'") ? " '" + afterThen.split("'")[1] : "";
                    
                    const newText = [
                        ifCondition,
                        indent + statement + comment,
                        'End If'
                    ].join('\n');

                    edits.push(vscode.TextEdit.replace(line.range, newText));
                }
            }

            // 格式化多变量定义 - 只格式化关键字，不拆分行
            if (text.trim().match(/^(Global\s+)?(Dim|Local)\s+.+,.+/i)) {
                const parts = text.trim().split(/\s+/);
                const isGlobal = parts[0].toLowerCase() === 'global';
                const modifier = isGlobal ? 'Global ' : '';
                const keyword = isGlobal ? this.transformKeywordCase(parts[1]) : this.transformKeywordCase(parts[0]);
                
                // 提取完整的变量声明部分
                const keywordPos = text.toLowerCase().indexOf(isGlobal ? parts[1].toLowerCase() : parts[0].toLowerCase());
                const keywordLength = isGlobal ? parts[1].length : parts[0].length;
                const beforeKeyword = text.substring(0, keywordPos);
                const afterKeyword = text.substring(keywordPos + keywordLength);
                
                // 构建新的格式化行，保留原始的变量声明和空格
                const formattedLine = beforeKeyword + keyword + afterKeyword;
                
                edits.push(vscode.TextEdit.replace(line.range, formattedLine));
            }

            // 格式化结构体定义
            if (text.trim().startsWith('Global Structure')) {
                const structName = text.trim().substring('Global Structure'.length).trim();
                edits.push(vscode.TextEdit.replace(line.range, `Global Structure ${structName}`));
            }
        }

        return edits;
    }
}