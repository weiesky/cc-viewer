import React from 'react';
import {
  ApiOutlined, AppstoreOutlined, DashboardOutlined, ToolOutlined,
  DatabaseOutlined, BarChartOutlined, FileOutlined, GlobalOutlined,
} from '@ant-design/icons';

// manifest panel.icon (allowlisted string) -> antd icon component. Unknown values fall back
// to appstore (the manifest already validates the allowlist; this is the render-layer backstop).
const ICONS = {
  api: ApiOutlined,
  dashboard: DashboardOutlined,
  appstore: AppstoreOutlined,
  tool: ToolOutlined,
  database: DatabaseOutlined,
  chart: BarChartOutlined,
  file: FileOutlined,
  global: GlobalOutlined,
};

export function PanelIcon({ name, style }) {
  const Icon = ICONS[name] || AppstoreOutlined;
  return <Icon style={style} />;
}
