import * as vscode from 'vscode';
import { RtBasicParser, RtBasicBuiltinFunctions } from './rtbasicParser';
import { RtBasicDefinitionProvider } from './rtbasicDefinitionProvider';
import { RtBasicCompletionProvider, RtBasicSignatureHelpProvider } from './rtbasicCompletionProvider';
import { RtBasicHoverProvider } from './rtbasicHoverProvider';
import { RtBasicDocumentFormatter } from './rtbasicFormatter';
import { RtBasicDiagnosticProvider } from './rtbasicDiagnosticProvider';
import { RtBasicWorkspaceManager } from './rtbasicWorkspaceManager';
import builtinFunctions from './builtinFunctions.json';

// 将导入的JSON类型断言为RtBasicBuiltinFunctions
const typedBuiltinFunctions = builtinFunctions as RtBasicBuiltinFunctions;

export function activate(context: vscode.ExtensionContext) {
    // 创建解析器实例
    const parser = new RtBasicParser();
    
    // 创建工作区管理器
    const workspaceManager = new RtBasicWorkspaceManager(parser);
    
    // 注册内置函数虚拟文档提供程序
    const builtinFuncScheme = 'rtbasic-builtin';
    context.subscriptions.push(
        vscode.workspace.registerTextDocumentContentProvider(builtinFuncScheme, {
            provideTextDocumentContent(uri: vscode.Uri): string {
                const funcName = uri.path.split('/').pop();
                const builtinFunc = typedBuiltinFunctions.functions.find(f => f.name === funcName);
                
                if (!builtinFunc) {
                    return '找不到内置函数的文档';
                }
                
                let content = `# ${builtinFunc.name}\n\n`;
                content += `${builtinFunc.description}\n\n`;
                
                content += '## 语法\n\n```rtbasic\n';
                content += `${builtinFunc.name}(${builtinFunc.parameters.map(p => 
                    `${p.name}${p.optional ? '?' : ''}`
                ).join(', ')})\n`;
                content += '```\n\n';
                
                if (builtinFunc.parameters.length > 0) {
                    content += '## 参数\n\n';
                    builtinFunc.parameters.forEach(param => {
                        content += `### ${param.name}${param.optional ? ' (可选)' : ''}\n\n`;
                        if (param.type) {
                            content += `类型: ${param.type}\n\n`;
                        }

                        if (param.description) {
                            content += `${param.description}\n\n`;
                        }
                    });
                }
                
                if (builtinFunc.returnType) {
                    content += '## 返回值\n\n';
                    content += `类型: ${builtinFunc.returnType}\n\n`;
                }
                
                if (builtinFunc.example) {
                    content += '## 示例\n\n```rtbasic\n';
                    content += `${builtinFunc.example}\n`;
                    content += '```\n';
                }
                
                return content;
            }
        })
    );
    
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
            '.', '(', ' ', '['
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

    // 事件处理
    let timeout: NodeJS.Timeout | undefined;
    const handleDocumentChange = (document: vscode.TextDocument) => {
        if (document.languageId !== 'rtbasic') return;
        
        clearTimeout(timeout);
        timeout = setTimeout(() => {
            parser.parse(document);
            workspaceManager.parseFile(document.uri);
        }, 500);
    };

    const handleFileEvent = (e: vscode.FileCreateEvent | vscode.FileDeleteEvent, isDelete = false) => {
        e.files.filter(file => file.fsPath.endsWith('.bas'))
            .forEach(file => isDelete 
                ? workspaceManager.removeFile(file) 
                : workspaceManager.parseFile(file));
    };

    context.subscriptions.push(
        vscode.workspace.onDidChangeTextDocument(e => handleDocumentChange(e.document)),
        vscode.workspace.onDidCreateFiles(e => handleFileEvent(e)),
        vscode.workspace.onDidDeleteFiles(e => handleFileEvent(e, true))
    );

    // 初始化当前打开的文档
    if (vscode.window.activeTextEditor) {
        handleDocumentChange(vscode.window.activeTextEditor.document);
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