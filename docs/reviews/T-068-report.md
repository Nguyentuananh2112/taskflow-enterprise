# T-068 — Ảnh đại diện — báo cáo (Engineer G)

> Trạng thái: **DONE (chờ lượt máy cho tầng I)**. Nhánh `feat/T-068` (trên `feat/T-067` @f8ae89e7).
> Căn cứ: `docs/design/avatar-chat.md` v2.1 (ADR-142, ADR-146, ADR-147 D13, ADR-148), `test-spec-chat.md` (F).

## Lệch / quyết định (TL đồng ý 18/10 — TL ghi vào ADR lúc gộp)

1. **Migration tách theo ticket.** `20261031000000_avatar` (đổi số khi gộp main sau Mốc 5; ban đầu 20261020000000) chỉ thêm `users.avatar_version INTEGER` + CHECK
   `users_avatar_version_positive_chk` (NULL hoặc 1…999 999 999). Migration chat là `20261031000100_chat` (D, T-069a).
2. **Code avatar nằm trong module auth** (bảng `users` thuộc auth). Route HR `DELETE /hr/employees/:userId/avatar` ở
   company, gọi qua cổng late-bound `accounts.removeAvatar`.
3. **Quy tắc version:** version mới = `max(version đã commit, version lớn nhất còn trên đĩa) + 1`. Không bao giờ dùng
   lại một version còn blob hoặc URL đã cache (gỡ ảnh rồi đặt lại ⇒ v2, không phải v1).
4. **Realtime:** `user:avatar-changed` gửi tới phòng `company`, không dùng `io.emit` (B yêu cầu). Socket chỉ vào phòng
   sau khi `joinPersonalRooms` xác thực lại thành công. Chấp nhận gửi tới mọi socket **chỉ vì** một công ty và mọi
   socket đều đã qua cổng xác thực + công ty (TL, R49). Điều kiện này ghi trong code tại `events.ts` và
   `user-notifications.ts`. Payload chỉ có `{userId, avatarUrl}` (variant 64), không có `avatarUrlLarge`.
   Đã xóa khỏi `PENDING_SERVER_EMIT`.
5. **Trần điểm ảnh theo mục đích:** avatar 24 MP, chat giữ 40 MP (truyền `maxPixels` xuống từng job sharp).
6. **`NotificationDto.actor` → `UserRefDto.nullable()`** (có `avatarUrl`), để thông báo hiển thị ảnh người làm.
7. **`HrAuditAction` thêm `AVATAR_REMOVED`**, ghi `before: {avatarVersion}`, cùng transaction với lệnh gỡ.
8. Ghi chú cho ADR-144 (từ D, TL đã đồng ý): `softDelete` tin nhắn xóa luôn dòng đính kèm trong cùng transaction.

## Đã làm

| Commit | Nội dung |
|---|---|
| 10ba25a1 | migration + `IFileStore.touch` / `list('avatars/…')` + `maxPixels` theo job |
| 1576ccac | repo auth: `lockAvatar` (FOR UPDATE) / `setAvatarVersion` / `avatarVersions` (Prisma + bộ nhớ); `SetAvatarUseCase` / `RemoveAvatarUseCase` |
| 9e9d6c46 | `PUT/DELETE /me/avatar` (authenticate → cổng công ty → rate limit `avatar` 10/giờ, fail-closed → rawUpload 5 MB), avatar trong `UserDto`, realtime, resolver `/media/avatars`, bước sweep `avatars` |
| 08ca2a33 | `DELETE /hr/employees/:userId/avatar`: `authorizeOnEmployee` (Admin; người giữ grant chỉ Admin gỡ được; không tự gỡ của mình qua route HR) + audit |
| 0ec906c7 | `avatarUrl` (64) trong DTO task / workspace / thông báo / nhân viên, qua decorator ở composition (một truy vấn cho mỗi trang) |
| 9ebed3ad | OpenAPI (`binaryBody`, header `X-Upload-Name`), `createTestApp({files})`, parity |
| 5a76a166 | test HTTP + **sửa lỗi**: `withAvatarRefs` dùng `{...instance}` làm mất method trên prototype ⇒ `GET /auth/me` 500 khi có kho tệp. Thay bằng `overriding()` (Proxy, bind `this` gốc) |
| 25b21519 | unit sweep / directory bộ nhớ / blobs / resolver |
| 3e5a3851 | AV-07 socket |
| 304cb992 | tầng I Prisma (**chưa chạy**) |

### Dọn dẹp (D13, ADR-147)

- **Gỡ ảnh:** `avatar_version = NULL`; sau commit `touch` blob về giờ gỡ (giờ nghiệp vụ). URL cũ 404 ngay vì
  resolver đòi version khớp DB. Blob được giữ 30 ngày.
- **Thành viên:** blob khác version hiện tại bị xóa khi quá 30 ngày (giờ nghiệp vụ). Ngoại lệ: version lớn nhất còn
  mới (< 1 giờ, giờ thật) được để yên vì có thể là lần đặt ảnh đang chạy (blob được đặt trước commit).
- **Người đã rời / đã xóa:** quá 30 ngày kể từ `left_at` gần nhất (thiếu `left_at` ⇒ tính từ blob mới nhất) ⇒
  `clearDeparted` (DB) trước, rồi mới xóa đĩa. Người được nhận lại trong 30 ngày vẫn giữ ảnh.
- **"Thuộc công ty"** (thống nhất với D): còn dòng `company_members` và `deleted_at IS NULL`. Người đã nghỉ có
  `avatarUrl: null` ở mọi DTO (AV-04).

## Kiểm thử (chỉ test nhỏ, ≤ 2 worker — chưa chạy job nặng)

| Bộ | Kết quả |
|---|---|
| `test/http/avatar.http.test.ts` (AV-01/02/04, 415/422/413/400/401, cổng công ty, DELETE, ma trận SEC-CH-17 + audit) | 10/10 |
| `test/http/avatar-realtime.http.test.ts` (AV-07) | 1/1 |
| `src/composition/avatar-sweep.test.ts` + `avatar-refs.test.ts` | 8/8 + 1/1 |
| `avatar.use-cases.test.ts` | 11/11 |
| openapi parity + `test/contract` + `src/composition` + http workspace / notifications | 120/120 (16 file) |
| `tsc --noEmit`, eslint, prettier | sạch |
| `test/integration/auth/avatar-directory.int.ts` (CHECK, repo, lockAvatar tuần tự hóa — R46, PrismaAvatarDirectory) | **chưa chạy — cần lượt TL** (DB `taskflow_t067`, Valkey db 7) |
| unit toàn bộ / integration toàn bộ / security | **chưa chạy — cần lượt TL** |

Ca 413: server cắt socket sau trần drain nên client có thể nhận `ECONNRESET` / `EPIPE` thay vì 413. Test chấp nhận
cả hai (F đồng ý) và khẳng định không có blob nào được ghi.

## Còn mở / bàn giao

- Tầng I + unit toàn bộ: chờ lượt máy.
- Attendance / leave / hr-audit / payroll chưa gắn `avatarUrl`; đội Mốc 4/5 thêm bằng `avatarRefs` khi cần.
- Tiếp theo: T-069 (use case / route chat trên `feat/avatar-chat` @4f37d4af của D), rồi T-070.
