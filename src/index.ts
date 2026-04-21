#!/usr/bin/env node

import { Command } from 'commander';
import { Logger } from './utils/logger';
import { chatCommand } from './commands/chat';
import { configCommand } from './commands/config';
import { registerSkillCommand } from './commands/skill';
import { feishuCommand } from './commands/feishu';
import { APP_VERSION } from './version';
import { RoleResolver } from './utils/role-resolver';
// import { LogUploadScheduler } from './utils/log-upload-scheduler';

// 启动日志上传调度器
// const uploadScheduler = new LogUploadScheduler();
// uploadScheduler.start();

// 优雅退出
// process.on('SIGINT', () => {
//   uploadScheduler.stop();
//   process.exit(0);
// });

function addRoleOption(command: Command): Command {
  return command.option('-r, --role <name>', '使用指定角色（roles/<name>）');
}

function main() {
  const program = new Command();

  // 显示品牌标识
  Logger.brand();

  addRoleOption(program)
    .name('xiaoba')
    .description('XiaoBa - 您的智能AI命令行助手')
    .version(APP_VERSION)
    .option('-s, --skill <name>', '启动时绑定指定 skill');

  program.hook('preAction', (_thisCommand, actionCommand) => {
    try {
      const options = actionCommand.optsWithGlobals() as { role?: string };
      RoleResolver.activateRole(options.role);
    } catch (error: any) {
      Logger.error(error.message);
      process.exit(1);
    }
  });

  // 聊天命令
  addRoleOption(program
    .command('chat')
    .description('开始与XiaoBa对话')
    .option('-i, --interactive', '进入交互式对话模式')
    .option('-m, --message <message>', '发送单条消息')
    .option('-s, --skill <name>', '启动时绑定指定 skill'))
    .action(chatCommand);

  // 配置命令
  addRoleOption(program
    .command('config')
    .description('配置XiaoBa的API设置'))
    .action(configCommand);

  // 飞书机器人命令
  addRoleOption(program
    .command('feishu')
    .description('启动飞书机器人（WebSocket 长连接模式）'))
    .action(feishuCommand);

  // Cats Company 机器人命令
  addRoleOption(program
    .command('catscompany')
    .description('启动 Cats Company 机器人（WebSocket 长连接模式）'))
    .action(async () => {
      const { catscompanyCommand } = await import('./commands/catscompany');
      await catscompanyCommand();
    });

  // 微信机器人命令
  addRoleOption(program
    .command('weixin')
    .description('启动微信机器人'))
    .action(async () => {
      const { weixinCommand } = await import('./commands/weixin');
      await weixinCommand();
    });

  // Dashboard 命令
  addRoleOption(program
    .command('dashboard')
    .description('启动 XiaoBa Dashboard 管理面板')
    .option('-p, --port <port>', '指定端口号', '3800'))
    .option('--host <host>', '指定监听地址（默认 127.0.0.1，可设为 0.0.0.0）')
    .action(async (options) => {
      const { dashboardCommand } = await import('./commands/dashboard');
      await dashboardCommand(options);
    });

  // Skill 管理命令
  registerSkillCommand(program);

  // 默认命令 - 进入交互模式
  program
    .action(() => {
      const opts = program.opts();
      chatCommand({ interactive: true, skill: opts.skill });
    });

  program.parse();
}

main();
