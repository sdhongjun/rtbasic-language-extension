import * as fs from 'fs';
import * as path from 'path';
import { parse } from 'yaml';
import { RtBasicBuiltinFunctions } from './rtbasicParser';

// 读取 YAML 文件
const yamlPath = path.join(__dirname, 'builtinFunctions.yaml');
const yamlContent = fs.readFileSync(yamlPath, 'utf8');

// 解析 YAML 内容
const parsedYaml = parse(yamlContent) as RtBasicBuiltinFunctions;

// 导出解析后的内置函数
const builtinFunctions: RtBasicBuiltinFunctions = parsedYaml;

export default builtinFunctions;