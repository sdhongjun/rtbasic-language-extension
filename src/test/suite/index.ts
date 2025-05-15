import * as path from 'path';
import * as Mocha from 'mocha';
import * as glob from 'glob';

export function run(): Promise<void> {
    // 创建 mocha 测试
    const mocha = new Mocha({
        ui: 'tdd',
        color: true
    });

    const testsRoot = path.resolve(__dirname, '..');

    return new Promise((c, e) => {
        glob('**/**.test.js', { cwd: testsRoot }, (err, files) => {
            if (err) {
                return e(err);
            }

            // 添加文件到测试套件
            files.forEach(f => mocha.addFile(path.resolve(testsRoot, f)));

            try {
                // 运行测试
                mocha.run(failures => {
                    if (failures > 0) {
                        e(new Error(`${failures} 个测试失败`));
                    } else {
                        c();
                    }
                });
            } catch (err) {
                e(err);
            }
        });
    });
}