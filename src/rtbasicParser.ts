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
  isSingleLine?: boolean; // 标记是否为单行控制块，如单行if语句
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
  isGlobal: boolean;  // 添加isGlobal属性来区分全局和文件作用域结构体
  sourceFile?: string;
}

export interface RtBasicCFunction {
  name: string;         // RtBasic中的函数名
  cFunctionDecl: string; // C函数声明
  range: vscode.Range;
  sourceFile?: string;
}

export interface RtBasicSymbol {
  variables: RtBasicVariable[];
  subs: RtBasicSub[];
  structures: RtBasicStructure[];
  controlBlocks: ControlBlock[];
  cFunctions: RtBasicCFunction[];
}

export class RtBasicParser {
  // 预编译的正则表达式
  private static readonly CFUNC_REGEX = /^\s*DEFINE_CFUNC\s+([a-zA-Z_][a-zA-Z0-9_]*)\s+(.+?);/i;
  private static readonly IF_START_REGEX = /^If\b.*?\bThen\b(?:\s+([^'\r\n]*))?/i;
  private static readonly FOR_START_REGEX = /^For\b.*?\bTo\b.*$/i;
  private static readonly WHILE_START_REGEX = /^While\b.*$/i;
  private static readonly SELECT_START_REGEX = /^Select\s+Case\b.*$/i;
  private static readonly IF_END_REGEX = /^End\s+If\b/i;
  private static readonly SELECT_END_REGEX = /^End\s+Select\b/i;
  private static readonly FOR_END_REGEX = /^Next\b/i;
  private static readonly WHILE_END_REGEX = /^Wend\b/i;
  private static readonly GLOBAL_DIM_REGEX = /global\s+(?:dim\s+)?([a-zA-Z_][a-zA-Z0-9_]*\s*(?:,\s*[a-zA-Z_][a-zA-Z0-9_]*)*)(?:\s+as\s+([a-zA-Z_][a-zA-Z0-9_]*))?/i;
  private static readonly DIM_REGEX = /dim\s+([a-zA-Z_][a-zA-Z0-9_]*(?:\s*\(\d+\))?(?:\s+as\s+[a-zA-Z_][a-zA-Z0-9_]*)?(?:\s*,\s*[a-zA-Z_][a-zA-Z0-9_]*(?:\s*\(\d+\))?(?:\s+as\s+[a-zA-Z_][a-zA-Z0-9_]*)?)*)/i;
  private static readonly LOCAL_REGEX = /local\s+([a-zA-Z_][a-zA-Z0-9_]*(?:\s*\(\d+\))?(?:\s+as\s+[a-zA-Z_][a-zA-Z0-9_]*)?(?:\s*,\s*[a-zA-Z_][a-zA-Z0-9_]*(?:\s*\(\d+\))?(?:\s+as\s+[a-zA-Z_][a-zA-Z0-9_]*)?)*)/i;
  private static readonly VAR_DEFINITION_REGEX = /([a-zA-Z_][a-zA-Z0-9_]*)(?:\s*\((\d+)\))?(?:\s+as\s+([a-zA-Z_][a-zA-Z0-9_]*))?/i;
  private static readonly ARRAY_REGEX = /(\w+)\s*\((\d+)\)/;

  private symbols: RtBasicSymbol = {
    variables: [],
    subs: [],
    structures: [],
    controlBlocks: [],
    cFunctions: []
  };

  constructor() {
    this.reset();
  }

  public reset(): void {
    this.symbols = {
      variables: [],
      subs: [],
      structures: [],
      controlBlocks: [],
      cFunctions: []
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

      // 解析C函数导入
      const cFuncMatch = text.match(/^\s*DEFINE_CFUNC\s+([a-zA-Z_][a-zA-Z0-9_]*)\s+(.+?);/i);
      if (cFuncMatch) {
        const rtbasicName = cFuncMatch[1];
        const cFunctionDecl = cFuncMatch[2];

        this.symbols.cFunctions.push({
          name: rtbasicName,
          cFunctionDecl: cFunctionDecl,
          range: lineRange,
          sourceFile: document.uri.fsPath
        });
        continue;
      }

      // 检查控制语句块开始
      const blockStartInfo = this.detectControlBlockStart(text);
      if (blockStartInfo) {
        const { blockType, isSingleLine } = blockStartInfo;
        
        if (blockType === "If" && isSingleLine) {
          // 单行 if 语句处理 - 不需要 end if
          const singleLineIfBlock = this.handleBlockStart(
            blockType, 
            lineRange, 
            currentSub, 
            currentControlBlock, 
            true
          );
          
          // 直接添加到符号表，不加入活动控制块栈
          this.symbols.controlBlocks.push(singleLineIfBlock);
        } else {
          // 常规多行控制块处理 - 需要对应的结束标记
          const newBlock = this.handleBlockStart(
            blockType, 
            lineRange, 
            currentSub, 
            currentControlBlock, 
            false
          );
          
          // 将当前控制块加入活动控制块栈
          activeControlBlocks.push(newBlock);
          currentControlBlock = newBlock;
        }
        
        continue;
      }

      // 检查控制语句块结束
      const blockEndInfo = this.detectControlBlockEnd(text, activeControlBlocks);
      if (blockEndInfo && blockEndInfo.matchingBlock) {
        const { matchingBlock, matchingIndex } = blockEndInfo;
        
        // 处理从匹配块到栈顶的所有块
        for (let i = activeControlBlocks.length - 1; i >= matchingIndex; i--) {
          this.handleBlockEnd(activeControlBlocks[i], lineRange);
        }

        // 从活动控制块栈中移除所有已处理的块
        activeControlBlocks.splice(matchingIndex);

        // 更新当前控制块为栈顶的控制块（如果有的话）
        currentControlBlock = activeControlBlocks.length > 0
          ? activeControlBlocks[activeControlBlocks.length - 1]
          : undefined;

        continue;
      }

      // 检查变量声明
      if ((text.toLowerCase().startsWith("global dim") || 
           (text.toLowerCase().startsWith("dim") && !currentStructure) || 
           text.toLowerCase().startsWith("local")) && 
          (!text.toLowerCase().startsWith("local") || (currentSub || currentControlBlock))) {
        
        // 处理变量声明
        const variableInfo = this.detectVariableDeclaration(text, lineRange, currentSub, currentControlBlock);
        if (variableInfo) {
          const { variable } = variableInfo;
          
          // 将变量添加到符号表
          this.symbols.variables.push(variable);
          
          // 如果变量在控制块内，将其添加到控制块的变量列表中
          if (currentControlBlock) {
            if (!currentControlBlock.variables) {
              currentControlBlock.variables = [];
            }
            currentControlBlock.variables.push(variable);
          }
          
          continue;
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

      // 解析全局结构体开始
      else if (text.toLowerCase().startsWith("global structure")) {
        const match = text.match(/global\s+structure\s+(\w+)/i);
        if (match) {
          currentStructure = {
            name: match[1],
            members: [],
            range: new vscode.Range(line.range.start, line.range.end),
            isGlobal: true,  // 设置为全局作用域
          };
        }
      }
      // 解析文件作用域结构体开始
      else if (text.toLowerCase().startsWith("structure")) {
        const match = text.match(/structure\s+(\w+)/i);
        if (match) {
          currentStructure = {
            name: match[1],
            members: [],
            range: new vscode.Range(line.range.start, line.range.end),
            isGlobal: false,  // 设置为文件作用域
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

  /**
   * 解析变量声明并创建变量对象
   */
  private parseVariableDeclaration(
    varName: string,
    range: vscode.Range,
    scope: "global" | "local" | "file" | "block",
    structType?: string,
    parentSub?: string,
    parentBlock?: ControlBlock
  ): RtBasicVariable {
    const arrayMatch = varName.match(RtBasicParser.ARRAY_REGEX);
    if (arrayMatch) {
      return {
        name: arrayMatch[1],
        range,
        scope,
        isArray: true,
        arraySize: parseInt(arrayMatch[2]),
        structType,
        parentSub,
        parentBlock
      };
    }
    return {
      name: varName,
      range,
      scope,
      structType,
      parentSub,
      parentBlock
    };
  }

  /**
   * 处理控制块的开始
   */
  private handleBlockStart(
    blockType: ControlBlockType,
    lineRange: vscode.Range,
    currentSub?: RtBasicSub,
    currentControlBlock?: ControlBlock,
    isSingleLine: boolean = false
  ): ControlBlock {
    const newBlock: ControlBlock = {
      type: blockType,
      range: lineRange,
      parentSub: currentSub?.name,
      variables: [],
      isSingleLine
    };

    if (currentControlBlock) {
      newBlock.parentBlock = currentControlBlock;
    }

    return newBlock;
  }

  /**
   * 处理控制块的结束
   */
  private handleBlockEnd(
    block: ControlBlock,
    lineRange: vscode.Range
  ): void {
    // 更新控制块范围
    block.range = new vscode.Range(block.range.start, lineRange.end);

    // 收集控制块内的变量
    if (!block.variables) {
      block.variables = [];
    }

    // 查找属于此控制块的所有变量
    this.symbols.variables.forEach(variable => {
      // 检查变量是否在此控制块的范围内
      if (variable.range && block.range.contains(variable.range) && 
          (!variable.parentBlock || variable.parentBlock === block)) {
        
        // 如果变量还没有被添加到任何控制块，或者已经是这个控制块的变量
        if (!block.variables!.includes(variable)) {
          block.variables!.push(variable);
        }
        
        // 更新变量的父控制块引用
        variable.parentBlock = block;
      }
    });

    // 将完成的控制块添加到符号表中
    if (!this.symbols.controlBlocks.includes(block)) {
      this.symbols.controlBlocks.push(block);
    }
  }

  /**
   * 检查控制块结束类型是否匹配
   */
  private isMatchingBlockEnd(endType: string, blockType: ControlBlockType): boolean {
    const endTypeMap: Record<string, ControlBlockType> = {
      'if': 'If',
      'select': 'Select',
      'next': 'For',
      'wend': 'While'
    };
    
    return endTypeMap[endType.toLowerCase()] === blockType;
  }

  /**
   * 检测控制块的开始
   */
  private detectControlBlockStart(text: string): { blockType: ControlBlockType; isSingleLine: boolean } | undefined {
    // 检查 If 语句
    const ifThenMatch = text.match(RtBasicParser.IF_START_REGEX);
    if (ifThenMatch) {
      let isSingleLine = false;
      
      // 检查是否是单行 if 语句 - 如果 then 后面有内容
      if (ifThenMatch[1]) {
        const afterThen = ifThenMatch[1].trim();
        
        // 检查 then 后是否有实际语句（不是空白且不以注释开头）
        if (afterThen && !afterThen.startsWith("'") && !afterThen.toLowerCase().startsWith("rem ")) {
          // 检查是否有注释，如果有，提取注释前的实际语句
          const commentPos = afterThen.indexOf("'");
          const actualStatement = commentPos >= 0 ? afterThen.substring(0, commentPos).trim() : afterThen;
          
          // 如果实际语句不为空，则这是一个单行if语句
          if (actualStatement) {
            isSingleLine = true;
          }
        }
      }
      
      return { blockType: "If", isSingleLine };
    }
    
    // 检查其他控制块类型
    const blockTypeMatches = [
      { regex: RtBasicParser.FOR_START_REGEX, type: "For" as ControlBlockType },
      { regex: RtBasicParser.WHILE_START_REGEX, type: "While" as ControlBlockType },
      { regex: RtBasicParser.SELECT_START_REGEX, type: "Select" as ControlBlockType }
    ];

    for (const { regex, type } of blockTypeMatches) {
      if (text.match(regex)) {
        return { blockType: type, isSingleLine: false };
      }
    }

    return undefined;
  }

  /**
   * 检测控制块的结束
   */

  private detectControlBlockEnd(text: string, activeControlBlocks: ControlBlock[]): 
    { matchingBlock: ControlBlock; matchingIndex: number } | undefined {
    
    if (activeControlBlocks.length === 0) {
      return undefined;
    }

    const endMatches = [
      { regex: RtBasicParser.IF_END_REGEX, type: "If" },
      { regex: RtBasicParser.SELECT_END_REGEX, type: "Select" },
      { regex: RtBasicParser.FOR_END_REGEX, type: "For" },
      { regex: RtBasicParser.WHILE_END_REGEX, type: "While" }
    ];

    for (const { regex, type } of endMatches) {
      if (text.match(regex)) {
        // 查找最近的匹配块
        for (let i = activeControlBlocks.length - 1; i >= 0; i--) {
          const block = activeControlBlocks[i];
          if (block.type === type && (!block.isSingleLine || type !== "If")) {
            return { matchingBlock: block, matchingIndex: i };
          }
        }
      }
    }

    return undefined;
  }

  /**
   * 检测变量声明并创建变量对象
   */
  private detectVariableDeclaration(
    text: string,
    lineRange: vscode.Range,
    currentSub?: RtBasicSub,
    currentControlBlock?: ControlBlock
  ): { variable: RtBasicVariable; scope: "global" | "local" | "file" | "block" } | undefined {
    // 检查全局变量声明
    if (text.toLowerCase().startsWith("global dim")) {
      const globalMatch = text.match(RtBasicParser.GLOBAL_DIM_REGEX);
      if (globalMatch) {
        const varName = globalMatch[1].trim();
        const structType = globalMatch[2];
        const variable = this.parseVariableDeclaration(
          varName,
          lineRange,
          "global",
          structType,
          undefined,
          currentControlBlock
        );
        return { variable, scope: "global" };
      }
    }
    
    // 检查文件变量声明
    else if (text.toLowerCase().startsWith("dim")) {
      const dimMatch = text.match(RtBasicParser.DIM_REGEX);
      if (dimMatch) {
        const varName = dimMatch[1].trim();
        const structType = dimMatch[2];
        const variable = this.parseVariableDeclaration(
          varName,
          lineRange,
          "file",
          structType,
          undefined,
          currentControlBlock
        );
        return { variable, scope: "file" };
      }
    }
    
    // 检查局部变量声明
    else if (text.toLowerCase().startsWith("local")) {
      const localMatch = text.match(RtBasicParser.LOCAL_REGEX);
      if (localMatch && (currentSub || currentControlBlock)) {
        const varName = localMatch[1].trim();
        const scope = currentControlBlock ? "block" : "local";
        const variable = this.parseVariableDeclaration(
          varName,
          lineRange,
          scope,
          undefined,
          currentSub?.name,
          currentControlBlock
        );
        return { variable, scope };
      }
    }
    
    return undefined;
  }

  private parseParameters(paramsText: string): RtBasicParameter[] {
    if (!paramsText.trim()) {
      return [];
    }

    return paramsText.split(",").map((param) => {
      param = param.trim();
      const arrayMatch = param.match(RtBasicParser.ARRAY_REGEX);
      
      if (arrayMatch) {
        return {
          name: arrayMatch[1],
          isArray: true,
          arraySize: parseInt(arrayMatch[2]),
        };
      }

      const match = param.match(/(\w+)/i);
      return {
        name: match ? match[1] : param,
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

    // 检查C函数导入
    const cFunction = this.symbols.cFunctions.find((cf) => cf.name === word);
    if (cFunction) {
      return new vscode.SymbolInformation(
        cFunction.name,
        vscode.SymbolKind.Function,
        "C Function Import",
        new vscode.Location(document.uri, cFunction.range)
      );
    }

    return undefined;
  }
}