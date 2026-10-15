> ⚠️ **BẢN GỐC v1.0 — CHỈ ĐỂ THAM CHIẾU.** Mọi điểm mâu thuẫn được GHI ĐÈ bởi `docs/blueprint/DECISIONS.md` (v1.1).
> Code mẫu trong file này có lỗi đã biết (generic hỏng, optimistic lock không hoạt động, IDOR...). KHÔNG copy nguyên văn.

# TÀI LIỆU ĐẶC TẢ KỸ THUẬT & KIẾN TRÚC HỆ THỐNG (MASTER BLUEPRINT)
**Tên dự án:** TaskFlow Enterprise (Multi-tenant Task & Project Management SaaS)
**Phiên bản:** 1.0.0
**Kiến trúc:** Modular Monolith + Clean Architecture (Backend) & Feature-Sliced Design (Frontend)
**Nguyên tắc cốt lõi:** OOP, SOLID, Domain-Driven Design (DDD), Zero God Component / Zero God Class

---

## 1. BẢN ĐẶC TẢ SẢN PHẨM (PRD)

### 1.1. Mục tiêu Hệ thống & Chỉ số Phi chức năng
* **Mục tiêu:** Xây dựng nền tảng quản lý dự án và cộng tác theo mô hình Kanban thời gian thực, hỗ trợ đa không gian làm việc (Multi-workspace) và kiểm soát truy cập dựa trên vai trò (RBAC).
* **Hiệu năng:**
  * API đọc (GET P95): `< 150ms`.
  * API ghi (POST/PATCH/DELETE P95): `< 300ms`.
  * Độ trễ đồng bộ WebSocket giữa các client: `< 100ms`.
* **Bảo mật:**
  * Mật khẩu băm bằng `bcrypt` (cost factor >= 12).
  * JWT Access Token (hạn 15 phút) + Refresh Token Rotation lưu trong `HttpOnly, Secure, SameSite=Strict Cookie`, đối chiếu trạng thái thu hồi trên Redis.
  * Kiểm duyệt dữ liệu đầu vào tại tầng Presentation bằng `Zod`.
* **Bảo trì:** Unit Test Coverage tại tầng `domain` và `application` tối thiểu `80%`.

### 1.2. Ma trận Phân quyền (RBAC Matrix)

| Hành động / Quyền hạn | OWNER | PM | MEMBER | VIEWER |
| :--- | :---: | :---: | :---: | :---: |
| Quản lý cấu hình & xóa Workspace | ✅ | ❌ | ❌ | ❌ |
| Mời / Xóa thành viên khỏi Workspace | ✅ | ✅ | ❌ | ❌ |
| Tạo / Chỉnh sửa / Lưu trữ (Archive) Project | ✅ | ✅ | ❌ | ❌ |
| Tạo Task mới & Bình luận | ✅ | ✅ | ✅ | ❌ |
| Chuyển trạng thái Task (Kéo thả Kanban) | ✅ | ✅ | ✅ | ❌ |
| Xóa Task | ✅ | ✅ | ❌ (Chỉ người tạo) | ❌ |
| Xem bảng Kanban & Lịch sử hoạt động | ✅ | ✅ | ✅ | ✅ |

### 1.3. Yêu cầu Chức năng
* **FR-01 (Phiên & Định danh):** Đăng ký tự động khởi tạo Workspace mặc định trong cùng một DB Transaction. Hỗ trợ đăng nhập, làm mới token và đăng xuất toàn bộ thiết bị.
* **FR-02 (Workspace & Thành viên):** Người dùng tham gia nhiều Workspace với các vai trò khác nhau.
* **FR-03 (Project):** Mỗi Project có mã định danh ngắn (VD: `TF-101`, `WEB-204`) và danh sách công việc riêng.
* **FR-04 (Task Lifecycle):**
  * Tạo, sửa, xóa, gán `assignee`, đặt `dueDate`, `priority`.
  * Chuyển trạng thái theo **State Machine** (`TODO` <-> `IN_PROGRESS` <-> `REVIEW` <-> `DONE`).
  * Sắp xếp thẻ trong cột bằng `positionIndex` (Fractional Indexing): kéo thả chỉ cập nhật 1 bản ghi.
* **FR-05 (Audit & Realtime):** Mọi thay đổi trạng thái hoặc người phụ trách phát sinh `DomainEvent` → ghi `TaskAuditLog` và phát qua `Socket.io` tới thành viên đang mở cùng Project.

---

## 2. QUY CHUẨN KIẾN TRÚC

### 2.1. Zero God Component / Zero God Class (Bắt buộc)
1. React Component ≤ **150 dòng**. Class/UseCase backend ≤ **200 dòng**.
2. Frontend: CẤM gọi `axios`/`fetch` trong `.tsx` — mạng nằm ở `api/`, điều phối qua hooks tại `hooks/`. CẤM > 3 `useState` trong một Presentational Component.
3. Backend: CẤM logic nghiệp vụ / gọi `prisma` trong Controller. CẤM import `@prisma/client`, `express`, `redis`, `socket.io` vào `domain/`.

### 2.2. OOP
* **Encapsulation:** thuộc tính Entity là `private`; không có `setStatus` công khai, phải gọi `task.transitionTo()`, `task.assignTo()`.
* **Abstraction:** Application giao tiếp hạ tầng qua Interface (`ITaskRepository`, `ICacheService`, `IEventBus`).
* **Inheritance:** Entity kế thừa `BaseEntity<T>`; lỗi kế thừa `AppError`.
* **Polymorphism:** `ErrorHandlerMiddleware` ánh xạ mọi `AppError` ra HTTP status mà không dùng chuỗi if/else theo loại lỗi.

### 2.3. SOLID
| Nguyên lý | Quy tắc |
| :--- | :--- |
| S | Mỗi UseCase là một class trong 1 file. Không có `TaskService` khổng lồ. |
| O | Thêm hành động phụ (email, webhook, audit) bằng Listener mới đăng ký vào EventBus, không sửa UseCase. |
| L | `PrismaTaskRepository` và `InMemoryTaskRepository` cùng implement `ITaskRepository`, thay thế được cho nhau. |
| I | Tách `ITaskReadRepository` và `ITaskWriteRepository`. |
| D | UseCase nhận dependency qua constructor; khởi tạo cụ thể tại `*.module.ts` (Composition Root). |

---

## 3. LUỒNG HOẠT ĐỘNG

### 3.1. Luồng Move Task
Client kéo thẻ → hook cập nhật Optimistic UI → `PATCH /api/v1/tasks/:id/status` → Auth + RBAC → Controller validate Zod → `MoveTaskStatusUseCase.execute({ taskId, targetStatus, actorId })` → `repo.findById` → `task.transitionTo()` (kiểm tra state machine, tạo `TaskStatusChangedEvent`) → `repo.save` → `eventBus.publishAll(task.pullDomainEvents())` → song song: AuditLogListener ghi `task_audit_logs`; SocketGateway phát `task:updated` vào phòng Project → trả `TaskResponseDTO` 200.

### 3.2. State Machine
```
[*] --> TODO
TODO --> IN_PROGRESS
IN_PROGRESS --> TODO
IN_PROGRESS --> REVIEW
REVIEW --> IN_PROGRESS
REVIEW --> DONE
DONE --> REVIEW   (Reopen)
```

### 3.3. ERD
USER 1-n REFRESH_TOKEN; USER n-n WORKSPACE qua WORKSPACE_MEMBER(role OWNER|PM|MEMBER|VIEWER); WORKSPACE 1-n PROJECT(name, key_prefix, is_archived); PROJECT 1-n TASK(assignee_id, title, description, status, priority, position_index float, version int, due_date); TASK 1-n TASK_AUDIT_LOG(actor_id, action, old_value jsonb, new_value jsonb).

---

## 4. CẤU TRÚC THƯ MỤC (gốc)

```text
taskflow-enterprise/
├── docker-compose.yml
├── .env.example
├── backend/
│   ├── prisma/{schema.prisma, seed.ts}
│   └── src/
│       ├── config/{env.config.ts (Zod), db.config.ts, redis.config.ts}
│       ├── core/
│       │   ├── domain/{BaseEntity.ts, IDomainEvent.ts}
│       │   ├── errors/{AppError.ts, error.middleware.ts}
│       │   ├── events/{IEventBus.ts, InMemoryEventBus.ts}
│       │   └── middlewares/{auth.middleware.ts, rbac.middleware.ts}
│       ├── modules/
│       │   ├── auth/{domain,application,infrastructure,presentation,auth.module.ts}
│       │   ├── workspace/{domain,application,infrastructure,presentation,workspace.module.ts}
│       │   └── task/
│       │       ├── domain/{entities/Task.entity.ts, events/TaskStatusChanged.event.ts, repositories/ITaskRepository.ts}
│       │       ├── application/{dtos/Task.dto.ts, use-cases/{CreateTask,MoveTaskStatus,GetProjectTasks,DeleteTask}.usecase.ts}
│       │       ├── infrastructure/{persistence/{PrismaTask.repository.ts, InMemoryTask.repository.ts}, listeners/TaskRealtime.listener.ts}
│       │       ├── presentation/{Task.validator.ts, Task.controller.ts, Task.routes.ts}
│       │       └── task.module.ts
│       ├── app.ts
│       └── server.ts
└── frontend/   (Next.js + Feature-Sliced Design)
    └── src/
        ├── shared/{api/httpClient.ts, ui/{Button,Badge,Input,Select}.tsx, hooks/useSocket.ts}
        ├── features/
        │   ├── auth/{api/auth.api.ts, hooks/useAuthForm.ts, components/LoginForm.tsx}
        │   └── task-board/{types/task.types.ts, api/task.api.ts, hooks/{useTaskBoard,useCreateTaskForm}.ts,
        │                   components/{CreateTaskToolbar,KanbanBoardGrid,KanbanColumn,TaskCard}.tsx, index.ts}
        └── app/{layout.tsx, page.tsx, (dashboard)/projects/[projectId]/page.tsx}
```

---

## 5. SCHEMA PRISMA (gốc)

```prisma
enum WorkspaceRole { OWNER PM MEMBER VIEWER }
enum TaskStatus { TODO IN_PROGRESS REVIEW DONE }
enum TaskPriority { LOW MEDIUM HIGH URGENT }

model User {
  id String @id @default(uuid())
  email String @unique
  passwordHash String @map("password_hash")
  fullName String @map("full_name")
  memberships WorkspaceMember[]
  assignedTasks Task[] @relation("TaskAssignee")
  refreshTokens RefreshToken[]
  auditLogs TaskAuditLog[]
  createdAt DateTime @default(now()) @map("created_at")
  updatedAt DateTime @updatedAt @map("updated_at")
  @@map("users")
}

model RefreshToken {
  id String @id @default(uuid())
  tokenHash String @unique @map("token_hash")
  userId String @map("user_id")
  user User @relation(fields: [userId], references: [id], onDelete: Cascade)
  isRevoked Boolean @default(false) @map("is_revoked")
  expiresAt DateTime @map("expires_at")
  createdAt DateTime @default(now()) @map("created_at")
  @@index([userId])
  @@map("refresh_tokens")
}

model Workspace {
  id String @id @default(uuid())
  name String
  slug String @unique
  members WorkspaceMember[]
  projects Project[]
  createdAt DateTime @default(now()) @map("created_at")
  updatedAt DateTime @updatedAt @map("updated_at")
  @@map("workspaces")
}

model WorkspaceMember {
  id String @id @default(uuid())
  workspaceId String @map("workspace_id")
  userId String @map("user_id")
  role WorkspaceRole @default(MEMBER)
  workspace Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  user User @relation(fields: [userId], references: [id], onDelete: Cascade)
  joinedAt DateTime @default(now()) @map("joined_at")
  @@unique([workspaceId, userId])
  @@index([userId])
  @@map("workspace_members")
}

model Project {
  id String @id @default(uuid())
  workspaceId String @map("workspace_id")
  name String
  keyPrefix String @map("key_prefix")
  description String?
  isArchived Boolean @default(false) @map("is_archived")
  workspace Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  tasks Task[]
  createdAt DateTime @default(now()) @map("created_at")
  updatedAt DateTime @updatedAt @map("updated_at")
  @@index([workspaceId])
  @@map("projects")
}

model Task {
  id String @id @default(uuid())
  projectId String @map("project_id")
  assigneeId String? @map("assignee_id")
  title String
  description String?
  status TaskStatus @default(TODO)
  priority TaskPriority @default(MEDIUM)
  positionIndex Float @default(1000.0) @map("position_index")
  version Int @default(1)
  dueDate DateTime? @map("due_date")
  project Project @relation(fields: [projectId], references: [id], onDelete: Cascade)
  assignee User? @relation("TaskAssignee", fields: [assigneeId], references: [id], onDelete: SetNull)
  auditLogs TaskAuditLog[]
  createdAt DateTime @default(now()) @map("created_at")
  updatedAt DateTime @updatedAt @map("updated_at")
  @@index([projectId, status, positionIndex])
  @@index([assigneeId])
  @@map("tasks")
}

model TaskAuditLog {
  id String @id @default(uuid())
  taskId String @map("task_id")
  actorId String @map("actor_id")
  action String
  oldValue Json? @map("old_value")
  newValue Json? @map("new_value")
  task Task @relation(fields: [taskId], references: [id], onDelete: Cascade)
  actor User @relation(fields: [actorId], references: [id], onDelete: Cascade)
  createdAt DateTime @default(now()) @map("created_at")
  @@index([taskId, createdAt])
  @@map("task_audit_logs")
}
```

---

## 6. API & WEBSOCKET (gốc)

| Phân hệ | Method | URI | Quyền tối thiểu | Payload |
| :--- | :---: | :--- | :---: | :--- |
| Auth | POST | `/api/v1/auth/register` | Public | `{ email, password, fullName }` → User + Default Workspace/Project |
| Auth | POST | `/api/v1/auth/login` | Public | `{ email, password }` → Access Token + Cookie Refresh |
| Auth | POST | `/api/v1/auth/refresh` | Cookie | Xoay vòng Refresh, cấp Access mới |
| Project | GET | `/api/v1/workspaces/:wsId/projects` | VIEWER | |
| Project | POST | `/api/v1/workspaces/:wsId/projects` | PM | `{ name, keyPrefix, description }` |
| Task | GET | `/api/v1/tasks?projectId=:id` | VIEWER | sắp theo positionIndex |
| Task | POST | `/api/v1/tasks` | MEMBER | `{ projectId, title, priority, description?, dueDate? }` |
| Task | PATCH | `/api/v1/tasks/:id/status` | MEMBER | `{ status, positionIndex? }` |
| Task | DELETE | `/api/v1/tasks/:id` | PM | |

Envelope thành công: `{ "success": true, "data": {...}, "meta": { "timestamp": "..." } }`
Envelope lỗi: `{ "success": false, "error": { "code": "BUSINESS_RULE_VIOLATION", "message": "...", "details": null } }`

WebSocket: client gửi `project:join` + `projectId` → server cho vào phòng `project:{projectId}`. Server phát: `task:created`, `task:moved` (`{ taskId, oldStatus, newStatus, updatedBy }`), `task:deleted` (`{ taskId }`).

---

## 7. CODE KHUNG (gốc — tóm tắt các ý định thiết kế)

* `BaseEntity<TProps>`: `protected props`, `addDomainEvent()`, `pullDomainEvents()`.
* `AppError` abstract có `statusCode`, `errorCode`, `details`; con: `BusinessRuleViolationError(422)`, `ResourceNotFoundError(404)`, `UnauthorizedError(401)`, `ForbiddenError(403)`. `globalErrorHandler` xử lý `AppError`, `ZodError`(400), còn lại 500.
* `InMemoryEventBus`: `subscribe(eventName, handler)`, `publishAll(events)`.
* `TaskEntity`: `ALLOWED_TRANSITIONS` theo state machine; `create()` (status TODO, trim title), `reconstitute()`, `ensureValidTitle` (≥3 ký tự), `transitionTo(target, actorId, newPositionIndex?)` (kiểm tra transition, phát `TaskStatusChangedEvent {taskId, projectId, actorId, oldStatus, newStatus}`, cập nhật position, `version += 1`), `toPrimitives()`.
* `ITaskReadRepository { findById, findByProject }`, `ITaskWriteRepository { save, delete }`.
* `CreateTaskUseCase`, `MoveTaskStatusUseCase` (findById → transitionTo → save → publishAll).
* `PrismaTaskRepository` dùng `upsert` (⚠️ không kiểm tra version).
* `TaskController` validate Zod: create `{projectId uuid, title 3..150, description?, priority?}`, move `{status, positionIndex?}`.
* Frontend: `task.types.ts` + `KANBAN_COLUMNS` (TODO "Cần làm", IN_PROGRESS "Đang thực hiện", REVIEW "Đang kiểm duyệt", DONE "Hoàn thành"); `useCreateTaskForm` (title, priority, isSubmitting, handleSubmit); `CreateTaskToolbar` dùng hook đó.

---

## 8. HẠ TẦNG
`.env`: `DATABASE_URL`, `REDIS_URL`, `PORT=4000`, `NODE_ENV`, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `FRONTEND_URL=http://localhost:3000`, `NEXT_PUBLIC_API_URL=http://localhost:4000/api/v1`, `NEXT_PUBLIC_WS_URL=http://localhost:4000`.
Docker: `postgres:16-alpine` (user taskflow_user, db taskflow_db, cổng 5432, volume pg_data), `redis:7-alpine` (6379).

## 9. ROADMAP (gốc)
1. Nền tảng: thư mục, docker, prisma migrate, core.
2. Auth/Workspace/RBAC: UserEntity, RegisterUserUseCase (transaction), Login/Refresh + Redis, middlewares.
3. Task + realtime: TaskEntity, unit test với InMemory repo, Prisma repo/controller/routes, TaskRealtimeListener.
4. Frontend: httpClient interceptor, shared/ui, task-board, useSocket.
