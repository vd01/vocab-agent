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
    <ErrorBoundary fallback={
      <div className="p-4 border border-red-200 rounded-lg text-red-500 text-sm">
        组件 "{componentName}" 渲染出错
      </div>
    }>
      <Suspense fallback={fallback ?? <div className="p-4 text-muted-foreground text-sm">加载组件...</div>}>
        <Component {...props} />
      </Suspense>
    </ErrorBoundary>
  );
}

// Simple Error Boundary for dynamic components
interface ErrorBoundaryProps {
  children: React.ReactNode;
  fallback: React.ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
}

class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('[DynamicRenderer ErrorBoundary]', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return this.props.fallback;
    }
    return this.props.children;
  }
}
