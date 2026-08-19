import React, { useState, useEffect, useCallback } from 'react';
import { Modal, Button, Table, message } from 'antd';
import { ReloadOutlined, DashboardOutlined } from '@ant-design/icons';
import { t } from '../../i18n';
import { apiUrl } from '../../utils/apiUrl';
import { isMobile } from '../../env';
import { BLUR_MASK_STYLE } from '../../utils/modalMask';
import styles from './ProcessModal.module.css';
import sharedChrome from '../common/sharedChrome.module.css';
import appStyles from '../../App.module.css';
import MobileDrawerCloseButton from '../mobile/MobileDrawerCloseButton';

// CCV 进程管理 Modal —— PC + mobile 共用。
// 风格:self-contained(数据只在 modal 内消费)。受控风格判定原则见 PluginModal.jsx 头注释。
// 自持 processList / processLoading 内部 state；外部仅 open/onClose 控制。
// open false→true 触发 fetch（沿用原 AppHeader 行为，不做 polling）。
//
// kill 确认改为受控 Modal（killConfirmPid state）替代 Modal.confirm —— 后者 portal 到 body
// 不受父 modal 关闭联动控制 (defensive review P2-2),且在 mobile zoom:0.6 容器下不缩放。
export default function ProcessModal({ open, onClose }) {
  const [processList, setProcessList] = useState([]);
  const [processLoading, setProcessLoading] = useState(false);
  const [killConfirmPid, setKillConfirmPid] = useState(null);
  const [killing, setKilling] = useState(false);

  const fetchProcesses = useCallback(() => {
    setProcessLoading(true);
    fetch(apiUrl('/api/ccv-processes'))
      .then(r => r.json())
      .then(data => {
        setProcessList(data.processes || []);
        setProcessLoading(false);
      })
      .catch(() => {
        setProcessList([]);
        setProcessLoading(false);
      });
  }, []);

  // open 从 false→true rising edge 触发 fetch；关时不清 state（与原 AppHeader 等价）
  useEffect(() => {
    if (open) fetchProcesses();
  }, [open, fetchProcesses]);

  // 父 modal 关闭时同步关闭 kill 确认 —— 避免外层关了内层确认仍在屏幕上的孤儿态
  useEffect(() => {
    if (!open) {
      setKillConfirmPid(null);
      setKilling(false);
    }
  }, [open]);

  const handleKillProcess = (pid) => {
    setKillConfirmPid(pid);
  };

  const handleKillConfirm = () => {
    const pid = killConfirmPid;
    if (!pid) return;
    setKilling(true);
    fetch(apiUrl('/api/ccv-processes/kill'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pid }),
    })
      .then(r => r.json())
      .then(data => {
        if (data.ok) {
          message.success(t('ui.processManagement.killed'));
          fetchProcesses();
        } else {
          message.error(data.error || t('ui.processManagement.killFailed'));
        }
      })
      .catch(() => {
        message.error(t('ui.processManagement.killFailed'));
      })
      .finally(() => {
        setKilling(false);
        setKillConfirmPid(null);
      });
  };

  const handleKillCancel = () => {
    setKillConfirmPid(null);
  };

  const titleNode = (
    <span><DashboardOutlined className={sharedChrome.titleIcon} />{t('ui.processManagement')}</span>
  );

  const refreshBtnNode = (
    <Button icon={<ReloadOutlined />} onClick={fetchProcesses} loading={processLoading}>
      {t('ui.processManagement.refresh')}
    </Button>
  );

  const tableNode = (
    <Table
      dataSource={processList}
      rowKey="pid"
      loading={processLoading}
      size="middle"
      pagination={false}
      // mobile 抽屉宽度有限，4 列默认会撑爆；横向滚动条让窄屏可读
      scroll={{ x: 'max-content' }}
      columns={[
        { title: t('ui.processManagement.port'), dataIndex: 'port', width: 80, render: (text) => text ? <a href={`${window.location.protocol}//127.0.0.1:${text}`} target="_blank" rel="noopener noreferrer">{text}</a> : '' },
        { title: 'PID', dataIndex: 'pid', width: 80 },
        { title: t('ui.processManagement.command'), dataIndex: 'command', ellipsis: true },
        { title: t('ui.processManagement.startTime'), dataIndex: 'startTime', width: 200 },
        {
          title: t('ui.processManagement.action'),
          width: 100,
          render: (_, record) => record.isCurrent
            ? <Button size="small" className={styles.currentProcessBtn}>{t('ui.processManagement.current')}</Button>
            : <Button size="small" danger onClick={() => handleKillProcess(record.pid)}>{t('ui.processManagement.kill')}</Button>,
        },
      ]}
    />
  );

  const killConfirmModal = (
    /* kill 确认 —— 受控 Modal,父关时通过 useEffect 联动关闭,避免孤儿态 */
    <Modal
      title={t('ui.processManagement.killConfirm')}
      open={killConfirmPid !== null}
      onCancel={handleKillCancel}
      onOk={handleKillConfirm}
      confirmLoading={killing}
      okType="danger"
      styles={{ body: isMobile ? { zoom: 0.6 } : {} }}
    />
  );

  if (isMobile) {
    return (
      <>
        <div className={`${appStyles.mobileDrawerOverlay} ${open ? appStyles.mobileDrawerOverlayVisible : ''}`}>
          <div className={appStyles.mobileLogMgmtHeader}>
            <span className={appStyles.mobileLogMgmtTitle}>{titleNode}</span>
            <MobileDrawerCloseButton onClose={onClose} />
          </div>
          <div className={appStyles.mobileDrawerInner}>
            <div className={styles.processModalScroll}>
              {tableNode}
              <div className={styles.processModalFooterBar}>
                {refreshBtnNode}
              </div>
            </div>
          </div>
        </div>
        {killConfirmModal}
      </>
    );
  }

  return (
    <>
      <Modal
        title={titleNode}
        open={open}
        onCancel={onClose}
        footer={refreshBtnNode}
        width={780}
        // mobile portal 适配：modal 通过 ReactDOM portal 逃出 mobileCachePanelInner zoom:0.6 容器，
        // 因此 body 自身需补 zoom:0.6 才能视觉与外层 mobile UI 一致（同 SkillsManagerModal:50）
        styles={{ body: isMobile ? { zoom: 0.6 } : {}, mask: BLUR_MASK_STYLE }}
      >
        {tableNode}
      </Modal>
      {killConfirmModal}
    </>
  );
}
