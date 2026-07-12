import { db } from '@/lib/db';
import { dynamicCommands } from '@/lib/db/schema';

const BUILTIN_COMMANDS = [
  { name: 'review', description: '开始 FSRS 复习' },
  { name: 'add', description: '添加新单词 (如: /add ephemeral)' },
  { name: 'pin', description: '置顶单词到侧边栏 (如: /pin ephemeral)' },
  { name: 'stats', description: '查看学习统计' },
  { name: 'dev', description: '触发开发者模式 (如: /dev 帮我写一个组件)' },
];

export async function GET() {
  try {
    const dynamic = await db
      .select({ name: dynamicCommands.name, description: dynamicCommands.description })
      .from(dynamicCommands);

    const commands = [
      ...BUILTIN_COMMANDS,
      ...dynamic
        .filter(c => !BUILTIN_COMMANDS.some(b => b.name === c.name))
        .map(c => ({ name: c.name, description: c.description })),
    ];

    return Response.json({ commands });
  } catch (error) {
    console.error('[Command List API Error]', error);
    // Fallback: return builtins only
    return Response.json({ commands: BUILTIN_COMMANDS });
  }
}
