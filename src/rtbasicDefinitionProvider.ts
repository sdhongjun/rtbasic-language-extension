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

        // 检查结构体成员
        const lineText = document.lineAt(position.line).text;
        const structAccessReg = this.workspaceManager.makeStructAccessRegex(word);
        const beforeCursor = lineText.substring(0, wordRange.start.character + word.length);
        const structMatch = beforeCursor.match(structAccessReg);
        if (structMatch) {
            return this.workspaceManager.findStructMemberDefinition(document, structMatch[0], currentFileSymbols, mergedSymbols);
        }

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
}