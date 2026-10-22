import React, { useEffect, useState } from 'react';
import { Button, Card, Space, Tag } from 'antd';

// A panel is a plain React component. It runs inside the host app's React tree (no
// iframe): you get the host's antd theme for free and can call your plugin service
// through the provided URL builders (auth/token handled by the host's fetch wrapper).
export default function Panel(props) {
  const {
    name, version, theme, lang, isMobile, status,
    pluginApiUrl, pluginWsUrl, onClose,
  } = props;
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    // ALL side effects belong in effects with a cleanup — the host re-executes your
    // bundle on every open, so module-level timers/listeners would accumulate.
    let cancelled = false;
    if (!pluginApiUrl) return undefined;
    fetch(pluginApiUrl('/hello'))
      .then(r => r.json())
      .then(d => { if (!cancelled) setData(d); })
      .catch(e => { if (!cancelled) setError(e.message); });
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="ccv-hello-panel-root" style={{ padding: 16 }}>
      <Space direction="vertical" style={{ width: '100%' }}>
        <Card size="small" title={`${name} v${version || '?'}`}>
          <p>
            theme=<Tag>{theme}</Tag>
            lang=<Tag>{lang}</Tag>
            mobile=<Tag>{String(isMobile)}</Tag>
            service=<Tag color={status === 'ready' ? 'green' : 'orange'}>{status}</Tag>
          </p>
          {error && <p style={{ color: 'var(--color-error, #d4380d)' }}>API error: {error}</p>}
          {data && <pre>{JSON.stringify(data, null, 2)}</pre>}
          <Button size="small" onClick={onClose}>Close (via props.onClose)</Button>
        </Card>
      </Space>
    </div>
  );
}

// Register synchronously at the top level of the bundle — the host matches this call
// with the <script data-ccv-load> it injected. Async registration (setTimeout/then)
// is rejected because document.currentScript is null by then.
window.CCV.registerPanel(__CCV_PANEL_NAME__, Panel);
