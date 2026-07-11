import { promises as fs } from 'fs';
import path from 'path';

export async function GET() {
  try {
    const componentsDir = path.join(process.cwd(), 'src', 'components', 'generated');
    const files = await fs.readdir(componentsDir);
    const names: string[] = [];
    for (const f of files) {
      if (!f.endsWith('.tsx') && !f.endsWith('.ts')) continue;
      const filePath = path.join(componentsDir, f);
      const stat = await fs.stat(filePath);
      if (stat.size > 10) {
        names.push(f.replace(/\.(tsx|ts)$/, ''));
      }
    }
    return Response.json(names);
  } catch {
    return Response.json([]);
  }
}
