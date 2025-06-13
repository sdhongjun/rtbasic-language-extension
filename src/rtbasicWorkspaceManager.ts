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
            controlBlocks: []
        };

        // 合并所有文件的符号
        for (const symbols of this.fileSymbols.values()) {
            // 只合并全局符号（Global 作用域）
            mergedSymbols.variables.push(...symbols.variables.filter(v => v.scope === 'global'));
            mergedSymbols.subs.push(...symbols.subs.filter(s => s.isGlobal));
            mergedSymbols.structures.push(...symbols.structures);
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
            controlBlocks: [...fileSymbols.controlBlocks]
        };

        // 添加其他文件的全局符号（避免重复）
        for (const variable of globalSymbols.variables) {
            if (!mergedSymbols.variables.some(v => v.name === variable.name && v.scope === 'global')) {
                mergedSymbols.variables.push(variable);
            }
        }

        for (const sub of globalSymbols.subs) {
            if (!mergedSymbols.subs.some(s => s.name === sub.name && s.isGlobal)) {
                mergedSymbols.subs.push(sub);
            }
        }

        for (const structure of globalSymbols.structures) {
            if (!mergedSymbols.structures.some(s => s.name === structure.name)) {
                mergedSymbols.structures.push(structure);
            }
        }

        return mergedSymbols;
    }
}