import * as vscode from 'vscode';
import { RtBasicParser, RtBasicBuiltinFunctions } from './rtbasicParser';
import { RtBasicWorkspaceManager } from './rtbasicWorkspaceManager';
import builtinFunctions from './builtinFunctions';

export class RtBasicDefinitionProvider implements vscode.DefinitionProvider {
    private parser: RtBasicParser;
    private workspaceManager: RtBasicWorkspaceManager;

    constructor(parser: RtBasicParser, workspaceManager: RtBasicWorkspaceManager) {
        this.parser = parser;
        this.workspaceManager = workspaceManager;
    }

    public provideDefinition(
        document: vscode.TextDocument,
        position: vscode.Position,
        token: vscode.CancellationToken
    ): vscode.ProviderResult<vscode.Definition> {
        const wordRange = document.getWordRangeAtPosition(position);
        if (!wordRange) {
            return null;
        }

        const word = document.getText(wordRange);
        
        // 首先检查是否是内置函数
        const builtinFunc = builtinFunctions.functions.find(f => f.name.toLowerCase() === word.toLowerCase());
        if (builtinFunc) {
            // 为内置函数创建虚拟位置
            const uri = vscode.Uri.parse(`rtbasic-builtin:///builtin/${word}`);
            const pos = new vscode.Position(0, 0);
            return new vscode.Location(uri, pos);
        }
        
        // 获取当前文件的符号和合并的全局符号
        const currentFileSymbols = this.parser.parse(document);
        const mergedSymbols = this.workspaceManager.getMergedSymbolsForFile(document.uri);
        
        // 首先在当前文件中查找局部符号
        
        // 检查局部变量和块作用域变量
        // 使用getCurrentContext方法获取当前位置的上下文信息
        const context = this.parser.getCurrentContext(document, position, currentFileSymbols.subs, currentFileSymbols.controlBlocks);
        const currentSub = context.subName ? currentFileSymbols.subs.find(sub => sub.name === context.subName) : undefined;
        const currentControlBlock = context.currentBlock;
        
        // 查找匹配的局部变量或块作用域变量
        // 优先考虑当前控制块中的变量
        if (currentControlBlock) {
            // 在当前控制块中查找变量
            const blockVariable = currentFileSymbols.variables.find(v => 
                v.name.toLowerCase() === word.toLowerCase() && 
                v.scope === 'block' && 
                v.parentSub === currentSub?.name &&
                v.parentBlock === currentControlBlock
            );
            
            if (blockVariable) {
                return new vscode.Location(document.uri, blockVariable.range);
            }
            
            // 在父控制块中查找变量
            let parentBlock = currentControlBlock.parentBlock;
            while (parentBlock) {
                const parentBlockVariable = currentFileSymbols.variables.find(v => 
                    v.name.toLowerCase() === word.toLowerCase() && 
                    v.scope === 'block' && 
                    v.parentSub === currentSub?.name &&
                    v.parentBlock === parentBlock
                );
                
                if (parentBlockVariable) {
                    return new vscode.Location(document.uri, parentBlockVariable.range);
                }
                
                parentBlock = parentBlock.parentBlock;
            }
        }
        
        // 如果在控制块中没有找到，则查找函数参数
        if (currentSub) {
            const sub = currentFileSymbols.subs.find(s => s.name.toLowerCase() === currentSub.name.toLowerCase());
            if (sub) {
                const param = sub.parameters.find(p => p.name.toLowerCase() === word.toLowerCase());
                if (param) {
                    // 返回函数定义位置作为参数的定义位置
                    return new vscode.Location(document.uri, sub.range);
                }
            }
            
            // 查找函数级别的局部变量
            const localVariable = currentFileSymbols.variables.find(v => 
                v.name.toLowerCase() === word.toLowerCase() && 
                v.scope === 'local' && 
                v.parentSub === currentSub.name
            );
            
            if (localVariable) {
                return new vscode.Location(document.uri, localVariable.range);
            }
        }
        
        // 如果以上都没找到，则查找任何匹配的局部变量或块作用域变量
        const anyLocalVariable = currentFileSymbols.variables.find(v => 
            v.name.toLowerCase() === word.toLowerCase() && (v.scope === 'local' || v.scope === 'block')
        );
        
        if (anyLocalVariable) {
            return new vscode.Location(document.uri, anyLocalVariable.range);
        }
        
        // 检查文件变量
        const fileVariable = currentFileSymbols.variables.find(v => v.name.toLowerCase() === word.toLowerCase() && v.scope === 'file');
        if (fileVariable) {
            return new vscode.Location(document.uri, fileVariable.range);
        }
        
        // 检查当前文件中的非全局Sub
        const localSub = currentFileSymbols.subs.find(s => s.name.toLowerCase() === word.toLowerCase() && !s.isGlobal);
        if (localSub) {
            return new vscode.Location(document.uri, localSub.range);
        }
        
        // 检查当前文件中的C函数
        const localCFunc = currentFileSymbols.cFunctions.find(cf => cf.name.toLowerCase() === word.toLowerCase());
        if (localCFunc) {
            return new vscode.Location(document.uri, localCFunc.range);
        }
        
        // 检查当前文件中的结构体
        const localStruct = currentFileSymbols.structures.find(s => s.name.toLowerCase() === word.toLowerCase());
        if (localStruct) {
            return new vscode.Location(document.uri, localStruct.range);
        }
        
        // 检查结构体成员（支持多级结构体成员，如 rect.topLeft.x）
        const lineText = document.lineAt(position.line).text;
        const beforeCursor = lineText.substring(0, position.character);
        const afterCursor = lineText.substring(position.character);
        
        // 提取光标前的完整表达式
        const expressionMatch = beforeCursor.match(/([a-zA-Z_][a-zA-Z0-9_]*(?:\.[a-zA-Z_][a-zA-Z0-9_]*)+)\.([a-zA-Z_][a-zA-Z0-9_]*)$/);
        
        if (expressionMatch) {
            // 获取结构体表达式和当前成员
            const structExpression = expressionMatch[1]; // 例如 "rect.topLeft"
            const currentMember = expressionMatch[2];    // 例如 "x"
            
            // 确保光标位于成员名称上
            if (currentMember && currentMember.toLowerCase() === word.toLowerCase()) {
                // 构建完整的表达式路径
                const fullExpression = `${structExpression}.${currentMember}`;
                const parts = fullExpression.split('.');
                
                // 递归查找结构体成员
                return this.findStructMemberDefinition(document, parts, currentFileSymbols, mergedSymbols);
            }
        }
        
        // 处理光标可能位于成员名称中间的情况
        const partialExpressionMatch = beforeCursor.match(/([a-zA-Z_][a-zA-Z0-9_]*(?:\.[a-zA-Z_][a-zA-Z0-9_]*)*)\./);
        if (partialExpressionMatch && word) {
            // 获取结构体表达式前缀
            const structExpression = partialExpressionMatch[1]; // 例如 "rect.topLeft"
            
            // 构建完整的表达式路径
            const fullExpression = `${structExpression}.${word}`;
            const parts = fullExpression.split('.');
            
            // 递归查找结构体成员
            return this.findStructMemberDefinition(document, parts, currentFileSymbols, mergedSymbols);
        }
        
        // 检查简单的结构体成员（单级，如 rect.width）
        const dotMatch = beforeCursor.match(/(\w+)\.(\w*)$/);
        if (dotMatch) {
            const structName = dotMatch[1];
            const memberName = word;
            
            // 先在当前文件中查找结构体
            const structure = currentFileSymbols.structures.find(s => s.name.toLowerCase() === structName.toLowerCase());
            if (structure) {
                const member = structure.members.find(m => m.name.toLowerCase() === memberName.toLowerCase());
                if (member) {
                    return new vscode.Location(document.uri, member.range);
                }
            }
            
            // 如果当前文件中没有找到，则在全局符号中查找
            const globalStructure = mergedSymbols.structures.find(s => s.name.toLowerCase() === structName.toLowerCase());
            if (globalStructure) {
                const member = globalStructure.members.find(m => m.name.toLowerCase() === memberName.toLowerCase());
                if (member) {
                    // 找到了全局结构体的成员
                    for (const [filePath, fileSymbols] of this.workspaceManager['fileSymbols'].entries()) {
                        const fileStruct = fileSymbols.structures.find(s => s.name.toLowerCase() === structName.toLowerCase());
                        if (fileStruct) {
                            const fileMember = fileStruct.members.find(m => m.name.toLowerCase() === memberName.toLowerCase());
                            if (fileMember) {
                                return new vscode.Location(vscode.Uri.file(filePath), fileMember.range);
                            }
                        }
                    }
                }
            }
        }
        
        // 在所有文件中查找全局符号
        
        // 检查全局变量
        const globalVariable = mergedSymbols.variables.find(v => v.name.toLowerCase() === word.toLowerCase() && v.scope === 'global');
        if (globalVariable) {
            // 如果是当前文件中的全局变量，直接返回
            const currentFileGlobalVar = currentFileSymbols.variables.find(
                v => v.name.toLowerCase() === word.toLowerCase() && v.scope === 'global'
            );
            if (currentFileGlobalVar) {
                return new vscode.Location(document.uri, currentFileGlobalVar.range);
            }
            
            // 否则，在其他文件中查找
            for (const [filePath, fileSymbols] of this.workspaceManager['fileSymbols'].entries()) {
                const fileVar = fileSymbols.variables.find(
                    v => v.name.toLowerCase() === word.toLowerCase() && v.scope === 'global'
                );
                if (fileVar) {
                    return new vscode.Location(vscode.Uri.file(filePath), fileVar.range);
                }
            }
        }
        
        // 检查全局Sub
        const globalSub = mergedSymbols.subs.find(s => s.name.toLowerCase() === word.toLowerCase() && s.isGlobal);
        if (globalSub) {
            // 如果是当前文件中的全局Sub，直接返回
            const currentFileGlobalSub = currentFileSymbols.subs.find(
                s => s.name.toLowerCase() === word.toLowerCase() && s.isGlobal
            );
            if (currentFileGlobalSub) {
                return new vscode.Location(document.uri, currentFileGlobalSub.range);
            }
            
            // 否则，在其他文件中查找
            for (const [filePath, fileSymbols] of this.workspaceManager['fileSymbols'].entries()) {
                const fileSub = fileSymbols.subs.find(
                    s => s.name.toLowerCase() === word.toLowerCase() && s.isGlobal
                );
                if (fileSub) {
                    return new vscode.Location(vscode.Uri.file(filePath), fileSub.range);
                }
            }
        }
        
        // 检查C函数
        const globalCFunc = mergedSymbols.cFunctions.find(cf => cf.name.toLowerCase() === word.toLowerCase());
        if (globalCFunc) {
            // 如果是当前文件中的C函数，直接返回
            const currentFileCFunc = currentFileSymbols.cFunctions.find(
                cf => cf.name.toLowerCase() === word.toLowerCase()
            );
            if (currentFileCFunc) {
                return new vscode.Location(document.uri, currentFileCFunc.range);
            }
            
            // 否则，在其他文件中查找
            for (const [filePath, fileSymbols] of this.workspaceManager['fileSymbols'].entries()) {
                const fileCFunc = fileSymbols.cFunctions.find(
                    cf => cf.name.toLowerCase() === word.toLowerCase()
                );
                if (fileCFunc) {
                    return new vscode.Location(vscode.Uri.file(filePath), fileCFunc.range);
                }
            }
        }

        return null;
    }

    /**
     * 递归查找多级结构体成员的定义
     * @param document 当前文档
     * @param parts 结构体成员路径（例如：['rect', 'topLeft', 'x']）
     * @param currentFileSymbols 当前文件的符号
     * @param mergedSymbols 合并的全局符号
     * @returns 成员定义的位置
     */
    private findStructMemberDefinition(
        document: vscode.TextDocument,
        parts: string[],
        currentFileSymbols: any,
        mergedSymbols: any
    ): vscode.Location | null {
        if (parts.length < 2) {
            return null;
        }

        // 第一部分是结构体变量名
        const rootStructName = parts[0];
        
        // 查找结构体定义
        let currentStructName = '';
        let currentStructure = null;
        let memberSourceFile = document.uri.fsPath;
        
        // 首先尝试在当前文件中查找变量定义
        const variable = currentFileSymbols.variables.find(
            (v: any) => v.name.toLowerCase() === rootStructName.toLowerCase()
        );
        
        if (variable && variable.structType){
            // 变量的类型是结构体名称
            currentStructName = variable.structType;
            
            // 在当前文件中查找结构体
            currentStructure = currentFileSymbols.structures.find(
                (s: any) => s.name.toLowerCase() === currentStructName.toLowerCase()
            );
            
            // 如果当前文件中没有找到，则在全局符号中查找
            if (!currentStructure) {
                currentStructure = mergedSymbols.structures.find(
                    (s: any) => s.name.toLowerCase() === currentStructName.toLowerCase()
                );
                
                // 找到结构体定义所在的文件
                if (currentStructure) {
                    for (const [filePath, fileSymbols] of this.workspaceManager['fileSymbols'].entries()) {
                        const fileStruct = fileSymbols.structures.find(
                            (s: any) => s.name.toLowerCase() === currentStructName.toLowerCase()
                        );
                        if (fileStruct) {
                            memberSourceFile = filePath;
                            currentStructure = fileStruct;
                            break;
                        }
                    }
                }
            }
        } else {
            // 如果没有找到变量，则假设第一部分直接是结构体名称
            currentStructName = rootStructName;
            
            // 在当前文件中查找结构体
            currentStructure = currentFileSymbols.structures.find(
                (s: any) => s.name.toLowerCase() === currentStructName.toLowerCase()
            );
            
            // 如果当前文件中没有找到，则在全局符号中查找
            if (!currentStructure) {
                currentStructure = mergedSymbols.structures.find(
                    (s: any) => s.name.toLowerCase() === currentStructName.toLowerCase()
                );
                
                // 找到结构体定义所在的文件
                if (currentStructure) {
                    for (const [filePath, fileSymbols] of this.workspaceManager['fileSymbols'].entries()) {
                        const fileStruct = fileSymbols.structures.find(
                            (s: any) => s.name.toLowerCase() === currentStructName.toLowerCase()
                        );
                        if (fileStruct) {
                            memberSourceFile = filePath;
                            currentStructure = fileStruct;
                            break;
                        }
                    }
                }
            }
        }
        
        if (!currentStructure) {
            return null;
        }
        
        // 从第二部分开始，逐级查找成员
        for (let i = 1; i < parts.length; i++) {
            const memberName = parts[i];
            const member = currentStructure.members.find(
                (m: any) => m.name.toLowerCase() === memberName.toLowerCase()
            );
            
            if (!member) {
                return null;
            }
            
            // 如果是最后一个成员，返回其定义位置
            if (i === parts.length - 1) {
                return new vscode.Location(vscode.Uri.file(memberSourceFile), member.range);
            }
            
            // 如果不是最后一个成员，则继续查找下一级结构体
            if (member.structType) {
                currentStructName = member.structType;
                
                // 在当前文件中查找结构体
                let nextStructure = currentFileSymbols.structures.find(
                    (s: any) => s.name.toLowerCase() === currentStructName.toLowerCase()
                );
                
                // 如果当前文件中没有找到，则在全局符号中查找
                if (!nextStructure) {
                    nextStructure = mergedSymbols.structures.find(
                        (s: any) => s.name.toLowerCase() === currentStructName.toLowerCase()
                    );
                    
                    // 找到结构体定义所在的文件
                    if (nextStructure) {
                        for (const [filePath, fileSymbols] of this.workspaceManager['fileSymbols'].entries()) {
                            const fileStruct = fileSymbols.structures.find(
                                (s: any) => s.name.toLowerCase() === currentStructName.toLowerCase()
                            );
                            if (fileStruct) {
                                memberSourceFile = filePath;
                                nextStructure = fileStruct;
                                break;
                            }
                        }
                    }
                }
                
                if (!nextStructure) {
                    return null;
                }
                
                currentStructure = nextStructure;
            } else {
                // 如果成员不是结构体类型，则无法继续查找
                return null;
            }
        }
        
        return null;
    }
}