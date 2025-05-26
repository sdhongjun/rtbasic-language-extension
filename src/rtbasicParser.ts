import * as vscode from "vscode";

export interface RtBasicVariable {
  name: string;
  range: vscode.Range;
  scope: "global" | "local" | "file" | "block";
  isArray?: boolean;
  arraySize?: number;
  structType?: string;
  parentSub?: string;
  parentBlock?: string; // 新增：所属控制语句块
}

// 新增：控制语句块类型
export interface ControlBlock {
  type: "if" | "for" | "while" | "select";
  range: vscode.Range;
  parentSub?: string;
}

export interface RtBasicSub {
  name: string;
  parameters: RtBasicParameter[];
  range: vscode.Range;
  isGlobal: boolean;
}

export interface RtBasicParameter {
  name: string;
  isArray?: boolean;
  arraySize?: number;
}

export interface RtBasicStructure {
  name: string;
  members: RtBasicVariable[];
  range: vscode.Range;
}

export interface RtBasicSymbol {
  variables: RtBasicVariable[];
  subs: RtBasicSub[];
  structures: RtBasicStructure[];
  controlBlocks: ControlBlock[];
}

export class RtBasicParser {
  private symbols: RtBasicSymbol = {
    variables: [],
    subs: [],
    structures: [],
  };
  
  private controlBlocks: ControlBlock[] = []; // 新增：跟踪控制语句块
  private currentControlBlock: ControlBlock | undefined; // 当前控制语句块

  constructor() {
    this.reset();
  }

  public reset(): void {
    this.symbols = {
      variables: [],
      subs: [],
      structures: [],
    };
  }

      public parse(document: vscode.TextDocument): RtBasicSymbol {
          this.reset();

          let currentSub: RtBasicSub | undefined;
          let currentStructure: RtBasicStructure | undefined;
          let currentControlBlock: ControlBlock | undefined;

          for (let i = 0; i < document.lineCount; i++) {
              const line = document.lineAt(i);
              const text = line.text.trim();
              const lineRange = new vscode.Range(i, 0, i, line.text.length);

              // 检查控制语句块开始
              const blockStartMatch = text.match(/^(If|For|While|Select)\b/i);
              if (blockStartMatch) {
                  currentControlBlock = {
                      type: blockStartMatch[1].toLowerCase() as ControlBlock['type'],
                      range: lineRange,
                      parentSub: currentSub?.name
                  };
                  this.controlBlocks.push(currentControlBlock);
              }

              // 检查控制语句块结束
              const blockEndMatch = text.match(/^End\s+(If|For|While|Select)\b/i);
              if (blockEndMatch && currentControlBlock?.type === blockEndMatch[1].toLowerCase()) {
                  // 更新控制语句块范围
                  currentControlBlock.range = new vscode.Range(
                      currentControlBlock.range.start,
                      lineRange.end
                  );
                  this.controlBlocks.pop();
                  currentControlBlock = this.controlBlocks.length > 0 
                      ? this.controlBlocks[this.controlBlocks.length - 1] 
                      : undefined;
              }

      // 解析全局变量
      if (text.toLowerCase().startsWith("global dim")) {
        // 匹配数组变量: Global Dim varName(size) [As type]
        // 匹配全局变量: Global Dim var1, var2 As Structure
        const globalMatch = text.match(
          /global\s+dim\s+([a-zA-Z_][a-zA-Z0-9_]*\s*(?:,\s*[a-zA-Z_][a-zA-Z0-9_]*)*)(?:\s+as\s+([a-zA-Z_][a-zA-Z0-9_]*))?/i
        );
        if (globalMatch) {
          const varNames = globalMatch[1].split(",").map((name) => name.trim());
          const structType = globalMatch[2];

          varNames.forEach((varName) => {
            // 检查是否是数组
            const arrayMatch = varName.match(/(\w+)\s*\((\d+)\)/);
            if (arrayMatch) {
              this.symbols.variables.push({
                name: arrayMatch[1],
                range: new vscode.Range(line.range.start, line.range.end),
                scope: "global",
                isArray: true,
                arraySize: parseInt(arrayMatch[2]),
                structType: structType,
              });
            } else {
              this.symbols.variables.push({
                name: varName,
                range: new vscode.Range(line.range.start, line.range.end),
                scope: "global",
                structType: structType,
              });
            }
          });
        }
      }

      // 解析局部变量
      else if (text.toLowerCase().startsWith("local")) {
        const localMatch = text.match(
          /local\s+([a-zA-Z_][a-zA-Z0-9_]*\s*(?:,\s*[a-zA-Z_][a-zA-Z0-9_]*)*)(?:\s+as\s+([a-zA-Z_][a-zA-Z0-9_]*))?/i
        );
        if (localMatch && (currentSub || currentControlBlock)) {
          const varNames = localMatch[1].split(",").map((name) => name.trim());
          const structType = localMatch[2];

          varNames.forEach((varName) => {
            const arrayMatch = varName.match(/(\w+)\s*\((\d+)\)/);
            if (arrayMatch) {
              this.symbols.variables.push({
                name: arrayMatch[1],
                range: new vscode.Range(line.range.start, line.range.end),
                scope: currentControlBlock ? "block" : "local",
                isArray: true,
                arraySize: parseInt(arrayMatch[2]),
                structType: structType,
                parentSub: currentSub?.name,
                parentBlock: currentControlBlock 
                  ? `${currentControlBlock.type}-${currentControlBlock.range.start.line}` 
                  : undefined,
              });
            } else {
              this.symbols.variables.push({
                name: varName,
                range: new vscode.Range(line.range.start, line.range.end),
                scope: currentControlBlock ? "block" : "local",
                structType: structType,
                parentSub: currentSub?.name,
                parentBlock: currentControlBlock 
                  ? `${currentControlBlock.type}-${currentControlBlock.range.start.line}` 
                  : undefined,
              });
            }
          });
        }
      }

      // 解析文件变量
      else if (text.toLowerCase().startsWith("dim")) {
        const dimMatch = text.match(
          /dim\s+([a-zA-Z_][a-zA-Z0-9_]*\s*(?:,\s*[a-zA-Z_][a-zA-Z0-9_]*)*)(?:\s+as\s+([a-zA-Z_][a-zA-Z0-9_]*))?/i
        );
        if (dimMatch) {
          const varNames = dimMatch[1].split(",").map((name) => name.trim());
          const structType = dimMatch[2];

          varNames.forEach((varName) => {
            const arrayMatch = varName.match(/(\w+)\s*\((\d+)\)/);
            if (arrayMatch) {
              this.symbols.variables.push({
                name: arrayMatch[1],
                range: new vscode.Range(line.range.start, line.range.end),
                scope: "file",
                isArray: true,
                arraySize: parseInt(arrayMatch[2]),
                structType: structType,
              });
            } else {
              this.symbols.variables.push({
                name: varName,
                range: new vscode.Range(line.range.start, line.range.end),
                scope: "file",
                structType: structType,
              });
            }
          });
        }
      }

      // 解析全局Sub
      else if (text.toLowerCase().startsWith("global sub")) {
        const match = text.match(/global\s+sub\s+(\w+)\s*\((.*)\)/i);
        if (match) {
          const sub: RtBasicSub = {
            name: match[1],
            parameters: this.parseParameters(match[2]),
            range: new vscode.Range(line.range.start, line.range.end),
            isGlobal: true,
          };
          this.symbols.subs.push(sub);
          currentSub = sub;
        }
      }

      // 解析结构体开始
      else if (text.toLowerCase().startsWith("global structure")) {
        const match = text.match(/global\s+structure\s+(\w+)/i);
        if (match) {
          currentStructure = {
            name: match[1],
            members: [],
            range: new vscode.Range(line.range.start, line.range.end),
          };
        }
      }

      // 解析结构体成员
      else if (currentStructure && text.toLowerCase().startsWith("dim")) {
        const memberMatch = text.match(
          /dim\s+([a-zA-Z_][a-zA-Z0-9_]*\s*(?:,\s*[a-zA-Z_][a-zA-Z0-9_]*)*)(?:\s+as\s+([a-zA-Z_][a-zA-Z0-9_]*))?/i
        );
        if (memberMatch) {
          const memberNames = memberMatch[1]
            .split(",")
            .map((name) => name.trim());
          const structType = memberMatch[2];

          memberNames.forEach((memberName) => {
            const arrayMatch = memberName.match(/(\w+)\s*\((\d+)\)/);
            if (arrayMatch) {
              currentStructure?.members.push({
                name: arrayMatch[1],
                range: new vscode.Range(line.range.start, line.range.end),
                scope: "file",
                isArray: true,
                arraySize: parseInt(arrayMatch[2]),
                structType: structType,
              });
            } else {
              currentStructure?.members.push({
                name: memberName,
                range: new vscode.Range(line.range.start, line.range.end),
                scope: "file",
                structType: structType,
              });
            }
          });
        }
      }

      // 结构体结束
      else if (text.toLowerCase() === "end structure" && currentStructure) {
        this.symbols.structures.push(currentStructure);
        currentStructure = undefined;
      }

      // Sub结束
      else if (text.toLowerCase() === "end sub" && currentSub) {
        currentSub = undefined;
      }
    }

    return this.symbols;
  }

  private parseParameters(paramsText: string): RtBasicParameter[] {
    if (!paramsText.trim()) {
      return [];
    }

    return paramsText.split(",").map((param) => {
      param = param.trim();

      // 检查是否是数组参数
      const arrayMatch = param.match(/(\w+)\s*\((\d+)\)/i);
      if (arrayMatch) {
        return {
          name: arrayMatch[1],
          isArray: true,
          arraySize: parseInt(arrayMatch[2]),
        };
      }

      // 普通参数
      const match = param.match(/(\w+)/i);
      if (match) {
        return {
          name: match[1],
        };
      }

      // 如果无法解析，返回一个基本参数
      return {
        name: param,
      };
    });
  }

  public getSymbolAtPosition(
    document: vscode.TextDocument,
    position: vscode.Position
  ): vscode.SymbolInformation | undefined {
    const wordRange = document.getWordRangeAtPosition(position);
    if (!wordRange) {
      return undefined;
    }

    const word = document.getText(wordRange);

    // 检查变量
    const variable = this.symbols.variables.find((v) => v.name === word);
    if (variable) {
      return new vscode.SymbolInformation(
        variable.name,
        vscode.SymbolKind.Variable,
        variable.scope,
        new vscode.Location(document.uri, variable.range)
      );
    }

    // 检查Sub
    const sub = this.symbols.subs.find((s) => s.name === word);
    if (sub) {
      return new vscode.SymbolInformation(
        sub.name,
        vscode.SymbolKind.Function,
        sub.isGlobal ? "global" : "file",
        new vscode.Location(document.uri, sub.range)
      );
    }

    // 检查结构体
    const struct = this.symbols.structures.find((s) => s.name === word);
    if (struct) {
      return new vscode.SymbolInformation(
        struct.name,
        vscode.SymbolKind.Struct,
        "global",
        new vscode.Location(document.uri, struct.range)
      );
    }

    return undefined;
  }
}