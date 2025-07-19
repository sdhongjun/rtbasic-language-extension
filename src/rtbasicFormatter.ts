import * as vscode from 'vscode';
import * as yaml from 'yaml';
import * as fs from 'fs';
import * as path from 'path';
import { RtBasicParser, ControlBlock } from './rtbasicParser';

interface LanguageConfig {
    keywords: {
        passcal_word: string[];
        multi_word_map: { [key: string]: string };  // 添加多词关键字映射
    };
    built_in_functions: {
        single_word: string[];
        multi_word: string[];
    };
    formatting: {
        default_indent: number;
        convert_tabs_to_spaces: boolean;
        max_line_length: number;
        split_single_line_if: boolean;
        preserve_empty_lines: boolean;
        align_function_parameters: boolean;
    };
}

export class RtBasicDocumentFormatter implements vscode.DocumentFormattingEditProvider {
    private parser: RtBasicParser;
    private config: LanguageConfig;
    private indentStack: number[] = [];

    constructor(parser: RtBasicParser) {
        this.parser = parser;
        this.config = this.loadConfig();
    }

    // 加载YAML配置文件
    private loadConfig(): LanguageConfig {
        try {
            const configPath = path.join(__dirname, 'config', 'language-config.yaml');
            const fileContents = fs.readFileSync(configPath, 'utf8');
            return yaml.parse(fileContents) as LanguageConfig;
        } catch (error) {
            console.error('Error loading language configuration:', error);
            // 返回默认配置
            return {
                keywords: { passcal_word: [], multi_word_map: {} },
                built_in_functions: { single_word: [], multi_word: [] },
                formatting: {
                    default_indent: 4,
                    convert_tabs_to_spaces: true,
                    max_line_length: 120,
                    split_single_line_if: true,
                    preserve_empty_lines: true,
                    align_function_parameters: true
                }
            };
        }
    }

    /**
     * 保护字符串内容，避免被关键字替换影响
     * @param text 要处理的文本
     * @returns 处理后的文本和字符串映射
     */
    private protectStringContent(text: string): { processedText: string, stringMap: Map<string, string> } {
        const stringMap = new Map<string, string>();
        let stringCount = 0;

        // 使用正则表达式匹配双引号字符串
        const stringRegex = /"([^"]*)"/g;
        const processedText = text.replace(stringRegex, (match) => {
            const placeholder = `__STRING_${stringCount}__`;
            stringMap.set(placeholder, match);
            stringCount++;
            return placeholder;
        });

        return { processedText, stringMap };
    }

    /**
     * 恢复字符串内容
     * @param text 处理后的文本
     * @param stringMap 字符串映射
     * @returns 恢复字符串后的文本
     */
    private restoreStringContent(text: string, stringMap: Map<string, string>): string {
        let restoredText = text;
        stringMap.forEach((value, key) => {
            restoredText = restoredText.replace(key, value);
        });
        return restoredText;
    }

    // 转换关键字大小写
    private transformKeywordCase(text: string): string {
        const { passcal_word, multi_word_map } = this.config.keywords;

        // 首先处理多关键字
        Object.entries(multi_word_map || {}).forEach(([pattern, replacement]) => {
            const regex = new RegExp(`\\b${pattern}\\b`, 'gi');
            text = text.replace(regex, replacement);
        });


        const sortedLowercase = [...passcal_word]
            .filter(keyword => !keyword.includes(' ')) // 排除已处理的多关键字
            .sort((a, b) => b.length - a.length);

        // 处理需要小写的单个关键字
        sortedLowercase.forEach(keyword => {
            const regex = new RegExp(`\\b${keyword}\\b`, 'gi');
            text = text.replace(regex, keyword);
        });

        // 处理单词内置函数
        this.config.built_in_functions.single_word.forEach(func => {
            const regex = new RegExp(`\\b${func}\\b`, 'gi');
            text = text.replace(regex, func);
        });

        // 处理多词内置函数
        this.config.built_in_functions.multi_word.forEach(func => {
            const pattern = func.replace(/\s+/g, '\\s+');
            const regex = new RegExp(`\\b${pattern}\\b`, 'gi');
            text = text.replace(regex, func);
        });

        return text;
    }

    /**
     * 计算缩进级别
     * @param line 当前行
     * @returns 计算后的缩进级别
     */
    private calculateIndentLevel(line: string): number {
        // 保护字符串内容，避免错误匹配字符串中的关键字
        const { processedText, stringMap } = this.protectStringContent(line);
        const trimmedLine = processedText.trim().toLowerCase();

        // 检查是否是注释行
        if (trimmedLine.startsWith("'")) {
            return this.indentStack[this.indentStack.length - 1] || 0;
        }

        // 减少缩进的关键字
        const decreaseIndentRegex = /^(end\s+if|end\s+sub|end\s+function|end\s+struct|end\s+structure|wend|next)/i;
        if (decreaseIndentRegex.test(trimmedLine)) {
            // 如果是结束块，我们需要减少缩进级别
            const currentIndent = this.indentStack.pop() || 0;
            return Math.max(0, currentIndent - 1); // 确保缩进不会小于0
        }

        // Else 和 ElseIf 保持与 If 相同的缩进
        if (/^(else|elseif|else\s+if)/i.test(trimmedLine)) {
            // 保持与 If 相同的缩进级别
            return Math.max(0, (this.indentStack[this.indentStack.length - 1] || 1) - 1);
        }

        // 增加缩进的关键字
        const increaseIndentRegex = /^(if.*then|sub\b|function\b|while\b|for\b|struct\b|global\s+struct\b|structure\b|global\s+structure\b|global\s+sub\b|global\s+function\b)/i;
        const singleLineIfBlockRegx = /^\s*if\b[\s\S]+?\bthen\b\s+\w+.*$/i;
        if (increaseIndentRegex.test(trimmedLine) &&
            !(singleLineIfBlockRegx.test(trimmedLine))) { // 不是单行if
            const currentIndent = this.indentStack[this.indentStack.length - 1] || 0;
            this.indentStack.push(currentIndent + 1);
            return currentIndent;
        }

        // 处理 return 和 exit sub 等语句，它们不应该改变缩进栈
        if (/^(return|exit\s+sub|exit\s+function)/i.test(trimmedLine)) {
            // 保持当前缩进级别不变
            return this.indentStack[this.indentStack.length - 1] || 0;
        }

        // 默认情况下，使用当前缩进级别
        return this.indentStack[this.indentStack.length - 1] || 0;
    }

    // 处理制表符转换
    private handleTabConversion(text: string, options: vscode.FormattingOptions): string {
        if (this.config.formatting.convert_tabs_to_spaces) {
            const tabSize = options.tabSize || this.config.formatting.default_indent;
            return text.replace(/\t/g, ' '.repeat(tabSize));
        }
        return text;
    }

    /**
     * 格式化函数参数列表
     * @param line 要格式化的行
     * @returns 格式化后的行
     */
    private formatFunctionParams(line: string): string {
        // 匹配函数声明，包括 sub、function 和它们的 global 变体
        const funcMatch = line.match(/^((?:GLOBAL\s+)?(?:SUB|FUNCTION)\s+\w+\s*\()([^)]*)\)(.*)/i);
        if (!funcMatch) {
            return line;
        }

        const [, prefix, params, suffix] = funcMatch;
        if (!params.trim()) {
            return prefix + ")" + suffix;
        }

        // 分割参数列表
        const paramList = params.split(',').map(param => param.trim());
        const formattedParams: string[] = [];

        for (const param of paramList) {
            // 匹配参数名称和类型
            const paramMatch = param.match(/^(\w+)\s+AS\s+(\w+)$/i);
            if (paramMatch) {
                const [, varName, typeName] = paramMatch;
                // 保持变量名原始大小写，类型名大写
                formattedParams.push(`${varName} AS ${typeName.toUpperCase()}`);
            } else {
                // 如果参数格式不正确，保持原样
                formattedParams.push(param);
            }
        }

        // 根据参数数量决定格式
        if (formattedParams.length > 1) {
            // 多个参数时，每个参数之间添加逗号和空格
            return prefix + formattedParams.join(", ") + ")" + suffix;
        } else {
            // 单个参数时，不需要逗号
            return prefix + formattedParams[0] + ")" + suffix;
        }
    }

    /**
     * 格式化单行代码
     * @param line 要格式化的行
     * @param indentLevel 缩进级别
     * @param options 格式化选项
     * @returns 格式化后的行
     */
    /**
     * 格式化运算符，确保运算符前后有空格
     * @param text 要处理的文本
     * @returns 格式化后的文本
     */
    private formatOperators(text: string): string {
        const OPERATOR_REGEX = /([+\-*/=]|<>|>>=|<<=|>>|<<|>=|<=|(?<!\<)>|<(?!\>))(?!=)/gi;
        text = text.replace(OPERATOR_REGEX, ` $1 `);

        // 处理逗号分隔符与连续空格
        return text.split(/\s*,/).join(', ').replace(/\s+/g, ' ').trim();
    }

    /**
     * Formats a single line of RTBASIC code by:
     * - Handling tab conversions
     * - Preserving comments (text after single quote)
     * - Protecting string contents during transformations
     * - Applying keyword case conversion
     * - Formatting operators and function parameters
     * - Restoring protected strings
     * - Applying proper indentation
     * @param line The input line to format
     * @param indentLevel Number of indentation levels to apply
     * @param options VS Code formatting options
     * @returns The formatted line with proper indentation
     */
    private formatLine(line: string, indentLevel: number, options: vscode.FormattingOptions): string {
        // 转换制表符
        line = this.handleTabConversion(line.trim(), options);

        let procText = line;
        let commentText = '';
        let splitPartMatch = /^((?:[^'"]|"(?:[^"]|"")*")*?)?(\s*'.*)?$/g.exec(procText);
        if (splitPartMatch) {
            procText = splitPartMatch[1] || '';
            commentText = splitPartMatch[2] || '';
        }

        // 保护字符串内容
        const { processedText, stringMap } = this.protectStringContent(procText);

        // 应用关键字大小写转换
        let formattedText = this.transformKeywordCase(processedText);

        // 格式化运算符
        formattedText = this.formatOperators(formattedText);

        // 格式化函数参数列表
        formattedText = this.formatFunctionParams(formattedText);

        // 恢复字符串内容
        formattedText = this.restoreStringContent(formattedText, stringMap);

        // 添加缩进
        const indentSize = options.tabSize || this.config.formatting.default_indent;
        const indentStr = options.insertSpaces || this.config.formatting.convert_tabs_to_spaces ? ' '.repeat(indentSize) : '\t';
        return indentStr.repeat(indentLevel) + formattedText + commentText;
    }

    /**
     * 提供文档格式化编辑
     * @param document 要格式化的文档
     * @param options 格式化选项
     * @param token 取消令牌
     * @returns 文本编辑数组
     */
    public provideDocumentFormattingEdits(
        document: vscode.TextDocument,
        options: vscode.FormattingOptions,
        token: vscode.CancellationToken
    ): vscode.TextEdit[] {
        try {
            const edits: vscode.TextEdit[] = [];
            this.indentStack = [0]; // 重置缩进栈

            // 解析文档获取控制块信息
            const { controlBlocks } = this.parser.parse(document);

            for (let i = 0; i < document.lineCount; i++) {
                // 检查是否取消
                if (token.isCancellationRequested) {
                    return [];
                }

                const line = document.lineAt(i);
                const text = line.text;

                // 处理空行
                if (text.trim().length === 0) {
                    // 根据配置决定是否保留空行
                    const preserveEmptyLines = this.config.formatting.preserve_empty_lines !== false;
                    if (preserveEmptyLines) {
                        edits.push(vscode.TextEdit.replace(line.range, ''));
                    }
                    continue;
                }

                // 保留注释行，但应用适当的缩进
                if (text.trim().startsWith("'")) {
                    edits.push(vscode.TextEdit.replace(
                        line.range,
                        this.formatLine(text, this.indentStack[this.indentStack.length - 1], options)
                    ));
                    continue;
                }

                // 计算当前行的缩进级别
                const indentLevel = this.calculateIndentLevel(text);

                // 处理单行If-Then语句
                // 只有当用户配置了拆分单行if语句时才执行此操作
                const shouldSplitSingleLineIf = this.config.formatting.split_single_line_if !== false;
                if (shouldSplitSingleLineIf && text.trim().toLowerCase().match(/^if.*then.*[^'\n]+$/i)) {
                    // 保护字符串内容，避免错误拆分包含"then"的字符串
                    const { processedText, stringMap } = this.protectStringContent(text);

                    // 在处理过的文本中查找"then"
                    if (processedText.toLowerCase().match(/\bthen\b/i)) {
                        const parts = processedText.split(/\bthen\b/i);
                        if (parts.length > 1 && !parts[1].trim().startsWith("'")) {
                            // 恢复字符串内容
                            const ifPart = this.restoreStringContent(parts[0], stringMap) + 'Then';
                            const thenPart = this.restoreStringContent(parts[1], stringMap).trim();

                            // 避免拆分已经包含End If的单行if语句
                            if (!thenPart.toLowerCase().includes('end if')) {
                                edits.push(vscode.TextEdit.replace(line.range, [
                                    this.formatLine(ifPart, indentLevel, options),
                                    this.formatLine(thenPart, indentLevel + 1, options),
                                    this.formatLine('End If', indentLevel, options)
                                ].join('\n')));
                                continue;
                            }
                        }
                    }
                }

                // 格式化当前行
                const formattedLine = this.formatLine(text, indentLevel, options);
                edits.push(vscode.TextEdit.replace(line.range, formattedLine));
            }

            return edits;
        } catch (error) {
            console.error('Error formatting RTBasic document:', error);
            return [];
        }
    }
}