// Single source of truth for the IM platforms the messaging UI knows about: brand icon/color,
// tab label, backend endpoints, and the per-platform settings-form field spec. The messaging
// modal, the header status chips, and the chat IM-source badge all derive from this registry, so
// adding a platform is one entry here (+ an icon + i18n keys).
import DingTalkIcon from '../common/DingTalkIcon';
import FeishuIcon from '../common/FeishuIcon';
import WeComIcon from '../common/WeComIcon';
import DiscordIcon from '../common/DiscordIcon';

export const dingtalkDescriptor = {
  id: 'dingtalk',
  labelKey: 'ui.messaging.dingtalk',
  fallback: 'DingTalk',
  icon: DingTalkIcon,
  color: '#1677ff',
  endpoints: { status: '/api/im/dingtalk/status', config: '/api/im/dingtalk/config', test: '/api/im/dingtalk/test' },
  enable: { key: 'ui.dingtalk.enable', fallback: 'Enable DingTalk bridge' },
  fields: [
    { key: 'appKey', type: 'text', section: 'main', required: true, labelKey: 'ui.dingtalk.appKey', fallback: 'AppKey' },
    { key: 'appSecret', type: 'password', section: 'main', required: true, labelKey: 'ui.dingtalk.appSecret', fallback: 'AppSecret' },
    {
      key: 'allowStaffIds', type: 'tags', section: 'more', optional: true,
      labelKey: 'ui.dingtalk.allowStaff', fallback: 'Sender allowlist (staffId)',
      placeholderKey: 'ui.dingtalk.allowStaffPlaceholder', placeholderFallback: 'staffId, press Enter to add',
      helpKey: 'ui.im.allowlistHelp', helpFallback: 'Only senders on this list can drive this Claude session; leave it empty and the bot binds to the first conversation that messages it. Recommended in group chats.',
    },
    {
      key: 'blockOnSkipPermissions', type: 'switch', section: 'more',
      labelKey: 'ui.dingtalk.blockSkipPerm', fallback: 'Block injection in skip-permissions sessions',
      helpKey: 'ui.dingtalk.blockSkipPermHelp', helpFallback: 'When the Claude session runs with --dangerously-skip-permissions, refuse remote injection (which would execute with no approval).',
    },
    {
      key: 'ackCard', type: 'switch', section: 'more',
      labelKey: 'ui.im.ackCard', fallback: 'Instant acknowledgment',
      helpKey: 'ui.im.ackCardHelp', helpFallback: 'Send immediate status feedback when a message is received; update in-place when the reply is ready.',
    },
    {
      key: 'cardTemplateId', type: 'text', section: 'more', optional: true,
      labelKey: 'ui.dingtalk.cardTemplateId', fallback: 'Card Template ID',
      helpKey: 'ui.dingtalk.cardTemplateIdHelp', helpFallback: 'Interactive Card template ID from the DingTalk Open Platform (optional — leave empty for plain-text acknowledgment).',
    },
    {
      key: 'aiCardTemplateId', type: 'text', section: 'more', optional: true,
      labelKey: 'ui.dingtalk.aiCardTemplateId', fallback: 'AI Card Template ID (streaming)',
      helpKey: 'ui.dingtalk.aiCardTemplateIdHelp', helpFallback: 'AI-card scene template ID (must declare content + flowStatus variables). When set, replies stream character-by-character with a flowStatus status tag, replacing the “[received]” text. Requires the Card.Instance.Write + Card.Streaming.Write permissions. Leave empty to use the plain card / text above.',
    },
    {
      key: 'aiCardStreamKey', type: 'text', section: 'more', optional: true,
      labelKey: 'ui.dingtalk.aiCardStreamKey', fallback: 'AI Card streaming variable name (default: content)',
      helpKey: 'ui.dingtalk.aiCardStreamKeyHelp', helpFallback: 'Name of the streaming markdown variable in your AI-card template. Leave empty to use the default “content”; set it only if your template names that variable differently.',
    },
  ],
  notes: [],
};

export const feishuDescriptor = {
  id: 'feishu',
  labelKey: 'ui.messaging.feishu',
  fallback: 'Feishu',
  icon: FeishuIcon,
  color: '#00d6b9',
  endpoints: { status: '/api/im/feishu/status', config: '/api/im/feishu/config', test: '/api/im/feishu/test' },
  enable: { key: 'ui.feishu.enable', fallback: 'Enable Feishu/Lark bridge' },
  fields: [
    { key: 'appId', type: 'text', section: 'main', required: true, labelKey: 'ui.feishu.appId', fallback: 'App ID' },
    { key: 'appSecret', type: 'password', section: 'main', required: true, labelKey: 'ui.feishu.appSecret', fallback: 'App Secret' },
    {
      key: 'region', type: 'select', section: 'main', default: 'feishu',
      labelKey: 'ui.feishu.region', fallback: 'Region',
      options: [
        { value: 'feishu', labelKey: 'ui.feishu.regionCn', fallback: 'Feishu (feishu.cn)' },
        { value: 'lark', labelKey: 'ui.feishu.regionGlobal', fallback: 'Lark (larksuite.com)' },
      ],
    },
    {
      key: 'allowUserIds', type: 'tags', section: 'more', optional: true,
      labelKey: 'ui.feishu.allowUsers', fallback: 'Sender allowlist (open_id)',
      placeholderKey: 'ui.feishu.allowUsersPlaceholder', placeholderFallback: 'open_id, press Enter to add',
      helpKey: 'ui.im.allowlistHelp', helpFallback: 'Only senders on this list can drive this Claude session; leave it empty and the bot binds to the first conversation that messages it. Recommended in group chats.',
    },
    {
      key: 'blockOnSkipPermissions', type: 'switch', section: 'more',
      labelKey: 'ui.im.blockSkipPerm', fallback: 'Block injection in skip-permissions sessions',
      helpKey: 'ui.im.blockSkipPermHelp', helpFallback: 'When the Claude session runs with --dangerously-skip-permissions, refuse remote injection (which would execute with no approval).',
    },
    {
      key: 'ackCard', type: 'switch', section: 'more',
      labelKey: 'ui.im.ackCard', fallback: 'Instant acknowledgment',
      helpKey: 'ui.im.ackCardHelp', helpFallback: 'Send immediate status feedback when a message is received; update in-place when the reply is ready.',
    },
    {
      key: 'aiCard', type: 'switch', section: 'more',
      labelKey: 'ui.im.aiCard', fallback: 'AI card streaming reply',
      helpKey: 'ui.im.aiCardHelp', helpFallback: 'Stream the reply character-by-character into the card instead of replacing it all at once when finished. Requires Instant acknowledgment; if streaming is not available it safely falls back to a single replace.',
    },
  ],
  notes: [
    { kind: 'hint', key: 'ui.feishu.provisioningHelp', fallback: 'In the Feishu/Lark console: create a custom app, set Event Subscription to long-connection, subscribe im.message.receive_v1, grant the im:message scope (and cardkit:card:write for AI-card streaming), publish the app, then add the bot to a chat.' },
  ],
};

export const wecomDescriptor = {
  id: 'wecom',
  labelKey: 'ui.messaging.wecom',
  fallback: 'WeCom',
  icon: WeComIcon,
  color: '#07c160',
  endpoints: { status: '/api/im/wecom/status', config: '/api/im/wecom/config', test: '/api/im/wecom/test' },
  enable: { key: 'ui.wecom.enable', fallback: 'Enable WeCom bridge' },
  fields: [
    { key: 'botId', type: 'text', section: 'main', required: true, labelKey: 'ui.wecom.botId', fallback: 'Bot ID' },
    { key: 'secret', type: 'password', section: 'main', required: true, labelKey: 'ui.wecom.secret', fallback: 'Secret' },
    {
      key: 'allowUserIds', type: 'tags', section: 'more', optional: true,
      labelKey: 'ui.wecom.allowUsers', fallback: 'Sender allowlist (userid)',
      placeholderKey: 'ui.wecom.allowUsersPlaceholder', placeholderFallback: 'userid, press Enter to add',
      helpKey: 'ui.im.allowlistHelp', helpFallback: 'Only senders on this list can drive this Claude session; leave it empty and the bot binds to the first conversation that messages it. Recommended in group chats.',
    },
    {
      key: 'blockOnSkipPermissions', type: 'switch', section: 'more',
      labelKey: 'ui.im.blockSkipPerm', fallback: 'Block injection in skip-permissions sessions',
      helpKey: 'ui.im.blockSkipPermHelp', helpFallback: 'When the Claude session runs with --dangerously-skip-permissions, refuse remote injection (which would execute with no approval).',
    },
    {
      key: 'ackCard', type: 'switch', section: 'more',
      labelKey: 'ui.im.ackCard', fallback: 'Instant acknowledgment',
      helpKey: 'ui.im.ackCardHelp', helpFallback: 'Send immediate status feedback when a message is received; update in-place when the reply is ready.',
    },
    {
      key: 'aiCard', type: 'switch', section: 'more',
      labelKey: 'ui.im.aiCard', fallback: 'AI card streaming reply',
      helpKey: 'ui.im.aiCardHelp', helpFallback: 'Stream the reply character-by-character into the card instead of replacing it all at once when finished. Requires Instant acknowledgment; if streaming is not available it safely falls back to a single replace.',
    },
  ],
  notes: [
    { kind: 'hint', key: 'ui.wecom.provisioningHelp', fallback: 'In the WeCom console: create a Smart Robot, set its API receive mode to long-connection, copy the Bot ID + Secret, then add the bot to a chat.' },
  ],
};

export const discordDescriptor = {
  id: 'discord',
  labelKey: 'ui.messaging.discord',
  fallback: 'Discord',
  icon: DiscordIcon,
  color: '#5865F2',
  endpoints: { status: '/api/im/discord/status', config: '/api/im/discord/config', test: '/api/im/discord/test' },
  enable: { key: 'ui.discord.enable', fallback: 'Enable Discord bridge' },
  fields: [
    { key: 'botToken', type: 'password', section: 'main', required: true, labelKey: 'ui.discord.botToken', fallback: 'Bot Token' },
    {
      key: 'allowUserIds', type: 'tags', section: 'more', optional: true,
      labelKey: 'ui.discord.allowUsers', fallback: 'Sender allowlist (user ID)',
      placeholderKey: 'ui.discord.allowUsersPlaceholder', placeholderFallback: 'user ID, press Enter to add',
      helpKey: 'ui.im.allowlistHelp', helpFallback: 'Only senders on this list can drive this Claude session; leave it empty and the bot binds to the first conversation that messages it. Recommended in group chats.',
    },
    {
      key: 'blockOnSkipPermissions', type: 'switch', section: 'more',
      labelKey: 'ui.im.blockSkipPerm', fallback: 'Block injection in skip-permissions sessions',
      helpKey: 'ui.im.blockSkipPermHelp', helpFallback: 'When the Claude session runs with --dangerously-skip-permissions, refuse remote injection (which would execute with no approval).',
    },
    {
      key: 'ackCard', type: 'switch', section: 'more',
      labelKey: 'ui.im.ackCard', fallback: 'Instant acknowledgment',
      helpKey: 'ui.im.ackCardHelp', helpFallback: 'Send immediate status feedback when a message is received; update in-place when the reply is ready.',
    },
  ],
  notes: [
    { kind: 'hint', key: 'ui.discord.provisioningHelp', fallback: 'In the Discord Developer Portal: create an app + bot, ENABLE the Message Content Intent, copy the bot token, and invite the bot (scopes: bot + applications.commands) with View Channels / Send Messages.' },
  ],
};

export const IM_PLATFORMS = [dingtalkDescriptor, feishuDescriptor, wecomDescriptor, discordDescriptor];

// Brand icon + color per id, for the chat IM-source badge (⟦im:<id>⟧).
export const IM_SOURCE_ICONS = Object.fromEntries(
  IM_PLATFORMS.map((p) => [p.id, { Icon: p.icon, color: p.color }]),
);
