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
  blockType?: string; // 添加blockType属性，用于存储变量所属的控制块类型
  sourceFile?: string;
  isConst?: boolean; // 标记是否为常量
  value?: string; // 存储常量的值
}

// 控制语句块类型
export type ControlBlockType = 'If' | 'For' | 'While' | 'Select';

export interface ControlBlock {
  type: ControlBlockType;
  range: vscode.Range;
  parentSub?: string;
  parentBlock?: ControlBlock; // 添加父控制块引用，用于嵌套控制块
  variables?: RtBasicVariable[]; // 添加变量数组
  isSingleLine?: boolean; // 标记是否为单行控制块，如单行if语句
  hasEndToken?: boolean; // 标记是否已找到结束标记
  isElseIf?: boolean; // 标记是否为ElseIf语句
  isElse?: boolean; // 标记是否为Else语句
}

export interface RtBasicSub {
  name: string;
  parameters: RtBasicParameter[];
  range: vscode.Range;
  isGlobal: boolean;
  returnType?: string;
  sourceFile?: string;
  description?: string; // 添加函数描述属性
}

export interface RtBasicParameter {
  name: string;
  isArray?: boolean;
  arraySize?: number;
  type?: string;
  description?: string;
  direction?: "in" | "out" | "inout"; // 添加参数方向属性
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
      // 匹配变量声明的开始部分
      GLOBAL_DIM: /^global\s+(?:dim\s+)?(.+)$/i,
      GLOBAL_CONST: /global\s+const\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*=\s*(.*?)(?:\s+as\s+([a-zA-Z_][a-zA-Z0-9_]*))?(?:\s*'.*)?$/i,
      DIM: /^dim\s+(.+)$/i,
      LOCAL: /^local\s+(.+)$/i,
      CONST: /const\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*=\s*(.*?)(?:\s+as\s+([a-zA-Z_][a-zA-Z0-9_]*))?(?:\s*'.*)?$/i,
      
      // 匹配单个变量声明（包括可选的数组大小和类型）
      VARIABLE_DECLARATION: /([a-zA-Z_][a-zA-Z0-9_]*)\s*(?:\((\d+)\))?\s*(?:as\s+([a-zA-Z_][a-zA-Z0-9_]*))?/i,
      
      // 辅助正则表达式
      ARRAY: /(\w+)\s*\((\d+)\)/,
      TYPE: /as\s+([a-zA-Z_][a-zA-Z0-9_]*)/i
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

      // 处理If语句相关的控制块
      if (this.handleIfStatement(text, lineRange, currentSub, activeControlBlocks)) {
        continue;
      }

      // 处理For和While语句
      if (this.handleLoopStatement(text, lineRange, currentSub, activeControlBlocks)) {
        continue;
      }

      // 处理控制块结束
      if (this.handleControlBlockEnd(text, lineRange, activeControlBlocks)) {
        // 更新当前控制块为栈顶的控制块（如果有的话）
        currentControlBlock = activeControlBlocks.length > 0
          ? activeControlBlocks[activeControlBlocks.length - 1]
          : undefined;
        continue;
      }

      // 解析全局Sub
      if (text.toLowerCase().startsWith("global sub")) {
        const match = text.match(/global\s+sub\s+(\w+)\s*\((.*)\)(?:\s+as\s+(\w+))?/i);
        if (match) {
          // 提取函数的文档注释
          const { comments, description } = this.extractDocComments(document, i);
          
          const sub: RtBasicSub = {
            name: match[1],
            parameters: this.parseParameters(match[2], comments),
            range: new vscode.Range(line.range.start, line.range.end),
            isGlobal: true,
            returnType: match[3], // 捕获返回类型
            sourceFile: document.uri.fsPath,
            description: description
          };
          this.symbols.subs.push(sub);
          currentSub = sub;
        }
      }

      // 解析普通Sub
      else if (text.toLowerCase().startsWith("sub")) {
        const match = text.match(/sub\s+(\w+)\s*\((.*)\)(?:\s+as\s+(\w+))?/i);
        if (match) {
          // 提取函数的文档注释
          const { comments, description } = this.extractDocComments(document, i);
          
          const sub: RtBasicSub = {
            name: match[1],
            parameters: this.parseParameters(match[2], comments),
            range: new vscode.Range(line.range.start, line.range.end),
            isGlobal: false,
            returnType: match[3], // 捕获返回类型
            sourceFile: document.uri.fsPath,
            description: description
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
            sourceFile: document.uri.fsPath
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
            sourceFile: document.uri.fsPath
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

      // 检查变量声明
      else if ((text.toLowerCase().startsWith("global") ||
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
    }

    return this.symbols;
  }

  /**
   * 处理If语句相关的控制块
   * 包括单行if、多行if-then、带elseif的if和带else的if
   */
  private handleIfStatement(
    text: string,
    lineRange: vscode.Range,
    currentSub: RtBasicSub | undefined,
    activeControlBlocks: ControlBlock[]
  ): boolean {
    // 检查单行If语句
    if (RtBasicParser.REGEX.IF.SINGLE_LINE.test(text)) {
      const singleLineIfBlock: ControlBlock = {
        type: "If",
        range: lineRange,
        parentSub: currentSub?.name,
        variables: [],
        isSingleLine: true,
        hasEndToken: true // 单行if语句立即标记为已结束
      };
      
      // 如果在其他控制块内，设置父块
      if (activeControlBlocks.length > 0) {
        singleLineIfBlock.parentBlock = activeControlBlocks[activeControlBlocks.length - 1];
      }
      
      this.symbols.controlBlocks.push(singleLineIfBlock);
      return true;
    }

    // 检查ElseIf语句
    if (RtBasicParser.REGEX.IF.ELSEIF.test(text)) {
      // 查找最近的未结束的If块
      for (let i = activeControlBlocks.length - 1; i >= 0; i--) {
        const block = activeControlBlocks[i];
        if (block.type === "If" && !block.hasEndToken && !block.isElseIf) {
          const elseIfBlock: ControlBlock = {
            type: "If",
            range: lineRange,
            parentSub: currentSub?.name,
            parentBlock: block,
            variables: [],
            isSingleLine: false,
            hasEndToken: false,
            isElseIf: true
          };
          
          this.symbols.controlBlocks.push(elseIfBlock);
          activeControlBlocks.push(elseIfBlock);
          return true;
        }
      }
    }

    // 检查Else语句
    if (RtBasicParser.REGEX.IF.ELSE.test(text)) {
      // 查找最近的未结束的If块
      for (let i = activeControlBlocks.length - 1; i >= 0; i--) {
        const block = activeControlBlocks[i];
        if (block.type === "If" && !block.hasEndToken && !block.isElseIf) {
          const elseBlock: ControlBlock = {
            type: "If",
            range: lineRange,
            parentSub: currentSub?.name,
            parentBlock: block,
            variables: [],
            isSingleLine: false,
            hasEndToken: false,
            isElse: true
          };
          
          this.symbols.controlBlocks.push(elseBlock);
          activeControlBlocks.push(elseBlock);
          return true;
        }
      }
    }

    // 检查多行If语句开始
    if (RtBasicParser.REGEX.IF.START.test(text) && !RtBasicParser.REGEX.IF.SINGLE_LINE.test(text)) {
      const ifBlock: ControlBlock = {
        type: "If",
        range: lineRange,
        parentSub: currentSub?.name,
        variables: [],
        isSingleLine: false,
        hasEndToken: false
      };
      
      // 如果在其他控制块内，设置父块
      if (activeControlBlocks.length > 0) {
        ifBlock.parentBlock = activeControlBlocks[activeControlBlocks.length - 1];
      }
      
      this.symbols.controlBlocks.push(ifBlock);
      activeControlBlocks.push(ifBlock);
      return true;
    }

    return false;
  }

  /**
   * 处理循环语句（For和While）
   */
  private handleLoopStatement(
    text: string,
    lineRange: vscode.Range,
    currentSub: RtBasicSub | undefined,
    activeControlBlocks: ControlBlock[]
  ): boolean {
    // 检查For循环开始
    if (RtBasicParser.REGEX.FOR.START.test(text)) {
      const forBlock: ControlBlock = {
        type: "For",
        range: lineRange,
        parentSub: currentSub?.name,
        variables: [],
        isSingleLine: false,
        hasEndToken: false
      };
      
      // 如果在其他控制块内，设置父块
      if (activeControlBlocks.length > 0) {
        forBlock.parentBlock = activeControlBlocks[activeControlBlocks.length - 1];
      }
      
      this.symbols.controlBlocks.push(forBlock);
      activeControlBlocks.push(forBlock);
      return true;
    }

    // 检查While循环开始
    if (RtBasicParser.REGEX.WHILE.START.test(text)) {
      const whileBlock: ControlBlock = {
        type: "While",
        range: lineRange,
        parentSub: currentSub?.name,
        variables: [],
        isSingleLine: false,
        hasEndToken: false
      };
      
      // 如果在其他控制块内，设置父块
      if (activeControlBlocks.length > 0) {
        whileBlock.parentBlock = activeControlBlocks[activeControlBlocks.length - 1];
      }
      
      this.symbols.controlBlocks.push(whileBlock);
      activeControlBlocks.push(whileBlock);
      return true;
    }

    return false;
  }

  /**
   * 处理控制块的结束
   */
  private handleControlBlockEnd(
    text: string,
    lineRange: vscode.Range,
    activeControlBlocks: ControlBlock[]
  ): boolean {
    // 检查End If
    if (RtBasicParser.REGEX.IF.END.test(text)) {
      // 从栈顶向下查找最近的未结束的If块
      for (let i = activeControlBlocks.length - 1; i >= 0; i--) {
        const block = activeControlBlocks[i];
        if (block.type === "If" && !block.hasEndToken && !block.isElseIf && !block.isElse) {
          // 更新块的范围和结束状态
          block.range = new vscode.Range(block.range.start, lineRange.end);
          block.hasEndToken = true;
          
          // 同时结束所有相关的ElseIf和Else块
          for (let j = i + 1; j < activeControlBlocks.length; j++) {
            const relatedBlock = activeControlBlocks[j];
            if (relatedBlock.type === "If" &&
              (relatedBlock.isElseIf || relatedBlock.isElse) &&
              relatedBlock.parentBlock === block) {
              relatedBlock.hasEndToken = true;
              relatedBlock.range = new vscode.Range(
                relatedBlock.range.start,
                lineRange.end
              );
            }
          }
          
          // 从活动控制块栈中移除已结束的块
          activeControlBlocks.splice(i);
          return true;
        }
      }
    }

    // 检查Next（For循环结束）
    if (RtBasicParser.REGEX.FOR.END.test(text)) {
      // 从栈顶向下查找最近的未结束的For块
      for (let i = activeControlBlocks.length - 1; i >= 0; i--) {
        const block = activeControlBlocks[i];
        if (block.type === "For" && !block.hasEndToken) {
          // 更新块的范围和结束状态
          block.range = new vscode.Range(block.range.start, lineRange.end);
          block.hasEndToken = true;
          
          // 从活动控制块栈中移除已结束的块
          activeControlBlocks.splice(i);
          return true;
        }
      }
    }

    // 检查Wend（While循环结束）
    if (RtBasicParser.REGEX.WHILE.END.test(text)) {
      // 从栈顶向下查找最近的未结束的While块
      for (let i = activeControlBlocks.length - 1; i >= 0; i--) {
        const block = activeControlBlocks[i];
        if (block.type === "While" && !block.hasEndToken) {
          // 更新块的范围和结束状态
          block.range = new vscode.Range(block.range.start, lineRange.end);
          block.hasEndToken = true;
          
          // 从活动控制块栈中移除已结束的块
          activeControlBlocks.splice(i);
          return true;
        }
      }
    }

    return false;
  }

  /**
   * 解析变量声明并创建变量对象
   * @param varDecl 变量声明信息，可以是字符串或包含名称、数组大小和类型的对象
   * @param range 变量声明的范围
   * @param scope 变量作用域
   * @param structType 变量类型
   * @param parentSub 父函数名称
   * @param parentBlock 父控制块
   * @returns 变量对象
   */
  private inferTypeFromValue(value: string): string {
    // 移除首尾空格
    value = value.trim();

    // 检查是否为字符串（以双引号或单引号包围）
    if ((value.startsWith('"') && value.endsWith('"')) || 
        (value.startsWith("'") && value.endsWith("'"))) {
      return "String";
    }

    // 检查是否为布尔值
    if (value.toLowerCase() === "true" || value.toLowerCase() === "false") {
      return "Boolean";
    }

    // 检查是否为浮点数
    if (value.includes('.') || value.toLowerCase().includes('e')) {
      return "Double";
    }

    // 检查是否为整数
    if (/^-?\d+$/.test(value)) {
      // 检查数值范围，决定使用Integer还是Long
      const num = parseInt(value);
      if (num >= -32768 && num <= 32767) {
        return "Integer";
      } else {
        return "Long";
      }
    }

    // 十六进制整数
    if (/\$\d+$/.test(value)) {
      const num = parseInt(value.substring(1), 16);
      if (num >= -32768 && num <= 32767) {
        return "Integer";
      } else {
        return "Long";
      }
    }

    // 默认返回Variant类型
    return "Variant";
  }

  private parseVariableDeclaration(
    varDecl: string | { name: string; arraySize?: number; type?: string },
    range: vscode.Range,
    scope: "global" | "local" | "file" | "block",
    structType?: string,
    parentSub?: string,
    parentBlock?: ControlBlock
  ): RtBasicVariable {
    const blockType = parentBlock ? parentBlock.type : undefined;
    
    // 如果传入的是对象，直接使用其属性
    if (typeof varDecl === 'object') {
      return {
        name: varDecl.name,
        range,
        scope,
        ...(varDecl.arraySize && { isArray: true, arraySize: varDecl.arraySize }),
        structType: varDecl.type || structType,
        parentSub,
        parentBlock,
        blockType: blockType ? String(blockType) : undefined
      };
    }
    
    // 如果传入的是字符串，检查是否为数组变量
    const arrayMatch = varDecl.match(RtBasicParser.REGEX.VARIABLE.ARRAY);
    if (arrayMatch) {
      return {
        name: arrayMatch[1],
        range,
        scope,
        isArray: true,
        arraySize: parseInt(arrayMatch[2]),
        structType,
        parentSub,
        parentBlock,
        blockType: blockType ? String(blockType) : undefined
      };
    }
    
    // 普通变量
    return {
      name: varDecl,
      range,
      scope,
      structType,
      parentSub,
      parentBlock,
      blockType: blockType ? String(blockType) : undefined
    };
  }

  /**
   * 检测变量声明并创建变量对象
   * 支持单行多个变量定义，如：dim a, b, c as Integer
   */
  private detectVariableDeclaration(
    text: string,
    lineRange: vscode.Range,
    currentSub?: RtBasicSub,
    currentControlBlock?: ControlBlock
  ): { variable: RtBasicVariable; scope: "global" | "local" | "file" | "block" } | undefined {
    // 检查全局变量声明
    if (text.toLowerCase().startsWith("global")) {
      const globalConstMatch = text.match(RtBasicParser.REGEX.VARIABLE.GLOBAL_CONST);
      if (globalConstMatch) {
        const varName = globalConstMatch[1].trim();
        const value = globalConstMatch[2].trim();
        const type = globalConstMatch[3]?.trim();

        const variable = this.parseVariableDeclaration(
          varName,
          lineRange,
          "global",
          type,
          undefined,
          currentControlBlock
        );

        // 添加常量特定属性
        variable.isConst = true;
        variable.value = value;
        variable.type = type || this.inferTypeFromValue(value);

        return { variable, scope: "global" };
      }

      const globalDimMatch = text.match(RtBasicParser.REGEX.VARIABLE.GLOBAL_DIM);
      if (globalDimMatch) {
        const varDeclaration = globalDimMatch[1].trim();
        
        // 提取变量声明中的所有变量
        const varDeclarations = this.extractVariableDeclarations(varDeclaration);
        
        if (varDeclarations.length > 0) {
          // 处理第一个变量（保持原有行为，只返回第一个变量）
          const firstVar = varDeclarations[0];
          const variable = this.parseVariableDeclaration(
            firstVar,
            lineRange,
            "global",
            undefined,
            undefined,
            currentControlBlock
          );
          
          // 如果有多个变量，将其他变量添加到符号表中
          if (varDeclarations.length > 1) {
            for (let i = 1; i < varDeclarations.length; i++) {
              const varInfo = varDeclarations[i];
              const additionalVar = this.parseVariableDeclaration(
                varInfo,
                lineRange,
                "global",
                undefined,
                undefined,
                currentControlBlock
              );
              this.symbols.variables.push(additionalVar);
              
              // 如果变量在控制块内，将其添加到控制块的变量列表中
              if (currentControlBlock) {
                if (!currentControlBlock.variables) {
                  currentControlBlock.variables = [];
                }
                currentControlBlock.variables.push(additionalVar);
              }
            }
          }
          
          return { variable, scope: "global" };
        }
      }
    }
    
    // 检查文件变量声明
    else if (text.toLowerCase().startsWith("dim")) {
      const dimMatch = text.match(RtBasicParser.REGEX.VARIABLE.DIM);
      if (dimMatch) {
        const varDeclaration = dimMatch[1].trim();
        
        // 提取变量声明中的所有变量
        const varDeclarations = this.extractVariableDeclarations(varDeclaration);
        
        if (varDeclarations.length > 0) {
          // 处理第一个变量（保持原有行为，只返回第一个变量）
          const firstVar = varDeclarations[0];
          const variable = this.parseVariableDeclaration(
            firstVar,
            lineRange,
            "file",
            undefined,
            undefined,
            currentControlBlock
          );
          
          // 如果有多个变量，将其他变量添加到符号表中
          if (varDeclarations.length > 1) {
            for (let i = 1; i < varDeclarations.length; i++) {
              const varInfo = varDeclarations[i];
              const additionalVar = this.parseVariableDeclaration(
                varInfo,
                lineRange,
                "file",
                undefined,
                undefined,
                currentControlBlock
              );
              this.symbols.variables.push(additionalVar);
              
              // 如果变量在控制块内，将其添加到控制块的变量列表中
              if (currentControlBlock) {
                if (!currentControlBlock.variables) {
                  currentControlBlock.variables = [];
                }
                currentControlBlock.variables.push(additionalVar);
              }
            }
          }
          
          return { variable, scope: "file" };
        }
      }
    }
    
    // 检查常量声明
    else if (text.toLowerCase().startsWith("const") && currentControlBlock) {
      const constMatch = text.match(RtBasicParser.REGEX.VARIABLE.CONST);
      if (constMatch) {
        const varName = constMatch[1].trim();
        const value = constMatch[2].trim();
        const type = constMatch[3]?.trim();

        const variable = this.parseVariableDeclaration(
          varName,
          lineRange,
          "block",
          type,
          currentSub?.name,
          currentControlBlock
        );

        // 添加常量特定属性
        variable.isConst = true;
        variable.value = value;
        variable.type = type || this.inferTypeFromValue(value);

        return { variable, scope: "block" };
      }
    }
    // 检查局部变量声明
    else if (text.toLowerCase().startsWith("local")) {
      const localMatch = text.match(RtBasicParser.REGEX.VARIABLE.LOCAL);
      if (localMatch && (currentSub || currentControlBlock)) {
        const varDeclaration = localMatch[1].trim();
        
        // 提取变量声明中的所有变量
        const varDeclarations = this.extractVariableDeclarations(varDeclaration);
        
        if (varDeclarations.length > 0) {
          const scope = currentControlBlock ? "block" : "local";
          
          // 处理第一个变量（保持原有行为，只返回第一个变量）
          const firstVar = varDeclarations[0];
          const variable = this.parseVariableDeclaration(
            firstVar,
            lineRange,
            scope,
            undefined,
            currentSub?.name,
            currentControlBlock
          );
          
          // 如果有多个变量，将其他变量添加到符号表中
          if (varDeclarations.length > 1) {
            for (let i = 1; i < varDeclarations.length; i++) {
              const varInfo = varDeclarations[i];
              const additionalVar = this.parseVariableDeclaration(
                varInfo,
                lineRange,
                scope,
                undefined,
                currentSub?.name,
                currentControlBlock
              );
              this.symbols.variables.push(additionalVar);
              
              // 如果变量在控制块内，将其添加到控制块的变量列表中
              if (currentControlBlock) {
                if (!currentControlBlock.variables) {
                  currentControlBlock.variables = [];
                }
                currentControlBlock.variables.push(additionalVar);
              }
            }
          }
          
          return { variable, scope };
        }
      }
    }
    
    return undefined;
  }

  /**
   * 从变量声明字符串中提取所有变量信息
   * 支持如下格式：
   * - 单个变量: varName
   * - 带类型的变量: varName as Type
   * - 数组变量: varName(10)
   * - 带类型的数组变量: varName(10) as Type
   * - 多个变量: varName1, varName2, varName3 as Type
   */
  /**
   * 从变量声明字符串中提取所有变量信息
   * @param declarationStr 变量声明字符串，不包含开头的 global/dim/local 关键字
   * @returns 变量声明数组，每个元素包含变量名、数组大小（可选）和类型（可选）
   */
  private extractVariableDeclarations(declarationStr: string): Array<{
    name: string;
    arraySize?: number;
    type?: string;
  }> {
    const result: Array<{
      name: string;
      arraySize?: number;
      type?: string;
    }> = [];

    // 移除可能的行尾注释
    const strWithoutComment = declarationStr.replace(/('|rem\s).*$/i, '').trim();
    
    // 分割多个变量声明
    const declarations = strWithoutComment.split(',').map(decl => decl.trim());
    
    for (const declaration of declarations) {
      // 使用 VARIABLE_DECLARATION 正则表达式匹配单个变量声明
      const match = declaration.match(RtBasicParser.REGEX.VARIABLE.VARIABLE_DECLARATION);
      
      if (match) {
        const [, name, arraySize, type] = match;
        
        result.push({
          name: name.trim(),
          ...(arraySize && { arraySize: parseInt(arraySize, 10) }),
          ...(type && { type: type.trim() })
        });
      }
    }
    
    return result;
  }

  /**
   * 解析函数参数
   */
  private parseParameters(paramsText: string, docComments?: string[]): RtBasicParameter[] {
    if (!paramsText.trim()) {
      return [];
    }

    // 解析参数注释
    const paramDescriptions: Record<string, string> = {};
    const paramDirections: Record<string, "in" | "out" | "inout"> = {};
    
    if (docComments && docComments.length > 0) {
      docComments.forEach(comment => {
        // 匹配 @param paramName Description 格式的注释
        const paramMatch = comment.match(/@param\s+(\w+)\s+(.*)/i);
        if (paramMatch) {
          const paramName = paramMatch[1];
          let description = paramMatch[2].trim();
          
          // 检查描述中是否包含方向信息 [in], [out], [inout]
          const directionMatch = description.match(/\[(in|out|inout)\]/i);
          if (directionMatch) {
            const direction = directionMatch[1].toLowerCase() as "in" | "out" | "inout";
            paramDirections[paramName] = direction;
            // 从描述中移除方向标记
            description = description.replace(/\[(in|out|inout)\]\s*/i, '').trim();
          }
          
          paramDescriptions[paramName] = description;
        }
      });
    }

    return paramsText.split(",").map((param) => {
      param = param.trim();
      
      // 解析参数方向
      let direction: "in" | "out" | "inout" | undefined;
      if (param.toLowerCase().includes("byval")) {
        direction = "in";
        param = param.replace(/byval\s+/i, "");
      } else if (param.toLowerCase().includes("byref")) {
        direction = "inout";
        param = param.replace(/byref\s+/i, "");
      }
      
      // 解析参数类型
      let type: string | undefined;
      const asMatch = param.match(/\s+as\s+(\w+)/i);
      if (asMatch) {
        type = asMatch[1];
        param = param.replace(/\s+as\s+\w+/i, "");
      }
      
      // 解析参数名称
      let paramName: string;
      // 解析数组参数
      const arrayMatch = param.match(RtBasicParser.REGEX.VARIABLE.ARRAY);
      if (arrayMatch) {
        paramName = arrayMatch[1];
        // 如果注释中指定了方向，优先使用注释中的方向
        const paramDirection = paramDirections[paramName] || direction;
        return {
          name: paramName,
          isArray: true,
          arraySize: parseInt(arrayMatch[2]),
          type,
          direction: paramDirection,
          description: paramDescriptions[paramName]
        };
      }

      // 解析普通参数
      const match = param.match(/(\w+)/i);
      paramName = match ? match[1] : param;
      // 如果注释中指定了方向，优先使用注释中的方向
      const paramDirection = paramDirections[paramName] || direction;
      return {
        name: paramName,
        type,
        direction: paramDirection,
        description: paramDescriptions[paramName]
      };
    });
  }

  /**
   * 提取函数的文档注释
   * @param document 文档对象
   * @param lineIndex 函数定义所在行的索引
   * @returns 包含注释数组和函数描述的对象
   */
  private extractDocComments(document: vscode.TextDocument, lineIndex: number): { comments: string[], description: string } {
    const comments: string[] = [];
    let description = '';
    let isDescriptionSection = true; // 默认先收集描述，直到遇到@标签
    
    // 向上查找注释行
    for (let i = lineIndex - 1; i >= 0; i--) {
      const line = document.lineAt(i).text.trim();
      
      // 如果不是注释行，则停止查找
      if (!line.startsWith("'") && !line.startsWith("REM ")) {
        break;
      }
      
      // 提取注释内容
      let commentText = line;
      if (line.startsWith("'")) {
        commentText = line.substring(1).trim();
      } else if (line.startsWith("REM ")) {
        commentText = line.substring(4).trim();
      }
      
      // 检查是否是标签注释（如@param, @return等）
      if (commentText.match(/@\w+/)) {
        isDescriptionSection = false; // 遇到标签后，不再收集描述
      } else if (isDescriptionSection && commentText) {
        // 如果是描述部分且不为空，添加到描述中
        if (description) {
          description = commentText + '\n' + description; // 保持原始顺序
        } else {
          description = commentText;
        }
      }
      
      comments.unshift(commentText); // 按原始顺序添加所有注释
    }
    
    return { comments, description };
  }

  /**
   * 获取指定位置的符号信息
   */
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
    const structure = this.symbols.structures.find((s) => s.name === word);
    if (structure) {
      return new vscode.SymbolInformation(
        structure.name,
        vscode.SymbolKind.Struct,
        structure.isGlobal ? "global" : "file",
        new vscode.Location(document.uri, structure.range)
      );
    }

    return undefined;
  }
}