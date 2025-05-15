import * as vscode from 'vscode';
import { RtBasicParser } from './rtbasicParser';

export class RtBasicDefinitionProvider implements vscode.DefinitionProvider {
    private parser: RtBasicParser;

    constructor(parser: RtBasicParser) {
        this.parser = parser;
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
        const symbols = this.parser.parse(document);

        // 检查变量
        const variable = symbols.variables.find(v => v.name === word);
        if (variable) {
            return new vscode.Location(document.uri, variable.range);
        }

        // 检查Sub
        const sub = symbols.subs.find(s => s.name === word);
        if (sub) {
            return new vscode.Location(document.uri, sub.range);
        }

        // 检查结构体
        const struct = symbols.structures.find(s => s.name === word);
        if (struct) {
            return new vscode.Location(document.uri, struct.range);
        }

        // 检查结构体成员
        // 这需要检查当前位置是否在结构体成员访问表达式中
        const lineText = document.lineAt(position.line).text;
        const beforeCursor = lineText.substring(0, position.character);
        const dotMatch = beforeCursor.match(/(\w+)\.(\w*)$/);
        
        if (dotMatch) {
            const structName = dotMatch[1];
            const memberName = word;
            
            const structure = symbols.structures.find(s => s.name === structName);
            if (structure) {
                const member = structure.members.find(m => m.name === memberName);
                if (member) {
                    return new vscode.Location(document.uri, member.range);
                }
            }
        }

        return null;
    }
}