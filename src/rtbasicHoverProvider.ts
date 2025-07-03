import * as vscode from 'vscode';
import { RtBasicParser, RtBasicVariable, RtBasicStructure, RtBasicCFunction, RtBasicBuiltinFunction, RtBasicSymbol } from './rtbasicParser';
import { RtBasicWorkspaceManager } from './rtbasicWorkspaceManager';

// 使用RtBasicSymbol类型作为FileSymbols的别名，以保持代码一致性
type FileSymbols = RtBasicSymbol;

export class RtBasicHoverProvider implements vscode.HoverProvider {
    private parser: RtBasicParser;
    private workspaceManager: RtBasicWorkspaceManager;

    constructor(parser: RtBasicParser, workspaceManager: RtBasicWorkspaceManager) {
        this.parser = parser;
        this.workspaceManager = workspaceManager;
    }

    public provideHover(
        document: vscode.TextDocument,
        position: vscode.Position,
        token: vscode.CancellationToken
    ): vscode.ProviderResult<vscode.Hover> {
        // 获取当前行的文本和光标位置
        const currentLine = document.lineAt(position.line).text;
        const cursorPos = position.character;
        
        // 增强的单词解析逻辑
        let start = cursorPos;
        let end = cursorPos;
        
        // 向前查找单词开始位置，支持结构体成员访问
        while (start > 0) {
            const prevChar = currentLine.charAt(start - 1);
            if (!/[\w.]/.test(prevChar)) break;
            // 如果是点号，前面必须是有效字符
            if (prevChar === '.' && start > 1 && !/[\w]/.test(currentLine.charAt(start - 2))) break;
            start--;
        }
        
        // 向后查找单词结束位置
        while (end < currentLine.length) {
            const nextChar = currentLine.charAt(end);
            if (!/[\w]/.test(nextChar)) break;
            end++;
        }
        
        // 获取完整单词或表达式
        let word = currentLine.substring(start, end).trim();
        
        const wordRange = new vscode.Range(
            position.line, start,
            position.line, end
        );
        
        if (!word) {
            return null;
        }
        
        // 获取当前文件的符号和合并的全局符号
        const currentFileSymbols = this.parser.parse(document);
        const mergedSymbols = this.workspaceManager.getMergedSymbolsForFile(document.uri);

        // 提取可能的结构体成员访问表达式
        const parts = word.split('.');
        
        if (parts.length > 1) {
            // 处理多级结构体成员访问
            return this.handleStructMemberAccess(parts, document, currentFileSymbols, mergedSymbols, wordRange);
        }

        // 检查变量
        // 获取当前上下文
        const context = this.parser.getCurrentContext(document, position, currentFileSymbols.subs, currentFileSymbols.controlBlocks);
        let variable: RtBasicVariable | undefined;

        // 按照从内到外的顺序搜索变量
        if (context.currentBlock) {
            // 1. 首先在当前块中搜索
            const blockVariables = currentFileSymbols.variables
                .filter(v => v.scope === 'block' && v.parentSub === context.subName)
                .sort((a, b) => {
                    // 确保有range属性
                    if (!a.range || !b.range) return 0;
                    // 按行号逆序排序
                    return b.range.start.line - a.range.start.line;
                });

            // 找到第一个在当前位置之前定义的变量
            variable = blockVariables.find(v => 
                v.name.toLowerCase() === word.toLowerCase() && 
                v.range && 
                (v.range.start.line < position.line || 
                (v.range.start.line === position.line && v.range.start.character < position.character))
            );
        }

        // 2. 如果没有找到，检查函数参数
        if (!variable && context.subName) {
            const currentSub = currentFileSymbols.subs.find(s => s.name === context.subName);
            if (currentSub) {
                const param = currentSub.parameters.find(p => p.name.toLowerCase() === word.toLowerCase());
                if (param) {
                    // 创建一个临时变量对象来表示函数参数
                    variable = {
                        name: param.name,
                        scope: 'parameter', // 使用特殊的scope值来标识参数
                        parentSub: context.subName,
                        type: param.type,
                        isArray: param.isArray,
                        arraySize: param.arraySize,
                        range: currentSub.range, // 使用函数的range作为参数的定义位置
                    };
                }
            }
        }

        // 3. 如果没有找到，检查函数作用域的局部变量
        if (!variable && context.subName) {
            variable = currentFileSymbols.variables.find(v => 
                v.name.toLowerCase() === word.toLowerCase() && 
                v.scope === 'local' && 
                v.parentSub === context.subName
            );
        }

        // 3. 如果仍然没有找到，检查文件作用域变量
        if (!variable) {
            variable = currentFileSymbols.variables.find(v => 
                v.name.toLowerCase() === word.toLowerCase() && v.scope === 'file'
            );
        }

        // 4. 最后检查全局变量
        if (!variable) {
            // 先检查当前文件中的全局变量
            variable = currentFileSymbols.variables.find(v => 
                v.name.toLowerCase() === word.toLowerCase() && v.scope === 'global'
            );
            
            // 如果当前文件中没有找到全局变量，则在合并的符号中查找
            if (!variable) {
                variable = mergedSymbols.variables.find(v => 
                    v.name.toLowerCase().toLowerCase() === word.toLowerCase() && v.scope === 'global'
                );
            }
        }
        
        if (variable) {
            let content = new vscode.MarkdownString();
            let varCode = '';
            let sourceFile = variable.sourceFile || document.uri.fsPath;
            
            switch (variable.scope) {
                case 'parameter':
                    // 处理函数参数
                    varCode = `${variable.name}`;
                    if (variable.isArray) {
                        varCode += `(${variable.arraySize || ''})`;
                    }
                    if (variable.type) {
                        varCode += ` As ${variable.type}`;
                    } else if (variable.structType) {
                        varCode += ` As ${variable.structType}`;
                    }
                    content.appendCodeblock(varCode, 'rtbasic');
                    
                    // 添加参数信息
                    let paramInfo = `Parameter of sub ${variable.parentSub}`;
                    content.appendText(`\n\n${paramInfo}`);
                    
                    // 如果是数组参数，显示数组信息
                    if (variable.isArray) {
                        content.appendText(`\nArray parameter${variable.arraySize ? ` with size ${variable.arraySize}` : ''}`);
                    }
                    break;
                case 'global':
                    varCode = `Global ${variable.name}`;
                    if (variable.isArray) {
                        if (variable.arraySize) {
                            varCode += `(${variable.arraySize})`;
                        } else if (variable.arraySizeStr) {
                            varCode += `(${variable.arraySizeStr})`;
                        }
                    }
                    if (variable.type) {
                        varCode += ` As ${variable.type}`;
                    } else if (variable.structType) {
                        varCode += ` As ${variable.structType}`;
                    }
                    content.appendCodeblock(varCode, 'rtbasic');
                    
                    // 如果全局变量来自其他文件，显示源文件信息
                    if (sourceFile !== document.uri.fsPath) {
                        content.appendText(`\n\nDefined in ${this.getRelativePath(sourceFile)}`);
                    }
                    break;
                case 'local':
                    varCode = `Local ${variable.name}`;
                    if (variable.isArray) {
                        if (variable.arraySize) {
                            varCode += `(${variable.arraySize})`;
                        } else if (variable.arraySizeStr) {
                            varCode += `(${variable.arraySizeStr})`;
                        }
                    }
                    if (variable.type) {
                        varCode += ` As ${variable.type}`;
                    } else if (variable.structType) {
                        varCode += ` As ${variable.structType}`;
                    }
                    content.appendCodeblock(varCode, 'rtbasic');
                    if (variable.parentSub) {
                        content.appendText(`\n\nLocal variable in sub ${variable.parentSub}`);
                    }
                    break;
                case 'block':
                    // 处理常量和普通块作用域变量
                    if (variable.isConst) {
                        varCode = `const ${variable.name}`;
                        if (variable.value) {
                            varCode += ` = ${variable.value}`;
                        }
                    } else {
                        varCode = `Local ${variable.name}`;
                    }
                    
                    if (variable.isArray) {
                        if (variable.arraySize) {
                            varCode += `(${variable.arraySize})`;
                        } else if (variable.arraySizeStr) {
                            varCode += `(${variable.arraySizeStr})`;
                        }
                    }

                    if (variable.type) {
                        varCode += ` As ${variable.type}`;
                    } else if (variable.structType) {
                        varCode += ` As ${variable.structType}`;
                    }
                    content.appendCodeblock(varCode, 'rtbasic');
                    
                    // 构建更详细的作用域信息
                    let scopeInfo = '';
                    if (variable.parentSub) {
                        scopeInfo += `sub ${variable.parentSub}`;
                    }
                    
                    if (variable.blockType) {
                        if (scopeInfo) {
                            scopeInfo += ', ';
                        }
                        scopeInfo += `${variable.blockType} block`;
                    }
                    
                    // 添加行号信息
                    if (variable.range) {
                        const startLine = variable.range.start.line + 1; // 转换为1-based行号
                        if (scopeInfo) {
                            scopeInfo += ` at line ${startLine}`;
                        } else {
                            scopeInfo = `line ${startLine}`;
                        }
                    }
                    
                    // 显示完整的作用域路径
                    if (scopeInfo) {
                        content.appendText(`\n\n${variable.isConst ? 'Block-scoped constant' : 'Block-scoped variable'} in ${scopeInfo}`);
                    } else {
                        content.appendText(`\n\n${variable.isConst ? 'Block-scoped constant' : 'Block-scoped variable'}`);
                    }
                    
                    // 如果是常量且有值，显示值信息
                    if (variable.isConst && variable.value) {
                        content.appendText(`\nValue: ${variable.value}`);
                    }
                    break;
                case 'file':
                    varCode = `Dim ${variable.name}`;
                    if (variable.isArray) {
                        varCode += `(${variable.arraySize})`;
                    }
                    if (variable.type) {
                        varCode += ` As ${variable.type}`;
                    } else if (variable.structType) {
                        varCode += ` As ${variable.structType}`;
                    }
                    content.appendCodeblock(varCode, 'rtbasic');
                    content.appendText('\n\nFile-level variable');
                    break;
            }
            
            if (variable.isArray) {
                if (variable.arraySize) {
                    content.appendText(`\nArray with size ${variable.arraySize}`);
                } else {
                    content.appendText(`\nArray with size ${variable.arraySizeStr}`);
                }
            }
            
            return new vscode.Hover(content, wordRange);
        }

        // 检查常量值
        const constValue = this.parser.getConstantValue(word);
        if (constValue !== undefined) {
            const content = new vscode.MarkdownString()
                .appendCodeblock(`const ${word} = ${constValue}`, 'rtbasic')
                .appendText('\n\nConstant value');
            return new vscode.Hover(content, wordRange);
        }

        // 检查Sub
        // 首先检查当前文件中的非全局Sub
        let sub = currentFileSymbols.subs.find(s => s.name.toLowerCase() === word.toLowerCase() && !s.isGlobal);
        let sourceFile = document.uri.fsPath;
        
        // 如果没有找到非全局Sub，则检查全局Sub
        if (!sub) {
            // 先检查当前文件中的全局Sub
            sub = currentFileSymbols.subs.find(s => s.name.toLowerCase() === word.toLowerCase() && s.isGlobal);
            
            // 如果当前文件中没有找到全局Sub，则在合并的符号中查找
            if (!sub) {
                sub = mergedSymbols.subs.find(s => s.name.toLowerCase() === word.toLowerCase() && s.isGlobal);
                
                // 查找Sub的源文件
                if (sub && sub.sourceFile) {
                    sourceFile = sub.sourceFile;
                }
            }
        }
        
        if (sub) {
            const params = sub.parameters.map(p => {
                let paramStr = p.name;
                if (p.type) {
                    paramStr += ` As ${p.type}`;
                }
                if (p.isArray) {
                    paramStr += `(${p.arraySize})`;
                }
                return paramStr;
            }).join(', ');
            
            const content = new vscode.MarkdownString()
                .appendCodeblock(
                    `${sub.isGlobal ? 'Global ' : ''}Sub ${sub.name}(${params})${sub.returnType ? ` As ${sub.returnType}` : ''}`, 
                    'rtbasic'
                );
            
            // 如果Sub来自其他文件，显示源文件信息
            if (sourceFile !== document.uri.fsPath) {
                content.appendText(`\n\nDefined in ${this.getRelativePath(sourceFile)}`);
            }
            
            // 添加函数描述（如果有）
            if (sub.description) {
                content.appendMarkdown(`\n\n${sub.description}\n`);
            }
            
            if (sub.parameters.length > 0) {
                content.appendMarkdown('\n\n**Parameters:**\n');
                sub.parameters.forEach(param => {
                    let paramDesc = `- \`${param.name}\``;
                    
                    // 添加类型信息
                    if (param.type) {
                        paramDesc += ` : \`${param.type}\``;
                    }
                    
                    // 添加数组信息
                    if (param.isArray) {
                        paramDesc += ` (Array[${param.arraySize || ''}])`;
                    }
                    
                    // 添加参数方向信息（如果有）
                    if (param.direction) {
                        paramDesc += ` - ${param.direction}`;
                    }
                    
                    // 添加参数描述（如果有）
                    if (param.description) {
                        paramDesc += `\n  ${param.description}`;
                    }
                    
                    content.appendMarkdown(paramDesc + '\n');
                });
            }
            
            // 添加返回值信息（如果有）
            if (sub.returnType) {
                content.appendMarkdown(`\n**Returns:** \`${sub.returnType}\`\n`);
            }
            
            return new vscode.Hover(content, wordRange);
        }

        // 检查C函数
        // 首先在当前文件中查找C函数
        let cFunction = currentFileSymbols.cFunctions.find(cf => cf.name.toLowerCase() === word.toLowerCase());
        sourceFile = document.uri.fsPath;
        
        // 如果当前文件中没有找到，则在全局符号中查找
        if (!cFunction) {
            cFunction = mergedSymbols.cFunctions.find(cf => cf.name.toLowerCase() === word.toLowerCase());
            
            // 查找C函数的源文件
            if (cFunction && cFunction.sourceFile) {
                sourceFile = cFunction.sourceFile;
            }
        }
        
        if (cFunction) {
            const content = new vscode.MarkdownString()
                .appendCodeblock(
                    `DEFINE_CFUNC ${cFunction.name} ${cFunction.cFunctionDecl};`, 
                    'rtbasic'
                )
                .appendText('\n\nC Function Declaration:')
                .appendCodeblock(cFunction.cFunctionDecl, 'c');
            
            // 解析并显示参数信息
            const paramsMatch = cFunction.cFunctionDecl.match(/\((.*)\)/);
            if (paramsMatch && paramsMatch[1].trim()) {
                const params = this.parseCFunctionParameters(paramsMatch[1].trim());
                if (params.length > 0) {
                    content.appendMarkdown('\n\n**Parameters:**\n');
                    params.forEach(param => {
                        content.appendMarkdown(`- \`${param}\`\n`);
                    });
                }
            }

            // 提取并显示返回类型
            const returnTypeMatch = cFunction.cFunctionDecl.match(/^(\w+\s*\*?\s+)/);
            if (returnTypeMatch) {
                const returnType = returnTypeMatch[1].trim();
                if (returnType !== 'void') {
                    content.appendMarkdown(`\n**Returns:** \`${returnType}\`\n`);
                }
            }
            
            // 如果C函数来自其他文件，显示源文件信息
            if (sourceFile !== document.uri.fsPath) {
                content.appendText(`\n\nDefined in ${this.getRelativePath(sourceFile)}`);
            }
            
            return new vscode.Hover(content, wordRange);
        }

        // 检查内置函数
        const builtinFunction = RtBasicParser.builtinFunctions.find(f => f.name.toLowerCase() === word.toLowerCase());
        if (builtinFunction) {
             const params = builtinFunction.parameters.map(p => {
                let paramStr = p.name;
                if (p.type) {
                    paramStr += ` As ${p.type}`;
                }
                if (p.optional) {
                    paramStr += '?';
                }
                return paramStr;
            }).join(', ');
            
            const content = new vscode.MarkdownString().appendCodeblock(
              `Global ${builtinFunction.name}(${params})${
                builtinFunction.returnType
                  ? ` As ${builtinFunction.returnType}`
                  : ""
              }`,
              "rtbasic"
            );

            if (builtinFunction.description) {
              content.appendMarkdown(`\n${builtinFunction.description}`);
            }
            if (builtinFunction.example) {
              content.appendCodeblock(
                `\n\nExample:\n\n\`\`\`rtbasic\n${builtinFunction.example}\n\`\`\``, "rtbasic"
              );
            }
            
            return new vscode.Hover(content, wordRange);
        }

        // 检查结构体
        // 首先在当前文件中查找结构体
        let struct = currentFileSymbols.structures.find(s => s.name.toLowerCase() === word.toLowerCase());
        sourceFile = document.uri.fsPath;
        
        // 如果当前文件中没有找到，则在全局符号中查找
        if (!struct) {
            struct = mergedSymbols.structures.find(s => s.name.toLowerCase() === word.toLowerCase());
            
            // 查找结构体的源文件
            if (struct && struct.sourceFile) {
                sourceFile = struct.sourceFile;
            }
        }
        
        if (struct) {
            const membersCode = struct.members.map(m => {
                let memberStr = `    Dim ${m.name}`;
                if (m.isArray) {
                    memberStr += `(${m.arraySize})`;
                }
                if ('type' in m && m.type) {
                    memberStr += ` As ${m.type}`;
                }
                return memberStr;
            }).join('\n');
            
            const content = new vscode.MarkdownString()
                .appendCodeblock(
                    `Global Structure ${struct.name}\n${membersCode}\nEnd Structure`, 
                    'rtbasic'
                );
            
            // 如果结构体来自其他文件，显示源文件信息
            if (sourceFile !== document.uri.fsPath) {
                content.appendText(`\n\nDefined in ${this.getRelativePath(sourceFile)}`);
            }
            
            if (struct.members.length > 0) {
                content.appendMarkdown('\n\n**Members:**\n');
                struct.members.forEach(member => {
                    let memberDesc = `- \`${member.name}\``;
                    if (member.type) {
                        memberDesc += ` (${member.type})`;
                    }
                    if (member.isArray) {
                        memberDesc += ` (array size: ${member.arraySize})`;
                    }
                    content.appendMarkdown(memberDesc + '\n');
                });
            }
            
            return new vscode.Hover(content, wordRange);
        }

        // 检查关键字
        const keywords: { [key: string]: string } = {
            'If': '条件语句，用于根据条件执行代码块。\n\n**语法：**\n```\nIf condition Then\n    statements\n[ElseIf condition Then\n    statements]\n[Else\n    statements]\nEnd If\n```\n\n**单行语法：**\n```\nIf condition Then statement\n```',
            'ElseIf': '条件语句的一部分，用于在前面的If条件为False时测试新条件。\n\n**语法：**\n```\nElseIf condition Then\n    statements\n```\n\n**单行语法：**\n```\nElseIf condition Then statement\n```',
            'Else': '条件语句的一部分，用于在所有前面的条件都为False时执行代码。\n\n**语法：**\n```\nElse\n    statements\n```',
            'Then': '用于If和ElseIf语句中，表示条件后面的执行代码。',
            'For': '循环语句，用于指定次数重复执行代码块。\n\n**语法：**\n```\nFor counter = start To end [Step step]\n    statements\nNext [counter]\n```',
            'While': '循环语句，当条件为True时重复执行代码块。\n\n**语法：**\n```\nWhile condition\n    statements\nWend\n```',
            'Select': '多分支条件语句，根据表达式的值执行不同的代码块。\n\n**语法：**\n```\nSelect expression\n    Case value1\n        statements\n    Case value2\n        statements\n    [Default\n        statements]\nEnd Select\n```'
        };

        if (keywords[word]) {
            return new vscode.Hover(new vscode.MarkdownString(keywords[word]), wordRange);
        }

        return null;
    }
    
    /**
     * 获取文件的相对路径
     * @param filePath 完整文件路径
     * @returns 相对于工作区的路径
     */
    /**
     * 解析C函数参数列表
     * @param paramsString 参数字符串
     * @returns 解析后的参数数组
     */
    private parseCFunctionParameters(paramsString: string): string[] {
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
                const param = currentParam.trim();
                if (param) {
                    // 处理参数名称和类型
                    const parts = param.split(/\s+/);
                    // 如果参数声明包含多个部分（如 'const char *name'），保持完整格式
                    params.push(param);
                }
                currentParam = '';
            } else {
                currentParam += char;
            }
        }
        
        // 添加最后一个参数
        const lastParam = currentParam.trim();
        if (lastParam) {
            params.push(lastParam);
        }
        
        return params;
    }

    private getRelativePath(filePath: string): string {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders) {
            return filePath;
        }
        
        for (const folder of workspaceFolders) {
            const relativePath = vscode.workspace.asRelativePath(filePath, false);
            if (relativePath !== filePath) {
                return relativePath;
            }
        }
        
        return filePath;
    }

    /**
     * 处理多级结构体成员访问
     * @param parts 通过点号分割的成员访问路径
     * @param document 当前文档
     * @param currentFileSymbols 当前文件的符号
     * @param mergedSymbols 合并的符号
     * @param wordRange 单词范围
     * @returns 悬停信息
     */
    private handleStructMemberAccess(
        parts: string[], 
        document: vscode.TextDocument, 
        currentFileSymbols: FileSymbols, 
        mergedSymbols: FileSymbols, 
        wordRange: vscode.Range
    ): vscode.Hover | null {
        // 第一部分是结构体变量名或结构体类型名
        const rootName = parts[0];
        
        // 首先检查变量声明，获取结构体类型
        const variables = [...currentFileSymbols.variables, ...mergedSymbols.variables];
        const structVar = variables.find(v => v.name.toLowerCase() === rootName.toLowerCase());
        
        // 确定实际结构体名称
        let actualStructName = rootName;
        
        // 如果变量有明确的structType，使用它
        if (structVar?.structType) {
            actualStructName = structVar.structType;
        } 
        // 否则检查变量是否是结构体实例
        else {
            const structure = [...currentFileSymbols.structures, ...mergedSymbols.structures]
                .find(s => s.name.toLowerCase() === rootName.toLowerCase());
            if (structure) {
                actualStructName = rootName;
            }
        }
        
        // 查找结构体定义
        let structure = currentFileSymbols.structures.find(s => s.name.toLowerCase() === actualStructName.toLowerCase());
        let sourceFile = document.uri.fsPath;
        
        if (!structure) {
            // 如果当前文件中没有找到，则在全局符号中查找
            structure = mergedSymbols.structures.find(s => s.name.toLowerCase() === actualStructName.toLowerCase());
            
            if (structure) {
                // 查找结构体的源文件
                for (const [filePath, fileSymbols] of Object.entries(this.workspaceManager.getAllFileSymbols())) {
                    const fileStruct = fileSymbols.structures.find(s => s.name.toLowerCase() === actualStructName.toLowerCase());
                    if (fileStruct) {
                        sourceFile = filePath;
                        break;
                    }
                }
            }
        }
        
        if (!structure) {
            return null;
        }
        
        // 递归查找成员
        let currentStructure = structure;
        let member = null;
        let memberPath = parts.slice(1);
        let memberSourceFile = sourceFile;
        
        // 遍历成员路径
        for (let i = 0; i < memberPath.length; i++) {
            const memberName = memberPath[i];
            
            if (!currentStructure) {
                return null;
            }
            
            member = currentStructure.members.find(m => m.name.toLowerCase() === memberName.toLowerCase());
            
            if (!member) {
                return null;
            }
            
            // 如果不是最后一个成员且当前成员是结构体类型，则继续查找子成员
            if (i < memberPath.length - 1 && member.structType) {
                // 查找成员类型对应的结构体
                const subStructName = member.structType;
                let subStruct = currentFileSymbols.structures.find(s => s.name.toLowerCase() === subStructName.toLowerCase());
                
                if (!subStruct) {
                    subStruct = mergedSymbols.structures.find(s => s.name.toLowerCase() === subStructName.toLowerCase());
                    
                    if (subStruct) {
                        // 查找子结构体的源文件
                        for (const [filePath, fileSymbols] of Object.entries(this.workspaceManager.getAllFileSymbols())) {
                            const fileStruct = fileSymbols.structures.find(s => s.name.toLowerCase() === subStructName.toLowerCase());
                            if (fileStruct) {
                                memberSourceFile = filePath;
                                break;
                            }
                        }
                    }
                }
                
                // 只有在找到子结构体时才更新当前结构体
                if (subStruct) {
                    currentStructure = subStruct;
                } else {
                    // 如果找不到子结构体，则无法继续查找
                    return null;
                }
            }
        }
        
        if (member && currentStructure) {
            let memberCode = `Dim ${member.name}`;
            if (member.isArray) {
                memberCode += `(${member.arraySize})`;
            }
            if (member.type) {
                memberCode += ` As ${member.type}`;
            }
            
            const content = new vscode.MarkdownString()
                .appendCodeblock(memberCode, 'rtbasic')
                .appendText(`\n\nMember of structure ${currentStructure.name}`);
            
            // 构建完整的访问路径
            const fullPath = parts.join('.');
            content.appendMarkdown(`\n\nAccess path: ${fullPath}`);
            
            // 创建一个可点击的链接，使用 editor.action.goToDeclaration 命令
            const fileUri = vscode.Uri.file(memberSourceFile);
            
            // 获取成员变量定义的位置
            let position: vscode.Position;
            if (member.range) {
                position = new vscode.Position(member.range.start.line, member.range.start.character);
            } else if (currentStructure.range) {
                // 如果成员没有range，回退到结构体的起始位置
                position = new vscode.Position(currentStructure.range.start.line, currentStructure.range.start.character);
            } else {
                position = new vscode.Position(0, 0);
            }
            
            // 创建命令参数，包含文件URI和位置信息
            const args = [{
                uri: fileUri,
                range: new vscode.Range(position, position)
            }];
            
            // 使用 editor.action.goToDeclaration 命令
            content.appendMarkdown(`\n\n[Go to ${currentStructure.name} definition](command:editor.action.goToDeclaration?${encodeURIComponent(JSON.stringify(args))})`);
            
            // 设置允许命令链接
            content.isTrusted = true;
            
            if (memberSourceFile !== document.uri.fsPath) {
                content.appendText(`\nDefined in ${this.getRelativePath(memberSourceFile)}`);
            }
            
            if (member.isArray) {
                content.appendText(`\nArray with size ${member.arraySize}`);
            }
            
            return new vscode.Hover(content, wordRange);
        }
        
        return null;
    }
}