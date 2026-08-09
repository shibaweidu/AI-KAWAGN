export type DemandFixture = { id: string; title: string; body: string; budget: number; replies: number; age: string };

// The demand page is retained as a separate, non-market fixture until its API is enabled.
export const demands: DemandFixture[] = [
  { id: "d1", title: "寻找稳定的 Claude Pro 供应", body: "需要长期使用，优先考虑库存和更新稳定的店铺。", budget: 30, replies: 2, age: "今天" },
  { id: "d2", title: "Cursor Pro 团队版", body: "需要 5 个席位，支持月付和售后说明。", budget: 80, replies: 1, age: "昨天" },
];
