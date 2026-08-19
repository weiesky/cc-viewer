// 发送链路对「图片上传仍在途」的纯判定 + uploadingItems 归约。
// 抽成纯函数便于 node:test 单测(参考 test/single-ws-submit.test.js 的纯函数+DI 范式)。
// 真正的 setState / URL.revokeObjectURL 副作用由 ChatView 执行,这里只算结果。

/**
 * 是否应缓发(defer):只要有上传在途就必须缓发,绝不放行立即发送。
 * 注意:不要用 alreadyDeferred 参与判定 —— 否则「已 deferred 时返回 false」会让第二次 Enter
 * 落进立即发送分支、在上传未完成时发出纯文字(丢图 + 可能重复发送)。
 * 双发幂等交给调用方 _deferSend 的实例标志处理(已 deferred 则不重复武装),不在本判定里短路。
 * @param {{uploadingCount:number}} p
 * @returns {boolean}
 */
export function shouldDeferSend({ uploadingCount }) {
  return uploadingCount > 0;
}

/**
 * 对 uploadingItems(元素 {id, name, previewUrl})做纯归约。
 * 返回 { next, revoke }:next 为新数组,revoke 为需要 URL.revokeObjectURL 的 url 列表。
 * @param {Array<{id:string,name?:string,previewUrl?:string}>} items
 * @param {{type:'add'|'remove'|'clear', item?:object, id?:string}} action
 * @returns {{next:Array, revoke:string[]}}
 */
export function reduceUploading(items, action) {
  const list = Array.isArray(items) ? items : [];
  switch (action && action.type) {
    case 'add': {
      if (!action.item || !action.item.id) return { next: list, revoke: [] };
      if (list.some(i => i.id === action.item.id)) return { next: list, revoke: [] }; // 去重 id
      return { next: [...list, action.item], revoke: [] };
    }
    case 'remove': {
      const item = list.find(i => i.id === action.id);
      if (!item) return { next: list, revoke: [] };
      return {
        next: list.filter(i => i.id !== action.id),
        revoke: item.previewUrl ? [item.previewUrl] : [],
      };
    }
    case 'clear': {
      return { next: [], revoke: list.map(i => i.previewUrl).filter(Boolean) };
    }
    default:
      return { next: list, revoke: [] };
  }
}
