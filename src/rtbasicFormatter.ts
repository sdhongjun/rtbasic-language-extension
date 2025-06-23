import * as vscode from 'vscode';
import { RtBasicParser, ControlBlock } from './rtbasicParser';

export class RtBasicDocumentFormatter implements vscode.DocumentFormattingEditProvider {
    private parser: RtBasicParser;
    
    // 需要大写的关键字
    private readonly uppercaseKeywords = [
        'Global', 'Dim', 'Sub', 'End', 'Structure', 
        'Then', 'Else', 'ElseIf', 'For', 'To', 'Next', 'While', 'Wend',
        'Select', 'Case', 'Default', 'Return', 'Function',
        // 组合关键字
        'End Sub', 'End If', 'End Structure', 'End Function',
        'Global Sub', 'ElseIf Then'
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
            const regex = new RegExp(`\\b${keyword}\\b`, 'gi');
            text = text.replace(regex, keyword.toLowerCase());
        });
        
        return text;
    }

    public provideDocumentFormattingEdits(
        document: vscode.TextDocument,
        options: vscode.FormattingOptions,
        token: vscode.CancellationToken
    ): vscode.TextEdit[] {
        const edits: vscode.TextEdit[] = [];
        const tabSize = options.tabSize || 4;
        const insertSpaces = options.insertSpaces;
        const indent = insertSpaces ? ' '.repeat(tabSize) : '\t';

        // 解析文档获取控制块信息
        const { controlBlocks } = this.parser.parse(document);
        const ifBlocks = controlBlocks.filter(block => block.type === 'If');
        let currentIndent = 0;

        for (let i = 0; i < document.lineCount; i++) {
            const line = document.lineAt(i);
            let text = this.transformKeywordCase(line.text);
            const lineRange = line.range;

            // 检查当前行是否在If块中
            const containingBlock = ifBlocks.find((block: ControlBlock) => 
                block.range.start.line <= i && block.range.end.line >= i
            );

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

                    edits.push(vscode.TextEdit.replace(lineRange, newText));
                    continue; // 跳过后续处理，避免重复修改
                }
            }

            // 更新缩进级别
            const lowerCaseText = text.trim().toLowerCase();
            if (lowerCaseText.startsWith('end') ||
                lowerCaseText.startsWith('end if') ||
                lowerCaseText.startsWith('wend') ||
                lowerCaseText.startsWith('next') ||
                lowerCaseText.startsWith('end sub') ||
                lowerCaseText.startsWith('end function')) {
                // 减小缩进级别
                currentIndent = Math.max(0, currentIndent - 1);
            }      
            
            // 处理ElseIf-Then在同一行的情况
            else if (text.trim().toLowerCase().startsWith('elseif') && text.toLowerCase().includes('then')) {
                const thenIndex = text.toLowerCase().indexOf('then');
                const afterThen = text.substring(thenIndex + 4).trim();
                
                if (afterThen && !afterThen.startsWith("'")) {
                    // 格式化为多行ElseIf语句
                    const elseIfCondition = text.substring(0, thenIndex + 4).trim();
                    const commentIndex = afterThen.indexOf("'");
                    const statement = commentIndex >= 0 ? afterThen.substring(0, commentIndex).trim() : afterThen.trim();
                    const comment = commentIndex >= 0 ? ' ' + afterThen.substring(commentIndex) : "";
                    
                    const newText = [
                        elseIfCondition,
                        indent + statement + comment
                    ].join('\n');

                    edits.push(vscode.TextEdit.replace(lineRange, newText));
                }
            }

            // 处理Else语句
            else if (lowerCaseText.startsWith('else') && 
                    !lowerCaseText.startsWith('elseif')) {
                // 移除前导空格，保持与If对齐
                const trimmedText = text.trim();
                edits.push(vscode.TextEdit.replace(lineRange, trimmedText));
                currentIndent += 1;
            }

            // 处理普通行的缩进
            if (containingBlock && !text.trim().match(/^(If|ElseIf|Else|End If)/i)) {
                const newText = indent.repeat(currentIndent) + text.trim();
                edits.push(vscode.TextEdit.replace(lineRange, newText));
                currentIndent += 1;
            }

            // 格式化多变量定义 - 只格式化关键字，不拆分行
            if (text.trim().match(/^(Global\s+)?(Dim|Local)\s+.+,.+/i)) {
                const parts = text.trim().split(/\s+/);
                const scopeModifier = parts[0].toLowerCase();
                const isGlobal = scopeModifier === 'global';
                const isFile = !isGlobal;
                const keyword = (isGlobal || isFile) ? this.transformKeywordCase(parts[1]) : this.transformKeywordCase(parts[0]);
                
                // 提取完整的变量声明部分
                const keywordPos = text.toLowerCase().indexOf((isGlobal || isFile) ? parts[1].toLowerCase() : parts[0].toLowerCase());
                const keywordLength = (isGlobal || isFile) ? parts[1].length : parts[0].length;
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

            // 格式化函数定义
            const subMatch = text.trim().match(/^(Global\s+)?(Sub|Function)\s+(\w+)\s*\((.*)\)(\s+As\s+\w+)?/i);
            if (subMatch) {
                const [, globalModifier, subType, subName, params, returnType] = subMatch;
                const formattedGlobal = globalModifier ? 'Global ' : '';
                const formattedSubType = this.transformKeywordCase(subType);
                const formattedParams = params.split(',')
                    .map(param => param.trim())
                    .join(', ');
                const formattedReturnType = returnType ? returnType.trim() : '';
                
                const formattedLine = `${formattedGlobal}${formattedSubType} ${subName}(${formattedParams})${formattedReturnType}`;
                edits.push(vscode.TextEdit.replace(line.range, formattedLine));
            }

            // 格式化 End Sub/Function
            const endSubMatch = text.trim().match(/^End\s+(Sub|Function)$/i);
            if (endSubMatch) {
                const [, subType] = endSubMatch;
                const formattedLine = `End ${this.transformKeywordCase(subType)}`;
                edits.push(vscode.TextEdit.replace(line.range, formattedLine));
            }
        }

        return edits;
    }
}