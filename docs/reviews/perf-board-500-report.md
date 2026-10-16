# perf/board-500 — render board ở quy mô T-027 (đo, đề xuất, đã sửa P1 + P2)

Engineer E · 2026-10-16 · branch `perf/board-500` (main `31591ab`) · máy yên (lượt Tech Lead sau k6 của D, 10:48–10:56).

## Cách đo
`apps/web/perf/board-scale.perf.tsx` (`pnpm --filter @taskflow/web test:perf`, jsdom, 1 worker, React Profiler `actualDuration`). Đường đi giống `use-board-realtime`: event thô → `parseTaskEvent` (Zod) → `updateBoard(applyRealtimeEvent)` → commit. Mỗi event một macrotask (như socket). Rebalance mô phỏng: 499 `task:moved` cùng cột, mỗi event đổi rank sang khóa mới — rebalance thật dùng `ranks.spread(n)` (khóa rải đều) nên ở client các trạng thái TRUNG GIAN bị xáo thứ tự (khóa mới lẫn khóa cũ dồn cục), mỗi event dời 1 thẻ — mô phỏng là sát/hơi xấu hơn thực tế. jsdom không có layout ⇒ số là cận trên phần React; Chromium thật nhanh hơn vài lần nhưng tỉ lệ giữa các ca giữ nguyên.

## Kết quả (ms, jsdom)
| Ca | 1 cột × 500 | 4 cột × 500 (2000 thẻ) |
|---|---|---|
| Mount (Profiler / tới DOM) | 649 / 1999 | 1161 / 10549 |
| 1 `task:updated` (bộ cũ `board.perf.tsx`, 4×125) | commit 6 | — |
| **1 `task:moved`** (thẻ đầu sang cột khác / cuối cột) | **commit 244**, wall 308 | **commit 246**, wall 308 |
| **Rebalance 499 event lần lượt** | **wall 84 s** (169 ms/event), commit avg 125 · p95 320 · max 867 | **wall 84 s** (168 ms/event), commit avg 123 · p95 305 · max 509 |
| Cùng 499 event gom 1 lần | commit 68, wall 112 | commit 138, wall 444 |

Ngân sách frontend.md §4.7: merge 1 event < 4 ms, mount 500 < 300 ms (Chrome). Ngưỡng của Tech Lead: > 100 ms/event hoặc khựng khi 500 event ⇒ **tệ**: `task:moved` đắt gấp ~40 lần `task:updated`, và một rebalance chiếm main thread hàng chục giây (jsdom; ước vài–hơn chục giây ở Chrome) ⇒ board đơ.

## Nguyên nhân (đọc code, khớp số đo)
1. **Mỗi event một commit.** 499 event = 499 lần setQueryData + render cột. Gom lại thì 499 event chỉ tốn 68–138 ms ⇒ chi phí nằm ở số lần commit, không ở merge/parse (merge 0.01 ms, `toColumns` 0.09 ms).
2. **Dời 1 thẻ ⇒ render lại cả cột.** `SortableTaskCard` (memo) nhận `index`; dời 1 thẻ làm dịch index mọi thẻ phía sau ⇒ chúng render lại (cần thiết cho `useSortable`). Nhưng nó dựng `handle` (`<button>`) và `actions` (`<MoveMenu>`) là JSX MỚI mỗi lần ⇒ phá `memo` của `TaskCard` ⇒ cả thẻ + MoveMenu render lại, không chỉ wrapper mỏng. `task:updated` không đổi index nên chỉ 1 thẻ render (6 ms).

## Đề xuất (Tech Lead duyệt P1 + P2, giữ N event — đã làm, xem cuối)
- **P1 — Gom event `task:*` theo frame ở client** (`use-board-realtime`): xếp event đã parse vào hàng đợi, `requestAnimationFrame` (tab ẩn: rAF dừng ⇒ hàng đợi xả khi hiện lại, hoặc fallback `setTimeout` 50 ms) xả bằng MỘT `updateBoard` reduce cả lô. Hợp đồng không đổi; trễ hiển thị ≤ 1 frame. Burst rebalance (server phát liền 499 event sau commit) ⇒ 1–vài commit thay vì 499. Vẫn giữ đúng quy tắc version/tombstone/dedupe (reduce tuần tự qua `applyRealtimeEvent`). Ước 0.5 ngày + test (fake rAF).
- **P2 — Giữ `TaskCard` memo khi chỉ đổi index**: `useMemo` cho `handle`/`actions` trong `SortableTaskCard` (deps: `canDrag`, `pending`, `task`, `handleRef`, `getColumns`, `onMove`) ⇒ dịch index chỉ chạy lại `useSortable` + `<li>`. Giảm chi phí 1 `task:moved` / kéo thả / optimistic move (cùng đường). Thêm ca vào `test/board-render-count.test.tsx` (move ⇒ TaskCard của thẻ khác KHÔNG render lại). Ước 0.5 ngày.
- **Không cần đổi API (trả lời câu hỏi "giữ N event hay `column:rebalanced`"): GIỮ N event.** Với P1, client tự gom; payload 499 × ~1 KB ≈ 0.5 MB/client/lần rebalance — hiếm (≈ 300 lần chèn vào cùng một khe mới xảy ra), chấp nhận được. `column:rebalanced` chỉ đáng làm nếu sau P1 đo Chromium vẫn khựng, hoặc k6 cho thấy phát 499 event tốn ở server (A3/D trả lời phần đó).
- **Không ảo hóa cột** lúc này (xung đột sortable, +3 ngày theo §4.7) — chỉ xét nếu sau P1+P2 mount 2000 thẻ vẫn quá ngân sách trên Chromium.
- Sau P1+P2: đo lại jsdom + **1 lượt Chromium headless ngắn** (board prod 1×500 qua mock API, đo long task khi move/rebalance) để có số thật.

## Sau sửa (P2 `20e0070`, P1 `f20ef77`, bench `bfb6706`) — 2026-10-16, máy yên

jsdom (`test:perf`, cùng bộ đo; 2 lần chạy):

| Ca | Trước | Sau | Tiêu chí Tech Lead |
|---|---|---|---|
| 1 `task:moved` (commit) | 244–246 ms | **42–53 ms** (4 lần đo: 42 · 44 · 53 · 43) | < 50 ms — đạt 3/4, lần 1×500 thứ hai 52.7 ms |
| Rebalance 499 event, không gom (đối chứng) | wall 84 s, commit max 867 ms | wall 13–15 s, commit max 56–74 ms (chỉ nhờ P2) | commit < 200 ms — đạt |
| Qua sink P1, event đến dồn (`setImmediate`, như trình duyệt xả message WS đã đệm) | — | **1 commit 72–81 ms, wall 0.14–0.37 s** | đạt |
| Qua sink P1, event cách nhau ≥ 1 ms (`setTimeout`, cận xấu) | — | ~220 commit, max 52–59 ms, wall 7.5–8.3 s | commit < 200 ms — đạt |
| Mount 500 / 2000 thẻ | 649 / 1161 ms | 482–489 / 987–1367 ms | (ngoài phạm vi P1/P2) |

Chromium headless (Playwright, bản `next build` prod + mock API, 1 cột × 500, 1440×900; `perf-chromium.mjs` trong scratchpad, không commit). Mock dev không có socket ⇒ đo **1 move qua menu "Chuyển tới"** (optimistic, cùng đường re-render với `task:moved`: thẻ đầu cột sang cột khác, dịch index 499 thẻ), không đo được burst rebalance (dựa vào jsdom):

| CPU | Mount tới DOM | Long task lớn nhất khi mount | Move: click → thẻ ở cột mới | Long task khi move |
|---|---|---|---|---|
| 1× | 994 ms | 314 ms | 99 ms | **không có** (> 50 ms) |
| 4× (throttle CDP) | 3760 ms | 2423 ms | 470 ms | max 129 ms, tổng 373 ms |

Kết luận: move/realtime đạt mục tiêu sau P1 + P2. **Còn lại (ngoài phạm vi việc này):** mount 500 thẻ ở CPU 4× có long task 2.4 s, vượt ngân sách §4.7 (< 300 ms ở 4×) — bậc 3–4 của §4.7 ("Hiện thêm" cho cột Hoàn thành / ảo hóa cột > 150 thẻ). Đề xuất ticket riêng nếu Tech Lead muốn đạt ngân sách mount.

DoD trên `bfb6706` (base main `31591ab`; sau đó rebase lên `3b16a6e` — main chỉ đổi docs/`load/`, không đụng `apps/`, `packages/`, lockfile ⇒ không chạy lại): `VITEST_MAX_WORKERS=2 pnpm verify` exit 0 (179 file / 1748 test, audit sạch); `apps/web` `pnpm build` exit 0; `test:perf` exit 0; hook đủ. Server :3021 đã tắt.
