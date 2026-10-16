# T-027c — Đo A3 + 1 vs 2 bản API sau LB + cpu-prof

**Người làm:** Engineer D (`taskflow-enterprise-6a`) · **Branch:** `feat/T-027c` (từ `main` 6900a97) · **Ngày:** 2026-10-16
**Căn cứ:** A3-report §6 mục 6 (kiểm chứng N container × 1 tiến trình Node sau LB, kỳ vọng gần ×2 tới khi Postgres bão hòa), T-027/T-027b (API chạm 1 lõi ở 150 RPS), Tech Lead: chuẩn bị, KHÔNG chạy — lượt đo gộp (A3 batch + 2 bản + cpu-prof) khi có "máy rảnh".

## Đã làm
| File | Nội dung |
|---|---|
| `load/compose.lb.yml` | Lớp phủ: `api2` (`extends` `api`), `lb` Caddy 2.11.7 (digest như compose prod D3), `UPSTREAMS` theo số bản; `SOCKET_REDIS_ADAPTER=true` + `TRUST_PROXY_HOPS=2` cho cả hai bản (bật cả khi 1 bản ⇒ hai lượt chỉ khác số bản); k6 → `http://lb:4000`. Không cổng host, Caddy `/data` `/config` trên tmpfs |
| `load/lb/Caddyfile` | `reverse_proxy {$UPSTREAMS}` round robin; `trusted_proxies static private_ranges` để giữ XFF giả theo user của k6 rồi nối IP k6 (nếu không: mọi user một IP ⇒ chỉ đo rate limiter); không health check chủ động (`/readyz` có hạn mức theo IP trong RAM) |
| `load/compose.load.yml` | `NODE_OPTIONS: ${API_NODE_OPTIONS:-}` + mount `${PROF_DIR}/api:/prof` (api2 mount `…/api2` — cả hai là PID 1, tránh trùng tên file) |
| `load/run.sh` | `INSTANCES=1\|2` (thêm `compose.lb.yml`, dựng `api [api2] lb`), `CPU_PROF=1`, `RESULTS_DIR`; `down` dừng êm các bản API trước (SIGTERM ⇒ exit 0 ⇒ Node ghi `.cpuprofile`); `stats-after-board` lấy mọi container của project; `environment.md` ghi số bản + cpu-prof. Không đặt `INSTANCES` ⇒ hành vi cũ (k6 → api trực tiếp) |
| `load/two-instance.sh` | Mỗi lượt (1 rồi 2 bản, `ORDER="2 1"` để đảo) dựng + seed LẠI, board 8 bậc (10…300 RPS mặc định), `docker stats` ~2 s, dọn; `compare.md`: request / đọc P95 / ghi P95 / lỗi theo bậc + điểm gãy |
| `load/README.md` | lệnh + 2 dòng bảng + ghi chú XFF sau LB |

## Kiểm chứng tĩnh (không dựng gì, không build)
| Kiểm | Kết quả |
|---|---|
| `docker compose -f compose.load.yml -f compose.lb.yml --profile tools config -q` | exit 0 — api/api2: `SOCKET_REDIS_ADAPTER=true`, `TRUST_PROXY_HOPS=2`, `NODE_OPTIONS` theo biến, mount `/prof` riêng; lb `UPSTREAMS`, depends_on api; k6 `BASE_URL=http://lb:4000` |
| `docker compose -f compose.load.yml config -q` (chế độ cũ) | exit 0 — `TRUST_PROXY_HOPS=1`, `NODE_OPTIONS` rỗng, không adapter |
| `caddy validate` (image 2.11.7, `UPSTREAMS` 2 bản) | Valid configuration |
| shellcheck `run.sh two-instance.sh single-rebalance-and-cpu.sh` | exit 0 |
| `--cpu-prof` qua `NODE_OPTIONS` + `process.exit` (Node 24 trên máy) | file `.cpuprofile` được ghi; API thoát exit 0 khi SIGTERM (`core/lifecycle/graceful-shutdown.ts`) |

## Kết quả lượt đo gộp (2026-10-16, 10:03–10:46, "máy rảnh" do Tech Lead cấp; F/E xác nhận không chạy gì nặng)
Image `taskflow-api:a3` build từ `feat/A3-batch-rebalance` @ `2667f6d` (cha = main `0339da1`); script đo `feat/T-027c`. VM Docker 10 CPU / 20 GB, host 12 luồng. Thư mục kết quả (gitignore): `load/results/20261016T030307Z` (a), `…T030847Z` (b), `…T030942Z-instances` (c, cpu-prof), `…T032817Z-instances` (c sạch).

**Lượt bỏ:** lần chạy (a) đầu (09:45–09:50) trùng `test:security` của F + verify gộp của Tech Lead ⇒ board 100 RPS đọc P95 81 ms (×6 so với T-027b) — **nhiễu, không dùng**. Chạy lại trên máy yên cho số bình thường ⇒ không cần image đối chứng (đã bắt đầu build `base0339` rồi dừng để giữ máy yên).

### (a) Rebalance đơn lẻ (nền board 50 RPS) + board 100→150 RPS — 1 bản, k6 gọi thẳng
| Đo | Trước A3 (T-027b) | A3 | |
|---|---|---|---|
| move kích hoạt rebalance cột 500 task — P50 / P95 / max (10 mẫu) | 812 / 874 / 893 ms | **65,5 / 79,9 / 88 ms** | ~11× nhanh hơn, **đạt NFR ghi < 300 ms** |
| move thường ngay sau — P95 | — | 20,1 ms | |
| board nền 50 RPS — đọc / ghi P95 | 10,3 / 12,7 ms | 12,4 / 17,0 ms | 0 lỗi |
| board 100 RPS — đọc / ghi P95 | 13,8 / 21,3 ms | 22,3 / 33,0 ms | |
| board 150 RPS — đọc / ghi P95 | 271,8 / 334,8 ms ❌ | **72,2 / 110,6 ms ✅** | API CPU TB 92 % (đỉnh 125 %), PG TB 44 % |

### (b) 40 rebalance đồng thời (kịch bản xấu nhất, T-027 §4)
| Đo | Trước A3 | A3 |
|---|---|---|
| move kích hoạt — P50 / P95 / max | 5 636 / 7 906 / 8 087 ms | **831,5 / 981,8 / 1 029 ms** (~8×) |
| move thường ngay sau — P95 | 6 792 ms | **344,3 ms** |
| số mẫu move thường | 29/40 (11 VU thiếu mẫu, chưa rõ lý do) | **40/40** |
Vẫn vượt NFR 300 ms ở kịch bản 40 cột rebalance cùng lúc — dự kiến (40 transaction ghi 500 dòng song song); không còn mất mẫu.

### (c) Board 8 bậc qua LB Caddy: 1 vs 2 bản API (`SOCKET_REDIS_ADAPTER=true`, `TRUST_PROXY_HOPS=2`)
Lượt sạch (không cpu-prof, `ORDER="2 1"`):

| RPS mục tiêu | Request 1 bản | Request 2 bản | Đọc P95 1 / 2 | Ghi P95 1 / 2 |
|---|---|---|---|---|
| ≤ 100 | ≈ như nhau | ≈ như nhau | 13–19 / 14–17 ms | 16–28 / 15–22 ms |
| 150 | 11 274 | 11 373 | **385 ❌** / 33,6 ms | 420 / 44 ms |
| 200 | 11 267 | 15 211 | 2 570 / **144,6 ms ✅** | 2 230 / 213 ms |
| 300 | 10 702 | 15 876 | 2 945 / 2 331 ms ❌ | 2 573 / 2 081 ms |

- **Điểm gãy NFR: 150 RPS (1 bản) → 300 RPS (2 bản).** Thông lượng trần ~188 req/s (1 bản) → ~265 req/s (2 bản) ⇒ **×1,4 trên máy dev**, chưa tới ×2: cùng VM còn k6, Caddy (TB 11 %, đỉnh 35 %), Postgres (đỉnh **113 %** ở lượt 2 bản) — trên hạ tầng thật (instance riêng, PG managed) kỳ vọng tốt hơn, nhưng **Postgres là nút cổ chai kế tiếp** cần theo dõi khi N > 1.
- 0 lỗi HTTP, **0 × 429** cả hai lượt ⇒ LB giữ đúng `X-Forwarded-For` theo user (không đo nhầm rate limiter). 409 tranh chấp: 57 (1 bản) / 37 (2 bản), không tính lỗi.
- 1 bản qua LB gãy ở 150 RPS (385 ms) trong khi (a) gọi thẳng không gãy (72 ms): thêm 1 hop Caddy + 7 bậc tải trước đó (dữ liệu tăng do 10 % tạo task) — số tuyệt đối giữa (a) và (c) không so trực tiếp.
- Lượt có cpu-prof (`ORDER="1 2"`): xu hướng như trên (300 RPS: 12 409 vs 22 660 request) nhưng **số tuyệt đối méo**: `NODE_OPTIONS` lọt vào healthcheck `node -e` mỗi 2 s ⇒ 680 file profile rác + CPU thêm, và một gai đơn lẻ ở 100 RPS (đọc P95 301 ms) không lặp lại ở lượt sạch. **Đã sửa:** healthcheck chạy `env NODE_OPTIONS= node …`.

### cpu-prof (A3 mục f) — tiến trình API chính, lượt 1 bản, 10→300 RPS (`…T030942Z-instances/n1/prof/api/*.cpuprofile`, 7,3 MB — mở bằng Chrome DevTools / speedscope)
Bận 57,6 % thời gian ghi (phần còn lại idle ở các bậc thấp). Self-time theo nhóm (% tổng):

| Nhóm | % tổng | ≈ % thời gian bận |
|---|---|---|
| `@prisma/client` (query compiler/serialize phía JS) | **18,9 %** | **~33 %** |
| native/builtin (`writev` 5,1 %, utf8, microtask) | 10,0 % | ~17 % |
| node-internal | 7,3 % | ~13 % |
| code app (`toDto` 1,7 % …) | 3,3 % | ~6 % |
| GC | 3,0 % | ~5 % |
| express (`stringify` response 2,4 %) + router | 3,4 % | ~6 % |
| `pg` + `pg-protocol` + `@prisma/adapter-pg` + `pg-pool` | 5,6 % | ~10 % |

Đọc số: CPU của một bản API bị **Prisma client chiếm ~1/3**; truy vấn DB vẫn nhanh (T-027 §5). Gợi ý cho A (chưa đo): truy vấn nóng `GET tasks` (60 % tải board) qua `$queryRaw`/`select` tối thiểu để bỏ lớp chuyển đổi của Prisma; xem kích thước payload (`writev` + `stringify` + `toDto` ≈ 9 %).

### Sửa script trong lượt đo (commit cùng báo cáo)
| Lỗi thấy khi chạy thật | Sửa |
|---|---|
| `environment.md` dòng git trống (`MSYS_NO_PATHCONV=1` ⇒ git.exe nhận `/d/…`) và không ghi image | `git -C "$(host_path …)"`; thêm dòng `image API / migrate` |
| `compare.md` không ghi được (node.exe nhận `/d/…` ⇒ `D:\d\…`) | truyền `host_path "$TOP"`; bảng của lượt đầu tạo lại tay từ JSON, cùng script |
| healthcheck thừa hưởng `NODE_OPTIONS` ⇒ hàng trăm profile rác | `env NODE_OPTIONS= node -e …` |
| `environment.md` in thừa giá trị `INSTANCES` | tách nhánh `if` |

## Lượt đo gộp đề xuất (kế hoạch ban đầu) (khi "máy rảnh", image build từ main có A3)
1. `bash load/run.sh` một lần chỉ để build image (hoặc `docker compose … build api migrate`) — nặng.
2. `ORDER="1 2" bash load/two-instance.sh` rồi `ORDER="2 1"` (đảo để loại hiệu ứng máy nóng dần) — ~2 × 2 × 8 phút.
3. `CPU_PROF=1 INSTANCES=1 STAGES=150 STAGE_SECONDS=60 SCENARIOS=board bash load/run.sh` (mục f của A3).
4. `bash load/single-rebalance-and-cpu.sh` + kịch bản rebalance 40 đồng thời — so với T-027b (A3).

## Rủi ro / giới hạn
- Máy dev: 2 bản API + Postgres + k6 cùng tranh CPU của VM Docker ⇒ "gần ×2" chỉ thấy nếu VM còn lõi rảnh; `environment.md` ghi số CPU của VM để đọc số đúng ngữ cảnh.
- Rate limit trong RAM (A3 §6 mục 3) nhân theo số bản — board dùng giới hạn theo user/IP trong Valkey nên không ảnh hưởng số đo; realtime (`realtime.js`) qua LB cần adapter — đã bật.
- Đã chạy thật 2026-10-16 (mục Kết quả): 0 × 429 ⇒ XFF qua LB đúng; các lỗi script lộ ra khi chạy đã sửa (bảng "Sửa script"). Mỗi cấu hình mới đo 1 lượt sạch — chênh lệch giữa 2 lượt (c) cho thấy nhiễu máy dev đáng kể ở bậc ≥ 200 RPS; kết luận định tính (điểm gãy 150 → 300, ×1,4–1,8) chắc hơn số tuyệt đối.
