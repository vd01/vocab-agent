import { executeCommand } from '@/lib/commands/executor';

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { command } = body;

    if (typeof command !== 'string' || !command.trim()) {
      return Response.json(
        { type: 'invalid-args', message: '请提供命令' },
        { status: 400 },
      );
    }

    const result = await executeCommand(command);
    return Response.json(result);
  } catch (error) {
    console.error('[Commands API Error]', error);
    const message = error instanceof Error ? error.message : String(error);
    return Response.json(
      { type: 'command-error', message: `命令执行失败: ${message}` },
      { status: 500 },
    );
  }
}
