'use client';

import React, { useRef, useEffect, useState } from 'react';

interface SandboxProps {
  html: string;
  css?: string;
  js?: string;
  width?: string;
  height?: string;
}

/**
 * Sandboxed rendering environment for dynamic components.
 * Uses iframe with srcdoc for isolation.
 */
export function Sandbox({ html, css = '', js = '', width = '100%', height = '300px' }: SandboxProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [loaded, setLoaded] = useState(false);

  const srcdoc = `
<!DOCTYPE html>
<html>
<head>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: system-ui, -apple-system, sans-serif; padding: 16px; }
    ${css}
  </style>
</head>
<body>
  ${html}
  <script>
    try { ${js} } catch(e) { document.body.innerHTML += '<p style="color:red;font-size:12px;">Error: ' + e.message + '</p>'; }
  </script>
</body>
</html>
  `;

  useEffect(() => {
    setLoaded(false);
  }, [html, css, js]);

  return (
    <div className="relative border rounded-lg overflow-hidden" style={{ width, height }}>
      {!loaded && (
        <div className="absolute inset-0 flex items-center justify-center bg-muted text-muted-foreground text-sm">
          加载中...
        </div>
      )}
      <iframe
        ref={iframeRef}
        srcDoc={srcdoc}
        sandbox="allow-scripts"
        className="w-full h-full border-0"
        onLoad={() => setLoaded(true)}
        title="Dynamic Component Sandbox"
      />
    </div>
  );
}
