'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Separator } from '@/components/ui/separator';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import type { AppConfig } from '@/lib/electron-types';

export function SettingsContent() {
  const [config, setConfigState] = useState<AppConfig | null>(null);
  const [saving, setSaving] = useState(false);
  const [switching, setSwitching] = useState(false);
  const [remoteUrl, setRemoteUrl] = useState('');
  const [remotePassword, setRemotePassword] = useState('');
  const [hasStoredPassword, setHasStoredPassword] = useState(false);
  const [shortcutInput, setShortcutInput] = useState('');
  const [capturingShortcut, setCapturingShortcut] = useState(false);
  const [shortcutError, setShortcutError] = useState('');
  const [modeError, setModeError] = useState('');
  const [envApiKey, setEnvApiKey] = useState('');
  const [envBaseUrl, setEnvBaseUrl] = useState('');
  const [envTeacherModel, setEnvTeacherModel] = useState('');
  const [envDeveloperModel, setEnvDeveloperModel] = useState('');
  const [envAuthPassword, setEnvAuthPassword] = useState('');
  const [envRestarting, setEnvRestarting] = useState(false);
  const [envDirty, setEnvDirty] = useState(false);

  useEffect(() => {
    loadConfig();
    window.electronAPI?.onModeSwitchError?.((msg) => {
      setModeError(msg);
      setSwitching(false);
    });
  }, []);

  async function loadConfig() {
    if (!window.electronAPI) return;
    const cfg = await window.electronAPI.getConfig();
    setConfigState(cfg);
    setRemoteUrl(cfg.remote.url);
    setShortcutInput(cfg.window.shortcut);
    setHasStoredPassword(!!cfg.remote.encryptedPassword);
    setEnvApiKey(cfg.env.openaiApiKey);
    setEnvBaseUrl(cfg.env.openaiBaseUrl);
    setEnvTeacherModel(cfg.env.teacherModel);
    setEnvDeveloperModel(cfg.env.developerModel);
    setEnvAuthPassword(cfg.env.authPassword);
    setEnvDirty(false);
  }

  async function handleSave() {
    if (!window.electronAPI || !config) return;
    setSaving(true);
    try {
      await window.electronAPI.setConfig({
        local: { ...config.local },
        remote: { ...config.remote, url: remoteUrl },
        window: { ...config.window },
        notification: { ...config.notification },
      } as Partial<AppConfig>);
      await loadConfig();
    } finally {
      setSaving(false);
    }
  }

  async function handleModeSwitch(mode: 'local' | 'remote') {
    if (!window.electronAPI || !config) return;
    if (config.mode === mode) return;
    setModeError('');
    setSwitching(true);
    try {
      await window.electronAPI.switchMode(mode);
      await loadConfig();
    } finally {
      setSwitching(false);
    }
  }

  async function handleSavePassword() {
    if (!window.electronAPI || !remotePassword) return;
    await window.electronAPI.saveRemotePassword(remotePassword);
    setRemotePassword('');
    setHasStoredPassword(true);
  }

  async function handleClearPassword() {
    if (!window.electronAPI) return;
    await window.electronAPI.clearRemotePassword();
    setHasStoredPassword(false);
  }

  function handleShortcutCapture(e: React.KeyboardEvent) {
    if (!capturingShortcut) return;
    e.preventDefault();

    const parts: string[] = [];
    if (e.ctrlKey) parts.push('Ctrl');
    if (e.altKey) parts.push('Alt');
    if (e.shiftKey) parts.push('Shift');
    if (e.metaKey) parts.push('Super');

    const key = e.key;
    if (!['Control', 'Alt', 'Shift', 'Meta'].includes(key)) {
      parts.push(key.length === 1 ? key.toUpperCase() : key);
    }

    if (parts.length >= 2) {
      const combo = parts.join('+');
      setShortcutInput(combo);
      setCapturingShortcut(false);
      tryRegisterShortcut(combo);
    }
  }

  async function tryRegisterShortcut(shortcut: string) {
    if (!window.electronAPI) return;
    setShortcutError('');
    const success = await window.electronAPI.registerShortcut(shortcut);
    if (!success) {
      setShortcutError(`快捷键 ${shortcut} 注册失败，可能与其他应用冲突`);
    }
  }

  async function handleNotificationChange(key: 'reviewReminder' | 'reminderInterval', value: boolean | number) {
    if (!window.electronAPI || !config) return;
    const newNotification = { ...config.notification, [key]: value };
    const newConfig = await window.electronAPI.setConfig({ notification: newNotification } as Partial<AppConfig>);
    setConfigState(newConfig);
  }

  async function handleCloseToTrayChange(value: boolean) {
    if (!window.electronAPI || !config) return;
    const newConfig = await window.electronAPI.setConfig({ window: { ...config.window, closeToTray: value } } as Partial<AppConfig>);
    setConfigState(newConfig);
  }

  async function handleEnvSaveAndRestart() {
    if (!window.electronAPI || !config) return;
    setEnvRestarting(true);
    try {
      await window.electronAPI.setConfig({
        env: {
          openaiApiKey: envApiKey,
          openaiBaseUrl: envBaseUrl,
          teacherModel: envTeacherModel,
          developerModel: envDeveloperModel,
          authPassword: envAuthPassword,
        },
      } as Partial<AppConfig>);
      if (config.mode === 'local') {
        await window.electronAPI.restartServer();
      }
      setEnvDirty(false);
    } finally {
      setEnvRestarting(false);
    }
  }

  if (!window.electronAPI) {
    return (
      <div className="flex items-center justify-center h-screen bg-background">
        <div className="text-center space-y-2">
          <p className="text-muted-foreground text-sm">请在桌面端使用此设置</p>
          <Button variant="outline" size="sm" onClick={() => window.history.back()}>
            返回
          </Button>
        </div>
      </div>
    );
  }

  if (!config) {
    return (
      <div className="flex items-center justify-center h-screen bg-background">
        <p className="text-muted-foreground text-sm">加载中...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background p-6 max-w-2xl mx-auto" onKeyDown={handleShortcutCapture}>
      <div className="flex items-center gap-3 mb-6">
        <Button variant="ghost" size="sm" onClick={() => window.history.back()}>
          ← 返回
        </Button>
        <h1 className="text-lg font-semibold">设置</h1>
      </div>

      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">部署模式</CardTitle>
            <CardDescription>选择本地运行或连接云端服务</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex gap-3">
              <Button
                variant={config.mode === 'local' ? 'default' : 'outline'}
                onClick={() => handleModeSwitch('local')}
                disabled={switching}
                className="flex-1"
              >
                本地模式
              </Button>
              <Button
                variant={config.mode === 'remote' ? 'default' : 'outline'}
                onClick={() => handleModeSwitch('remote')}
                disabled={switching}
                className="flex-1"
              >
                云端模式
              </Button>
            </div>

            {modeError && (
              <p className="text-sm text-destructive">{modeError}</p>
            )}

            {config.mode === 'local' && (
              <div className="space-y-2">
                <Label>本地端口</Label>
                <Input
                  type="number"
                  value={config.local.port}
                  onChange={(e) => {
                    setConfigState({ ...config, local: { port: parseInt(e.target.value) || 3088 } });
                  }}
                  min={1024}
                  max={65535}
                />
              </div>
            )}

            {config.mode === 'remote' && (
              <div className="space-y-3">
                <div className="space-y-2">
                  <Label>云端地址</Label>
                  <Input
                    type="url"
                    value={remoteUrl}
                    onChange={(e) => setRemoteUrl(e.target.value)}
                    placeholder="https://example.duckdns.org:31588"
                  />
                </div>
                <Separator />
                <div className="space-y-2">
                  <Label>自动登录</Label>
                  {hasStoredPassword ? (
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-muted-foreground">已存储密码</span>
                      <Button variant="outline" size="sm" onClick={handleClearPassword}>
                        清除密码
                      </Button>
                    </div>
                  ) : (
                    <div className="flex gap-2">
                      <Input
                        type="password"
                        value={remotePassword}
                        onChange={(e) => setRemotePassword(e.target.value)}
                        placeholder="输入密码"
                        className="flex-1"
                      />
                      <Button size="sm" onClick={handleSavePassword} disabled={!remotePassword}>
                        保存
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">快捷键</CardTitle>
            <CardDescription>全局快捷键唤起窗口</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-3">
              <Input
                value={shortcutInput}
                onChange={(e) => setShortcutInput(e.target.value)}
                onFocus={() => setCapturingShortcut(true)}
                onBlur={() => setCapturingShortcut(false)}
                placeholder={capturingShortcut ? '按下组合键...' : '点击输入快捷键'}
                readOnly={capturingShortcut}
                className="flex-1"
              />
              <Button
                size="sm"
                variant="outline"
                onClick={() => tryRegisterShortcut(shortcutInput)}
                disabled={!shortcutInput}
              >
                注册
              </Button>
            </div>
            {shortcutError && (
              <p className="text-sm text-destructive">{shortcutError}</p>
            )}
            {capturingShortcut && (
              <p className="text-sm text-muted-foreground">请按下组合键（至少包含一个修饰键 + 一个普通键）</p>
            )}
            <div className="flex items-center justify-between">
              <Label>关闭时最小化到托盘</Label>
              <Switch
                checked={config.window.closeToTray}
                onCheckedChange={handleCloseToTrayChange}
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">通知</CardTitle>
            <CardDescription>FSRS 复习提醒</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <Label>复习提醒</Label>
              <Switch
                checked={config.notification.reviewReminder}
                onCheckedChange={(v) => handleNotificationChange('reviewReminder', v)}
              />
            </div>
            {config.notification.reviewReminder && (
              <div className="flex items-center justify-between">
                <Label>提醒间隔（分钟）</Label>
                <Input
                  type="number"
                  value={config.notification.reminderInterval}
                  onChange={(e) => handleNotificationChange('reminderInterval', parseInt(e.target.value) || 30)}
                  min={5}
                  max={480}
                  className="w-24"
                />
              </div>
            )}
          </CardContent>
        </Card>

        {config.mode === 'local' && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">AI 服务配置</CardTitle>
              <CardDescription>配置 API 密钥和模型参数，修改后需重启本地服务生效</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>API Key</Label>
                <Input
                  type="password"
                  value={envApiKey}
                  onChange={(e) => { setEnvApiKey(e.target.value); setEnvDirty(true); }}
                  placeholder="sk-..."
                />
              </div>
              <div className="space-y-2">
                <Label>API Base URL</Label>
                <Input
                  type="url"
                  value={envBaseUrl}
                  onChange={(e) => { setEnvBaseUrl(e.target.value); setEnvDirty(true); }}
                  placeholder="https://api.openai.com/v1"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label>Teacher 模型</Label>
                  <Input
                    value={envTeacherModel}
                    onChange={(e) => { setEnvTeacherModel(e.target.value); setEnvDirty(true); }}
                    placeholder="gpt-4o-mini"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Developer 模型</Label>
                  <Input
                    value={envDeveloperModel}
                    onChange={(e) => { setEnvDeveloperModel(e.target.value); setEnvDirty(true); }}
                    placeholder="deepseek-reasoner"
                  />
                </div>
              </div>
              <Separator />
              <div className="space-y-2">
                <Label>登录密码</Label>
                <Input
                  type="password"
                  value={envAuthPassword}
                  onChange={(e) => { setEnvAuthPassword(e.target.value); setEnvDirty(true); }}
                  placeholder="设置应用登录密码"
                />
              </div>
              <div className="flex justify-end">
                <Button
                  onClick={handleEnvSaveAndRestart}
                  disabled={envRestarting || (!envDirty && !envApiKey && !envBaseUrl && !envAuthPassword)}
                >
                  {envRestarting ? '重启服务中...' : '保存并重启服务'}
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        <div className="flex justify-end">
          <Button onClick={handleSave} disabled={saving}>
            {saving ? '保存中...' : '保存设置'}
          </Button>
        </div>
      </div>
    </div>
  );
}
