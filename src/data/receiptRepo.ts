import { operationId, receiptSchema } from '../shared/operation';
import type { OperationReceipt } from '../shared/operation';
import type { FileSystem } from './fs';
import { createWrite } from './journal';
import type { Write } from './journal';

const pathFor = (id: string) => `receipts/${operationId.parse(id).toLowerCase()}.json`;

export class ReceiptRepo {
  constructor(private fs: FileSystem) {}
  async get(id: string): Promise<OperationReceipt | null> {
    const path = pathFor(id), file = await this.fs.read(path);
    if (!file) return null;
    const receipt = receiptSchema.parse(JSON.parse(file.text));
    if (receipt.operation_id.toLowerCase() !== operationId.parse(id).toLowerCase()) throw new Error(`Receipt identity mismatch: ${path}`);
    return receipt;
  }
  async write(input: OperationReceipt): Promise<Write> {
    const receipt = receiptSchema.parse({ ...input, operation_id: operationId.parse(input.operation_id).toLowerCase() }), path = pathFor(receipt.operation_id);
    if (await this.fs.read(path)) throw new Error(`Receipt already exists: ${receipt.operation_id}`);
    return createWrite(path, JSON.stringify(receipt), null);
  }
}
