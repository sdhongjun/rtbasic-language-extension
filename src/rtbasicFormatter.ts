import * as vscode from 'vscode';
import { RtBasicParser } from './rtbasicParser';

export class RtBasicDocumentFormatter implements vscode.DocumentFormattingEditProvider {
    private parser: RtBasicParser;
    
    // 需要大写的关键字
    private readonly uppercaseKeywords = [
        'Global', 'Dim', 'Sub', 'End', 'Structure', 
        'Then', 'Else', 'For', 'To', 'Next', 'While', 'Wend',
        'Select', 'Case', 'Default', 'Return'
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
        // 处理需要大写的关键字
        this.uppercaseKeywords.forEach(keyword => {
            const regex = new RegExp(`\\b${keyword.toLowerCase()}\\b`, 'gi');
            text = text.replace(regex, keyword);
        });
        
        // 处理需要小写的关键字
        this.lowercaseKeywords.forEach(keyword => {
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

            // 格式化多变量定义
            if (text.trim().match(/^(Global\s+)?(Dim|Local)\s+.+,.+/i)) {
                const parts = text.trim().split(/\s+/);
                const modifier = parts[0] === 'Global' ? 'Global ' : '';
                const keyword = parts[0] === 'Global' ? parts[1] : parts[0];
                const varsAndType = text.trim().substring(modifier.length + keyword.length).trim();
                
                // 分割变量和类型
                const [vars, typeDecl] = varsAndType.split(/\s+as\s+/i);
                const variables = vars.split(',').map((v: string) => v.trim());
                const type = typeDecl ? ` As ${typeDecl}` : '';

                // 重新格式化为每行一个变量
                const newLines = variables.map((v: string) => {
                    return `${modifier}${keyword} ${v}${type}`;
                });

                edits.push(vscode.TextEdit.replace(line.range, newLines.join('\n')));
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