import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { RtBasicParser, RtBasicSymbol } from './rtbasicParser';

/**
 * 管理工作区中的所有 RTBasic 文件
 */
export class RtBasicWorkspaceManager {
    private parser: RtBasicParser;
    private fileSymbols: Map<string, RtBasicSymbol> = new Map();
    private _onSymbolsChanged: vscode.EventEmitter<void> = new vscode.EventEmitter<void>();
    
    /**
     * 当符号表更新时触发的事件
     */
    public readonly onSymbolsChanged: vscode.Event<void> = this._onSymbolsChanged.event;

    constructor(parser: RtBasicParser) {
        this.parser = parser;
    }

    /**
     * 扫描工作区中的所有 .bas 文件并解析它们
     */
    public async scanWorkspace(): Promise<void> {
        if (!vscode.workspace.workspaceFolders || vscode.workspace.workspaceFolders.length === 0) {
            return;
        }

        // 清除现有的符号表
        this.fileSymbols.clear();

        // 获取工作区中的所有 .bas 文件
        const basFiles = await this.findBasFiles();
        
        // 解析每个文件
        for (const file of basFiles) {
            await this.parseFile(file);
        }

        // 触发符号更新事件
        this._onSymbolsChanged.fire();
    }

    /**
     * 查找工作区中的所有 .bas 文件
     */
    private async findBasFiles(): Promise<vscode.Uri[]> {
        const basFiles: vscode.Uri[] = [];
        
        for (const folder of vscode.workspace.workspaceFolders!) {
            const pattern = new vscode.RelativePattern(folder, '**/*.bas');
            const files = await vscode.workspace.findFiles(
                pattern, 
                '{**/node_modules/**,**/bower_components/**,**/dist/**,**/out/**,**/build/**}',
                1000
            );
            basFiles.push(...files);
        }
        
        return basFiles;
    }

    /**
     * 解析单个文件
     */
    public async parseFile(uri: vscode.Uri): Promise<void> {
        try {
            const document = await vscode.workspace.openTextDocument(uri);
            const symbols = this.parser.parse(document);
            this.fileSymbols.set(uri.fsPath, symbols);
        } catch (error) {
            console.error(`Error parsing file ${uri.fsPath}:`, error);
        }
    }

    /**
     * 删除文件的符号
     */
    public removeFile(uri: vscode.Uri): void {
        this.fileSymbols.delete(uri.fsPath);
        this._onSymbolsChanged.fire();
    }

    /**
     * 获取所有文件的合并符号表
     */
    public getAllSymbols(): RtBasicSymbol {
        const mergedSymbols: RtBasicSymbol = {
            variables: [],
            subs: [],
            structures: [],
            controlBlocks: [],
            cFunctions: []
        };

        // 合并所有文件的符号
        for (const symbols of this.fileSymbols.values()) {
            // 只合并全局符号（Global 作用域）
            mergedSymbols.variables.push(...symbols.variables.filter(v => v.scope === 'global'));
            mergedSymbols.subs.push(...symbols.subs.filter(s => s.isGlobal));
            mergedSymbols.structures.push(...symbols.structures.filter(s => s.isGlobal));
            // 合并C函数
            if (symbols.cFunctions) {
                mergedSymbols.cFunctions.push(...symbols.cFunctions);
            }
        }

        return mergedSymbols;
    }

    /**
     * 获取特定文件的符号表
     */
    public getFileSymbols(uri: vscode.Uri): RtBasicSymbol | undefined {
        return this.fileSymbols.get(uri.fsPath);
    }

    /**
     * 获取合并了全局符号和特定文件符号的符号表
     */
    /**
     * 获取所有文件的符号表
     */
    public getAllFileSymbols(): { [key: string]: RtBasicSymbol } {
        const result: { [key: string]: RtBasicSymbol } = {};
        for (const [filePath, symbols] of this.fileSymbols) {
            result[filePath] = symbols;
        }
        return result;
    }

    public getMergedSymbolsForFile(uri: vscode.Uri): RtBasicSymbol {
        const fileSymbols = this.getFileSymbols(uri);
        const globalSymbols = this.getAllSymbols();
        
        if (!fileSymbols) {
            return globalSymbols;
        }

        // 创建一个新的符号表，包含文件的所有符号和其他文件的全局符号
        const mergedSymbols: RtBasicSymbol = {
            variables: [...fileSymbols.variables],
            subs: [...fileSymbols.subs],
            structures: [...fileSymbols.structures],
            controlBlocks: [...fileSymbols.controlBlocks],
            cFunctions: [...(fileSymbols.cFunctions || [])]
        };

        // 添加其他文件的全局符号（避免重复）
        for (const variable of globalSymbols.variables) {
            if (!mergedSymbols.variables.some(v => v.name.toLowerCase() === variable.name.toLowerCase() && v.scope === 'global')) {
                mergedSymbols.variables.push(variable);
            }
        }

        for (const sub of globalSymbols.subs) {
            if (!mergedSymbols.subs.some(s => s.name.toLowerCase() === sub.name.toLowerCase() && s.isGlobal)) {
                mergedSymbols.subs.push(sub);
            }
        }

        for (const structure of globalSymbols.structures) {
            if (structure.isGlobal && !mergedSymbols.structures.some(s => s.name.toLowerCase() === structure.name.toLowerCase())) {
                mergedSymbols.structures.push(structure);
            }
        }

        // 添加其他文件的C函数（避免重复）
        if (globalSymbols.cFunctions) {
            for (const cFunction of globalSymbols.cFunctions) {
                if (!mergedSymbols.cFunctions.some(f => f.name.toLowerCase() === cFunction.name.toLowerCase())) {
                    mergedSymbols.cFunctions.push(cFunction);
                }
            }
        }

        return mergedSymbols;
    }

    public makeStructAccessRegex(suffix: string) : RegExp {
        // 匹配
        // 数组访问: gVar(10).suffix
        // ZINDEX_STRUCT访问: ZINDEX_STRUCT(type, address).suffix
        // 多级数组访问: Type.strucMem.strucMem.suffix
        return new RegExp(`((([a-z0-9_]+\\.)*[a-z0-9_]+|([a-z0-9_]+)\\(\\s*[a-z0-9_]+\\s*\\)|ZINDEX_STRUCT\\(([a-z0-9_]+),.*\\))\\.${suffix}$)`, 'ig');
    }

    /**
     * 递归查找多级结构体成员的定义
     * @param document 当前文档
     * @param mixedStructParts 结构体成员路径（例如：['rect', 'topLeft', 'x']）
     * @param currentFileSymbols 当前文件的符号
     * @param mergedSymbols 合并的全局符号
     * @returns 成员定义的位置
     */
    public findStructMemberDefinition(
        document: vscode.TextDocument,
        mixedStructParts: string,
        currentFileSymbols: any,
        mergedSymbols: any
    ): vscode.Location | null {
        const zindexReg = /ZINDEX_STRUCT\(([a-zA-Z0-9_]+),.*\)\.([a-zA-Z0-9_]+)/i;
        let zIndexMatch = mixedStructParts.match(zindexReg);
        // 查找结构体定义
        let currentStructName = '';
        let currentStructure = null;
        let memberSourceFile = document.uri.fsPath;
        let parts: string[] = [];

        if (zIndexMatch) {
            // 如果没有找到变量，则假设第一部分直接是结构体名称
            currentStructName = zIndexMatch[1];
            parts = [zIndexMatch[1], zIndexMatch[2]];

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
                    for (const [filePath, fileSymbols] of this['fileSymbols'].entries()) {
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
            const arrayAccessReg = /([a-z0-9_]+)\(.*\)\.([a-z0-9_]+)/i;
            let arrayMatch = mixedStructParts.match(arrayAccessReg);
            if (arrayMatch) {
                parts = [arrayMatch[1], arrayMatch[2]];
            } else {
                parts = mixedStructParts.split('.');
            }

            const varName = parts[0];
            // 首先尝试在当前文件中查找变量定义
            const variable = currentFileSymbols.variables.find(
                (v: any) => v.name.toLowerCase() === varName.toLowerCase()
            ) || mergedSymbols.variables.find(
                (v: any) => v.name.toLowerCase() === varName.toLowerCase()
            );

            if (variable && variable.structType) {
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
                        for (const [filePath, fileSymbols] of this['fileSymbols'].entries()) {
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
                        for (const [filePath, fileSymbols] of this['fileSymbols'].entries()) {
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