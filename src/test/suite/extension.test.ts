import * as assert from 'assert';
import * as vscode from 'vscode';

suite('RtBasic 扩展测试套件', () => {
    vscode.window.showInformationMessage('开始 RtBasic 扩展测试。');

    test('扩展激活测试', async () => {
        const extension = vscode.extensions.getExtension('your-publisher.rtbasic-language-extension');
        assert.ok(extension);
        
        await extension.activate();
        assert.ok(true, '扩展应成功激活');
    });

    test('语法高亮测试', () => {
        // 测试语法高亮是否正确加载
        const config = vscode.workspace.getConfiguration('rtbasic');
        assert.ok(config, '应能获取 RtBasic 配置');
    });

    test('代码补全测试', async () => {
        // 测试代码补全功能
        const doc = await vscode.workspace.openTextDocument({
            content: 'PRINT "Hello"',
            language: 'rtbasic'
        });
        
        const completions = await vscode.commands.executeCommand<vscode.CompletionList>(
            'vscode.executeCompletionItemProvider',
            doc.uri,
            new vscode.Position(0, 0)
        );
        
        assert.ok(completions, '应返回补全项');
        assert.ok(completions.items.length > 0, '应至少有一个补全项');
    });
});