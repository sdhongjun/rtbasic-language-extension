import * as vscode from 'vscode';
import { RtBasicParser } from './rtbasicParser';
import { RtBasicWorkspaceManager } from './rtbasicWorkspaceManager';

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
        
        // 获取当前文件的符号和合并的全局符号
        const currentFileSymbols = this.parser.parse(document);
        const mergedSymbols = this.workspaceManager.getMergedSymbolsForFile(document.uri);
        
        // 首先在当前文件中查找局部符号
        
        // 检查局部变量
        const localVariable = currentFileSymbols.variables.find(v => v.name === word && v.scope === 'local');
        if (localVariable) {
            return new vscode.Location(document.uri, localVariable.range);
        }
        
        // 检查文件变量
        const fileVariable = currentFileSymbols.variables.find(v => v.name === word && v.scope === 'file');
        if (fileVariable) {
            return new vscode.Location(document.uri, fileVariable.range);
        }
        
        // 检查当前文件中的非全局Sub
        const localSub = currentFileSymbols.subs.find(s => s.name === word && !s.isGlobal);
        if (localSub) {
            return new vscode.Location(document.uri, localSub.range);
        }
        
        // 检查当前文件中的结构体
        const localStruct = currentFileSymbols.structures.find(s => s.name === word);
        if (localStruct) {
            return new vscode.Location(document.uri, localStruct.range);
        }
        
        // 检查结构体成员
        const lineText = document.lineAt(position.line).text;
        const beforeCursor = lineText.substring(0, position.character);
        const dotMatch = beforeCursor.match(/(\w+)\.(\w*)$/);
        
        if (dotMatch) {
            const structName = dotMatch[1];
            const memberName = word;
            
            // 先在当前文件中查找结构体
            const structure = currentFileSymbols.structures.find(s => s.name === structName);
            if (structure) {
                const member = structure.members.find(m => m.name === memberName);
                if (member) {
                    return new vscode.Location(document.uri, member.range);
                }
            }
            
            // 如果当前文件中没有找到，则在全局符号中查找
            const globalStructure = mergedSymbols.structures.find(s => s.name === structName);
            if (globalStructure) {
                const member = globalStructure.members.find(m => m.name === memberName);
                if (member) {
                    // 找到了全局结构体的成员
                    for (const [filePath, fileSymbols] of this.workspaceManager['fileSymbols'].entries()) {
                        const fileStruct = fileSymbols.structures.find(s => s.name === structName);
                        if (fileStruct) {
                            const fileMember = fileStruct.members.find(m => m.name === memberName);
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
        const globalVariable = mergedSymbols.variables.find(v => v.name === word && v.scope === 'global');
        if (globalVariable) {
            // 如果是当前文件中的全局变量，直接返回
            const currentFileGlobalVar = currentFileSymbols.variables.find(
                v => v.name === word && v.scope === 'global'
            );
            if (currentFileGlobalVar) {
                return new vscode.Location(document.uri, currentFileGlobalVar.range);
            }
            
            // 否则，在其他文件中查找
            for (const [filePath, fileSymbols] of this.workspaceManager['fileSymbols'].entries()) {
                const fileVar = fileSymbols.variables.find(
                    v => v.name === word && v.scope === 'global'
                );
                if (fileVar) {
                    return new vscode.Location(vscode.Uri.file(filePath), fileVar.range);
                }
            }
        }
        
        // 检查全局Sub
        const globalSub = mergedSymbols.subs.find(s => s.name === word && s.isGlobal);
        if (globalSub) {
            // 如果是当前文件中的全局Sub，直接返回
            const currentFileGlobalSub = currentFileSymbols.subs.find(
                s => s.name === word && s.isGlobal
            );
            if (currentFileGlobalSub) {
                return new vscode.Location(document.uri, currentFileGlobalSub.range);
            }
            
            // 否则，在其他文件中查找
            for (const [filePath, fileSymbols] of this.workspaceManager['fileSymbols'].entries()) {
                const fileSub = fileSymbols.subs.find(
                    s => s.name === word && s.isGlobal
                );
                if (fileSub) {
                    return new vscode.Location(vscode.Uri.file(filePath), fileSub.range);
                }
            }
        }

        return null;
    }
}