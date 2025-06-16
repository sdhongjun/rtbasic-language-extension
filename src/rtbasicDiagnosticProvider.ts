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
        
        // 检查变量作用域
        this.checkVariableScopes(symbols.variables, symbols.controlBlocks, diagnostics);
        
        // 更新诊断信息
        this.diagnosticCollection.set(document.uri, diagnostics);
    }

    private checkUnclosedBlocks(blocks: ControlBlock[], diagnostics: vscode.Diagnostic[], document: vscode.TextDocument) {
        const unclosedBlocks = blocks.filter(block => {
            // 如果是单行if语句，不应该被标记为未闭合
            if (block.type === 'If' && block.range.start.line === block.range.end.line) {
                // 获取该行的文本内容
                const lineText = document.lineAt(block.range.start.line).text;
                // 检查是否是单行if语句（if与then在同一行且then后有非注释语句）
                const ifThenMatch = lineText.match(/^If\b.*\bThen\b\s+(.+)$/i);
                if (ifThenMatch) {
                    const afterThen = ifThenMatch[1].trim();
                    // 如果then后有非注释语句，则认为是单行if语句，不需要End If
                    if (afterThen && !afterThen.startsWith("'") && !afterThen.startsWith("REM")) {
                        return false;
                    }
                }
            }
            // 对于其他类型的控制块或多行if语句，如果开始行和结束行相同，则认为是未闭合的
            return block.range.start.line === block.range.end.line;
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
                // 检查嵌套层级
                if (blockStack.length > 100) {
                    diagnostics.push(new vscode.Diagnostic(
                        block.range,
                        `控制块嵌套层级过深(超过100层)`,
                        vscode.DiagnosticSeverity.Warning
                    ));
                }
                blockStack.push(block);
            } else if (this.isBlockEnd(block.type)) {
                const lastBlock = blockStack.pop();
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
                }
            }
        }

        // 检查剩余未闭合的块
        for (const block of blockStack) {
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

    private isBlockStart(type: string): boolean {
        // 使用 ControlBlockType 类型检查
        return ['If', 'For', 'While', 'Select'].includes(type);
    }

    private isBlockEnd(type: string): boolean {
        return ['End If', 'Next', 'Wend', 'End Select'].includes(type);
    }

    private doBlockTypesMatch(startType: string, endType: string): boolean {
        const matchingPairs: Record<string, string> = {
            'If': 'End If',
            'For': 'Next',
            'While': 'Wend',
            'Select': 'End Select'
        };

        return matchingPairs[startType] === endType;
    }

    private getMatchingEndType(startType: string): string {
        const matchingPairs: Record<string, string> = {
            'If': 'End If',
            'For': 'Next',
            'While': 'Wend',
            'Select': 'End Select'
        };

        return matchingPairs[startType] || '未知';
    }
}