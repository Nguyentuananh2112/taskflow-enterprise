# T-070 — Realtime trò chuyện (Engineer G) — báo cáo

> **Trạng thái:** DONE ở mức test nhỏ. Cùng nhánh `feat/T-069` (TL: T-070 trên nhánh này), commit 3ff7f020.
> **Căn cứ:** `avatar-chat.md` ADR-145, B L1 (cache typing ≤ 5 s), SEC-CH-04 / 05 / 19.

## Đã làm

- **Phát tới phòng `user:{id}`.** Mỗi event chat tính người nhận LÚC PHÁT bằng `recipientIds` của store D: participant
  hiệu lực, hoặc thành viên ws, đã lọc công ty hoạt động. Chỉ một lần `io.to([...])` cho cả danh sách. Không có phòng
  theo hội thoại, không có `chat:join`.
  - Vì tính lúc phát, người vừa bị bớt / nghỉ việc / hết `access_until` không nhận tin kế tiếp, kể cả khi socket còn
    mở (SEC-CH-04/05).
- **Event:**
  - `chat:message:new` và `chat:message:updated` mang `{message}` là MessageDto đầy đủ, có `clientMsgId`.
  - `chat:read`: DIRECT ⇒ cả hai phía ("Đã xem"); GROUP / WS ⇒ chỉ các thiết bị của chính người đọc.
  - `chat:conversation:updated`: ConversationDto theo góc nhìn TỪNG người (unread / muted / myRole khác nhau), nên
    phát một lần cho mỗi người.
  - `chat:conversation:removed`: tới người bị bớt hoặc tự rời.
- **Nơi đặt code:**
  - `ChatRealtimeNotifier` (module chat) hiện thực `IChatNotifier`; use case gọi trong `afterCommit`.
  - Core `core/realtime/chat-realtime.ts`: `emitChat` + `registerChatTyping`.
  - Gateway có option `chatTyping`; container xuất `gateway` (authenticator, accessChecker, chatTyping) để dùng
    `...container.gateway`.
- **`chat:typing`:**
  - Payload sai, phiên chưa xác thực lại, quá nhịp, hoặc không có quyền ⇒ bỏ qua im lặng, không ack (SEC-CH-19).
  - Nhịp ≤ 1 lần / 3 s / socket.
  - Quyền + người nhận cache theo socket ≤ 5 s, tối đa 50 mục; lỗi tra quyền ⇒ fail-closed.
  - Không gửi về chính người gõ.
- **Parity:** `PENDING_SERVER_EMIT` đã RỖNG. Regex parity nhận được tên event nhiều phần — trước đây `chat:message:new`
  không bao giờ khớp.
- **Tách file vì max-lines:** `clientIp` sang `core/realtime/client-ip.ts` (gateway vẫn re-export);
  `gatedSocketAuth` / `gatewayOptions` sang `late-realtime.ts`.

## Kiểm thử (chỉ test nhỏ, ≤ 2 worker)

| Bộ | Kết quả |
|---|---|
| `chat-realtime.http.test.ts` (gateway thật, 3 socket): DIRECT new + read, Otto không nhận; bớt khỏi nhóm ⇒ removed + không nhận tin kế tiếp, người còn lại nhận updated theo góc nhìn mình; typing tới người kia, không về mình, quá nhịp bỏ, người ngoài / payload sai không ai nhận | 3/3 |
| `chat-realtime-notifier.test.ts` (hết `access_until` ⇒ không nhận; read DIRECT với GROUP; updated mỗi người; typingRecipients) | 4/4 |
| Gộp: chat, composition, core, HTTP chat / avatar / realtime, parity OpenAPI + realtime, contract, files | **835/835** (73 file) |
| tsc, eslint, prettier, dependency-cruiser | sạch |

## T-070b — `chat:conversation:removed` khi mất quyền workspace (TL)

- **Hook ở composition, không sửa module workspace.** `LateBoundRealtime.onWorkspaceAccessLost` chạy SAU hai lời gọi
  mà workspace vốn đã làm sau commit:
  - `revokeWorkspaceAccess`: bị bớt; tự rời; nghỉ việc qua `WorkspaceExit` (T-062), sau đó auth còn
    `disconnectUser`;
  - `closeWorkspace`: ws xóa mềm.
  Lỗi của hook chat bị nuốt, không ảnh hưởng event workspace.
- **`ChatRealtimeNotifier.workspaceAccessLost`:** `findByWorkspace` (D, 7a93ff12) ⇒ phòng chưa từng mở thì không phát;
  có phòng ⇒ `removed {conversationId}` tới ĐÚNG những người mất quyền. Chỉ id, không nội dung.
- **Lưu trữ ws:** Admin chỉ lưu trữ được ws không còn thành viên (`workspace_has_members`), nên không có ai cần báo.
- **Nghỉ việc ⇒ nhóm / DIRECT:** socket bị ngắt khi hoàn tất (`disconnectUser`), REST 401 `SESSION_REVOKED`; web xóa
  cache chat khi `SESSION_REVOKED` (§7). Không cần event.
- **Test:**
  - `chat-workspace-realtime.http.test.ts` 3/3: bị bớt ⇒ người đó nhận, người ở lại không; tự rời; xóa mềm ⇒ mọi
    thành viên nhận; phòng chưa mở ⇒ không phát.
  - Unit `workspaceAccessLost` 1/1.
  - Bộ gộp 853/853.
- **B (L, ghi nhận):** `conversationUpdated` gọi `summaryFor` riêng từng người. Hiện chỉ phát ở lệnh quản trị nhóm /
  tạo hội thoại (≤ 100 người), không phát mỗi tin, nên chấp nhận được. Nếu sau này phát mỗi tin thì phải gom bằng
  một truy vấn.

## Còn mở

- Test 2 socket / 2 tab ở tầng I (redis-adapter) và E2E chạy theo cổng TL / F.
