'use client';

import React, { Suspense } from 'react';
import { componentRegistry } from './component-registry';

interface DynamicRendererProps {
  componentName: string;
  props: Record<string, unknown>;
  fallback?: React.ReactNode;
}

export function DynamicRenderer({ componentName, props, fallback }: DynamicRendererProps) {
  const Component = componentRegistry.get(componentName);

  if (!Component) {
    return (
      <div className="p-4 border border-dashed rounded-lg text-muted-foreground text-sm">
        组件 "{componentName}" 未注册。
        <br />
        <span className="text-xs">请使用 Developer Agent 注册此组件。</span>
      </div>
    );
  }

  return (
    <ErrorBoundary componentName={componentName}>
      <Suspense fallback={fallback ?? <div className="p-4 text-muted-foreground text-sm">加载组件...</div>}>
        <Component {...props} />
      </Suspense>
    </ErrorBoundary>
  );
}

// Error Boundary for dynamic components — shows the actual error message
// so developers can see what went wrong without opening DevTools
interface ErrorBoundaryProps {
  children: React.ReactNode;
  componentName: string;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error(`[DynamicRenderer] Component "${(ErrorBoundary as any)._componentName}" error:`, error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      const errMsg = this.state.error?.message ?? '未知错误';
      // Extract the most useful part of the error (usually the first line)
      const shortMsg = errMsg.split('\n')[0].slice(0, 200);
      return (
        <div className="p-3 border border-red-200 dark:border-red-900 rounded-lg bg-red-50/50 dark:bg-red-950/20">
          <div className="text-sm font-medium text-red-600 dark:text-red-400">
            组件 &quot;{this.props.componentName}&quot; 渲染出错
          </div>
          <div className="mt-1 text-xs text-red-500/80 dark:text-red-400/80 font-mono break-all">
            {shortMsg}
          </div>
          <details className="mt-1">
            <summary className="text-[10px] text-red-400/60 cursor-pointer">完整错误</summary>
            <pre className="mt-1 text-[10px] text-red-400/60 whitespace-pre-wrap break-all max-h-32 overflow-y-auto">{errMsg}</pre>
          </details>
        </div>
      );
    }
    return this.props.children;
  }
}
