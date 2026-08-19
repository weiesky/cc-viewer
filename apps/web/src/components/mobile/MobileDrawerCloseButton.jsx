import React from 'react';
import { CloseOutlined } from '@ant-design/icons';
import { t } from '../../i18n';
import appStyles from '../../App.module.css';

// 移动端抽屉通用关闭按钮：PluginModal / ProcessModal / ProxyModal 共用。
// className 复用 App.module.css 中既有 `.mobileLogMgmtClose`。
export default function MobileDrawerCloseButton({ onClose }) {
  return (
    <button
      className={appStyles.mobileLogMgmtClose}
      onClick={onClose}
      aria-label={t('ui.closeDrawer')}
    >
      <CloseOutlined style={{ fontSize: 16 }} />
    </button>
  );
}
