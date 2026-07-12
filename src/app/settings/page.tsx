'use client';

import dynamic from 'next/dynamic';

const SettingsContent = dynamic(
  () => import('@/components/settings/settings-content').then((m) => m.SettingsContent),
  { ssr: false, loading: () => <div className="flex items-center justify-center h-screen bg-background"><p className="text-muted-foreground text-sm">加载中...</p></div> }
);

export default function SettingsPage() {
  return <SettingsContent />;
}
