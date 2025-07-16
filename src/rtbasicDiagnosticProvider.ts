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
     * 直接使用解析后的控制块列表，不再重复扫描代码
     */
    private checkElseIfElseStatements(document: vscode.TextDocument, blocks: ControlBlock[], diagnostics: vscode.Diagnostic[]) {
        // 筛选出所有If类型的控制块
        const ifBlocks = blocks.filter(block => block.type === 'If');
        
        // 创建一个映射，用于快速查找每个If块的相关ElseIf和Else块
        const ifBlockMap = new Map<ControlBlock, {
            elseIfBlocks: ControlBlock[],
            elseBlock?: ControlBlock
        }>();
        
        // 构建If块与其相关ElseIf和Else块的映射关系
        for (const block of ifBlocks) {
            // 跳过ElseIf和Else块，因为它们会被作为相关块处理
            if (block.isElseIf || block.isElse) {
                continue;
            }
            
            // 查找与当前If块相关的ElseIf和Else块
            const elseIfBlocks = ifBlocks.filter(b => 
                b.isElseIf && b.parentBlock === block
            );
            
            const elseBlock = ifBlocks.find(b => 
                b.isElse && b.parentBlock === block
            );
            
            ifBlockMap.set(block, { elseIfBlocks, elseBlock });
        }
        // 检查每个If块及其相关的ElseIf和Else块
        for (const [ifBlock, related] of ifBlockMap.entries()) {
            const { elseIfBlocks, elseBlock } = related;
            const isSingleLine = ifBlock.isSingleLine || false;
            
            // 检查单行If语句
            if (isSingleLine) {
                // 检查ElseIf块
                for (const elseIfBlock of elseIfBlocks) {
                    const elseIfLine = document.lineAt(elseIfBlock.range.start.line);
                    const elseIfText = elseIfLine.text.trim();
                    
                    // 单行If后的ElseIf也必须是单行形式
                    if (!elseIfBlock.isSingleLine) {
                        diagnostics.push(new vscode.Diagnostic(
                            elseIfBlock.range,
                            `单行If语句后的ElseIf也必须是单行形式`,
                            vscode.DiagnosticSeverity.Error
                        ));
                    }
                    
                    // 检查ElseIf是否有Then关键字
                    if (!elseIfText.toLowerCase().includes('then')) {
                        diagnostics.push(new vscode.Diagnostic(
                            elseIfBlock.range,
                            `ElseIf语句必须包含Then关键字`,
                            vscode.DiagnosticSeverity.Error
                        ));
                    }
                }
                
                // 检查Else块
                if (elseBlock) {
                    const elseLine = document.lineAt(elseBlock.range.start.line);
                    const elseText = elseLine.text.trim();
                    
                    // 单行If后的Else也必须是单行形式
                    if (elseText.toLowerCase() === 'else') {
                        diagnostics.push(new vscode.Diagnostic(
                            elseBlock.range,
                            `单行If语句后的Else也必须是单行形式，应包含语句`,
                            vscode.DiagnosticSeverity.Error
                        ));
                    }
                }
            } else {
                // 多行If必须有End If
                if (!ifBlock.hasEndToken) {
                    diagnostics.push(new vscode.Diagnostic(
                        ifBlock.range,
                        `多行If语句必须有对应的End If`,
                        vscode.DiagnosticSeverity.Error
                    ));
                }
                
                // 检查ElseIf块
                for (const elseIfBlock of elseIfBlocks) {
                    const elseIfLine = document.lineAt(elseIfBlock.range.start.line);
                    const elseIfText = elseIfLine.text.trim();
                    
                    // 多行If块内的ElseIf不能是单行形式
                    if (elseIfBlock.isSingleLine) {
                        diagnostics.push(new vscode.Diagnostic(
                            elseIfBlock.range,
                            `多行If块内的ElseIf不能是单行形式`,
                            vscode.DiagnosticSeverity.Error
                      ));
                    }
                    
                    // 检查ElseIf是否有Then关键字
                    if (!elseIfText.toLowerCase().includes('then')) {
                        diagnostics.push(new vscode.Diagnostic(
                            elseIfBlock.range,
                            `ElseIf语句必须包含Then关键字`,
                            vscode.DiagnosticSeverity.Error
                        ));
                    }
                }
                
                // 检查Else块
                if (elseBlock) {
                    const elseLine = document.lineAt(elseBlock.range.start.line);
                    const elseText = elseLine.text.trim();
                    
                    // 多行If块内的Else必须是独立的一行
                    if (!/else(?:\s*'.*)?/i.test(elseText)) {
                        diagnostics.push(new vscode.Diagnostic(
                            elseBlock.range,
                            `多行If块内的Else必须是独立的一行`,
                            vscode.DiagnosticSeverity.Error
                        ));
                    }
                }
            }
        }
        
        
        // 检查孤立的ElseIf和Else块（没有父If块的块）
        const orphanedBlocks = blocks.filter(block => 
            (block.isElseIf || block.isElse) && !block.parentBlock
        );
        
        for (const block of orphanedBlocks) {
            diagnostics.push(new vscode.Diagnostic(
                block.range,
                `${block.isElseIf ? 'ElseIf' : 'Else'} 语句必须在有效的 If 块内部`,
                vscode.DiagnosticSeverity.Error
            ));
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

    private getMatchingEndType(startType: string): string {
        const matchingPairs: Record<string, string> = {
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