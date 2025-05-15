import * as path from 'path';
import * as cp from 'child_process';
import {
    downloadAndUnzipVSCode,
    resolveCliArgsFromVSCodeExecutablePath,
    runTests
} from '@vscode/test-electron';

async function main() {
    try {
        // 下载 VSCode 的特定版本，解压并返回可执行路径
        const vscodeExecutablePath = await downloadAndUnzipVSCode('stable');
        console.log(`使用 VSCode 路径: ${vscodeExecutablePath}`);

        // 获取 VSCode 可执行文件的命令行参数
        const [cliPath, ...args] = resolveCliArgsFromVSCodeExecutablePath(vscodeExecutablePath);

        // 使用 cp.spawn 运行 VSCode CLI
        cp.spawnSync(cliPath, [...args, '--install-extension', 'dbaeumer.vscode-eslint'], {
            encoding: 'utf-8',
            stdio: 'inherit'
        });

        // 扩展的根目录
        const extensionDevelopmentPath = path.resolve(__dirname, '../../');
        
        // 测试文件的路径
        const extensionTestsPath = path.resolve(__dirname, './suite/index');

        // 下载 VSCode，运行测试，然后处理结果
        await runTests({
            vscodeExecutablePath,
            extensionDevelopmentPath,
            extensionTestsPath,
        });
    } catch (err) {
        console.error('运行测试时出错:', err);
        process.exit(1);
    }
}

main();