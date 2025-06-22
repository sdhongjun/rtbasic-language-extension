import * as vscode from "vscode";

export interface RtBasicVariable {
  name: string;
  range: vscode.Range;
  scope: "global" | "local" | "file" | "block" | "parameter";
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
  isStructMember?: boolean; // 标记是否为结构体成员
  structName?: string; // 结构体变量名
  memberName?: string; // 成员名称
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
  parentSub?: string; // 所属函数名，仅对局部结构体有效
}

export interface RtBasicCFunction {
  name: string;         // RtBasic中的函数名
  cFunctionDecl: string; // C函数声明
  range: vscode.Range;
  sourceFile?: string;
}

export interface RtBasicBuiltinFunction {
  name: string;
  description: string;
  parameters: Array<{
    name: string;
    type: string;
    description?: string;
    optional?: boolean;
  }>;
  returnType: string;
  example?: string;
}

export interface RtBasicBuiltinFunctions {
  functions: RtBasicBuiltinFunction[];
}

export interface RtBasicSymbol {
  variables: RtBasicVariable[];
  subs: RtBasicSub[];
  structures: RtBasicStructure[];
  controlBlocks: ControlBlock[];
  cFunctions: RtBasicCFunction[];
  builtinFunctions: RtBasicBuiltinFunction[];
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
      // 匹配单个变量声明（包括可选的数组大小和类型）以及结构体成员访问
      VARIABLE_DECLARATION: /([a-zA-Z_][a-zA-Z0-9_]*(?:\.[a-zA-Z_][a-zA-Z0-9_]*)*)\s*(?:\((\d+)\))?\s*(?:as\s+([a-zA-Z_][a-zA-Z0-9_]*))?/i,
      
      // 辅助正则表达式
      ARRAY: /(\w+)\s*\((.+)\)/,
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
    cFunctions: [],
    builtinFunctions: []
  };

  private constants = new Map<string, number>();

  constructor() {
    this.reset();
    this.loadBuiltinFunctions();
  }

  public reset(): void {
    this.symbols = {
      variables: [],
      subs: [],
      structures: [],
      controlBlocks: [],
      cFunctions: [],
      builtinFunctions: []
    };
    this.constants.clear();
  }

  private async loadBuiltinFunctions(): Promise<void> {
    try {
      const fs = require('fs');
      const path = require('path');
      
      // 获取内置函数定义文件的路径
      const configPath = path.join(__dirname, 'builtinFunctions.json');
      
      // 读取并解析配置文件
      const configContent = fs.readFileSync(configPath, 'utf8');
      const config = JSON.parse(configContent) as RtBasicBuiltinFunctions;
      
      // 更新内置函数列表
      this.symbols.builtinFunctions = config.functions;
      
      console.log(`Loaded ${this.symbols.builtinFunctions.length} builtin functions`);
    } catch (error) {
      console.error('Failed to load builtin functions:', error);
      // 确保即使加载失败也至少有ZINDEX_STRUCT函数
      this.symbols.builtinFunctions = [{
        name: 'ZINDEX_STRUCT',
        description: '访问结构体成员。用于通过结构体名称和结构体指针访问结构体成员。',
        parameters: [
          {
            name: 'structName',
            type: 'String',
            description: '结构体名称',
            optional: false
          },
          {
            name: 'structPtr',
            type: 'Long',
            description: '结构体指针',
            optional: false
          }
        ],
        returnType: 'Variant',
        example: 'result = ZINDEX_STRUCT("MyStruct", ptr).memberName'
      }];
    }
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
      // 解析结构体开始
      else if (text.toLowerCase().startsWith("structure")) {
        const match = text.match(/structure\s+(\w+)/i);
        if (match) {
          // 根据上下文确定结构体作用域
          const isGlobal = false; // 无global修饰符的结构体默认不是全局的
          const inSub = currentSub !== undefined;
          
          currentStructure = {
            name: match[1],
            members: [],
            range: new vscode.Range(line.range.start, line.range.end),
            isGlobal: isGlobal,
            sourceFile: document.uri.fsPath
          };
          
          // 如果在函数或控制块内，设置parentSub
          if (inSub) {
            currentStructure.parentSub = currentSub?.name;
          }
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
           text.toLowerCase().startsWith("local") ||
           text.toLowerCase().startsWith("const")) && 
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
    // 验证变量有效性
    if (typeof varDecl === 'string' && !this.validateVariable({
      name: varDecl,
      range,
      scope,
      structType,
      parentSub,
      parentBlock,
      isStructMember: varDecl.includes('.'),
      structName: varDecl.includes('.') ? varDecl.split('.')[0] : undefined,
      memberName: varDecl.includes('.') ? varDecl.split('.')[1] : undefined
    })) {
      throw new Error(`Invalid variable declaration: ${varDecl}`);
    }
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
      // 检查数组变量是否是结构体成员
      const isStructMember = arrayMatch[1].includes('.');
      const structName = isStructMember ? arrayMatch[1].split('.')[0] : undefined;
      const memberName = isStructMember ? arrayMatch[1].split('.')[1] : arrayMatch[1];
      
      return {
        name: arrayMatch[1],
        range,
        scope,
        isArray: true,
        arraySize: parseInt(arrayMatch[2]),
        structType: isStructMember ? structName : structType,
        parentSub,
        parentBlock,
        blockType: blockType ? String(blockType) : undefined,
        ...(isStructMember && { isStructMember: true, structName, memberName })
      };
    }
    
    // 检查是否是结构体成员访问表达式
    const isStructMemberAccess = varDecl.includes('.');
    if (isStructMemberAccess) {
      const [structVarName, memberName] = varDecl.split('.');
      
      // 查找结构体变量定义
      const structVar = this.symbols.variables.find(v => v.name === structVarName);
      const structType = structVar?.structType;
      
      return {
        name: varDecl,
        range,
        scope,
        structType,
        parentSub,
        parentBlock,
        blockType: blockType ? String(blockType) : undefined,
        isStructMember: true,
        structName: structVarName,
        memberName
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
    // 删除行尾注释
    let textWithoutComments = text.replace(/('|rem\s).*$/i, '').trim();
    const isGlobal = /\bglobal\b/i.test(textWithoutComments);
    const isConst = /\bconst\b/i.test(textWithoutComments);
    const isLocal = /\blocal\b/i.test(textWithoutComments);

    // 解析常量
    if (isConst) {
        const constMatch = text.match(/^(?:global\s+)?\bconst\b\s+(\w+)\s+=(.+)/i);
        if (constMatch) {
          const varName = constMatch[1].trim();// 常量名称
          const value = constMatch[2].trim(); // 常量值
          const scope: "global" | "file" = isGlobal ? "global" : "file";

          // 计算常量表达式值
          let evaluatedValue = value;
          const numericValue = this.evaluateMathExpression(value);
          if (numericValue !== undefined) {
            evaluatedValue = numericValue.toString();
          }

          const variable: RtBasicVariable = {
            name: varName,
            range: lineRange,
            scope: scope,
            structType: undefined,
            parentSub: currentSub?.name,
            parentBlock: undefined,
            blockType: undefined,
            isConst: true,
            value: evaluatedValue,
            type: this.inferTypeFromValue(value)
          };

          return { variable, scope: scope };
        }

        return undefined;
    }

    // 删除作用域修饰符
    textWithoutComments = textWithoutComments.replace(/(global\s+dim\s+|global\s+|dim\s+|local\s+)/i, '');
    
    // 提取变量声明中的所有变量声明
    const varDeclarations =
      this.extractVariableDeclarations(textWithoutComments);
    if (varDeclarations.length > 0) {
      const scope: "global" | "local" | "file" = isGlobal
        ? "global"
        : isLocal
        ? "local"
        : "file";

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
  private evaluateMathExpression(expr: string): number | undefined {
    if (!expr || !expr.trim()) {
      console.warn('警告: 空表达式');
      return undefined;
    }

    // 移除所有空白字符
    const cleanedExpr = expr.replace(/\s+/g, '');
    
    // 验证表达式只包含数字、运算符和括号
    if (!/^[\d+\-*\/()]+$/.test(cleanedExpr)) {
      console.warn(`警告: 表达式包含非法字符: ${cleanedExpr}`);
      return undefined;
    }

    // 使用Function构造函数安全计算表达式
    try {
      // eslint-disable-next-line no-new-func
      const result = new Function(`return ${cleanedExpr}`)();
      if (typeof result !== 'number' || isNaN(result)) {
        console.warn(`警告: 无效的数值结果: ${result}`);
        return undefined;
      }
      return Math.floor(result); // 确保返回整数
    } catch (e) {
      console.warn(`警告: 无法计算表达式 "${cleanedExpr}": ${
        e instanceof Error ? e.message : String(e)
      }`);
      return undefined;
    }
  }

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
    
    // 分割多个变量声明，但保留带as的类型声明
    const declarations: string[] = [];
    let currentDecl = '';
    let inAsClause = false;
    
    for (const part of declarationStr.split(',')) {
      const trimmedPart = part.trim();
      if (trimmedPart.includes(' as ')) {
        // 遇到as类型声明，结束当前声明
        currentDecl += (currentDecl ? ', ' : '') + trimmedPart;
        declarations.push(currentDecl);
        currentDecl = '';
        inAsClause = false;
      } else if (inAsClause) {
        // 在as子句中，继续添加到当前声明
        currentDecl += ', ' + trimmedPart;
      } else {
        // 普通变量声明部分
        if (currentDecl) {
          declarations.push(currentDecl);
          currentDecl = '';
        }
        currentDecl = trimmedPart;
      }
    }
    
    if (currentDecl) {
      declarations.push(currentDecl);
    }
    
    // 处理每个独立的变量声明
    for (const declaration of declarations) {
      // 匹配变量名、数组大小和类型
      const match = declaration.match(/^\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*(?:\(\s*([a-zA-Z0-9_]+)\s*\))?(?:\s+as\s+([a-zA-Z_][a-zA-Z0-9_]*))?/i);
      
      if (match) {
        const [, name, arraySizeExpr, type] = match;
        const varName = name.trim();
        const varType = type?.trim();
        
        // 处理数组维度
        let arraySize: number | undefined;
        if (arraySizeExpr) {
          // 尝试解析为数字
          if (/^\d+$/.test(arraySizeExpr)) {
            arraySize = parseInt(arraySizeExpr, 10);
          } 
          // 尝试解析为常量
          else if (this.constants.has(arraySizeExpr)) {
            arraySize = this.constants.get(arraySizeExpr);
          }
          // 尝试解析为算术表达式或变量引用
          else {
            // 替换变量引用为常量值
            let expr = arraySizeExpr;
            const varMatches = arraySizeExpr.matchAll(/([a-zA-Z_]\w*)/g);
            for (const match of varMatches) {
              const varName = match[1];
              if (this.constants.has(varName)) {
                expr = expr.replace(new RegExp(`\\b${varName}\\b`, 'g'), this.constants.get(varName)!.toString());
              }
            }
            
            // 安全计算表达式
            const evaluatedSize = this.evaluateMathExpression(expr);
            if (evaluatedSize !== undefined && evaluatedSize >= 0) {
              arraySize = evaluatedSize;
            } else {
              console.warn(`无法确定数组长度: ${arraySizeExpr}`);
            }
          }
        }
        
        result.push({
          name: varName,
          ...(arraySize && { arraySize }),
          ...(varType && { type: varType })
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
  /**
   * 获取指定位置的上下文信息
   * @param document 文档对象
   * @param position 位置
   * @param subs 函数列表
   * @param controlBlocks 控制块列表
   * @returns 包含当前上下文信息的对象
   */
  public getCurrentContext(
    document: vscode.TextDocument,
    position: vscode.Position,
    subs: RtBasicSub[],
    controlBlocks: ControlBlock[]
  ): { subName?: string; currentBlock?: ControlBlock } {
    // 首先找到当前所在的函数
    const currentSub = subs.find(sub => 
      sub.range.contains(position)
    );

    // 如果不在任何函数中，直接返回空上下文
    if (!currentSub) {
      return {};
    }

    // 找到当前位置所在的所有控制块
    const containingBlocks = controlBlocks
      .filter(block => 
        block.range.contains(position) && 
        block.parentSub === currentSub.name
      )
      // 按照范围大小排序，最小的范围（最内层的块）在前
      .sort((a, b) => {
        const aSize = (a.range.end.line - a.range.start.line) * 1000 + (a.range.end.character - a.range.start.character);
        const bSize = (b.range.end.line - b.range.start.line) * 1000 + (b.range.end.character - b.range.start.character);
        return aSize - bSize;
      });

    // 返回上下文信息
    return {
      subName: currentSub.name,
      currentBlock: containingBlocks.length > 0 ? containingBlocks[0] : undefined
    };
  }

  /**
   * 获取指定常量的值
   * @param name 常量名称
   * @returns 常量值字符串，如果未找到则返回undefined
   */
  public getConstantValue(name: string): string | undefined {
    // 在符号表中查找匹配的常量
    const constant = this.symbols.variables.find(v => 
      v.name === name && v.isConst
    );
    
    return constant?.value;
  }

  /**
   * 验证变量是否符合语法规则
   * @param variable 要验证的变量
   * @returns 如果变量有效返回true，否则返回false
   */
  private validateVariable(variable: RtBasicVariable): boolean {
    // 检查结构体成员变量
    if (variable.isStructMember) {
      // 结构体成员格式应为 structName.memberName
      if (!variable.name.match(/^[a-zA-Z_][a-zA-Z0-9_]*\.[a-zA-Z_][a-zA-Z0-9_]*$/)) {
        return false;
      }
      
      // 检查结构体变量名是否有效
      if (!variable.structName || !variable.structName.match(/^[a-zA-Z_][a-zA-Z0-9_]*$/)) {
        return false;
      }
      
      // 检查成员名是否有效
      if (!variable.memberName || !variable.memberName.match(/^[a-zA-Z_][a-zA-Z0-9_]*$/)) {
        return false;
      }
    } 
    // 检查普通变量名是否有效
    else if (!variable.name.match(/^[a-zA-Z_][a-zA-Z0-9_]*$/)) {
      return false;
    }

    // 检查数组大小是否有效
    if (variable.isArray && (!variable.arraySize || variable.arraySize <= 0)) {
      return false;
    }

    return true;
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