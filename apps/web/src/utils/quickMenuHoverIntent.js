// 级联子菜单 hover-intent（终端工具栏与对话输入栏的四芒星快捷菜单共用）：
// 从下排行斜向上滑向其子菜单高处选项时，路径会扫过相邻行，立即切换会抢走展开态
// 致子菜单中途消失。进入（已有展开行时）/离开都延迟 HOVER_INTENT_MS 提交，扫过的
// 行来不及生效，路径上的误触发被后续 clearTimeout 撤销；无展开行时进入即时响应不付延迟。

export const HOVER_INTENT_MS = 140;

// getExpanded 必须现场读宿主最新值（class 读 this.state，hooks 读 latest-value ref）：
// 延迟提交时展开行可能已被后续 enter/点击改写，闭包快照会误收别行的展开态。
// skip：宿主整体不参与 hover 展开（如 iPad tap 的 synthetic mouseEnter 会与 click 切换互抵）；
// holdOpen：延迟收起提交时刻判定是否保住展开（如 AgentTeam 启用请求进行中保住 loading 反馈）。
export function createQuickMenuHoverIntent({ getExpanded, setExpanded, skip, holdOpen }) {
  let timer = null;
  return {
    enter(key) {
      if (skip?.()) return;
      clearTimeout(timer);
      const current = getExpanded();
      if (current === key) return;
      if (current === null) setExpanded(key);
      else timer = setTimeout(() => setExpanded(key), HOVER_INTENT_MS);
    },
    leave(key) {
      if (skip?.()) return;
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (holdOpen?.(key)) return;
        if (getExpanded() === key) setExpanded(null);
      }, HOVER_INTENT_MS);
    },
    cancel() {
      clearTimeout(timer);
    },
  };
}
