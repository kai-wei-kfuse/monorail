// 从计时条、记录条写的一行字里取出 #标签 和 @项目（原型 model.js 的 parseText）。

/** description 是去掉 #… @… 以后的字；project 只认已有项目，写了不存在的 @x 当没写。 */
export function parseEntryText(text: string, projects: readonly string[]): { description: string; tags: string[]; project: string | null } {
  // Metadata starts at a token boundary; URL fragments and email addresses remain ordinary text.
  const tags = [...new Set([...text.matchAll(/(?:^|\s)#([^\s#@]+)/g)].map(m => m[1]))];
  const at = /(?:^|\s)@([^\s#@]+)/.exec(text)?.[1];
  return {
    description: text.replace(/(^|\s)[#@][^\s#@]+/g, '$1').replace(/\s+/g, ' ').trim(),
    tags,
    project: at !== undefined && projects.includes(at) ? at : null,
  };
}
