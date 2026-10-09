import { Modal, ConfigProvider } from 'antd';
import { t } from '../../i18n';
import WorkspaceList from './WorkspaceList';

// New-parallel-project picker (2026-10): the header [+] button opens this modal.
// It reuses the shared WorkspaceList (recent workspaces + DirBrowser folder
// picker) — the exact component the Electron project selector and the workspace
// page both render — so the new-project / project-management logic and styling
// stay identical across web and Electron. Picking + launching a workspace calls
// `onLaunch` (AppBase.handleWorkspaceLaunch): the server launches the project
// (spawn its main PTY) and the view switches to it, leaving every other live
// project's process running untouched. The modal has a normal Cancel/close path
// and never unmounts the chat view underneath.
export default function NewProjectModal({ open, onClose, onLaunch, themeConfig }) {
  return (
    <Modal
      open={open}
      onCancel={onClose}
      footer={null}
      width={1080}
      title={t('ui.resume.newProject')}
      destroyOnHidden
      className="ccvGlassModal"
      rootClassName="ccvGlassModalRoot"
    >
      <ConfigProvider theme={themeConfig}>
        <WorkspaceList
          embedded
          onLaunch={(payload) => {
            if (onLaunch) onLaunch(payload);
            onClose();
          }}
        />
      </ConfigProvider>
    </Modal>
  );
}
