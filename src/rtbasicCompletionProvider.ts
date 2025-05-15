import * as vscode from 'vscode';
import { RtBasicParser, RtBasicStructure, RtBasicSub, RtBasicVariable } from './rtbasicParser';

export class RtBasicCompletionProvider implements vscode.CompletionItemProvider {
    private parser: RtBasicParser;

    constructor(parser: RtBasicParser) {
        this.parser = parser;
    }

    public provideCompletionItems(
        document: vscode.TextDocument,
        position: vscode.Position,
        token: vscode.CancellationToken,
        context: vscode.CompletionContext
    ): vscode.ProviderResult<vscode.CompletionItem[] | vscode.CompletionList> {
        const lineText = document.lineAt(position.line).text;
        const beforeCursor = lineText.substring(0, position.character);

        // 解析当前文档以获取所有符号
        const symbols = this.parser.parse(document);

        // 检查是否在结构体成员访问
        const dotMatch = beforeCursor.match(/(\w+)\.\w*$/);
        if (dotMatch) {
            return this.provideStructureMemberCompletions(dotMatch[1], symbols.structures);
        }

        // 检查是否在Sub参数输入
        const subMatch = beforeCursor.match(/(\w+)\s*\(([^)]*)?$/);
        if (subMatch) {
            return this.provideSubParameterCompletions(subMatch[1], symbols.subs);
        }

        // 提供所有可用符号的补全
        return this.provideSymbolCompletions(symbols);
    }

    private provideStructureMemberCompletions(
        structName: string,
        structures: RtBasicStructure[]
    ): vscode.CompletionItem[] {
        const structure = structures.find(s => s.name === structName);
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
        const sub = subs.find(s => s.name === subName);
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

    private provideSymbolCompletions(symbols: any): vscode.CompletionItem[] {
        const completions: vscode.CompletionItem[] = [];

        // 添加变量补全
        symbols.variables.forEach((variable: RtBasicVariable) => {
            const item = new vscode.CompletionItem(variable.name, vscode.CompletionItemKind.Variable);
            item.detail = `(${variable.scope})`;
            if (variable.isArray) {
                item.detail += `(${variable.arraySize})`;
            }
            if (variable.structType) {
                item.detail += ` As ${variable.structType}`;
            }
            
            const docs = new vscode.MarkdownString();
            if (variable.isArray) {
                docs.appendText(`Array size: ${variable.arraySize}\n`);
            }
            docs.appendText(`Scope: ${variable.scope}`);
            if (variable.parentSub) {
                docs.appendText(`\nDefined in: ${variable.parentSub}`);
            }
            item.documentation = docs;
            completions.push(item);
        });

        // 添加Sub补全
        symbols.subs.forEach((sub: RtBasicSub) => {
            const item = new vscode.CompletionItem(sub.name, vscode.CompletionItemKind.Function);
            const params = sub.parameters.map((p: any) => {
                let paramStr = p.name;
                if (p.isArray) {
                    paramStr += `(${p.arraySize})`;
                }
                return paramStr;
            }).join(', ');
            
            item.detail = `(${sub.isGlobal ? 'global' : 'file'} sub)`;
            item.documentation = new vscode.MarkdownString()
                .appendCodeblock(`${sub.isGlobal ? 'Global ' : ''}Sub ${sub.name}(${params})`, 'rtbasic');
            
            // 添加Sub签名信息
            item.insertText = new vscode.SnippetString(`${sub.name}($1)`);
            item.command = {
                command: 'editor.action.triggerParameterHints',
                title: 'Trigger parameter hints'
            };
            
            completions.push(item);
        });

        // 添加结构体补全
        symbols.structures.forEach((struct: RtBasicStructure) => {
            const item = new vscode.CompletionItem(struct.name, vscode.CompletionItemKind.Struct);
            item.detail = `(global structure) ${struct.name}`;
            
            const membersDoc = struct.members.map((m: any) =>
                `    Dim ${m.name} As ${m.type}`
            ).join('\n');
            
            item.documentation = new vscode.MarkdownString()
                .appendCodeblock(`Global Structure ${struct.name}\n${membersDoc}\nEnd Structure`, 'rtbasic');
            
            completions.push(item);
        });

        return completions;
    }
}

export class RtBasicSignatureHelpProvider implements vscode.SignatureHelpProvider {
    private parser: RtBasicParser;

    constructor(parser: RtBasicParser) {
        this.parser = parser;
    }

    public provideSignatureHelp(
        document: vscode.TextDocument,
        position: vscode.Position,
        token: vscode.CancellationToken,
        context: vscode.SignatureHelpContext
    ): vscode.ProviderResult<vscode.SignatureHelp> {
        const symbols = this.parser.parse(document);
        const lineText = document.lineAt(position.line).text;
        const beforeCursor = lineText.substring(0, position.character);
        
        // 查找正在调用的Sub
        const subMatch = beforeCursor.match(/(\w+)\s*\(([^)]*)?$/);
        if (!subMatch) {
            return null;
        }

        const subName = subMatch[1];
        const sub = symbols.subs.find(s => s.name === subName);
        if (!sub) {
            return null;
        }

        const signatureHelp = new vscode.SignatureHelp();
        
        // 构建参数字符串
        const paramStrings = sub.parameters.map(p => {
            let paramStr = p.name;
            if (p.isArray) {
                paramStr += `(${p.arraySize})`;
            }
            return paramStr;
        });
        
        const signature = new vscode.SignatureInformation(
            `${sub.name}(${paramStrings.join(', ')})`,
            `${sub.isGlobal ? 'Global ' : ''}Sub ${sub.name}`
        );

        // 为每个参数添加参数信息
        signature.parameters = sub.parameters.map(param => {
            let paramLabel = param.name;
            if (param.isArray) {
                paramLabel += `(${param.arraySize})`;
            }
            
            let paramDoc = `Parameter ${param.name}`;
            if (param.isArray) {
                paramDoc += `, array with size ${param.arraySize}`;
            }
            
            return new vscode.ParameterInformation(paramLabel, paramDoc);
        });

        signatureHelp.signatures = [signature];
        signatureHelp.activeSignature = 0;
        
        // 计算当前参数位置
        const commaCount = (subMatch[2] || '').split(',').length - 1;
        signatureHelp.activeParameter = Math.min(commaCount, sub.parameters.length - 1);

        return signatureHelp;
    }
}