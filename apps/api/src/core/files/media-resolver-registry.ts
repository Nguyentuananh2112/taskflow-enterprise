import type { IMediaResolver, ResolvedMedia } from './ports';

type Target = Parameters<IMediaResolver['resolve']>[0];

/**
 * `/media` hỏi DB theo `kind` — module sở hữu dữ liệu đăng ký resolver của mình ở composition root (avatar:
 * T-068, chat: T-069). Chưa đăng ký ⇒ `null` ⇒ 404 (fail-closed).
 */
export class MediaResolverRegistry implements IMediaResolver {
  readonly #byKind = new Map<Target['kind'], IMediaResolver>();

  register(kind: Target['kind'], resolver: IMediaResolver): void {
    if (this.#byKind.has(kind)) throw new Error(`resolver /media '${kind}' đã đăng ký`);
    this.#byKind.set(kind, resolver);
  }

  resolve(target: Target): Promise<ResolvedMedia | null> {
    return this.#byKind.get(target.kind)?.resolve(target) ?? Promise.resolve(null);
  }
}
