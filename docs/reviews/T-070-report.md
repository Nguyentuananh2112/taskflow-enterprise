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

## Còn mở

- **Workspace xóa mềm / thành viên rời ws ⇒ chưa phát `chat:conversation:removed`.** Việc này cần hook ở module
  workspace, nằm ngoài phạm vi chat. REST trả 404 ngay và tin kế tiếp không tới, vì người nhận được tính lúc phát.
  Web xử lý 404 bằng cách bỏ hội thoại. Nếu TL muốn có event, đó là việc nhỏ ở workspace (gọi
  `notifier.conversationRemoved`).
- Test 2 socket / 2 tab ở tầng I (redis-adapter) và E2E chạy theo cổng TL / F.
