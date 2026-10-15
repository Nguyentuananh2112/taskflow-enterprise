import { AsyncLocalStorage } from 'node:async_hooks';

export interface RequestContext {
  readonly requestId: string;
  /** IP thật của client (Express `req.ip`, đã áp `trust proxy`). */
  readonly ip?: string | undefined;
}

const storage = new AsyncLocalStorage<RequestContext>();

/** Ngữ cảnh theo request, lan truyền qua mọi lời gọi async (devops.md §6.1). */
export const requestContext = {
  run<T>(context: RequestContext, fn: () => T): T {
    return storage.run(context, fn);
  },
  get(): RequestContext | undefined {
    return storage.getStore();
  },
  requestId(): string | undefined {
    return storage.getStore()?.requestId;
  },
};
