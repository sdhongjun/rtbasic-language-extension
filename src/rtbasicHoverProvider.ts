import * as vscode from 'vscode';
import { RtBasicParser, RtBasicVariable, RtBasicStructure } from './rtbasicParser';

export class RtBasicHoverProvider implements vscode.HoverProvider {
    private parser: RtBasicParser;

    constructor(parser: RtBasicParser) {
        this.parser = parser;
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
        const symbols = this.parser.parse(document);

        // 检查是否在结构体成员访问
        const lineText = document.lineAt(position.line).text;
        const beforeCursor = lineText.substring(0, position.character);
        const dotMatch = beforeCursor.match(/(\w+)\.(\w*)$/);
        
        if (dotMatch && dotMatch[2] === word) {
            const structName = dotMatch[1];
            const memberName = word;
            
            const structure = symbols.structures.find(s => s.name === structName);
            if (structure) {
                const member = structure.members.find(m => m.name === memberName);
                if (member) {
                    let memberCode = `Dim ${member.name}`;
                    if (member.isArray) {
                        memberCode += `(${member.arraySize})`;
                    }
                    
                    const content = new vscode.MarkdownString()
                        .appendCodeblock(memberCode, 'rtbasic')
                        .appendText(`\n\nMember of structure ${structure.name}`);
                    
                    if (member.isArray) {
                        content.appendText(`\nArray with size ${member.arraySize}`);
                    }
                    
                    return new vscode.Hover(content, wordRange);
                }
            }
        }

        // 检查变量
        const variable = symbols.variables.find(v => v.name === word);
        if (variable) {
            let content = new vscode.MarkdownString();
            let varCode = '';
            
            switch (variable.scope) {
                case 'global':
                    varCode = `Global Dim ${variable.name}`;
                    if (variable.isArray) {
                        varCode += `(${variable.arraySize})`;
                    }
                    if (variable.structType) {
                        varCode += ` As ${variable.structType}`;
                    }
                    content.appendCodeblock(varCode, 'rtbasic');
                    break;
                case 'local':
                    varCode = `Local ${variable.name}`;
                    if (variable.isArray) {
                        varCode += `(${variable.arraySize})`;
                    }
                    if (variable.structType) {
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
                    if (variable.structType) {
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
        const sub = symbols.subs.find(s => s.name === word);
        if (sub) {
                            const params = sub.parameters.map(p => {
                                let paramStr = p.name;
                                if (p.isArray) {
                                    paramStr += `(${p.arraySize})`;
                                }
                                return paramStr;
                            }).join(', ');
            
            const content = new vscode.MarkdownString()
                .appendCodeblock(
                    `${sub.isGlobal ? 'Global ' : ''}Sub ${sub.name}(${params})`, 
                    'rtbasic'
                );
            
            if (sub.parameters.length > 0) {
                content.appendText('\n\n**Parameters:**\n');
                sub.parameters.forEach(param => {
                    let paramDesc = `- \`${param.name}\``;
                    if (param.isArray) {
                        paramDesc += ` (array size: ${param.arraySize})`;
                    }
                    content.appendText(paramDesc + '\n');
                });
            }
            
            return new vscode.Hover(content, wordRange);
        }

        // 检查结构体
        const struct = symbols.structures.find(s => s.name === word);
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
            
            if (struct.members.length > 0) {
                content.appendText('\n\n**Members:**\n');
                struct.members.forEach(member => {
                    let memberDesc = `- \`${member.name}\``;
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
}