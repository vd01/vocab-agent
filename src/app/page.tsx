'use client';

import { ChatPanel } from '@/components/chat/chat-panel';

export default function Home() {
  return (
    <div className="flex flex-col h-screen bg-background">
      <header className="border-b px-4 py-2.5 flex items-center justify-center shrink-0">
        <h1 className="text-sm font-medium text-foreground">
          Vocab Agent
        </h1>
      </header>
      <main className="flex-1 overflow-hidden">
        <ChatPanel />
      </main>
    </div>
  );
}
