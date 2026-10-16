# T-042 — Kiểm thử độc lập Mốc 3

**Giao cho:** Engineer F (`taskflow-enterprise-35`) · **Mốc:** 3 · **Song song** với T-037…T-041

## Nguồn
`docs/design/test-spec-hr.md` (đã chốt Q1–Q8) · `docs/design/attendance-leave.md` §8, §9.

## Việc cần làm
Bộ SEC-HR-* (security suite), CC-HR-* (×20, harness integration), E2E-HR-* (chromium + mobile); cổng E2E cho từng DONE của T-041; Stryker `attendance-domain` và `leave-domain` ≥ 90 % sau T-038/T-039. Ca nào đỏ trên code chưa sửa ⇒ báo chủ vé, không tự sửa code sản phẩm.

## Done
Mọi ca trong test-spec có test tương ứng (hoặc ghi OUT_OF_SCOPE có lý do + file phủ). `DONE T-042`.
