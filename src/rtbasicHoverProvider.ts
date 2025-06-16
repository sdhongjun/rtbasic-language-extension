import * as vscode from 'vscode';
import { RtBasicParser, RtBasicVariable, RtBasicStructure, RtBasicCFunction } from './rtbasicParser';
import { RtBasicWorkspaceManager } from './rtbasicWorkspaceManager';

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
        const wordRange = document.getWordRangeAtPosition(position);
        if (!wordRange) {
            return null;
        }

        const word = document.getText(wordRange);
        
        // 获取当前文件的符号和合并的全局符号
        const currentFileSymbols = this.parser.parse(document);
        const mergedSymbols = this.workspaceManager.getMergedSymbolsForFile(document.uri);

        // 检查是否在结构体成员访问
        const lineText = document.lineAt(position.line).text;
        const beforeCursor = lineText.substring(0, position.character);
        const dotMatch = beforeCursor.match(/(\w+)\.(\w*)$/);
        
        if (dotMatch && dotMatch[2] === word) {
            const structName = dotMatch[1];
            const memberName = word;
            
            // 首先在当前文件中查找结构体
            let structure = currentFileSymbols.structures.find(s => s.name === structName);
            let member = null;
            let sourceFile = document.uri.fsPath;
            
            if (structure) {
                member = structure.members.find(m => m.name === memberName);
            } else {
                // 如果当前文件中没有找到，则在全局符号中查找
                structure = mergedSymbols.structures.find(s => s.name === structName);
                
                if (structure) {
                    member = structure.members.find(m => m.name === memberName);
                    
                    // 查找结构体的源文件
                    for (const [filePath, fileSymbols] of Object.entries(this.workspaceManager.getAllFileSymbols())) {
                        const fileStruct = fileSymbols.structures.find(s => s.name === structName);
                        if (fileStruct) {
                            sourceFile = filePath;
                            break;
                        }
                    }
                }
            }

            if (structure && member) {
                let memberCode = `Dim ${member.name}`;
                if (member.isArray) {
                    memberCode += `(${member.arraySize})`;
                }
                if (member.type) {
                    memberCode += ` As ${member.type}`;
                }
                
                const content = new vscode.MarkdownString()
                    .appendCodeblock(memberCode, 'rtbasic')
                    .appendText(`\n\nMember of structure ${structure.name}`);
                
                if (sourceFile !== document.uri.fsPath) {
                    content.appendText(`\nDefined in ${this.getRelativePath(sourceFile)}`);
                }
                
                if (member.isArray) {
                    content.appendText(`\nArray with size ${member.arraySize}`);
                }
                
                return new vscode.Hover(content, wordRange);
            }
        }

        // 检查变量
        // 首先检查当前文件中的局部变量和文件变量
        let variable = currentFileSymbols.variables.find(v => 
            v.name === word && (v.scope === 'local' || v.scope === 'file')
        );
        
        // 如果没有找到局部变量或文件变量，则检查全局变量
        if (!variable) {
            // 先检查当前文件中的全局变量
            variable = currentFileSymbols.variables.find(v => 
                v.name === word && v.scope === 'global'
            );
            
            // 如果当前文件中没有找到全局变量，则在合并的符号中查找
            if (!variable) {
                variable = mergedSymbols.variables.find(v => 
                    v.name === word && v.scope === 'global'
                );
            }
        }
        
        if (variable) {
            let content = new vscode.MarkdownString();
            let varCode = '';
            let sourceFile = variable.sourceFile || document.uri.fsPath;
            
            switch (variable.scope) {
                case 'global':
                    varCode = `Global Dim ${variable.name}`;
                    if (variable.isArray) {
                        varCode += `(${variable.arraySize})`;
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
                        varCode += `(${variable.arraySize})`;
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
                content.appendText(`\nArray with size ${variable.arraySize}`);
            }
            
            return new vscode.Hover(content, wordRange);
        }

        // 检查Sub
        // 首先检查当前文件中的非全局Sub
        let sub = currentFileSymbols.subs.find(s => s.name === word && !s.isGlobal);
        let sourceFile = document.uri.fsPath;
        
        // 如果没有找到非全局Sub，则检查全局Sub
        if (!sub) {
            // 先检查当前文件中的全局Sub
            sub = currentFileSymbols.subs.find(s => s.name === word && s.isGlobal);
            
            // 如果当前文件中没有找到全局Sub，则在合并的符号中查找
            if (!sub) {
                sub = mergedSymbols.subs.find(s => s.name === word && s.isGlobal);
                
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
            
            if (sub.parameters.length > 0) {
                content.appendText('\n\n**Parameters:**\n');
                sub.parameters.forEach(param => {
                    let paramDesc = `- \`${param.name}\``;
                    if (param.type) {
                        paramDesc += ` (${param.type})`;
                    }
                    if (param.isArray) {
                        paramDesc += ` (array size: ${param.arraySize})`;
                    }
                    content.appendText(paramDesc + '\n');
                });
            }
            
            return new vscode.Hover(content, wordRange);
        }

        // 检查C函数
        // 首先在当前文件中查找C函数
        let cFunction = currentFileSymbols.cFunctions.find(cf => cf.name === word);
        sourceFile = document.uri.fsPath;
        
        // 如果当前文件中没有找到，则在全局符号中查找
        if (!cFunction) {
            cFunction = mergedSymbols.cFunctions.find(cf => cf.name === word);
            
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
                    content.appendText('\n\n**Parameters:**\n');
                    params.forEach(param => {
                        content.appendText(`- \`${param}\`\n`);
                    });
                }
            }

            // 提取并显示返回类型
            const returnTypeMatch = cFunction.cFunctionDecl.match(/^(\w+\s*\*?\s+)/);
            if (returnTypeMatch) {
                const returnType = returnTypeMatch[1].trim();
                if (returnType !== 'void') {
                    content.appendText(`\n**Returns:** \`${returnType}\`\n`);
                }
            }
            
            // 如果C函数来自其他文件，显示源文件信息
            if (sourceFile !== document.uri.fsPath) {
                content.appendText(`\n\nDefined in ${this.getRelativePath(sourceFile)}`);
            }
            
            return new vscode.Hover(content, wordRange);
        }

        // 检查结构体
        // 首先在当前文件中查找结构体
        let struct = currentFileSymbols.structures.find(s => s.name === word);
        sourceFile = document.uri.fsPath;
        
        // 如果当前文件中没有找到，则在全局符号中查找
        if (!struct) {
            struct = mergedSymbols.structures.find(s => s.name === word);
            
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
                content.appendText('\n\n**Members:**\n');
                struct.members.forEach(member => {
                    let memberDesc = `- \`${member.name}\``;
                    if (member.type) {
                        memberDesc += ` (${member.type})`;
                    }
                    if (member.isArray) {
                        memberDesc += ` (array size: ${member.arraySize})`;
                    }
                    content.appendText(memberDesc + '\n');
                });
            }
            
            return new vscode.Hover(content, wordRange);
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
}