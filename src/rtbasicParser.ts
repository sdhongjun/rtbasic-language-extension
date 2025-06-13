import * as vscode from "vscode";

export interface RtBasicVariable {
  name: string;
  range: vscode.Range;
  scope: "global" | "local" | "file" | "block";
  isArray?: boolean;
  arraySize?: number;
  structType?: string;
  type?: string;
  parentSub?: string;
  parentBlock?: ControlBlock;
  sourceFile?: string;
}

// 新增：控制语句块类型
export type ControlBlockType = "If" | "For" | "While" | "Select";

export interface ControlBlock {
  type: ControlBlockType;
  range: vscode.Range;
  parentSub?: string;
  parentBlock?: ControlBlock; // 添加父控制块引用，用于嵌套控制块
  variables?: RtBasicVariable[]; // 添加变量数组
}

export interface RtBasicSub {
  name: string;
  parameters: RtBasicParameter[];
  range: vscode.Range;
  isGlobal: boolean;
  returnType?: string;
  sourceFile?: string;
}

export interface RtBasicParameter {
  name: string;
  isArray?: boolean;
  arraySize?: number;
  type?: string;
  description?: string;
}

export interface RtBasicStructure {
  name: string;
  members: RtBasicVariable[];
  range: vscode.Range;
  sourceFile?: string;
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
    controlBlocks: []
  };

  constructor() {
    this.reset();
  }

  public reset(): void {
    this.symbols = {
      variables: [],
      subs: [],
      structures: [],
      controlBlocks: []
    };
  }

      public parse(document: vscode.TextDocument): RtBasicSymbol {
          this.reset();

          let currentSub: RtBasicSub | undefined;
          let currentStructure: RtBasicStructure | undefined;
          let activeControlBlocks: ControlBlock[] = [];
          let currentControlBlock: ControlBlock | undefined;

          for (let i = 0; i < document.lineCount; i++) {
              const line = document.lineAt(i);
              const text = line.text.trim();
              const lineRange = new vscode.Range(i, 0, i, line.text.length);

              // 检查控制语句块开始
              const blockStartMatch = text.match(/^(If|For|While|Select)\b.*$/i);
              if (blockStartMatch) {
                  const blockType = blockStartMatch[1] as ControlBlockType;
                  const newBlock: ControlBlock = {
                      type: blockType,
                      range: lineRange,
                      parentSub: currentSub?.name,
                      variables: []
                  };
                  
                  // 如果这是嵌套的控制块，设置父控制块
                  if (currentControlBlock) {
                      newBlock.parentBlock = currentControlBlock;
                  }
                  
                  // 将当前控制块加入活动控制块栈
                  activeControlBlocks.push(newBlock);
                  currentControlBlock = newBlock;
              }

              // 检查控制语句块结束
              const blockEndMatch = text.match(/^(?:End\s+(If|Select)|Next|Wend)\b/i);
              if (blockEndMatch && activeControlBlocks.length > 0) {
                  const lastBlock = activeControlBlocks[activeControlBlocks.length - 1];
                  const endType = blockEndMatch[1] || text.trim();
                  
                  // 检查结束类型是否匹配当前控制块
                  const isMatching = (
                      (endType.toLowerCase() === "if" && lastBlock.type === "If") ||
                      (endType.toLowerCase() === "select" && lastBlock.type === "Select") ||
                      (endType.toLowerCase() === "next" && lastBlock.type === "For") ||
                      (endType.toLowerCase() === "wend" && lastBlock.type === "While")
                  );
                  
                  if (isMatching) {
                      // 更新控制语句块范围，包括结束行
                      lastBlock.range = new vscode.Range(
                          lastBlock.range.start,
                          lineRange.end
                      );
                      
                      // 收集控制块内的变量
                      if (!lastBlock.variables) {
                          lastBlock.variables = [];
                      }
                      
                      // 查找属于此控制块的所有变量
                      this.symbols.variables.forEach(variable => {
                          if (variable.parentBlock === lastBlock) {
                              lastBlock.variables!.push(variable);
                          }
                      });
                      
                      // 将完成的控制块添加到符号表中
                      this.symbols.controlBlocks.push(lastBlock);
                      
                      // 从活动控制块栈中移除
                      activeControlBlocks.pop();
                      
                      // 更新当前控制块为栈顶的控制块（如果有的话）
                      currentControlBlock = activeControlBlocks.length > 0 
                          ? activeControlBlocks[activeControlBlocks.length - 1] 
                          : undefined;
                          
                      // 如果当前控制块存在，更新其范围以包含刚结束的子块
                      if (currentControlBlock) {
                          currentControlBlock.range = new vscode.Range(
                              currentControlBlock.range.start,
                              lineRange.end
                          );
                      }
                  }
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
      
      // 解析文件作用域变量（使用File关键字）
      else if (text.toLowerCase().startsWith("file dim")) {
        // 匹配数组变量: File Dim varName(size) [As type]
        // 匹配文件变量: File Dim var1, var2 As Structure
        const fileMatch = text.match(
          /file\s+dim\s+([a-zA-Z_][a-zA-Z0-9_]*\s*(?:,\s*[a-zA-Z_][a-zA-Z0-9_]*)*)(?:\s+as\s+([a-zA-Z_][a-zA-Z0-9_]*))?/i
        );
        if (fileMatch) {
          const varNames = fileMatch[1].split(",").map((name) => name.trim());
          const structType = fileMatch[2];

          varNames.forEach((varName) => {
            // 检查是否是数组
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
                parentBlock: currentControlBlock || undefined,
              });
            } else {
              this.symbols.variables.push({
                name: varName,
                range: new vscode.Range(line.range.start, line.range.end),
                scope: currentControlBlock ? "block" : "local",
                structType: structType,
                parentSub: currentSub?.name,
                parentBlock: currentControlBlock || undefined,
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
      
      // 解析普通Sub
      else if (text.toLowerCase().startsWith("sub")) {
        const match = text.match(/sub\s+(\w+)\s*\((.*)\)/i);
        if (match) {
          const sub: RtBasicSub = {
            name: match[1],
            parameters: this.parseParameters(match[2]),
            range: new vscode.Range(line.range.start, line.range.end),
            isGlobal: false,
          };
          this.symbols.subs.push(sub);
          currentSub = sub;
          
          // 重置控制块状态，因为进入了新的Sub
          activeControlBlocks = [];
          currentControlBlock = undefined;
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
        // 更新当前Sub的范围，包含整个Sub的内容
        currentSub.range = new vscode.Range(
          currentSub.range.start,
          lineRange.end
        );
        
        // 清理所有未关闭的控制块
        for (const block of activeControlBlocks) {
          block.range = new vscode.Range(
            block.range.start,
            lineRange.end
          );
          this.symbols.controlBlocks.push(block);
        }
        
        // 重置控制块状态
        activeControlBlocks = [];
        currentControlBlock = undefined;
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

    // 检查控制块
    // 注意：这里我们不是通过名称查找控制块，而是检查位置是否在控制块范围内
    const controlBlock = this.symbols.controlBlocks.find(
      (block) => block.range.contains(position)
    );
    if (controlBlock) {
      return new vscode.SymbolInformation(
        `${controlBlock.type} block`,
        vscode.SymbolKind.Module,
        controlBlock.parentSub || "file",
        new vscode.Location(document.uri, controlBlock.range)
      );
    }

    return undefined;
  }
}