# F3 workspace — lấp GAP mutation (chủ module: B)

**Người làm:** Engineer B · **Branch:** `test/F3-ws-gaps` (từ main `9d177c7`) · **Ngày:** 2026-10-16
**Nguồn:** `docs/reviews/F3-mutation-report.md` §4.1 (F, snapshot main `4ba066b`, workspace 83.07 %).

Chỉ thêm / sửa test. Không đổi code sản phẩm.

Mọi ca đã được **đột biến tay** đúng dòng nó bảo vệ, và đều đỏ:

- thay một chuỗi, chạy đúng test theo tên, khôi phục file từ bản sao;
- script `mutate.sh` trong scratchpad; số test chạy được in kèm, để không lẫn với lượt "0 test khớp bộ lọc".

## P1 + INT ưu tiên

| GAP                         | Test                                                                                                                                                                                                                                                                                        | Mutant đã giết                                                              |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| **W-1** `add-member:65`     | `members-stale-actor.test.ts`: OWNER bị hạ xuống PM trong store, request cũ (role OWNER) cấp `OWNER` / `PM` ⇒ 403, `details.required = member:add`, nina không vào. Đối chứng: cấp `MEMBER` vẫn được                                                                                        | `!canGrant(fresh.role, role)` → `false` ⇒ 2 ca đỏ                           |
| `exclusive-purge-run` (9 %) | `exclusive-purge-run.test.ts` (mới, `$queryRaw` giả): khóa được ⇒ gọi lô đúng 1 lần `(id, now)`, trả nguyên kết quả; `locked=false` / không dòng ⇒ `PurgeRunBusyError` (là `PurgeRunStopped`), không gọi lô; lỗi DB ⇒ ném nguyên; lỗi giữa lô ⇒ lan ra; tham số khóa = `PURGE_RUN_LOCK_KEY` | 6 / 6 (điều kiện `false` / `true` / đảo, bỏ `return`, sai `now`, khóa rỗng) |

**Không viết ca hộp đen SEC cho W-1.** Phải chèn thao tác "hạ role" đúng giữa lúc middleware đọc role và lúc khóa owners. Từ ngoài API điều này không tất định (cùng lý do với SEC-24d). Unit stale-actor là đúng tầng.

## P2 (W-2..W-11)

File `f3-mutation-gaps.test.ts` (W-2..W-9) và `test/http/workspace.http.test.ts` (W-10, W-11).

| GAP  | Test                                                                                                                                                                     | Mutant                                    |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------- |
| W-2  | tạo project có description ⇒ view + bản lưu                                                                                                                              | `?? null` → `&& null`                     |
| W-3  | archive ⇒ `project:updated` + meta `{actorId, originClientId}`                                                                                                           | type `''`; `?? null` → `&& null`          |
| W-4  | đổi role ⇒ `notifyRoleChanged` có `originClientId`                                                                                                                       | `?? null` → `&& null`                     |
| W-5  | create-workspace: lỗi DB / conflict khác slug ⇒ ném đúng lỗi đó, gọi 1 lần                                                                                               | bỏ `if (!isSlugConflict) throw`           |
| W-6  | restore id không tồn tại ⇒ 404 `{resource:'workspace'}`                                                                                                                  | `\|\|` → `&&` (TypeError)                 |
| W-7  | project biến mất giữa đọc và ghi ⇒ 404 `{resource:'project'}`                                                                                                            | `!current` → `false`                      |
| W-8  | 409 mang `currentVersion` = version đã lưu                                                                                                                               | getter `version` → `undefined`            |
| W-9  | "ws của tôi" ⇒ view đầy đủ                                                                                                                                               | map → `undefined`                         |
| W-10 | OWNER gửi body / params / query sai ở 6 route ⇒ 400; **bỏ cursor dự phòng hardcode** ở test phân trang (giờ tạo project thứ 2, kiểm 200 + `limit 1` + `nextCursor` thật) | 6 route bỏ schema (body / params / query) |
| W-11 | VIEWER và MEMBER `GET …/projects/:id` ⇒ 200, đúng ProjectDto                                                                                                             | `permit('')`; handler nhận `{}`           |

**Lưu ý W-8.** Bản đầu so `currentVersion` với chính getter `version`, là thứ đang bị đột biến ⇒ mutant sống. Bản sửa so với snapshot lưu NGAY sau lần ghi chen (đọc lúc đó vì `FakeUnitOfWork` rollback cả lần ghi chen khi use case thất bại; Postgres thì không).

**Lưu ý W-10 (không có lỗi sản phẩm).** `GET /projects?limit=1` chạy đúng. Cursor dự phòng chỉ che _khả năng_ route hỏng: test chưa từng kiểm status.

Case `PATCH project {keyPrefix}` lúc đầu không giết được mutant: use case tự từ chối bản cập nhật rỗng. Đã đổi body thành `{name, keyPrefix}`; khi đó chỉ schema strict mới chặn.

## P3 (W-12..W-22)

File `f3-mutation-gaps-p3.test.ts`; W-19 ở `workspace.http.test.ts`.

| GAP  | Test                                                                                                                                | Mutant                                               |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| W-12 | `slugifyName('a'×39 + ' bcd')` ⇒ `'a'×39`                                                                                           | bỏ `.replace(/-+$/)` sau `slice`                     |
| W-13 | biên hợp lệ: description 2000, `pageLimit(1)`, `pageLimit(100)`, q 100 ký tự, gốc slug 3 ký tự                                      | 5 phép so `>`/`<` → `>=`/`<=`                        |
| W-14 | OWNER duy nhất tự đặt lại OWNER ⇒ OK                                                                                                | `role !== 'OWNER'` → `true`                          |
| W-15 | membership còn, user mất ⇒ 404 `user`                                                                                               | `!user` → `false`                                    |
| W-16 | ws đã xóa: Delete (slug sai) 404 chứ không 400; Update 404 và **không gọi `save`**; Get 404                                         | 3 × `!ws \|\| ws.isDeleted` → `false`                |
| W-17 | PATCH slug giữ nguyên ⇒ không log `workspace.slug_changed`; slug mới ⇒ có                                                           | `!== ws.slug` → `true`                               |
| W-18 | lỗi DB khi kiểm quyền project ⇒ ném nguyên                                                                                          | `instanceof` → `true`                                |
| W-19 | `?deleted=yes`, DELETE `{}` và DELETE `{confirmSlug đúng, force}`, PATCH member field lạ ⇒ 400                                      | 3 route bỏ schema                                    |
| W-20 | `path:code` của issues: role, confirmSlug, limit, q, `[]:too_small` × 2, name (create / update ws, project; domain trực tiếp), slug | mẫu đại diện: code → `''`, field `'name'` → `''` (6) |
| W-21 | `details.resource`: optimistic-save ws, owner-guard, project.queries, set-archived, restore thua job purge                          | 3 mẫu → `''`                                         |
| W-22 | `details.required`: PM cấp OWNER (`member:add`), PM xóa OWNER (`member:remove`)                                                     | `required` → `''`                                    |

**W-16 Update.** Lớp sau (`saveWorkspaceOrFail`) cũng ra 404, nên chỉ nhìn mã lỗi thì không thấy lớp đầu bị gỡ. Test kiểm thêm là không có lần ghi nào.

**W-19 DELETE.** Thiếu schema thì body `{}` vẫn 400 (use case báo `confirmSlug` không khớp). Case `confirmSlug` đúng + field lạ mới phân biệt: không có schema thì workspace bị xóa thật.

## EQ / đề xuất (chưa làm — cần Tech Lead quyết vì đụng code sản phẩm)

- `presentation/keyset-cursor.ts`: lớp dư (`afterFromCursor` đã `z.uuid()`). Đề xuất xóa, hoặc ghi rõ là lớp dự phòng.
- Bản sao `isSlugConflict` ở `auth/register.use-case.ts:43`: đề xuất register dùng chung helper của workspace qua public API của module (ADR-093) để khỏi lệch.

## Kiểm (exit code)

`tsc` 0 · `eslint` 0 · `lint:deps` 0 · vitest `src/modules/workspace` + `test/http/workspace.http.test.ts` ⇒ exit 0, 24 file / 216 test (trước: 23 / 202 sau đợt P2). Integration / security không đụng (chỉ unit + HTTP in-memory).
