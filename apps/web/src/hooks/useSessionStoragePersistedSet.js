import { useState, useEffect, useRef } from 'react';

// 三处持久化样板（FileExplorer 展开 / MobileFileExplorer 展开 / GitChanges 折叠）此前
// 各自手写 lazy useState + useEffect persist + firstMountRef + （后补）prevProjectNameRef，
// GitChanges 修了 "空 → 非空 projectName 异步到达不覆盖" 的 race 但前两处没回流。
// 抽这个 hook 把三件套统一，新增 caller 自动拿到所有防御。
//
// 设计要点：
// - load(projectName) → Set<string>；save(projectName, set) → void。两个回调由 caller 传
//   模块级稳定引用（loadExpandedPaths / saveExpandedPaths 之类），避免 effect deps 抖。
// - **关键不变量**：projectName 从 '' → 非空（API 异步到达）这一跳跳过 rehydrate，保留用户
//   在 projectName 拿到前的内存操作；save effect 会用新 projectName 自然落盘。真正的
//   workspace 切换（非空 → 非空 / 非空 → 空）才丢旧 set 重 hydrate。
// - firstMountRef 跳首跑：lazy useState 已读过 storage，effect 再跑一次 setState 会触发
//   一次额外 render。
//
// 返回 [set, setSet] 跟 useState 同形。class 组件不能用 hook，ChatView 等 class 调用方
// 需在 componentDidUpdate 内手抄同款守卫逻辑（参见 ChatView.componentDidUpdate）。

export function useSessionStoragePersistedSet({ projectName, load, save }) {
  const [setVal, setSetVal] = useState(() => load(projectName));
  const firstMountRef = useRef(true);
  const prevProjectNameRef = useRef(projectName);

  useEffect(() => {
    const prev = prevProjectNameRef.current;
    prevProjectNameRef.current = projectName;
    if (firstMountRef.current) {
      firstMountRef.current = false;
      return;
    }
    if (!prev && projectName) return;
    setSetVal(load(projectName));
  }, [projectName, load]);

  useEffect(() => {
    save(projectName, setVal);
  }, [setVal, projectName, save]);

  return [setVal, setSetVal];
}
