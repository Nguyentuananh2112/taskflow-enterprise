-- Mốc 6 — trò chuyện (docs/design/avatar-chat.md §3, ADR-143/144/148; T-069a). TẠM timestamp — TL đặt lúc gộp;
-- tách khỏi 20261031000000_avatar (users.avatar_version — G, T-068). 3 enum + 5 bảng, FK: users Restrict,
-- hội thoại Cascade, workspace Cascade (purge ws xóa chat — R20), reply / message của đính kèm SetNull.

-- CreateEnum
CREATE TYPE "chat_conversation_kind" AS ENUM ('DIRECT', 'GROUP', 'WORKSPACE');

-- CreateEnum
CREATE TYPE "chat_participant_role" AS ENUM ('OWNER', 'MEMBER');

-- CreateEnum
CREATE TYPE "chat_attachment_kind" AS ENUM ('IMAGE', 'FILE');

-- CreateTable
CREATE TABLE "chat_conversations" (
    "id" UUID NOT NULL,
    "kind" "chat_conversation_kind" NOT NULL,
    "title" VARCHAR(80),
    "direct_key" VARCHAR(73),
    "workspace_id" UUID,
    "created_by_id" UUID NOT NULL,
    "last_message_at" TIMESTAMPTZ(3),
    "last_message_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "chat_conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chat_participants" (
    "conversation_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role" "chat_participant_role" NOT NULL DEFAULT 'MEMBER',
    "joined_at" TIMESTAMPTZ(3) NOT NULL,
    "left_at" TIMESTAMPTZ(3),

    CONSTRAINT "chat_participants_pkey" PRIMARY KEY ("conversation_id","user_id")
);

-- CreateTable
CREATE TABLE "chat_read_states" (
    "conversation_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "last_read_message_id" UUID,
    "muted" BOOLEAN NOT NULL DEFAULT false,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "chat_read_states_pkey" PRIMARY KEY ("conversation_id","user_id")
);

-- CreateTable
CREATE TABLE "chat_messages" (
    "id" UUID NOT NULL,
    "conversation_id" UUID NOT NULL,
    "sender_id" UUID NOT NULL,
    "client_msg_id" UUID NOT NULL,
    "request_hash" CHAR(64) NOT NULL,
    "body" TEXT,
    "reply_to_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "edited_at" TIMESTAMPTZ(3),
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "chat_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chat_attachments" (
    "id" UUID NOT NULL,
    "uploader_id" UUID NOT NULL,
    "message_id" UUID,
    "kind" "chat_attachment_kind" NOT NULL,
    "original_name" VARCHAR(255) NOT NULL,
    "mime" VARCHAR(100) NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "sha256" CHAR(64) NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "file_key" VARCHAR(128) NOT NULL,
    "preview_key" VARCHAR(128),
    "thumb_key" VARCHAR(128),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chat_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "chat_conversations_direct_key_key" ON "chat_conversations"("direct_key");

-- CreateIndex
CREATE UNIQUE INDEX "chat_conversations_workspace_id_key" ON "chat_conversations"("workspace_id");

-- CreateIndex
CREATE INDEX "chat_conversations_created_by_id_idx" ON "chat_conversations"("created_by_id");

-- CreateIndex
CREATE INDEX "chat_participants_user_id_left_at_idx" ON "chat_participants"("user_id", "left_at");

-- CreateIndex
CREATE INDEX "chat_read_states_user_id_idx" ON "chat_read_states"("user_id");

-- CreateIndex
CREATE INDEX "chat_messages_conversation_id_created_at_id_idx" ON "chat_messages"("conversation_id", "created_at", "id");

-- CreateIndex
CREATE INDEX "chat_messages_created_at_idx" ON "chat_messages"("created_at");

-- CreateIndex
CREATE INDEX "chat_messages_reply_to_id_idx" ON "chat_messages"("reply_to_id");

-- CreateIndex
CREATE UNIQUE INDEX "chat_messages_sender_id_client_msg_id_key" ON "chat_messages"("sender_id", "client_msg_id");

-- CreateIndex
CREATE INDEX "chat_attachments_message_id_idx" ON "chat_attachments"("message_id");

-- CreateIndex
CREATE INDEX "chat_attachments_orphan_created_at_idx" ON "chat_attachments"("created_at") WHERE (message_id IS NULL);

-- CreateIndex
CREATE INDEX "chat_attachments_uploader_id_created_at_idx" ON "chat_attachments"("uploader_id", "created_at");

-- CreateIndex (B M3: files-sweep `existingBlobKeys` tra theo khóa — một blob chỉ thuộc một dòng ⇒ file_key UNIQUE)
CREATE UNIQUE INDEX "chat_attachments_file_key_key" ON "chat_attachments"("file_key");

-- CreateIndex
CREATE INDEX "chat_attachments_preview_key_idx" ON "chat_attachments"("preview_key");

-- CreateIndex
CREATE INDEX "chat_attachments_thumb_key_idx" ON "chat_attachments"("thumb_key");

-- AddForeignKey
ALTER TABLE "chat_conversations" ADD CONSTRAINT "chat_conversations_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_conversations" ADD CONSTRAINT "chat_conversations_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_participants" ADD CONSTRAINT "chat_participants_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "chat_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_participants" ADD CONSTRAINT "chat_participants_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_read_states" ADD CONSTRAINT "chat_read_states_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "chat_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_read_states" ADD CONSTRAINT "chat_read_states_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "chat_conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_sender_id_fkey" FOREIGN KEY ("sender_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_reply_to_id_fkey" FOREIGN KEY ("reply_to_id") REFERENCES "chat_messages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_attachments" ADD CONSTRAINT "chat_attachments_uploader_id_fkey" FOREIGN KEY ("uploader_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_attachments" ADD CONSTRAINT "chat_attachments_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "chat_messages"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- CHECK (Prisma không biểu diễn — avatar-chat.md §3).
-- Loại ⇔ cột: DIRECT ⇔ direct_key; WORKSPACE ⇔ workspace_id; GROUP ⇔ title (tên nhóm không rỗng sau trim).
ALTER TABLE "chat_conversations" ADD CONSTRAINT "chat_conversations_kind_chk" CHECK (
  ("kind" = 'DIRECT') = ("direct_key" IS NOT NULL)
  AND ("kind" = 'WORKSPACE') = ("workspace_id" IS NOT NULL)
  AND ("kind" = 'GROUP') = ("title" IS NOT NULL)
);
ALTER TABLE "chat_conversations" ADD CONSTRAINT "chat_conversations_title_chk"
  CHECK ("title" IS NULL OR char_length(btrim("title")) BETWEEN 1 AND 80);
-- B M2: hai uuid đầy đủ (chữ thường) VÀ đúng thứ tự nhỏ:lớn — app lỡ tạo "B:A" sẽ bị chặn thay vì sinh DM thứ hai cho
-- cùng một cặp (UNIQUE không thấy). COLLATE "C" = so byte như `directKey()` của domain.
ALTER TABLE "chat_conversations" ADD CONSTRAINT "chat_conversations_direct_key_chk" CHECK (
  "direct_key" IS NULL OR (
    "direct_key" ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    AND split_part("direct_key", ':', 1) COLLATE "C" < split_part("direct_key", ':', 2) COLLATE "C"
  )
);
ALTER TABLE "chat_conversations" ADD CONSTRAINT "chat_conversations_last_message_chk"
  CHECK (("last_message_at" IS NULL) = ("last_message_id" IS NULL));

ALTER TABLE "chat_participants" ADD CONSTRAINT "chat_participants_left_chk"
  CHECK ("left_at" IS NULL OR "left_at" >= "joined_at");

-- Thân ≤ 4 000 ký tự (contracts đếm code point, Postgres char_length đếm ký tự — cùng nghĩa với UTF-8);
-- đã xóa ⇒ thân NULL.
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_body_chk"
  CHECK ("body" IS NULL OR char_length("body") <= 4000);
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_deleted_body_chk"
  CHECK ("deleted_at" IS NULL OR "body" IS NULL);
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_request_hash_chk"
  CHECK ("request_hash" ~ '^[0-9a-f]{64}$');

-- B L2: trần 20 MiB = trần tệp của ADR-141 (ảnh đã mã hóa lại còn nhỏ hơn).
ALTER TABLE "chat_attachments" ADD CONSTRAINT "chat_attachments_size_chk"
  CHECK ("size_bytes" >= 0 AND "size_bytes" <= 20 * 1024 * 1024);
-- B L1 (lớp 2 — app đã kiểm `isFileKey` trước mọi thao tác đĩa): khóa ĐẦY ĐỦ có tiền tố module `chat/` + 128 bit base32
-- (TL/G 18/10; thư mục ab/cd là việc riêng của LocalFileStore, DB không thấy).
ALTER TABLE "chat_attachments" ADD CONSTRAINT "chat_attachments_keys_chk" CHECK (
  "file_key" ~ '^chat/[a-z2-7]{26}$'
  AND ("preview_key" IS NULL OR "preview_key" ~ '^chat/[a-z2-7]{26}$')
  AND ("thumb_key" IS NULL OR "thumb_key" ~ '^chat/[a-z2-7]{26}$')
);
ALTER TABLE "chat_attachments" ADD CONSTRAINT "chat_attachments_dims_chk" CHECK (
  ("width" IS NULL) = ("height" IS NULL) AND ("width" IS NULL OR ("width" > 0 AND "height" > 0))
);
ALTER TABLE "chat_attachments" ADD CONSTRAINT "chat_attachments_sha256_chk" CHECK ("sha256" ~ '^[0-9a-f]{64}$');
