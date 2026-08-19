// UltraPlan 纯逻辑控制器（从 ChatView / TerminalPanel 各自抽出的重复方法收口为一份）。
//
// 依赖注入的纯逻辑类，不依赖 antd / React / DOM 之外的东西，可直接在 node:test 下 import。
// host 适配器把宿主组件的 state / props / 上传 / 提示 / 关闭编辑器桥接进来；宿主的 6 个
// ultraplan 方法退化为一行委托。state 仍留在宿主 component.state，行为不变。
//
// host 接口：
//   getState()            → 宿主 this.state（读 ultraplanFiles / customUltraplanExperts / ultraplanVariant）
//   setState(updater)     → 转发宿主 this.setState，原样透传对象式与 functional updater
//   onUpdatePreferences(p) → 包 this.props.onUpdatePreferences?.(p)（props 无该回调则不调）
//   uploadFile(file)      → 包 uploadFileAndGetPath(file)（注入以避免 import TerminalPanel 形成循环依赖）
//   messageError(msg)     → 包 antd message.error(msg)（注入以保持本模块 antd-free）
//   closeEditor()         → 包宿主各自的 closeCustomUltraplanEditor()（两边写不同 state 字段，故留宿主）

import { visibleExpertKeys } from './ultraplanExperts.js';

export class UltraplanController {
  constructor(host) {
    this.host = host;
  }

  handleUpload = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.onchange = async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      try {
        const path = await this.host.uploadFile(file);
        this.host.setState(prev => ({
          ultraplanFiles: [...prev.ultraplanFiles, { name: file.name, path }],
        }));
      } catch (err) {
        console.error('Ultraplan upload failed:', err);
        this.host.messageError(err?.message || 'Upload failed');
      }
    };
    input.click();
  };

  handlePaste = async (e) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of items) {
      if (item.type.startsWith('image/')) {
        e.preventDefault();
        const file = item.getAsFile();
        if (!file) return;
        try {
          const path = await this.host.uploadFile(file);
          const name = file.name || `paste-${Date.now()}.png`;
          this.host.setState(prev => ({
            ultraplanFiles: [...prev.ultraplanFiles, { name, path }],
          }));
        } catch (err) {
          console.error('Ultraplan paste upload failed:', err);
          this.host.messageError(err?.message || 'Upload failed');
        }
        return;
      }
    }
  };

  handleRemoveFile = (idx) => {
    this.host.setState(prev => ({
      ultraplanFiles: prev.ultraplanFiles.filter((_, i) => i !== idx),
    }));
  };

  persistExperts = (experts) => {
    this.host.setState({ customUltraplanExperts: experts });
    this.host.onUpdatePreferences({ customUltraplanExperts: experts });
  };

  saveExpert = (item) => {
    const existing = this.host.getState().customUltraplanExperts;
    const idx = existing.findIndex(e => e.id === item.id);
    const next = idx >= 0
      ? existing.map(e => (e.id === item.id ? item : e))
      : [...existing, item];
    this.persistExperts(next);
    this.host.closeEditor();
  };

  deleteExpert = (id) => {
    const st = this.host.getState();
    const next = st.customUltraplanExperts.filter(e => e.id !== id);
    this.persistExperts(next);
    // 如果当前选中的就是被删的，回退到首个可见专家（无可见则 codeExpert）
    if (st.ultraplanVariant === 'custom:' + id) {
      const visible = visibleExpertKeys(next, st.ultraplanExpertOrder, st.ultraplanExpertHidden);
      this.host.setState({ ultraplanVariant: visible[0] || 'codeExpert' });
    }
    this.host.closeEditor();
  };

  // 「管理专家」弹窗的显隐 / 排序落盘：写 state + 同步 preferences（多端/刷新一致）。
  // 若当前选中变体因隐藏而不再可见，回退到首个可见键（无可见则 codeExpert）。
  persistExpertLayout = ({ order, hidden }) => {
    const st = this.host.getState();
    const patch = { ultraplanExpertOrder: order, ultraplanExpertHidden: hidden };
    const visible = visibleExpertKeys(st.customUltraplanExperts, order, hidden);
    if (!visible.includes(st.ultraplanVariant)) {
      patch.ultraplanVariant = visible[0] || 'codeExpert';
    }
    this.host.setState(patch);
    this.host.onUpdatePreferences({ ultraplanExpertOrder: order, ultraplanExpertHidden: hidden });
  };
}
