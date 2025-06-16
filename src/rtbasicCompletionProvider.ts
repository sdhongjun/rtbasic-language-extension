import * as vscode from 'vscode';
import { RtBasicParser, RtBasicStructure, RtBasicSub, RtBasicVariable, ControlBlock } from './rtbasicParser';
import { RtBasicWorkspaceManager } from './rtbasicWorkspaceManager';

export class RtBasicCompletionProvider implements vscode.CompletionItemProvider {
    private parser: RtBasicParser;
    private workspaceManager: RtBasicWorkspaceManager;

    constructor(parser: RtBasicParser, workspaceManager: RtBasicWorkspaceManager) {
        this.parser = parser;
        this.workspaceManager = workspaceManager;
    }

    public provideCompletionItems(
        document: vscode.TextDocument,
        position: vscode.Position,
        token: vscode.CancellationToken,
        completionContext: vscode.CompletionContext
    ): vscode.ProviderResult<vscode.CompletionItem[] | vscode.CompletionList> {
        const lineText = document.lineAt(position.line).text;
        const beforeCursor = lineText.substring(0, position.character);

        // 解析当前文档以获取所有符号
        const currentFileSymbols = this.parser.parse(document);
        
        // 获取合并了当前文件和工作区全局符号的符号表
        const mergedSymbols = this.workspaceManager.getMergedSymbolsForFile(document.uri);

        // 检查是否在结构体成员访问
        const dotMatch = beforeCursor.match(/(\w+)\.\w*$/);
        if (dotMatch) {
            // 首先在当前文件中查找结构体
            const structName = dotMatch[1];
            const localStructure = currentFileSymbols.structures.find(s => s.name === structName);
            
            if (localStructure) {
                return this.provideStructureMemberCompletions(structName, currentFileSymbols.structures);
            } else {
                // 如果当前文件中没有找到，则在全局符号中查找
                return this.provideStructureMemberCompletions(structName, mergedSymbols.structures);
            }
        }

        // 检查是否在Sub参数输入
        const subMatch = beforeCursor.match(/(\w+)\s*\(([^)]*)?$/);
        if (subMatch) {
            const subName = subMatch[1];
            // 首先在当前文件中查找Sub
            const localSub = currentFileSymbols.subs.find(s => s.name === subName);
            
            if (localSub) {
                return this.provideSubParameterCompletions(subName, currentFileSymbols.subs);
            } else {
                // 如果当前文件中没有找到，则在全局符号中查找
                return this.provideSubParameterCompletions(subName, mergedSymbols.subs);
            }
        }

        // 确定当前上下文（sub函数和控制语句块）
        const currentContext = this.getCurrentContext(document, position, currentFileSymbols.subs, currentFileSymbols.controlBlocks);
        
        // 提供所有可用符号的补全（包括当前文件的局部符号和全局符号）
        return this.provideSymbolCompletions(currentFileSymbols, mergedSymbols, currentContext.subName, currentContext.blockId);
    }

    private provideStructureMemberCompletions(
        structName: string,
        structures: RtBasicStructure[]
    ): vscode.CompletionItem[] {
        const structure = structures.find(s => s.name === structName);
        if (!structure) {
            return [];
        }

        return structure.members.map(member => {
            const item = new vscode.CompletionItem(member.name, vscode.CompletionItemKind.Field);
            item.detail = `(${structure.name} member)`;
            if (member.isArray) {
                item.detail += `(${member.arraySize})`;
            }
            
            const docs = new vscode.MarkdownString();
            if (member.isArray) {
                docs.appendText(`Array size: ${member.arraySize}\n`);
            }
            docs.appendText('\nMember of structure ')
                .appendCodeblock(structure.name, 'rtbasic');
            item.documentation = docs;
            return item;
        });
    }

    private provideSubParameterCompletions(
        subName: string,
        subs: RtBasicSub[]
    ): vscode.CompletionItem[] {
        const sub = subs.find(s => s.name === subName);
        if (!sub) {
            return [];
        }

        return sub.parameters.map((param: any) => {
            const item = new vscode.CompletionItem(param.name, vscode.CompletionItemKind.Variable);
            item.detail = `(parameter)`;
            if (param.isArray) {
                item.detail += `(${param.arraySize})`;
            }
            
            const docs = new vscode.MarkdownString()
                .appendText(`Parameter for sub ${sub.name}`);
            if (param.isArray) {
                docs.appendText(`\nArray with size ${param.arraySize}`);
            }
            item.documentation = docs;
            return item;
        });
    }

    /**
     * 确定当前位置所在的 sub 函数
     * @param document 当前文档
     * @param position 当前位置
     * @param subs 所有 sub 函数
     * @returns 当前位置所在的 sub 函数名，如果不在任何 sub 函数内则返回 undefined
     */
    private getCurrentContext(
        document: vscode.TextDocument,
        position: vscode.Position,
        subs: RtBasicSub[],
        controlBlocks: ControlBlock[]
    ): { subName?: string; blockId?: string } {
        // 确定当前所在的 sub 函数
        let currentSub: string | undefined;
        for (const sub of subs) {
            if (sub.range && 
                sub.range.start.line <= position.line && 
                sub.range.end.line >= position.line) {
                currentSub = sub.name;
                break;
            }
        }

        // 确定当前所在的 control block
        let currentBlock: string | undefined;
        for (const block of controlBlocks) {
            if (block.range && 
                block.range.start.line <= position.line && 
                block.range.end.line >= position.line) {
                currentBlock = `${block.type}-${block.range.start.line}`;
                break;
            }
        }

        return {
            subName: currentSub,
            blockId: currentBlock
        };
    }

    private provideSymbolCompletions(
        currentFileSymbols: any,
        mergedSymbols: any,
        currentSub?: string, 
        currentBlock?: string
    ): vscode.CompletionItem[] {
        const completions: vscode.CompletionItem[] = [];

        // 添加当前文件中的局部变量和文件级变量
        currentFileSymbols.variables.forEach((variable: RtBasicVariable) => {
            let shouldInclude = false;

            switch (variable.scope) {
                case 'block':
                    // 控制语句块作用域的变量
                    shouldInclude = currentBlock === variable.parentBlock && 
                                  currentSub === variable.parentSub;
                    break;
                case 'local':
                    // 局部变量
                    shouldInclude = currentSub === variable.parentSub;
                    break;
                case 'file':
                    // 文件作用域变量
                    shouldInclude = true;
                    break;
                case 'global':
                    // 当前文件中的全局变量
                    shouldInclude = true;
                    break;
                default:
                    shouldInclude = false;
            }

            if (shouldInclude) {
                const item = new vscode.CompletionItem(variable.name, vscode.CompletionItemKind.Variable);
                
                // 设置变量详细信息
                const scopeText = variable.scope === 'block' ? 'block-local' : variable.scope;
                item.detail = `(${scopeText} variable)`;
                if (variable.isArray) {
                    item.detail += `(${variable.arraySize})`;
                }
                if (variable.structType) {
                    item.detail += ` As ${variable.structType}`;
                } else if (variable.type) {
                    item.detail += ` As ${variable.type}`;
                }
                
                // 设置文档说明
                const docs = new vscode.MarkdownString();
                if (variable.isArray) {
                    docs.appendText(`Array size: ${variable.arraySize}\n`);
                }
                docs.appendText(`Scope: ${scopeText}`);
                if (variable.parentSub) {
                    docs.appendText(`\nDefined in: ${variable.parentSub}`);
                }
                if (variable.parentBlock) {
                    docs.appendText(`\nBlock: ${variable.parentBlock}`);
                }
                item.documentation = docs;
                
                completions.push(item);
            }
        });

        // 添加工作区中的全局变量（排除当前文件中已有的变量）
        mergedSymbols.variables.forEach((variable: RtBasicVariable) => {
            // 只包含全局变量，并且确保不与当前文件中的变量重复
            if (variable.scope === 'global' && 
                !currentFileSymbols.variables.some((v: RtBasicVariable) => v.name === variable.name)) {
                const item = new vscode.CompletionItem(variable.name, vscode.CompletionItemKind.Variable);
                
                // 设置变量详细信息
                item.detail = `(global variable)`;
                if (variable.isArray) {
                    item.detail += `(${variable.arraySize})`;
                }
                if (variable.structType) {
                    item.detail += ` As ${variable.structType}`;
                } else if (variable.type) {
                    item.detail += ` As ${variable.type}`;
                }
                
                // 设置文档说明
                const docs = new vscode.MarkdownString();
                if (variable.isArray) {
                    docs.appendText(`Array size: ${variable.arraySize}\n`);
                }
                docs.appendText(`Scope: global`);
                if (variable.sourceFile) {
                    docs.appendText(`\nDefined in: ${variable.sourceFile}`);
                }
                item.documentation = docs;
                
                completions.push(item);
            }
        });

        // 添加当前文件中的Sub补全
        currentFileSymbols.subs.forEach((sub: RtBasicSub) => {
            const item = new vscode.CompletionItem(sub.name, vscode.CompletionItemKind.Function);
            const params = sub.parameters.map((p: any) => {
                let paramStr = p.name;
                if (p.type) {
                    paramStr += ` As ${p.type}`;
                }
                if (p.isArray) {
                    paramStr += `(${p.arraySize})`;
                }
                return paramStr;
            }).join(', ');
            
            item.detail = `(${sub.isGlobal ? 'global' : 'file'} sub)`;
            item.documentation = new vscode.MarkdownString()
                .appendCodeblock(`${sub.isGlobal ? 'Global ' : ''}Sub ${sub.name}(${params})${sub.returnType ? ` As ${sub.returnType}` : ''}`, 'rtbasic');
            
            // 添加Sub签名信息
            item.insertText = new vscode.SnippetString(`${sub.name}($1)`);
            item.command = {
                command: 'editor.action.triggerParameterHints',
                title: 'Trigger parameter hints'
            };
            
            completions.push(item);
        });

        // 添加工作区中的全局Sub（排除当前文件中已有的Sub）
        mergedSymbols.subs.forEach((sub: RtBasicSub) => {
            // 只包含全局Sub，并且确保不与当前文件中的Sub重复
            if (sub.isGlobal && 
                !currentFileSymbols.subs.some((s: RtBasicSub) => s.name === sub.name)) {
                const item = new vscode.CompletionItem(sub.name, vscode.CompletionItemKind.Function);
                const params = sub.parameters.map((p: any) => {
                    let paramStr = p.name;
                    if (p.type) {
                        paramStr += ` As ${p.type}`;
                    }
                    if (p.isArray) {
                        paramStr += `(${p.arraySize})`;
                    }
                    return paramStr;
                }).join(', ');
                
                item.detail = `(global sub)`;
                const docs = new vscode.MarkdownString()
                    .appendCodeblock(`Global Sub ${sub.name}(${params})${sub.returnType ? ` As ${sub.returnType}` : ''}`, 'rtbasic');
                
                if (sub.sourceFile) {
                    docs.appendText(`\nDefined in: ${sub.sourceFile}`);
                }
                
                item.documentation = docs;
                
                // 添加Sub签名信息
                item.insertText = new vscode.SnippetString(`${sub.name}($1)`);
                item.command = {
                    command: 'editor.action.triggerParameterHints',
                    title: 'Trigger parameter hints'
                };
                
                completions.push(item);
            }
        });

        // 添加当前文件中的结构体补全
        currentFileSymbols.structures.forEach((struct: RtBasicStructure) => {
            const item = new vscode.CompletionItem(struct.name, vscode.CompletionItemKind.Struct);
            item.detail = `(${struct.isGlobal ? 'global' : 'file'} structure) ${struct.name}`;
            
            const membersDoc = struct.members.map((m: any) => {
                let memberStr = `    Dim ${m.name}`;
                if (m.type) {
                    memberStr += ` As ${m.type}`;
                }
                if (m.isArray) {
                    memberStr += `(${m.arraySize})`;
                }
                return memberStr;
            }).join('\n');
            
            item.documentation = new vscode.MarkdownString()
                .appendCodeblock(`${struct.isGlobal ? 'Global ' : ''}Structure ${struct.name}\n${membersDoc}\nEnd Structure`, 'rtbasic');
            
            completions.push(item);
        });

        // 添加工作区中的结构体（排除当前文件中已有的结构体）
        mergedSymbols.structures.forEach((struct: RtBasicStructure) => {
            // 确保不与当前文件中的结构体重复
            if (!currentFileSymbols.structures.some((s: RtBasicStructure) => s.name === struct.name)) {
                const item = new vscode.CompletionItem(struct.name, vscode.CompletionItemKind.Struct);
                item.detail = `(${struct.isGlobal ? 'global' : 'file'} structure) ${struct.name}`;
                
                const membersDoc = struct.members.map((m: any) => {
                    let memberStr = `    Dim ${m.name}`;
                    if (m.type) {
                        memberStr += ` As ${m.type}`;
                    }
                    if (m.isArray) {
                        memberStr += `(${m.arraySize})`;
                    }
                    return memberStr;
                }).join('\n');
                
                const docs = new vscode.MarkdownString()
                    .appendCodeblock(`${struct.isGlobal ? 'Global ' : ''}Structure ${struct.name}\n${membersDoc}\nEnd Structure`, 'rtbasic');
                
                if (struct.sourceFile) {
                    docs.appendText(`\nDefined in: ${struct.sourceFile}`);
                }
                
                item.documentation = docs;
                
                completions.push(item);
            }
        });

        return completions;
    }
}

export class RtBasicSignatureHelpProvider implements vscode.SignatureHelpProvider {
    private parser: RtBasicParser;
    private workspaceManager: RtBasicWorkspaceManager;

    constructor(parser: RtBasicParser, workspaceManager: RtBasicWorkspaceManager) {
        this.parser = parser;
        this.workspaceManager = workspaceManager;
    }

    public provideSignatureHelp(
        document: vscode.TextDocument,
        position: vscode.Position,
        token: vscode.CancellationToken,
        context: vscode.SignatureHelpContext
    ): vscode.ProviderResult<vscode.SignatureHelp> {
        const currentFileSymbols = this.parser.parse(document);
        const mergedSymbols = this.workspaceManager.getMergedSymbolsForFile(document.uri);
        const lineText = document.lineAt(position.line).text;
        const beforeCursor = lineText.substring(0, position.character);
        
        // 查找正在调用的Sub，支持更复杂的情况
        // 例如：myFunc(arg1, func2(arg), "string, with comma")
        // 或者：result = myFunc(arg1, arg2)
        const subMatch = beforeCursor.match(/(?:^|[=\s;,])?\s*(\w+)\s*\(([^)]*)?$/);
        if (!subMatch) {
            return null;
        }

        const subName = subMatch[1];
        
        // 首先在当前文件中查找非全局Sub
        let sub = currentFileSymbols.subs.find(s => s.name === subName && !s.isGlobal);
        
        // 如果在当前文件中没有找到，则在全局符号中查找
        if (!sub) {
            sub = mergedSymbols.subs.find(s => s.name === subName && s.isGlobal);
        }
        
        if (!sub) {
            return null;
        }

        const signatureHelp = new vscode.SignatureHelp();
        
        // 构建参数字符串
        const paramStrings = sub.parameters.map(p => {
            let paramStr = p.name;
            if (p.type) {
                paramStr += ` As ${p.type}`;
            }
            if (p.isArray) {
                paramStr += `(${p.arraySize})`;
            }
            return paramStr;
        });
        
        // 创建函数签名信息
        const signature = new vscode.SignatureInformation(
            `${sub.name}(${paramStrings.join(', ')})${sub.returnType ? ` As ${sub.returnType}` : ''}`,
            new vscode.MarkdownString(`${sub.isGlobal ? 'Global ' : ''}Sub defined in ${sub.sourceFile || 'current file'}`)
        );

        // 为每个参数添加参数信息
        signature.parameters = sub.parameters.map(param => {
            let paramLabel = param.name;
            if (param.type) {
                paramLabel += ` As ${param.type}`;
            }
            if (param.isArray) {
                paramLabel += `(${param.arraySize})`;
            }
            
            const paramDoc = new vscode.MarkdownString()
                .appendText(`Parameter ${param.name}`);
            
            if (param.type) {
                paramDoc.appendText(`\nType: ${param.type}`);
            }
            
            if (param.isArray) {
                paramDoc.appendText(`\nArray with size ${param.arraySize}`);
            }
            
            if (param.description) {
                paramDoc.appendText(`\n\n${param.description}`);
            }
            
            return new vscode.ParameterInformation(paramLabel, paramDoc);
        });

        signatureHelp.signatures = [signature];
        signatureHelp.activeSignature = 0;
        
        // 计算当前参数位置
        if (subMatch[2]) {
            // 计算逗号数量，但忽略括号内的逗号和字符串内的逗号
            let paramText = subMatch[2];
            let nestLevel = 0;
            let inString = false;
            let stringChar = '';
            let commaCount = 0;
            
            for (let i = 0; i < paramText.length; i++) {
                const char = paramText[i];
                
                // 处理字符串
                if ((char === '"' || char === "'") && (i === 0 || paramText[i-1] !== '\\')) {
                    if (!inString) {
                        inString = true;
                        stringChar = char;
                    } else if (char === stringChar) {
                        inString = false;
                    }
                    continue;
                }
                
                // 如果在字符串内，跳过
                if (inString) {
                    continue;
                }
                
                // 处理括号嵌套
                if (char === '(') {
                    nestLevel++;
                } else if (char === ')') {
                    nestLevel--;
                } else if (char === ',' && nestLevel === 0) {
                    commaCount++;
                }
            }
            
            signatureHelp.activeParameter = Math.min(commaCount, sub.parameters.length - 1);
        } else {
            signatureHelp.activeParameter = 0; // 第一个参数
        }

        return signatureHelp;
    }
}