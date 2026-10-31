import type { GovernanceCall } from "./proposalValidation";

export type GovernanceReceipt = {
  status?: number | null; hash?: string; transactionHash?: string;
  blockNumber?: number; blockHash?: string; from?: string; to?: string | null;
  logs?: readonly { address: string; topics: readonly string[]; data: string; removed?: boolean }[];
};
export type GovernanceReceiptProvider = {
  getTransaction: (hash: string) => Promise<{ from: string; to: string | null; data: string; value: bigint; hash?: string; blockHash?: string | null } | null>;
  getBlock: (block: number) => Promise<{ hash: string | null } | null>;
};
const same = (left: string | null | undefined, right: string) => typeof left === "string" && left.toLowerCase() === right.toLowerCase();
/** Verify the exact submitted action, including successful replacement transactions. */
export async function verifySubmittedGovernanceReceipt(provider: GovernanceReceiptProvider, receipt: GovernanceReceipt,
  call: Pick<GovernanceCall, "to" | "data" | "value">, account: string): Promise<string> {
  const hash = receipt.hash ?? receipt.transactionHash;
  if (receipt.status !== 1 || !hash || !/^0x[0-9a-f]{64}$/i.test(hash)
    || !Number.isSafeInteger(receipt.blockNumber) || !receipt.blockHash || !/^0x[0-9a-f]{64}$/i.test(receipt.blockHash)) throw new Error("The mined governance receipt could not be verified.");
  const [transaction, block] = await Promise.all([provider.getTransaction(hash), provider.getBlock(receipt.blockNumber!)]);
  if (!transaction || (transaction.hash && !same(transaction.hash, hash)) || !same(transaction.from, account) || !same(transaction.to, call.to)
    || transaction.data.toLowerCase() !== call.data.toLowerCase() || transaction.value !== call.value
    || !same(block?.hash, receipt.blockHash) || (transaction.blockHash && !same(transaction.blockHash, receipt.blockHash))
    || (receipt.from && !same(receipt.from, account)) || (receipt.to && !same(receipt.to, call.to))
    || receipt.logs?.some(log => log.removed)) {
    throw new Error("The mined transaction does not match this governance action. Check wallet activity before trying again.");
  }
  return hash;
}
