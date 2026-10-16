# T-027c — Chuẩn bị đo 1 vs 2 bản API sau LB (CHƯA chạy)

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

## Lượt đo gộp đề xuất (khi "máy rảnh", image build từ main có A3)
1. `bash load/run.sh` một lần chỉ để build image (hoặc `docker compose … build api migrate`) — nặng.
2. `ORDER="1 2" bash load/two-instance.sh` rồi `ORDER="2 1"` (đảo để loại hiệu ứng máy nóng dần) — ~2 × 2 × 8 phút.
3. `CPU_PROF=1 INSTANCES=1 STAGES=150 STAGE_SECONDS=60 SCENARIOS=board bash load/run.sh` (mục f của A3).
4. `bash load/single-rebalance-and-cpu.sh` + kịch bản rebalance 40 đồng thời — so với T-027b (A3).

## Rủi ro / giới hạn
- Máy dev: 2 bản API + Postgres + k6 cùng tranh CPU của VM Docker ⇒ "gần ×2" chỉ thấy nếu VM còn lõi rảnh; `environment.md` ghi số CPU của VM để đọc số đúng ngữ cảnh.
- Rate limit trong RAM (A3 §6 mục 3) nhân theo số bản — board dùng giới hạn theo user/IP trong Valkey nên không ảnh hưởng số đo; realtime (`realtime.js`) qua LB cần adapter — đã bật.
- Chưa chạy thật: lần đầu có thể lộ lỗi dựng (vd Caddy giữ XFF khác kỳ vọng ⇒ thấy 429 hàng loạt ở `rate_limited`) — đọc `rate_limited` trong board-summary trước khi tin số.
