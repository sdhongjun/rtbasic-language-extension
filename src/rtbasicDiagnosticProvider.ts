import * as vscode from 'vscode';
import { RtBasicParser, ControlBlock, RtBasicVariable, ControlBlockType } from './rtbasicParser';

// 扩展现有的类型以包含文件作用域
type VariableScope = 'global' | 'local' | 'file' | 'block';

// 使用从 RtBasicParser 导入的类型

export class RtBasicDiagnosticProvider {
    private diagnosticCollection: vscode.DiagnosticCollection;
    private parser: RtBasicParser;
    private workspaceManager: any; // 使用any类型，后续可以根据实际类型进行调整

    constructor(context: vscode.ExtensionContext, workspaceManager: any) {
        this.diagnosticCollection = vscode.languages.createDiagnosticCollection('rtbasic');
        this.parser = new RtBasicParser();
        this.workspaceManager = workspaceManager;
        
        // 注册事件监听器
        context.subscriptions.push(
            vscode.workspace.onDidChangeTextDocument(this.onDocumentChange, this),
            vscode.workspace.onDidOpenTextDocument(this.onDocumentOpen, this),
            this.diagnosticCollection
        );
    }

    private async onDocumentChange(event: vscode.TextDocumentChangeEvent) {
        if (event.document.languageId === 'rtbasic') {
            await this.updateDiagnostics(event.document);
        }
    }

    private async onDocumentOpen(document: vscode.TextDocument) {
        if (document.languageId === 'rtbasic') {
            await this.updateDiagnostics(document);
        }
    }

    private async updateDiagnostics(document: vscode.TextDocument) {
        const diagnostics: vscode.Diagnostic[] = [];
        
        // 解析文档
        const symbols = this.parser.parse(document);
        
        // 检查未闭合的控制块
        this.checkUnclosedBlocks(symbols.controlBlocks, diagnostics, document);
        
        // 检查控制块类型匹配
        this.checkBlockTypeMatching(symbols.controlBlocks, diagnostics);
        
        // 检查ElseIf和Else语句的位置
        this.checkElseIfElseStatements(document, symbols.controlBlocks, diagnostics);
        
        // 检查变量作用域
        this.checkVariableScopes(symbols.variables, symbols.controlBlocks, diagnostics);
        
        // 更新诊断信息
        this.diagnosticCollection.set(document.uri, diagnostics);
    }

    /**
     * 判断一行代码是否是单行语句
     * @param text 代码文本
     * @returns 是否是单行语句
     */
    private isSingleLineStatement(text: string): boolean {
        const hasThen = text.toLowerCase().includes("then");
        if (!hasThen) return false;
        
        const thenIndex = text.toLowerCase().indexOf("then");
        const afterThen = text.substring(thenIndex + 4).trim();
        
        // 如果Then后面没有内容，或者只有注释，就不是单行语句
        return afterThen !== "" && 
               !afterThen.startsWith("'") && 
               !afterThen.toLowerCase().startsWith("rem ");
    }

    /**
     * 判断一个控制块是否在Sub内部
     * @param block 控制块
     * @param document 文档
     * @returns 是否在Sub内部
     */
    private isBlockInSub(block: ControlBlock, document: vscode.TextDocument): boolean {
        // 从块的开始位置向上查找Sub声明
        for (let line = block.range.start.line; line >= 0; line--) {
            const text = document.lineAt(line).text.trim().toLowerCase();
            if (text.startsWith('sub ')) return true;
            if (text === 'end sub') return false;
        }
        return false;
    }

    /**
     * 获取If块的父级Sub名称
     * @param block 控制块
     * @param document 文档
     * @returns Sub名称或undefined
     */
    private getParentSubName(block: ControlBlock, document: vscode.TextDocument): string | undefined {
        for (let line = block.range.start.line; line >= 0; line--) {
            const text = document.lineAt(line).text.trim();
            if (text.toLowerCase().startsWith('sub ')) {
                const match = text.match(/^sub\s+(\w+)/i);
                return match ? match[1] : undefined;
            }
        }
        return undefined;
    }

    /**
     * 检查If语句、ElseIf和Else分支的正确性
     * 重构版本，使用更健壮的逻辑
     */
    private checkElseIfElseStatements(document: vscode.TextDocument, blocks: ControlBlock[], diagnostics: vscode.Diagnostic[]) {
        // 按行号对控制块进行排序
        const sortedBlocks = [...blocks].sort((a, b) => a.range.start.line - b.range.start.line);
        
        // 创建一个映射，用于快速查找每行对应的控制块
        const lineToBlockMap = new Map<number, ControlBlock>();
        for (const block of blocks) {
            lineToBlockMap.set(block.range.start.line, block);
        }
        
        // 用于跟踪If块的栈
        interface IfContext {
            block: ControlBlock;
            isSingleLine: boolean;
            hasElse: boolean;
            parentSub?: string;
            startLine: number;
            endLine?: number;
            elseIfLines: number[];
            elseLines: number[];
        }
        
        const ifContextStack: IfContext[] = [];
        const allIfContexts: IfContext[] = [];
        
        // 第一遍扫描：构建If块的上下文信息
        for (let i = 0; i < document.lineCount; i++) {
            const line = document.lineAt(i);
            const text = line.text.trim().toLowerCase();
            const block = lineToBlockMap.get(i);

            // 处理If语句
            if (block && block.type === 'If') {
                const isSingleLine = this.isSingleLineStatement(text);
                const parentSub = this.getParentSubName(block, document);
                
                const context: IfContext = {
                    block,
                    isSingleLine,
                    hasElse: false,
                    parentSub,
                    startLine: i,
                    elseIfLines: [],
                    elseLines: []
                };

                ifContextStack.push(context);
                allIfContexts.push(context);
                continue;
            }

            // 处理End If语句
            if (text === 'end if' && ifContextStack.length > 0) {
                const currentContext = ifContextStack[ifContextStack.length - 1];
                currentContext.endLine = i;
                ifContextStack.pop();
                continue;
            }

            // 处理ElseIf语句
            if (text.startsWith('elseif') && ifContextStack.length > 0) {
                const currentContext = ifContextStack[ifContextStack.length - 1];
                currentContext.elseIfLines.push(i);
                continue;
            }

            // 处理Else语句
            if (text === 'else' && ifContextStack.length > 0) {
                const currentContext = ifContextStack[ifContextStack.length - 1];
                currentContext.elseLines.push(i);
                currentContext.hasElse = true;
                continue;
            }
            
        }

        // 第二遍扫描：检查ElseIf和Else语句的正确性
        for (const context of allIfContexts) {
            // 检查单行If语句的ElseIf和Else
            if (context.isSingleLine) {
                // 单行If不应该有End If
                if (context.endLine !== undefined) {
                    diagnostics.push(new vscode.Diagnostic(
                        document.lineAt(context.endLine).range,
                        `单行If语句不应该有End If`,
                        vscode.DiagnosticSeverity.Error
                    ));
                }

                // 检查ElseIf语句
                for (const elseIfLine of context.elseIfLines) {
                    const line = document.lineAt(elseIfLine);
                    const text = line.text.trim();
                    
                    // 单行If后的ElseIf也必须是单行形式
                    if (!this.isSingleLineStatement(text)) {
                        diagnostics.push(new vscode.Diagnostic(
                            line.range,
                            `单行If语句后的ElseIf也必须是单行形式`,
                            vscode.DiagnosticSeverity.Error
                        ));
                    }
                }

                // 检查Else语句
                for (const elseLine of context.elseLines) {
                    const line = document.lineAt(elseLine);
                    const text = line.text.trim();
                    
                    // 单行If后的Else也必须是单行形式
                    if (text.toLowerCase() === 'else') {
                        diagnostics.push(new vscode.Diagnostic(
                            line.range,
                            `单行If语句后的Else也必须是单行形式，应包含语句`,
                            vscode.DiagnosticSeverity.Error
                        ));
                    }
                }
            } else {
                // 多行If语句的检查
                
                // 多行If必须有End If
                if (context.endLine === undefined) {
                    diagnostics.push(new vscode.Diagnostic(
                        document.lineAt(context.startLine).range,
                        `多行If语句必须有对应的End If`,
                        vscode.DiagnosticSeverity.Error
                    ));
                }

                // 检查ElseIf语句
                for (const elseIfLine of context.elseIfLines) {
                    const line = document.lineAt(elseIfLine);
                    const text = line.text.trim();
                    
                    // 多行If块内的ElseIf不能是单行形式
                    if (this.isSingleLineStatement(text)) {
                        diagnostics.push(new vscode.Diagnostic(
                            line.range,
                            `多行If块内的ElseIf不能是单行形式`,
                            vscode.DiagnosticSeverity.Error
                        ));
                    }
                }

                // 检查Else语句
                for (const elseLine of context.elseLines) {
                    const line = document.lineAt(elseLine);
                    const text = line.text.trim();
                    
                    // 多行If块内的Else必须是独立的一行
                    if (text.toLowerCase() !== 'else') {
                        diagnostics.push(new vscode.Diagnostic(
                            line.range,
                            `多行If块内的Else必须是独立的一行`,
                            vscode.DiagnosticSeverity.Error
                        ));
                    }
                }
            }
        }
        
        // 第三遍扫描：检查ElseIf和Else语句是否在有效的If块内部
        for (let i = 0; i < document.lineCount; i++) {
            const line = document.lineAt(i);
            const text = line.text.trim();
            
            // 检查是否是ElseIf或Else语句
            if (/^ElseIf\b/i.test(text) || /^Else\b/i.test(text)) {
                const isElseIf = /^ElseIf\b/i.test(text);
                
                // 检查是否在任何If块的上下文中
                let inValidIfBlock = false;
                let parentIfContext: IfContext | undefined;
                
                for (const context of allIfContexts) {
                    // 如果是单行If，检查这个ElseIf/Else是否紧跟在它后面
                    if (context.isSingleLine && i === context.startLine + 1) {
                        inValidIfBlock = true;
                        parentIfContext = context;
                        break;
                    }
                    
                    // 如果是多行If，检查这个ElseIf/Else是否在它的范围内
                    if (!context.isSingleLine && 
                        i > context.startLine && 
                        (context.endLine === undefined || i < context.endLine)) {
                        inValidIfBlock = true;
                        parentIfContext = context;
                        break;
                    }
                }
                
                if (!inValidIfBlock) {
                    diagnostics.push(new vscode.Diagnostic(
                        line.range,
                        `${isElseIf ? 'ElseIf' : 'Else'} 语句必须在有效的 If 块内部`,
                        vscode.DiagnosticSeverity.Error
                    ));
                    continue;
                }
                
                // 特别处理Sub内部的If语句
                if (parentIfContext && parentIfContext.parentSub) {
                    // 在Sub内部的If语句需要特别注意ElseIf和Else的形式
                    if (isElseIf) {
                        // 检查ElseIf是否有Then关键字
                        if (!text.toLowerCase().includes('then')) {
                            diagnostics.push(new vscode.Diagnostic(
                                line.range,
                                `ElseIf语句必须包含Then关键字`,
                                vscode.DiagnosticSeverity.Error
                            ));
                        }
                        
                        // 在Sub内部，ElseIf的形式必须与父If一致
                        const isElseIfSingleLine = this.isSingleLineStatement(text);
                        if (parentIfContext.isSingleLine !== isElseIfSingleLine) {
                            diagnostics.push(new vscode.Diagnostic(
                                line.range,
                                parentIfContext.isSingleLine 
                                    ? `单行If语句后的ElseIf也必须是单行形式` 
                                    : `多行If块内的ElseIf不能是单行形式`,
                                vscode.DiagnosticSeverity.Error
                            ));
                        }
                    } else {
                        // 检查Else语句
                        const isElseSingleLine = text.trim().toLowerCase() !== 'else';
                        if (parentIfContext.isSingleLine !== isElseSingleLine) {
                            diagnostics.push(new vscode.Diagnostic(
                                line.range,
                                parentIfContext.isSingleLine 
                                    ? `单行If语句后的Else也必须是单行形式，应包含语句` 
                                    : `多行If块内的Else必须是独立的一行`,
                                vscode.DiagnosticSeverity.Error
                            ));
                        }
                    }
                }
            }
        }
        
        // 检查未闭合的If块
        for (const context of allIfContexts) {
            if (!context.isSingleLine && context.endLine === undefined) {
                diagnostics.push(new vscode.Diagnostic(
                    document.lineAt(context.startLine).range,
                    `多行If语句必须有对应的End If`,
                    vscode.DiagnosticSeverity.Error
                ));
            }
        }
    }

    private checkUnclosedBlocks(blocks: ControlBlock[], diagnostics: vscode.Diagnostic[], document: vscode.TextDocument) {
        const unclosedBlocks = blocks.filter(block => {
            // 如果是单行if语句，不应该被标记为未闭合
            if (block.type === 'If' && block.isSingleLine) {
                return false;
            }
            
            // 如果是同一行包含If和End If的情况，不应该被标记为未闭合
            if (block.type === 'If' && block.range.start.line === block.range.end.line) {
                const lineText = document.lineAt(block.range.start.line).text;
                if (lineText.match(/\bEnd\s+If\b/i)) {
                    return false;
                }
            }
            
            // 检查If块是否包含ElseIf/Else语句或End If
            if (block.type === 'If') {
                const blockText = document.getText(block.range);
                // 如果有End If，则认为已闭合
                if (blockText.match(/\bEnd\s+If\b/i)) {
                    return false;
                }
                // 如果有ElseIf/Else且后面有End If，则认为已闭合
                if ((blockText.match(/ElseIf\b/i) || blockText.match(/Else\b/i)) && 
                    blockText.match(/\bEnd\s+If\b/i)) {
                    return false;
                }
            }
            
            // 对于其他类型的控制块，如果没有结束标记，则认为是未闭合的
            return !block.hasEndToken;
        });
        
        for (const block of unclosedBlocks) {
            diagnostics.push(new vscode.Diagnostic(
                block.range,
                `未闭合的控制块: ${block.type}。需要添加 ${this.getMatchingEndType(block.type)}`,
                vscode.DiagnosticSeverity.Error
            ));
        }
    }

    private checkBlockTypeMatching(blocks: ControlBlock[], diagnostics: vscode.Diagnostic[]) {
        const blockStack: ControlBlock[] = [];
        
        for (const block of blocks) {
            if (this.isBlockStart(block.type)) {
                // 单行if语句不需要匹配的结束标记
                if (block.type === 'If' && block.isSingleLine) {
                    continue;
                }
                
                // 检查嵌套层级
                if (blockStack.length > 100) {
                    diagnostics.push(new vscode.Diagnostic(
                        block.range,
                        `控制块嵌套层级过深(超过100层)`,
                        vscode.DiagnosticSeverity.Warning
                    ));
                }
                
                // 检查是否已经有结束标记
                if (block.hasEndToken) {
                    continue; // 如果已经有结束标记，不需要压入栈中
                }
                
                blockStack.push(block);
            } else if (this.isBlockEnd(block.type)) {
                // 查找最近的未闭合的开始块
                let lastBlock = blockStack.pop();
                while (lastBlock && lastBlock.hasEndToken) {
                    lastBlock = blockStack.pop();
                }
                
                if (!lastBlock) {
                    diagnostics.push(new vscode.Diagnostic(
                        block.range,
                        `意外的控制块结束: ${block.type}，没有找到对应的开始块`,
                        vscode.DiagnosticSeverity.Error
                    ));
                } else if (!this.doBlockTypesMatch(lastBlock.type, block.type)) {
                    diagnostics.push(new vscode.Diagnostic(
                        block.range,
                        `控制块类型不匹配: 期望 ${this.getMatchingEndType(lastBlock.type)}, 实际为 ${block.type}`,
                        vscode.DiagnosticSeverity.Error
                    ));
                } else {
                    // 标记该块已经有结束标记
                    lastBlock.hasEndToken = true;
                }
            }
        }

        // 检查剩余未闭合的块
        for (const block of blockStack) {
            // 单行if语句不需要匹配的结束标记
            if (block.type === 'If' && block.isSingleLine) {
                continue;
            }
            
            // 如果块已经有结束标记，跳过
            if (block.hasEndToken) {
                continue;
            }
            
            diagnostics.push(new vscode.Diagnostic(
                block.range,
                `控制块未正确闭合: ${block.type} 缺少 ${this.getMatchingEndType(block.type)}`,
                vscode.DiagnosticSeverity.Error
            ));
        }
    }

    private checkVariableScopes(variables: RtBasicVariable[], blocks: ControlBlock[], diagnostics: vscode.Diagnostic[]) {
        const variableMap = new Map<string, RtBasicVariable[]>();
        
        // 按名称分组变量
        for (const variable of variables) {
            const vars = variableMap.get(variable.name) || [];
            vars.push(variable);
            variableMap.set(variable.name, vars);
        }

        // 检查每组同名变量
        for (const [name, vars] of variableMap) {
            if (vars.length > 1) {
                // 检查同一作用域内的重复声明
                const scopeGroups = new Map<string, RtBasicVariable[]>();
                for (const v of vars) {
                    const scopeKey = `${v.scope}-${v.parentSub || ''}-${v.parentBlock?.type || ''}`;
                    const scopeVars = scopeGroups.get(scopeKey) || [];
                    scopeVars.push(v);
                    scopeGroups.set(scopeKey, scopeVars);
                }

                for (const scopeVars of scopeGroups.values()) {
                    if (scopeVars.length > 1) {
                        for (const v of scopeVars) {
                            diagnostics.push(new vscode.Diagnostic(
                                v.range,
                                `变量 ${v.name} 在同一作用域中重复声明`,
                                vscode.DiagnosticSeverity.Error
                            ));
                        }
                    }
                }
            }

            // 检查块级变量的作用域
            for (const v of vars) {
                if (v.scope === 'block' && v.parentBlock) {
                    const block = blocks.find(b => b === v.parentBlock);
                    if (!block) {
                        diagnostics.push(new vscode.Diagnostic(
                            v.range,
                            `变量 ${v.name} 的作用域无效：找不到对应的控制块`,
                            vscode.DiagnosticSeverity.Error
                        ));
                    } else if (!block.range.contains(v.range)) {
                        diagnostics.push(new vscode.Diagnostic(
                            v.range,
                            `变量 ${v.name} 在其控制块作用域之外声明`,
                            vscode.DiagnosticSeverity.Error
                        ));
                    }
                }
            }

            // 检查文件作用域变量与全局变量的冲突
            const fileVars = vars.filter(v => v.scope === 'file');
            const globalVars = vars.filter(v => v.scope === 'global');
            
            if (fileVars.length > 0 && globalVars.length > 0) {
                for (const v of fileVars) {
                    diagnostics.push(new vscode.Diagnostic(
                        v.range,
                        `变量 ${v.name} 已在全局作用域中声明，可能导致命名冲突`,
                        vscode.DiagnosticSeverity.Warning
                    ));
                }
            }
        }
    }

    private isBlockStart(type: ControlBlockType | string): type is ControlBlockType {
        return ['If', 'For', 'While', 'Select'].includes(type as string);
    }

    private isBlockEnd(type: ControlBlockType): boolean {
        return ['End If', 'Next', 'Wend', 'End Select'].includes(type);
    }

    private doBlockTypesMatch(startType: ControlBlockType, endType: ControlBlockType): boolean {
        const expectedEndType = this.getMatchingEndType(startType);
        if (!expectedEndType) {
            console.warn(`未知的控制块开始类型: ${startType}`);
            return false;
        }
        return expectedEndType === endType;
    }

    private getMatchingEndType(startType: string): ControlBlockType {
        const matchingPairs: Record<string, ControlBlockType> = {
            'If': 'End If',
            'For': 'Next',
            'While': 'Wend',
            'Select': 'End Select'
        };

        if (!matchingPairs[startType]) {
            console.warn(`无法确定控制块类型 ${startType} 的匹配结束类型`);
            // 根据开始类型返回更合理的默认值
            if (startType.includes('If')) return 'End If';
            if (startType.includes('For')) return 'Next';
            if (startType.includes('While')) return 'Wend';
            if (startType.includes('Select')) return 'End Select';
        }
        return matchingPairs[startType] || 'End If';
    }
}