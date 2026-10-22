import { Tag } from 'antd';
import { SwapOutlined } from '@ant-design/icons';
import { t } from '../../i18n';
import { shouldRenderSdkModelChip } from '../../utils/sdkModelChip';
import { profileDisplayModel } from '../settings/ProxyModal';
import styles from './ProxyChip.module.css';

/**
 * Proxy hot-switch chip, rendered in the chat input bar (right of the Enter hint).
 *
 * Migrated verbatim from AppHeader._renderProxyChip so the same chip shows on PC and iPad
 * (Mobile tree never renders AppHeader). Purely presentational: the click is delegated to
 * `onOpenProxyModal` so the owning ChatView can mount the ProxyModal next to the input bar.
 *
 * Visibility mirrors the header original: a proxy chip when the main agent uses a profile
 * (or Default with a custom endpoint plus an explicit sub/team role); otherwise, in SDK mode
 * only, a read-only launch-model chip fills the slot (shouldRenderSdkModelChip). Returns
 * null when neither applies (dormant official Default, or non-SDK PTY with no assignment).
 */
export default function ProxyChip({
  proxyProfiles,
  activeProxyId,
  proxyRoles,
  proxyOfficialDefault,
  sdkMode,
  sdkModel,
  onOpenProxyModal,
}) {
  const profiles = proxyProfiles || [];
  const roles = proxyRoles || {};
  const activeId = activeProxyId;
  const p = profiles.find(x => x.id === activeId);
  const nameOf = id => (profiles.find(x => x.id === id) || {}).name || id;
  const explicitRole = v => (v && v !== 'follow') ? (v === 'max' ? 'Default' : nameOf(v)) : null;
  const subD = explicitRole(roles.subagent);
  const teamD = explicitRole(roles.teammate);

  let proxyChipVisible = !!activeId;
  if (proxyChipVisible) {
    if (activeId === 'max') {
      const dormant = proxyOfficialDefault !== false;
      if (dormant || (!subD && !teamD)) proxyChipVisible = false;
    } else if (!p) proxyChipVisible = false;
  }

  if (!proxyChipVisible) {
    // SDK launch-model chip only fills this slot when the proxy chip renders nothing
    // (official Default / dormant). Read-only — unrelated to the proxy editor.
    if (!shouldRenderSdkModelChip({ sdkMode, sdkModel, proxyChipVisible })) return null;
    return (
      <Tag className={styles.sdkChip} title={t('ui.sdkModel', { model: sdkModel })}>
        {sdkModel}
      </Tag>
    );
  }

  const mainLabel = p ? `${p.name}${profileDisplayModel(p) ? ` · ${profileDisplayModel(p)}` : ''}` : 'Default';
  const followTxt = t('ui.proxy.followMainResolved', { name: p ? p.name : 'Default' });
  const title = t('ui.proxy.roleSummary', {
    main: mainLabel,
    sub: subD || followTxt,
    team: teamD || followTxt,
  });
  return (
    <Tag
      className={styles.proxyChip}
      title={title}
      onClick={onOpenProxyModal}
      role="button"
      tabIndex={0}
      aria-label={`${t('ui.proxySwitch')}: ${mainLabel}`}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpenProxyModal?.(); } }}
    >
      <SwapOutlined className={styles.swapIcon} />
      {mainLabel}
    </Tag>
  );
}
