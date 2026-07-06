import React from 'react';
import { getSvgAvatar } from '../utils/helpers';
import styles from './RoleFilterBar.module.css';

function RoleFilterBar({ roles, selectedRoles, onToggle, style }) {
  if (!roles || roles.length === 0) return null;

  return (
    <div className={styles.roleFilterBar} style={style}>
      {roles.map(r => {
        const selected = selectedRoles.has(r.key);
        return (
          <button key={r.key}
            className={selected ? styles.roleChipActive : styles.roleChip}
            onClick={() => onToggle(r.key)}
          >
            {r.avatarImg ? (
              <img src={r.avatarImg} className={styles.roleAvatarImg} alt={r.name}
                onError={(e) => { e.target.onerror = null; e.target.style.display = 'none'; const d = e.target.parentNode.querySelector('[data-role-avatar-fallback]'); if (d) d.style.display = ''; }} />
            ) : null}
            <div className={styles.roleAvatar}
              style={{ background: r.color || 'rgba(255,255,255,0.1)', display: r.avatarImg ? 'none' : '' }}
              data-role-avatar-fallback=""
              dangerouslySetInnerHTML={{ __html: r.avatarSvg || getSvgAvatar(r.avatarType) }}
            />
            <span className={styles.roleName}>{r.name}</span>
            {selected && <span className={styles.roleCheck}>✓</span>}
          </button>
        );
      })}
    </div>
  );
}

export default RoleFilterBar;
