import * as vscode from 'vscode';
import { RtBasicParser, RtBasicStructure, RtBasicSub, RtBasicVariable, ControlBlock, RtBasicCFunction } from './rtbasicParser';
import { RtBasicWorkspaceManager } from './rtbasicWorkspaceManager';
import builtinFunctions from './builtinFunctions';

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
        let beforeCursor = lineText.substring(0, position.character);

        // 解析当前文档以获取所有符号
        const currentFileSymbols = this.parser.parse(document);
        
        // 获取合并了当前文件和工作区全局符号的符号表
        const mergedSymbols = this.workspaceManager.getMergedSymbolsForFile(document.uri);

        // 检查是否在结构体成员访问（支持多级访问）
        const dotMatch = beforeCursor.match(/((([a-z0-9_]+\.)*[a-z0-9_]+|([a-z0-9_]+)\([a-z0-9_]+\)|ZINDEX_STRUCT\(([a-z0-9]+),.*\))\.$)/i);
        if (dotMatch) {
            const fullPath = dotMatch[1];
            const pathParts = fullPath.split('.');
            
            try {
                // 1. 推断根变量类型
                const rootVarName = pathParts[0];
                let currentType = this.inferVariableType(rootVarName, currentFileSymbols, mergedSymbols);
                if (!currentType) {
                    currentType = dotMatch[2];

                    if (!currentType) {
                        console.log(`Root variable type not found: ${rootVarName}`);
                        return [];
                    }
                }

                // 2. 查找根结构体
                let currentStruct = currentFileSymbols.structures.find(s => s.name.toLowerCase() === currentType?.toLowerCase()) ||
                                   mergedSymbols.structures.find(s => s.name.toLowerCase() === currentType?.toLowerCase());
                if (!currentStruct) {
                    console.log(`Root structure not found: ${currentType}`);
                    return [];
                }

                // 3. 递归查找嵌套结构体成员
                for (let i = 1; i < pathParts.length; i++) {
                    const memberName = pathParts[i];
                    if (memberName === '') break;

                    const member: RtBasicVariable | undefined= currentStruct.members.find(m => m.name.toLowerCase() === memberName.toLowerCase());
                    
                    if (!member) {
                        console.log(`Member not found: ${memberName} in structure ${currentStruct.name}`);
                        return [];
                    }
                    
                    if (!member.structType) {
                        console.log(`Member is not a structure: ${memberName}`);
                        return [];
                    }
                    
                    // 更新当前结构体类型
                    currentStruct = currentFileSymbols.structures.find(s => member.structType ? s.name.toLowerCase() === member.structType.toLowerCase() : undefined) ||
                                   mergedSymbols.structures.find(s => member.structType ? s.name.toLowerCase() === member.structType.toLowerCase() : undefined);
                    
                    if (!currentStruct) {
                        console.log(`Structure type not found: ${member.structType}`);
                        return [];
                    }
                }
                
                // 4. 提供最终结构体的成员补全
                return this.provideStructureMemberCompletions(currentStruct.name, [currentStruct]);
            } catch (error) {
                console.error('Error processing nested structure access:', error);
                return [];
            }
        }

        // 检查是否在Sub参数输入
        const subMatch = beforeCursor.match(/(\w+)\s*\(([^)]*)?$/);
        if (subMatch) {
            const subName = subMatch[1];
            // 首先在当前文件中查找Sub
            const localSub = currentFileSymbols.subs.find(s => s.name.toLowerCase() === subName.toLowerCase());
            
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
        return this.provideSymbolCompletions(document, position, currentFileSymbols, mergedSymbols, currentContext.subName, currentContext.blockId);
    }

    private inferVariableType(
        variableName: string,
        currentFileSymbols: any,
        mergedSymbols: any
    ): string | undefined {
        // 先尝试获取结构体数组变量名称
        let arrayReg = /([a-zA-Z0-9_]+)\(.*\)/i;
        let match = arrayReg.exec(variableName);
        if (match) {
            variableName = match[1];
        }

        // 1. 查找变量定义
        const variable = currentFileSymbols.variables.find((v: RtBasicVariable) => 
            v.name.toLowerCase() === variableName.toLowerCase());
        
        if (!variable) {
            // 如果在当前文件中没找到，检查全局变量
            const globalVar = mergedSymbols.variables.find((v: RtBasicVariable) => 
                v.name.toLowerCase() === variableName.toLowerCase() && v.scope === 'global');
            if (!globalVar) {
                return undefined;
            }
            return globalVar.structType || globalVar.type;
        }
        
        return variable.structType || variable.type;
    }

    private provideStructureMemberCompletions(
        structName: string,
        structures: RtBasicStructure[]
    ): vscode.CompletionItem[] {
        const structure = structures.find(s => s.name.toLowerCase() === structName.toLowerCase());
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
        const sub = subs.find(s => s.name.toLowerCase() === subName.toLowerCase());
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
    ): { subName?: string; blockId?: string; currentBlock?: ControlBlock } {
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
        let currentBlock: ControlBlock | undefined;
        let currentBlockId: string | undefined;
        
        // 首先找到最内层的控制块
        for (const block of controlBlocks) {
            if (block.range && 
                block.range.start.line <= position.line && 
                block.range.end.line >= position.line) {
                // 如果当前块在已找到的块内部，或者还没找到块
                if (!currentBlock || 
                    (block.range.start.line >= currentBlock.range.start.line && 
                     block.range.end.line <= currentBlock.range.end.line)) {
                    currentBlock = block;
                    currentBlockId = `${block.type}-${block.range.start.line}`;
                }
            }
        }

        return {
            subName: currentSub,
            blockId: currentBlockId,
            currentBlock: currentBlock
        };
    }

    private provideSymbolCompletions(
        document: vscode.TextDocument,
        position: vscode.Position,
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
                    if (currentSub === variable.parentSub) {
                        // 获取当前上下文中的控制块
                        const context = this.getCurrentContext(document, position, currentFileSymbols.subs, currentFileSymbols.controlBlocks);
                        let block = context.currentBlock;
                        
                        // 遍历当前块及其所有父块
                        while (block) {
                            if (block === variable.parentBlock) {
                                shouldInclude = true;
                                break;
                            }
                            block = block.parentBlock;
                        }
                    }
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
                    if (variable.arraySize) {
                        item.detail += `(${variable.arraySize})`;
                    } else if (variable.arraySizeStr) {
                        item.detail += `(${variable.arraySizeStr})`;
                    }
                }
                if (variable.structType) {
                    item.detail += ` As ${variable.structType}`;
                } else if (variable.type) {
                    item.detail += ` As ${variable.type}`;
                }
                
                // 设置文档说明
                const docs = new vscode.MarkdownString();
                if (variable.isArray) {
                    if (variable.arraySize) {
                        docs.appendText(`Array size: ${variable.arraySize}\n`);
                    } else if (variable.arraySizeStr) {
                        docs.appendText(`Array size: ${variable.arraySizeStr}\n`);
                    }
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

        // 添加当前文件中的C函数补全
        currentFileSymbols.cFunctions.forEach((cfunc: RtBasicCFunction) => {
            const item = new vscode.CompletionItem(cfunc.name, vscode.CompletionItemKind.Function);
            item.detail = `(C Function Import)`;
            
            const docs = new vscode.MarkdownString()
                .appendCodeblock(`DEFINE_CFUNC ${cfunc.name} ${cfunc.cFunctionDecl};`, 'rtbasic')
                .appendText('\nC Function Declaration:')
                .appendCodeblock(cfunc.cFunctionDecl, 'c');
            
            if (cfunc.sourceFile) {
                docs.appendText(`\nDefined in: ${cfunc.sourceFile}`);
            }
            
            item.documentation = docs;
            completions.push(item);
        });

        // 添加工作区中的C函数（排除当前文件中已有的C函数）
        mergedSymbols.cFunctions?.forEach((cfunc: RtBasicCFunction) => {
            if (!currentFileSymbols.cFunctions.some((f: RtBasicCFunction) => f.name === cfunc.name)) {
                const item = new vscode.CompletionItem(cfunc.name, vscode.CompletionItemKind.Function);
                item.detail = `(C Function Import)`;
                
                const docs = new vscode.MarkdownString()
                    .appendCodeblock(`DEFINE_CFUNC ${cfunc.name} ${cfunc.cFunctionDecl};`, 'rtbasic')
                    .appendText('\nC Function Declaration:')
                    .appendCodeblock(cfunc.cFunctionDecl, 'c');
                
                if (cfunc.sourceFile) {
                    docs.appendText(`\nDefined in: ${cfunc.sourceFile}`);
                }
                
                item.documentation = docs;
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

        // 添加内置函数补全
        completions.push(...builtinFunctions.functions.map(func => {
            const item = new vscode.CompletionItem(func.name, vscode.CompletionItemKind.Function);
            item.detail = '(builtin function)';
            
            // 创建文档字符串
            const docs = new vscode.MarkdownString()
                .appendText(`${func.description}\n\n`);
            
            // 添加语法示例
            if (func.example) {
                docs.appendCodeblock(func.example, 'rtbasic');
                docs.appendText('\n');
            }
            
            // 添加参数信息
            if (func.parameters.length > 0) {
                docs.appendText('参数:\n');
                func.parameters.forEach(param => {
                    docs.appendText(`- ${param.name}${param.optional ? ' (可选)' : ''}: ${param.type}`);
                    if (param.description) {
                        docs.appendText(` - ${param.description}`);
                    }
                    docs.appendText('\n');
                });
                docs.appendText('\n');
            }
            
            // 添加返回类型信息
            if (func.returnType) {
                docs.appendText(`返回类型: ${func.returnType}`);
            }
            
            item.documentation = docs;
            
            // 创建参数提示的代码片段
            const snippetParams = func.parameters.map((param, index) => {
                return param.optional ? 
                    `\${${index + 2}:, \${${index + 3}:${param.name}}}` : 
                    `\${${index + 1}:${param.name}}`;
            }).join(', ');
            
            item.insertText = new vscode.SnippetString(`${func.name}(${snippetParams})`);
            item.command = {
                command: 'editor.action.triggerParameterHints',
                title: 'Trigger parameter hints'
            };
            
            return item;
        }));

        // 添加控制语句代码片段
        const controlSnippets = [
            {
                label: 'If',
                kind: vscode.CompletionItemKind.Snippet,
                insertText: new vscode.SnippetString('If ${1:condition} Then\n\t${2}\nEnd If'),
                detail: 'If-Then block',
                documentation: new vscode.MarkdownString('Creates an If-Then block')
            },
            {
                label: 'ElseIf',
                kind: vscode.CompletionItemKind.Snippet,
                insertText: new vscode.SnippetString('ElseIf ${1:condition} Then\n\t${2}'),
                detail: 'ElseIf block',
                documentation: new vscode.MarkdownString('Creates an ElseIf block')
            },
            {
                label: 'ElseIf-inline',
                kind: vscode.CompletionItemKind.Snippet,
                insertText: new vscode.SnippetString('ElseIf ${1:condition} Then ${2:statement}'),
                detail: 'Single-line ElseIf statement',
                documentation: new vscode.MarkdownString('Creates a single-line ElseIf statement')
            }
        ];

        completions.push(...controlSnippets);

        // 添加工作区中的结构体（排除当前文件中已有的结构体）
        mergedSymbols.structures.forEach((struct: RtBasicStructure) => {
            // 确保不与当前文件中的结构体重复
            if (!currentFileSymbols.structures.some((s: RtBasicStructure) => s.name.toLowerCase() === struct.name.toLowerCase())) {
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

    /**
     * 解析C函数参数列表
     * @param paramsString 参数字符串
     * @returns 解析后的参数数组
     */
    private parseParameters(paramsString: string): string[] {
        const params: string[] = [];
        let currentParam = '';
        let nestLevel = 0;
        let inString = false;
        let stringChar = '';
        
        for (let i = 0; i < paramsString.length; i++) {
            const char = paramsString[i];
            
            // 处理字符串
            if ((char === '"' || char === "'") && (i === 0 || paramsString[i-1] !== '\\')) {
                if (!inString) {
                    inString = true;
                    stringChar = char;
                } else if (char === stringChar) {
                    inString = false;
                }
                currentParam += char;
                continue;
            }
            
            // 如果在字符串内，添加字符并继续
            if (inString) {
                currentParam += char;
                continue;
            }
            
            // 处理括号嵌套
            if (char === '(') {
                nestLevel++;
                currentParam += char;
            } else if (char === ')') {
                nestLevel--;
                currentParam += char;
            } else if (char === ',' && nestLevel === 0) {
                // 遇到顶层逗号，添加当前参数并重置
                params.push(currentParam.trim());
                currentParam = '';
            } else {
                currentParam += char;
            }
        }
        
        // 添加最后一个参数
        if (currentParam.trim()) {
            params.push(currentParam.trim());
        }
        
        return params;
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
        
        // 查找正在调用的Sub或内置函数
        const subMatch = beforeCursor.match(/(?:^|[=\s;,])?\s*(\w+)\s*\(([^)]*)?$/);
        if (!subMatch) {
            return null;
        }

        const subName = subMatch[1];
        
        // 首先检查是否是内置函数
        const builtinFunc = builtinFunctions.functions.find((f) => f.name.toLowerCase() === subName.toLowerCase());
        if (builtinFunc) {
            const signatureHelp = new vscode.SignatureHelp();
            
            // 创建内置函数签名信息
            const signature = new vscode.SignatureInformation(
                `${builtinFunc.name}(${builtinFunc.parameters.map((p: any) =>
                    `${p.name}${p.optional ? '?' : ''}${p.type ? ` As ${p.type}` : ''}`
                ).join(', ')})`,
                new vscode.MarkdownString(builtinFunc.description)
            );

            // 为每个参数添加参数信息
            signature.parameters = builtinFunc.parameters.map((param: any) => {
                let paramLabel = param.name;
                if (param.optional) {
                    paramLabel += '?';
                }
                if (param.type) {
                    paramLabel += ` As ${param.type}`;
                }
                
                const paramDoc = new vscode.MarkdownString()
                    .appendText(`Parameter ${param.name}${param.optional ? ' (可选)' : ''}`);
                
                if (param.type) {
                    paramDoc.appendText(`\nType: ${param.type}`);
                }
                
                if (param.description) {
                    paramDoc.appendText(`\n\n${param.description}`);
                }
                
                // Direction property removed as it's not in the JSON schema
                
                return new vscode.ParameterInformation(paramLabel, paramDoc);
            });

            signatureHelp.signatures = [signature];
            signatureHelp.activeSignature = 0;
            
            // 计算当前参数位置
            if (subMatch[2]) {
                const commaCount = subMatch[2].split(',').length - 1;
                signatureHelp.activeParameter = Math.min(commaCount, builtinFunc.parameters.length - 1);
            } else {
                signatureHelp.activeParameter = 0;
            }
            
            return signatureHelp;
        }
        
        // 如果不是内置函数，继续查找Sub或C函数
        let sub = currentFileSymbols.subs.find(s => s.name.toLowerCase() === subName.toLowerCase() && !s.isGlobal);
        if (!sub) {
            sub = mergedSymbols.subs.find(s => s.name.toLowerCase() === subName.toLowerCase() && s.isGlobal);
        }
        
        let cFunction = null;
        if (!sub) {
            cFunction = currentFileSymbols.cFunctions?.find(f => f.name.toLowerCase() === subName.toLowerCase());
            if (!cFunction && mergedSymbols.cFunctions) {
                cFunction = mergedSymbols.cFunctions.find(f => f.name.toLowerCase() === subName.toLowerCase());
            }
            if (!cFunction) {
                return null;
            }
        }

        const signatureHelp = new vscode.SignatureHelp();
        
        if (sub) {
            // 处理Sub函数的签名
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
            
            const signature = new vscode.SignatureInformation(
                `${sub.name}(${paramStrings.join(', ')})${sub.returnType ? ` As ${sub.returnType}` : ''}`,
                new vscode.MarkdownString(`${sub.isGlobal ? 'Global ' : ''}Sub defined in ${sub.sourceFile || 'current file'}`)
            );

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
        } else if (cFunction) {
            // 处理C函数的签名
            // 解析C函数声明，提取参数信息
            const cFuncDecl = cFunction.cFunctionDecl;
            
            // 创建函数签名信息
            const signature = new vscode.SignatureInformation(
                `${cFunction.name}${cFuncDecl.substring(cFuncDecl.indexOf('('))}`,
                new vscode.MarkdownString(`C Function Import defined in ${cFunction.sourceFile || 'current file'}`)
            );
            
            // 提取参数列表
            const paramsMatch = cFuncDecl.match(/\((.*)\)/);
            if (paramsMatch && paramsMatch[1].trim()) {
                const paramsString = paramsMatch[1].trim();
                // 处理参数列表，考虑逗号在字符串中的情况和嵌套括号
                const params = this.parseParameters(paramsString);
                
                // 为每个参数添加参数信息
                signature.parameters = params.map(param => {
                    return new vscode.ParameterInformation(
                        param,
                        new vscode.MarkdownString(`C parameter: ${param}`)
                    );
                });
            } else {
                signature.parameters = [];
            }
            
            signatureHelp.signatures = [signature];
            signatureHelp.activeSignature = 0;
        }
        
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
            
                // 如果在字符串内，跳过字符
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
            
            signatureHelp.activeParameter = Math.min(commaCount, sub!.parameters.length - 1);
        } else {
            signatureHelp.activeParameter = 0; // 第一个参数
        }

        return signatureHelp;
    }
}