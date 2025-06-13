import * as vscode from 'vscode';
import { RtBasicParser } from './rtbasicParser';
import { RtBasicDefinitionProvider } from './rtbasicDefinitionProvider';
import { RtBasicCompletionProvider, RtBasicSignatureHelpProvider } from './rtbasicCompletionProvider';
import { RtBasicHoverProvider } from './rtbasicHoverProvider';
import { RtBasicDocumentFormatter } from './rtbasicFormatter';
import { RtBasicDiagnosticProvider } from './rtbasicDiagnosticProvider';
import { RtBasicWorkspaceManager } from './rtbasicWorkspaceManager';

export function activate(context: vscode.ExtensionContext) {
    // 创建解析器实例
    const parser = new RtBasicParser();
    
    // 创建工作区管理器
    const workspaceManager = new RtBasicWorkspaceManager(parser);
    
    // 注册语言功能提供者
    const selector = { language: 'rtbasic', scheme: 'file' };

    // 定义跳转提供者
    context.subscriptions.push(
        vscode.languages.registerDefinitionProvider(
            selector,
            new RtBasicDefinitionProvider(parser, workspaceManager)
        )
    );

    // 代码补全提供者
    context.subscriptions.push(
        vscode.languages.registerCompletionItemProvider(
            selector,
            new RtBasicCompletionProvider(parser, workspaceManager),
            '.', '(' // 触发字符
        )
    );

    // 函数签名帮助提供者
    context.subscriptions.push(
        vscode.languages.registerSignatureHelpProvider(
            selector,
            new RtBasicSignatureHelpProvider(parser, workspaceManager),
            '(', ',' // 触发字符
        )
    );

    // 悬停提示提供者
    context.subscriptions.push(
        vscode.languages.registerHoverProvider(
            selector,
            new RtBasicHoverProvider(parser, workspaceManager)
        )
    );

    // 文档符号提供者（用于大纲视图和转到符号功能）
    context.subscriptions.push(
        vscode.languages.registerDocumentSymbolProvider(
            selector,
            {
                provideDocumentSymbols(document: vscode.TextDocument): vscode.ProviderResult<vscode.SymbolInformation[] | vscode.DocumentSymbol[]> {
                    const symbols = parser.parse(document);
                    const result: vscode.SymbolInformation[] = [];

                    // 添加全局变量
                    symbols.variables
                        .filter(v => v.scope === 'global')
                        .forEach(v => {
                            result.push(new vscode.SymbolInformation(
                                v.name,
                                vscode.SymbolKind.Variable,
                                'Global Variables',
                                new vscode.Location(document.uri, v.range)
                            ));
                        });

                    // 添加文件变量
                    symbols.variables
                        .filter(v => v.scope === 'file')
                        .forEach(v => {
                            result.push(new vscode.SymbolInformation(
                                v.name,
                                vscode.SymbolKind.Variable,
                                'File Variables',
                                new vscode.Location(document.uri, v.range)
                            ));
                        });

                    // 添加Sub
                    symbols.subs.forEach(s => {
                        result.push(new vscode.SymbolInformation(
                            s.name,
                            vscode.SymbolKind.Function,
                            s.isGlobal ? 'Global Subs' : 'Subs',
                            new vscode.Location(document.uri, s.range)
                        ));

                        // 添加局部变量
                        symbols.variables
                            .filter(v => v.scope === 'local' && v.parentSub === s.name)
                            .forEach(v => {
                                let varName = v.name;
                                if (v.isArray) {
                                    varName += `(${v.arraySize})`;
                                }
                                result.push(new vscode.SymbolInformation(
                                    varName,
                                    vscode.SymbolKind.Variable,
                                    `Local Variables (${s.name})`,
                                    new vscode.Location(document.uri, v.range)
                                ));
                            });
                    });

                    // 添加结构体
                    symbols.structures.forEach(s => {
                        result.push(new vscode.SymbolInformation(
                            s.name,
                            vscode.SymbolKind.Struct,
                            'Structures',
                            new vscode.Location(document.uri, s.range)
                        ));

                        // 添加结构体成员
                        s.members.forEach(m => {
                            result.push(new vscode.SymbolInformation(
                                m.name,
                                vscode.SymbolKind.Field,
                                `Structure ${s.name}`,
                                new vscode.Location(document.uri, m.range)
                            ));
                        });
                    });

                    return result;
                }
            }
        )
    );

    // 监听文档变化事件，以更新解析结果
    let timeout: NodeJS.Timeout | undefined = undefined;
    const documentChangeHandler = async (document: vscode.TextDocument) => {
        if (document.languageId !== 'rtbasic') {
            return;
        }

        if (timeout) {
            clearTimeout(timeout);
            timeout = undefined;
        }

        timeout = setTimeout(async () => {
            parser.parse(document);
            // 更新工作区管理器中的文件符号
            await workspaceManager.parseFile(document.uri);
        }, 500);
    };

    context.subscriptions.push(
        vscode.workspace.onDidChangeTextDocument(e => documentChangeHandler(e.document))
    );

    // 监听文件创建和删除事件
    context.subscriptions.push(
        vscode.workspace.onDidCreateFiles(async (e) => {
            for (const file of e.files) {
                if (file.fsPath.endsWith('.bas')) {
                    await workspaceManager.parseFile(file);
                }
            }
        })
    );

    context.subscriptions.push(
        vscode.workspace.onDidDeleteFiles((e) => {
            for (const file of e.files) {
                if (file.fsPath.endsWith('.bas')) {
                    workspaceManager.removeFile(file);
                }
            }
        })
    );

    // 初始化当前打开的文档
    if (vscode.window.activeTextEditor) {
        documentChangeHandler(vscode.window.activeTextEditor.document);
    }

    // 初始扫描工作区
    workspaceManager.scanWorkspace().then(() => {
        vscode.window.showInformationMessage('RTBasic 工作区扫描完成');
    });

    // 注册命令
    context.subscriptions.push(
        vscode.commands.registerCommand('rtbasic.reloadSymbols', async () => {
            if (vscode.window.activeTextEditor) {
                parser.parse(vscode.window.activeTextEditor.document);
                await workspaceManager.parseFile(vscode.window.activeTextEditor.document.uri);
                vscode.window.showInformationMessage('RTBasic 符号已重新加载');
            }
        })
    );

    // 注册扫描工作区命令
    context.subscriptions.push(
        vscode.commands.registerCommand('rtbasic.scanWorkspace', async () => {
            await workspaceManager.scanWorkspace();
            vscode.window.showInformationMessage('RTBasic 工作区扫描完成');
        })
    );

    // 注册格式化文档命令
    context.subscriptions.push(
        vscode.commands.registerCommand('rtbasic.formatDocument', () => {
            const editor = vscode.window.activeTextEditor;
            if (editor && editor.document.languageId === 'rtbasic') {
                vscode.commands.executeCommand('editor.action.formatDocument');
            }
        })
    );

    // 注册文档格式化提供者
    context.subscriptions.push(
        vscode.languages.registerDocumentFormattingEditProvider(
            { language: 'rtbasic', scheme: 'file' },
            new RtBasicDocumentFormatter(parser)
        )
    );

    // 注册诊断提供程序
    new RtBasicDiagnosticProvider(context, workspaceManager);
}

export function deactivate() {
    // 清理资源
}