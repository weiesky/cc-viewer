// ultraplan 预设专家路由 —— 枚举随包发布的 ultraAgents/*.json 供前端「添加预设专家」弹窗使用。
// 无参数、不读项目目录：listUltraAgents() 默认 dir = ULTRA_AGENTS_DIR（包内置目录），
// 不接受任何 query/body，杜绝路径穿越与越权读取被查看项目的风险。
import { listUltraAgents } from '../lib/ultra-agents-api.js';

async function ultraAgentsList(req, res) {
  try {
    const agents = listUltraAgents();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, agents }));
  } catch (err) {
    console.error('[api/ultra-agents]', err);
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'internal_error' }));
  }
}

export const ultraAgentsRoutes = [
  { method: 'GET', match: 'exact', path: '/api/ultra-agents', handler: ultraAgentsList },
];
