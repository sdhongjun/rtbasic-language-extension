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

// 控制语句块类型（包含开始和结束块）
export type ControlBlockType = 
  'If' | 'For' | 'While' | 'Select'  // 开始块类型
  | 'End If' | 'Next' | 'Wend' | 'End Select';  // 结束块类型

export interface ControlBlock {
  type: ControlBlockType;
  range: vscode.Range;
  parentSub?: string;
  parentBlock?: ControlBlock; // 添加父控制块引用，用于嵌套控制块
  variables?: RtBasicVariable[]; // 添加变量数组
  isSingleLine?: boolean; // 标记是否为单行控制块，如单行if语句
  hasEndToken?: boolean; // 标记是否已找到结束标记
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
  // 预编译的正则表达式 - 按功能分组
  private static readonly REGEX = {
    // 函数和结构体相关
    CFUNC: /^\s*DEFINE_CFUNC\s+([a-zA-Z_][a-zA-Z0-9_]*)\s+(.+?);/i,
    
    // If语句相关
    IF: {
      START: /^If\b.*?\bThen\b(?:\s+([^'\r\n]*))?/i,
      SINGLE_LINE: /^If\b.*?\bThen\b\s+(?!\s*')(?:[^'\r\n]+)(?=\s*(?:'|$))(?!\s*(?:ElseIf|Else|End\s+If)\b)/i,
      END: /^End\s+If\b/i,
      ELSEIF: /^ElseIf\b.*?(?:\bThen\b)?/i,
      ELSE: /^Else\b/i,
      ELSEIF_THEN_SINGLE_LINE: /^ElseIf\b.*?\bThen\b\s+[^'\r\n]+(?!\s+ElseIf\b|\s+Else\b|\s+End\s+If\b)/i
    },
    
    // 循环语句相关
    FOR: {
      START: /^For\b.*?\bTo\b.*$/i,
      END: /^Next\b/i
    },
    WHILE: {
      START: /^While\b.*$/i,
      END: /^Wend\b/i
    },
    
    // Select语句相关
    SELECT: {
      START: /^Select\s+Case\b.*$/i,
      END: /^End\s+Select\b/i,
      CASE: /^Case\s+.*$/i
    },
    
    // 变量声明相关
    VARIABLE: {
      GLOBAL_DIM: /global\s+(?:dim\s+)?([a-zA-Z_][a-zA-Z0-9_]*\s*(?:,\s*[a-zA-Z_][a-zA-Z0-9_]*)*)(?:\s+as\s+([a-zA-Z_][a-zA-Z0-9_]*))?/i,
      DIM: /dim\s+([a-zA-Z_][a-zA-Z0-9_]*(?:\s*\(\d+\))?(?:\s+as\s+[a-zA-Z_][a-zA-Z0-9_]*)?(?:\s*,\s*[a-zA-Z_][a-zA-Z0-9_]*(?:\s*\(\d+\))?(?:\s+as\s+[a-zA-Z_][a-zA-Z0-9_]*)?)*)/i,
      LOCAL: /local\s+([a-zA-Z_][a-zA-Z0-9_]*(?:\s*\(\d+\))?(?:\s+as\s+[a-zA-Z_][a-zA-Z0-9_]*)?(?:\s*,\s*[a-zA-Z_][a-zA-Z0-9_]*(?:\s*\(\d+\))?(?:\s+as\s+[a-zA-Z_][a-zA-Z0-9_]*)?)*)/i,
      DEFINITION: /([a-zA-Z_][a-zA-Z0-9_]*)(?:\s*\((\d+)\))?(?:\s+as\s+([a-zA-Z_][a-zA-Z0-9_]*))?/i,
      ARRAY: /(\w+)\s*\((\d+)\)/
    }
  };
  
  // 控制块类型映射
  private static readonly BLOCK_TYPE_MAP = [
    { regex: RtBasicParser.REGEX.FOR.START, type: "For" as ControlBlockType },
    { regex: RtBasicParser.REGEX.WHILE.START, type: "While" as ControlBlockType },
    { regex: RtBasicParser.REGEX.SELECT.START, type: "Select" as ControlBlockType }
  ];

  // 结束标记映射
  private static readonly END_TOKEN_MAP = [
    { regex: RtBasicParser.REGEX.IF.END, endType: 'End If', startType: 'If' },
    { regex: RtBasicParser.REGEX.SELECT.END, endType: 'End Select', startType: 'Select' },
    { regex: RtBasicParser.REGEX.FOR.END, endType: 'Next', startType: 'For' },
    { regex: RtBasicParser.REGEX.WHILE.END, endType: 'Wend', startType: 'While' }
  ];

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
    let lastSingleLineIfBlock: ControlBlock | undefined; // 跟踪最后一个单行If/ElseIf块

    for (let i = 0; i < document.lineCount; i++) {
      const line = document.lineAt(i);
      const text = line.text.trim();
      const lineRange = new vscode.Range(i, 0, i, line.text.length);

      // 解析C函数导入
      const cFuncMatch = text.match(RtBasicParser.REGEX.CFUNC);
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

      // 检查是否是ElseIf或Else语句
      if (RtBasicParser.REGEX.IF.ELSEIF.test(text) || RtBasicParser.REGEX.IF.ELSE.test(text)) {
        // 检查是否是单行ElseIf语句
        const blockStartInfo = this.detectControlBlockStart(text);
        const isSingleLineElseIf = blockStartInfo && blockStartInfo.blockType === "If" && 
                                  blockStartInfo.isSingleLine && RtBasicParser.REGEX.IF.ELSEIF.test(text);
        const isElse = RtBasicParser.REGEX.IF.ELSE.test(text);
        
        // 处理单行ElseIf语句
        if (isSingleLineElseIf) {
          // 如果前一行是单行If/ElseIf，则这个单行ElseIf与它关联
          if (lastSingleLineIfBlock) {
            // 创建一个新的单行ElseIf块
            const elseIfBlock: ControlBlock = {
              type: "If",
              range: lineRange,
              parentSub: currentSub?.name,
              parentBlock: lastSingleLineIfBlock.parentBlock, // 与前一个单行If块共享同一个父块
              variables: [],
              isSingleLine: true,
              hasEndToken: true // 单行ElseIf语句不需要结束标记
            };
            
            // 将新块添加到符号表
            this.symbols.controlBlocks.push(elseIfBlock);
            
            // 更新最后一个单行If块
            lastSingleLineIfBlock = elseIfBlock;
            
            continue;
          }
        }
        
        // 处理Else语句
        if (isElse) {
          // 如果前一行是单行If/ElseIf，则这个Else与它关联
          if (lastSingleLineIfBlock) {
            // 创建一个Else块（不是单行的，因为Else没有条件）
            const elseBlock: ControlBlock = {
              type: "If", // 仍然是If类型的一部分
              range: lineRange,
              parentSub: currentSub?.name,
              parentBlock: lastSingleLineIfBlock.parentBlock, // 与前一个单行If块共享同一个父块
              variables: [],
              isSingleLine: false,
              hasEndToken: true // Else也需要标记为已闭合，因为它不需要额外的End If
            };
            
            // 将新块添加到符号表
            this.symbols.controlBlocks.push(elseBlock);
            
            // 重置最后一个单行If块，因为Else后面不能再有ElseIf
            lastSingleLineIfBlock = undefined;
            
            continue;
          }
        }
        
        // 如果有活动的控制块，并且最近的控制块是If块
        if (activeControlBlocks.length > 0) {
          // 从栈顶向下查找最近的If块
          for (let i = activeControlBlocks.length - 1; i >= 0; i--) {
            const block = activeControlBlocks[i];
            if (block.type === "If" && !block.isSingleLine) {
              // 更新If块的范围以包含ElseIf/Else语句
              block.range = new vscode.Range(
                block.range.start,
                lineRange.end
              );
              
              // 标记ElseIf/Else为已闭合，因为它们不需要额外的End If
              if (RtBasicParser.REGEX.IF.ELSEIF.test(text) || RtBasicParser.REGEX.IF.ELSE.test(text)) {
                block.hasEndToken = true;
              }
              
              break;
            }
          }
        }
        
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
    const arrayMatch = varName.match(RtBasicParser.REGEX.VARIABLE.ARRAY);
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
      isSingleLine,
      hasEndToken: isSingleLine // 单行if语句不需要结束标记，所以hasEndToken为true
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
    block.range = new vscode.Range(block.range.start, new vscode.Position(lineRange.end.line, Number.MAX_SAFE_INTEGER));

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
  private isMatchingBlockEnd(endType: ControlBlockType, blockType: ControlBlockType): boolean {
    const matchingPairs: Record<string, ControlBlockType> = {
      'If': 'End If',
      'For': 'Next',
      'While': 'Wend',
      'Select': 'End Select'
    };
    
    return matchingPairs[blockType] === endType;
  }

  /**
   * 检测控制块的开始
   */
  private detectControlBlockStart(text: string): { blockType: ControlBlockType; isSingleLine: boolean } | undefined {
    // 检查单行If语句（包括ElseIf Then单行语句）
    if (RtBasicParser.REGEX.IF.SINGLE_LINE.test(text) || RtBasicParser.REGEX.IF.ELSEIF_THEN_SINGLE_LINE.test(text)) {
      return { blockType: "If", isSingleLine: true };
    }
    
    // 检查复杂If语句（包含ElseIf/Else分支）
    if (RtBasicParser.REGEX.IF.START.test(text)) {
      return { blockType: "If", isSingleLine: false };
    }
    
    // 检查 ElseIf 或 Else 语句 - 这些不是新的控制块开始
    if (RtBasicParser.REGEX.IF.ELSEIF.test(text) || RtBasicParser.REGEX.IF.ELSE.test(text)) {
      return undefined;
    }
    
    // 使用预定义的映射表简化其他控制块类型检查
    const match = RtBasicParser.BLOCK_TYPE_MAP.find(({ regex }) => regex.test(text));
    return match ? { blockType: match.type, isSingleLine: false } : undefined;
  }

  /**
   * 检测控制块的结束
   */
  private detectControlBlockEnd(text: string, activeControlBlocks: ControlBlock[]): 
    { matchingBlock: ControlBlock; matchingIndex: number } | undefined {
    
    if (activeControlBlocks.length === 0) {
      return undefined;
    }

    // 检查是否是ElseIf或Else语句 - 这些不是控制块结束标记
    if (RtBasicParser.REGEX.IF.ELSEIF.test(text) || RtBasicParser.REGEX.IF.ELSE.test(text)) {
      // 从栈顶向下查找最近的非单行If块
      for (let i = activeControlBlocks.length - 1; i >= 0; i--) {
        const block = activeControlBlocks[i];
        if (block.type === "If" && !block.isSingleLine) {
          // 更新If块的范围以包含ElseIf/Else分支
          block.range = new vscode.Range(
            block.range.start,
            new vscode.Position(block.range.end.line + 1, 0)
          );
          // 标记为未结束，因为还需要等待End If
          block.hasEndToken = false;
          break; // 找到匹配的If块后退出循环
        }
      }
      return undefined; // ElseIf/Else不是控制块结束标记
    }

    // 使用预定义的END_TOKEN_MAP检查所有可能的结束标记
    for (const { regex, startType } of RtBasicParser.END_TOKEN_MAP) {
      if (regex.test(text)) {
        // 从栈顶向下查找匹配的块
        for (let i = activeControlBlocks.length - 1; i >= 0; i--) {
          const block = activeControlBlocks[i];
          
          // 跳过单行语句，它们不需要结束标记
          if (block.isSingleLine) {
            continue;
          }
          
          // 检查类型是否匹配
          if (block.type === startType) {
            // 标记已找到结束标记
            block.hasEndToken = true;
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
    if (text.toLowerCase().startsWith("global")) {
      const globalMatch = text.match(RtBasicParser.REGEX.VARIABLE.GLOBAL_DIM);
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
      const dimMatch = text.match(RtBasicParser.REGEX.VARIABLE.DIM);
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
      const localMatch = text.match(RtBasicParser.REGEX.VARIABLE.LOCAL);
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
      const arrayMatch = param.match(RtBasicParser.REGEX.VARIABLE.ARRAY);
      
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