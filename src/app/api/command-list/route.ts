import { db } from '@/lib/db';
import { dynamicCommands } from '@/lib/db/schema';

const BUILTIN_COMMANDS = [
  { name: 'review', description: '开始 FSRS 复习 (如: /review 5 四级)' },
  { name: 'add', description: '添加新单词 (如: /add ephemeral 短暂的 四级)' },
  { name: 'pin', description: '置顶单词到侧边栏 (如: /pin ephemeral)' },
  { name: 'stats', description: '查看学习统计' },
  { name: 'group', description: '管理分组 (如: /group, /group 四级, /group create 考研)' },
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
