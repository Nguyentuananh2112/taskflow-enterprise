import { vi } from 'vitest';

// XHR giả chạy qua `fetch` cho test tích hợp UI (T-071). jsdom kiểm CORS cho XHR (trang :3000 → API :4000) mà mock
// MSW không mô phỏng CORS/preflight ⇒ XHR thật của jsdom luôn lỗi mạng. Bản này giữ đúng phần XHR mà
// `shared/api/upload.ts` dùng (open, header, upload.onprogress, onload/onerror/onabort, abort); ngữ nghĩa XHR chi tiết đã
// có `upload.test.ts`. Request đi qua `fetch` ⇒ MSW + cookie jar như mọi request khác.

class FetchXhr {
  status = 0;
  responseText = '';
  responseType = '';
  withCredentials = false;
  readonly upload: { onprogress: ((e: ProgressEvent) => void) | null } = { onprogress: null };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  ontimeout: (() => void) | null = null;
  onabort: (() => void) | null = null;
  private method = 'GET';
  private url = '';
  private readonly headers = new Headers();
  private responseHeaders = new Headers();
  private readonly controller = new AbortController();

  open(method: string, url: string) {
    this.method = method;
    this.url = url;
  }
  setRequestHeader(name: string, value: string) {
    this.headers.set(name, value);
  }
  getAllResponseHeaders() {
    return [...this.responseHeaders].map(([k, v]) => `${k}: ${v}`).join('\r\n');
  }
  abort() {
    this.controller.abort();
  }
  send(body: Blob | null) {
    const total = body?.size ?? 0;
    // eslint-disable-next-line no-restricted-globals -- hạ tầng test (như installCookieJar)
    fetch(this.url, {
      method: this.method,
      headers: this.headers,
      body,
      credentials: this.withCredentials ? 'include' : 'omit',
      signal: this.controller.signal,
    })
      .then(async (response) => {
        this.upload.onprogress?.({ lengthComputable: true, loaded: total, total } as ProgressEvent);
        this.status = response.status;
        this.responseHeaders = response.headers;
        this.responseText = await response.text();
        this.onload?.();
      })
      .catch(() => (this.controller.signal.aborted ? this.onabort?.() : this.onerror?.()));
  }
}

/** Thay `XMLHttpRequest` cho file test; gỡ bằng `vi.unstubAllGlobals()`. */
export function stubFetchXhr() {
  vi.stubGlobal('XMLHttpRequest', FetchXhr);
}
